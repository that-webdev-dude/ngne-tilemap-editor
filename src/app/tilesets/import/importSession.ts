import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { PixelBuffer } from "../../../core/model";
import { addTilesetCommand } from "../../../core/tileset";
import type { TilesetImport } from "../../../core/tileset";
import { activeHistory, sessionStore } from "../../state/session";
import { toolPipeline } from "../../tools/appPipeline";
import { WorkerError } from "../../worker/protocol";
import type { WorkerClient } from "../../worker/client";
import type { TilesetImportInput } from "../../worker/tasks/tileset.task";
import {
    changedForm,
    gridKey,
    gridOf,
    initialForm,
    nameProblem,
    planOf,
    rememberGrid,
} from "./importForm";
import type { ImportForm, ImportPlan } from "./importForm";
import { decodable } from "./importSources";
import type { ImportSource } from "./importSources";

// One run of the Import Tileset dialog (SPEC §6.1, DESIGN §9; TE-024): the source, the form and
// its plan, and the work the background worker does for them. Decoding and slicing run in the
// worker; nothing is sent to it while the plan refuses (a limit, packability, a tile size above
// 256), so such a refusal shows before any decode. A grid PNG is decoded once for the pane; a
// sprite's frame is composited for the pane when it is chosen, and its import runs at every
// change of the grid (debounced) for the counts and warnings the form shows, the last one kept
// for Import. Import runs the add-tileset command, one history entry, while the dialog stays
// open ("Importing…"); it closes once the tileset is added, and otherwise shows why not.

/** An answer of the worker for a grid of a sprite: the import, or why there is none. */
export interface SpriteImportResult {
    key: string;
    imported: TilesetImport | null;
    error: string | null;
}

export interface ImportSessionState {
    readonly source: ImportSource;
    readonly form: ImportForm;
    readonly plan: ImportPlan;
    /** Why the name or export name cannot be taken. */
    readonly nameProblem: string | null;
    /** What the source pane shows: the grid PNG, or the sprite's chosen frame. */
    readonly pixels: PixelBuffer | null;
    /** The pixels are being made in the worker. */
    readonly loadingPixels: boolean;
    /** Why the pane has no pixels. */
    readonly pixelsError: string | null;
    /** A sprite's import for the form's grid, or null while there is none yet. */
    readonly spriteResult: SpriteImportResult | null;
    /** A sprite's import is being made for the form's grid. */
    readonly computing: boolean;
    /** Import adds the tileset. */
    readonly importing: boolean;
    /** Why the last Import added nothing; cleared by the next change. */
    readonly failure: string | null;
    /** The tileset Import added: its name and tile count. */
    readonly added: { name: string; tiles: number } | null;
}

export interface ImportSession {
    readonly store: StoreApi<ImportSessionState>;
    /** Changes fields of the form. */
    change(patch: Partial<ImportForm>): void;
    /** Whether Import can run now. */
    canImport(): boolean;
    /** Imports: resolves with the tileset's name and tile count once added, else null. */
    confirm(): Promise<{ name: string; tiles: number } | null>;
    /** Stops the work in the worker. */
    dispose(): void;
}

export interface ImportSessionOptions {
    /** The worker that decodes and slices; the app's by default. */
    worker: Pick<WorkerClient, "run">;
    /** How long a sprite's import waits after a change of the grid, in ms. */
    delayMs?: number;
}

/**
 * Whether Import can run in `state`: the plan and the names hold, nothing is being added, and
 * a sprite's import for the form's grid is there (the import whose counts the form shows).
 */
export function canImportState(state: ImportSessionState): boolean {
    if (!state.plan.ok || state.nameProblem !== null || state.importing) return false;
    if (state.source.kind !== "sprite") return true;
    const { spriteResult } = state;
    return (
        !state.computing &&
        spriteResult !== null &&
        spriteResult.key === gridKey(state.form) &&
        spriteResult.imported !== null
    );
}

function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

const cancelled = (error: unknown) => error instanceof WorkerError && error.code === "cancelled";

/** Whether the history can take a command now: no transaction, no stroke. */
const historyIdle = () => !activeHistory().transaction && !toolPipeline.stroking;

export function createImportSession(
    source: ImportSource,
    { worker, delayMs = 150 }: ImportSessionOptions,
): ImportSession {
    const project = () => sessionStore.getState().session.project;
    const form = initialForm(sessionStore.getState().session, source);
    const store = createStore<ImportSessionState>(() => ({
        source,
        form,
        plan: planOf(project(), source, form),
        nameProblem: nameProblem(project(), form),
        pixels: null,
        loadingPixels: false,
        pixelsError: null,
        spriteResult: null,
        computing: false,
        importing: false,
        failure: null,
        added: null,
    }));
    let disposed = false;
    /** The pane's pixels being asked for, and whether the worker has started on them. */
    let pixelsRequest: { controller: AbortController; started: boolean } | null = null;
    let spriteTimer: ReturnType<typeof setTimeout> | null = null;
    /** The newest sprite import asked of the worker, pending or settled, by its grid's key. */
    let sprite: {
        key: string;
        controller: AbortController;
        /** The worker has taken it up: it is left to finish rather than end the worker. */
        started: boolean;
        failed: boolean;
        result: Promise<SpriteImportResult>;
    } | null = null;

    const importInput = (state: ImportSessionState): TilesetImportInput | null => {
        const grid = gridOf(state.form);
        const options = { fileName: source.fileName, ...grid };
        switch (source.kind) {
            case "image":
                return { kind: "image", bytes: source.bytes, options };
            case "sprite":
                return { kind: "sprite", key: source.key, bytes: source.bytes, options };
            case "atlas":
                return {
                    kind: "atlas",
                    json: source.json,
                    png: source.png.bytes,
                    options: { fileName: source.fileName },
                };
            case "refused":
                return null;
        }
    };

    /**
     * Whether the plan refuses for a pixel limit or packability: nothing is decoded then, not
     * even for the pane (SPEC §6.1).
     */
    const roomRefused = () => {
        const { plan } = store.getState();
        return !plan.ok && (plan.code === "limit" || plan.code === "packability");
    };

    /** The pane's pixels were not asked for while the plan refused for room. */
    let pixelsSkipped = false;

    const loadPixels = () => {
        // A request the worker has started is left to finish: ending it would end the worker
        // and the sprite it holds. Its answer is dropped.
        if (pixelsRequest && !pixelsRequest.started) pixelsRequest.controller.abort();
        pixelsRequest = null;
        pixelsSkipped = false;
        if (source.kind !== "image" && source.kind !== "sprite") return;
        if (roomRefused() || (source.kind === "image" && !decodable(source.size))) {
            pixelsSkipped = true;
            store.setState({ pixels: null, loadingPixels: false });
            return;
        }
        const own = { controller: new AbortController(), started: false };
        const options = {
            signal: own.controller.signal,
            onStarted: () => void (own.started = true),
        };
        const request: Promise<PixelBuffer> =
            source.kind === "image"
                ? worker.run("png.decode", { bytes: source.bytes }, options)
                : worker.run(
                      "tileset.spriteFrame",
                      { key: source.key, bytes: source.bytes, frame: store.getState().form.frame },
                      options,
                  );
        pixelsRequest = own;
        store.setState({ loadingPixels: true, pixelsError: null });
        request.then(
            (pixels) => {
                if (pixelsRequest !== own) return;
                pixelsRequest = null;
                store.setState({ pixels, loadingPixels: false });
            },
            (error: unknown) => {
                if (pixelsRequest !== own || cancelled(error)) return;
                pixelsRequest = null;
                store.setState({ pixels: null, loadingPixels: false, pixelsError: reason(error) });
            },
        );
    };

    /** Shows the sprite import of `key` once settled, while it is the form's grid. */
    const show = (key: string, result: Promise<SpriteImportResult>) =>
        void result.then((settled) => {
            if (sprite?.key === key && gridKey(store.getState().form) === key) {
                store.setState({ spriteResult: settled, computing: false });
            }
        });

    /** Stops the sprite import asked last, unless the worker has started it. */
    const dropSprite = () => {
        if (sprite && !sprite.started) sprite.controller.abort();
        sprite = null;
    };

    /**
     * Asks the worker for the sprite's import of the form's grid, unless it has it or is
     * making it; one that failed is asked again.
     */
    const requestSprite = (): Promise<SpriteImportResult> | null => {
        const state = store.getState();
        const input = importInput(state);
        if (source.kind !== "sprite" || !state.plan.ok || !input) return null;
        const key = gridKey(state.form);
        if (sprite?.key === key && !sprite.failed) return sprite.result;
        dropSprite();
        const controller = new AbortController();
        const own: NonNullable<typeof sprite> = {
            key,
            controller,
            started: false,
            failed: false,
            result: worker
                .run("tileset.import", input, {
                    signal: controller.signal,
                    onStarted: () => void (own.started = true),
                })
                .then(
                    (imported): SpriteImportResult => ({ key, imported, error: null }),
                    (error: unknown): SpriteImportResult => {
                        own.failed = true;
                        return {
                            key,
                            imported: null,
                            error: cancelled(error) ? "The import was cancelled." : reason(error),
                        };
                    },
                ),
        };
        sprite = own;
        store.setState({ computing: true });
        show(key, own.result);
        return own.result;
    };

    /** After a change of the grid: the sprite's import of the new grid, after a pause. */
    const scheduleSprite = () => {
        if (source.kind !== "sprite") return;
        if (spriteTimer !== null) clearTimeout(spriteTimer);
        spriteTimer = null;
        const state = store.getState();
        if (!state.plan.ok) {
            dropSprite();
            store.setState({ spriteResult: null, computing: false });
            return;
        }
        const key = gridKey(state.form);
        store.setState({ computing: true });
        if (sprite?.key === key && !sprite.failed) {
            show(key, sprite.result);
            return;
        }
        spriteTimer = setTimeout(() => {
            spriteTimer = null;
            if (!disposed) void requestSprite();
        }, delayMs);
    };

    const change = (patch: Partial<ImportForm>) => {
        if (disposed || store.getState().importing) return;
        const previous = store.getState().form;
        const next = changedForm(project(), previous, patch);
        store.setState({
            form: next,
            plan: planOf(project(), source, next),
            nameProblem: nameProblem(project(), next),
            failure: null,
        });
        // The pane loads once the plan no longer refuses for room.
        if (next.frame !== previous.frame || (pixelsSkipped && !roomRefused())) loadPixels();
        if (gridKey(next) !== gridKey(previous)) scheduleSprite();
    };

    const canImport = () => canImportState(store.getState());

    const importNow = async (): Promise<TilesetImport | string> => {
        if (source.kind === "sprite") {
            const settled = await requestSprite();
            if (!settled) return "There is nothing to import.";
            return settled.imported ?? settled.error ?? "There is nothing to import.";
        }
        const input = importInput(store.getState());
        if (!input) return "There is nothing to import.";
        try {
            return await worker.run("tileset.import", input);
        } catch (error) {
            return reason(error);
        }
    };

    const confirm = async () => {
        if (disposed || !canImport()) return null;
        store.setState({ importing: true, failure: null });
        const fail = (failure: string) => {
            store.setState({ importing: false, failure });
            return null;
        };
        const imported = await importNow();
        if (disposed) return null;
        if (typeof imported === "string") return fail(imported);
        const { form } = store.getState();
        // The project may have changed while the worker ran.
        const plan = planOf(project(), source, form);
        if (!plan.ok) return fail(plan.problem);
        const problem = nameProblem(project(), form);
        if (problem) return fail(problem);
        if (!historyIdle()) return fail("Finish the stroke on the map first.");
        const { tileset } = imported;
        tileset.name = form.name;
        tileset.exportName = form.exportName;
        try {
            activeHistory().execute(addTilesetCommand(tileset));
        } catch (error) {
            return fail(reason(error));
        }
        if (source.kind === "image") rememberGrid(form);
        const added = { name: tileset.name, tiles: tileset.tiles.length };
        store.setState({ importing: false, added });
        return added;
    };

    loadPixels();
    scheduleSprite();

    return {
        store,
        change,
        canImport,
        confirm,
        dispose() {
            disposed = true;
            if (spriteTimer !== null) clearTimeout(spriteTimer);
            pixelsRequest?.controller.abort();
            sprite?.controller.abort();
            // The worker lets the sprite go: its images may be large.
            if (source.kind === "sprite") {
                worker.run("tileset.releaseSprite", { key: source.key }).catch(() => {});
            }
        },
    };
}
