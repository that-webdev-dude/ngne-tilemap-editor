import type { Command } from "../../../core/history";
import type { TilesetSourceKind } from "../../../core/model";
import type { UpdateSourceFiles, UpdateSummary } from "../../../core/tileset";
import { matchTiles, updateFromSourceCommand } from "../../../core/tileset";
import { commandDialogs } from "../../dialogs/dialogRequests";
import { notices } from "../../notices/notices";
import { sessionStore } from "../../state/session";
import { backgroundWorker } from "../../worker/client";
import type { WorkerClient } from "../../worker/client";
// The task type, so that `run("tileset.updateSource")` is typed outside the worker's own glob.
import type { UpdateTilesetInput } from "../../worker/tasks/tilesetUpdate.task";
import { currentTileset, historyIdle } from "../edit/tilesetEdit";
import { readImportSource } from "../import/importSources";
import type { PickedFile } from "../import/importSources";
import { pickedFile } from "../import/pickTilesetFiles";
import { createUpdateSession } from "./updateSession";
import type { UpdateSession } from "./updateSession";

// Tileset → Update Tileset from Source… (SPEC §6.3, DESIGN §5 and §9; TE-028). The source file
// is picked, or dropped on the tileset's tab in the Tilesets panel; the worker reads it with
// the tileset's recorded parameters and matches it. With nothing ambiguous or missing the
// update applies at once, one history entry, and a toast gives the counts; otherwise the
// dialog asks for a choice per ambiguous and missing tile, and its Apply makes the entry. A
// browser's open picker cannot be given a file name, so the picker takes only files of the
// source's kind and a toast names the recorded file as it opens. One update at a time: files
// picked or dropped while one runs are ignored.

export interface UpdateTilesetRequest {
    kind: "update-tileset";
    session: UpdateSession;
    /** True once the update is applied, null when cancelled. Closes the dialog. */
    answer(values: true | null): void;
}

/** The types the picker offers for a source of `kind` (SUITE §7). */
export function updatePickerAccept(kind: Exclude<TilesetSourceKind, "collection">): string {
    switch (kind) {
        case "image":
            return "image/png,.png";
        case "sprite":
            return ".ngsprite,application/zip";
        case "atlas":
            return ".atlas.json,image/png,.png";
    }
}

/** "10 unchanged, 1 moved, 1 changed, 0 new, 1 ambiguous, 3 missing" (DESIGN §9). */
export function summaryText(summary: UpdateSummary): string {
    const { unchanged, moved, changed, ambiguous, missing } = summary;
    return [
        `${unchanged} unchanged`,
        `${moved} moved`,
        `${changed} changed`,
        `${summary.new} new`,
        `${ambiguous} ambiguous`,
        `${missing} missing`,
    ].join(", ");
}

let running = false;

/** Whether an update is in progress (its files are read, or its dialog is open). */
export function updatingTileset(): boolean {
    return running;
}

function reason(error: unknown): string {
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/** The files of the source as the update reads them, or why there are none. */
async function sourceFiles(files: readonly PickedFile[]): Promise<UpdateSourceFiles | string> {
    const source = await readImportSource(files);
    if (!source) return "The source is a .png, an .ngsprite, or an .atlas.json with its PNG.";
    switch (source.kind) {
        case "image":
            return { kind: "image", png: source.bytes };
        case "sprite":
            return { kind: "sprite", bytes: source.bytes };
        case "atlas":
            return { kind: "atlas", json: source.json, png: source.png.bytes };
        case "refused":
            return source.message;
    }
}

/**
 * Updates tileset `tilesetId` from `files`. Resolves true once the update is applied; false
 * when it is cancelled, changes nothing, is refused (reported by a toast), or another update
 * is in progress.
 */
export async function updateTilesetFromFiles(
    tilesetId: string,
    files: readonly PickedFile[],
    worker: Pick<WorkerClient, "run"> = backgroundWorker,
): Promise<boolean> {
    if (running) return false;
    const project = () => sessionStore.getState().session.project;
    const tileset = project().tilesets.find((each) => each.id === tilesetId);
    if (!tileset) return false;
    const { name } = tileset;
    const fail = (message: string) => {
        notices.error(`Could not update tileset “${name}”. ${message}`);
        return false;
    };
    running = true;
    try {
        const read = await sourceFiles(files);
        if (typeof read === "string") return fail(read);
        const input: UpdateTilesetInput = {
            tileset: {
                id: tileset.id,
                name,
                tileWidth: tileset.tileWidth,
                tileHeight: tileset.tileHeight,
                source: { ...tileset.source },
                tiles: tileset.tiles.map(({ id, sourceKey, fingerprint }) => ({
                    id,
                    sourceKey,
                    fingerprint,
                })),
            },
            files: read,
        };
        let result;
        try {
            result = await worker.run("tileset.updateSource", input);
        } catch (error) {
            return fail(reason(error));
        }
        const { source } = result;
        // The project may have changed while the worker read: the tileset removed (an undo
        // of its import), or its tiles changed (an undo of an earlier update). The rows are
        // the matching of the tiles as they are now.
        const current = project().tilesets.find((each) => each.id === tilesetId);
        if (!current) return fail("The tileset was removed while its source was read.");
        const match =
            current.tiles === tileset.tiles
                ? result.match
                : matchTiles(current.tiles, source.entries);
        const execute = (command: Command) => sessionStore.getState().history.execute(command);
        const busy = () => (historyIdle() ? null : "Finish the stroke on the map first.");

        if (match.ambiguous.length === 0 && match.missing.length === 0) {
            const problem = busy();
            if (problem) return fail(problem);
            let command;
            try {
                command = updateFromSourceCommand(project(), tilesetId, source);
            } catch (error) {
                return fail(reason(error));
            }
            if (!command) {
                notices.info(`Tileset “${name}” is up to date with its source.`);
                return false;
            }
            execute(command);
            notices.info(`Updated tileset “${name}”: ${summaryText(match.summary)}.`);
            return true;
        }

        const session = createUpdateSession(
            { tilesetId, tilesetName: name, source, match },
            { project, execute, busy },
        );
        const answer = await commandDialogs.open<true>((answer): UpdateTilesetRequest => ({
            kind: "update-tileset",
            session,
            answer,
        }));
        if (answer !== true) return false;
        if (session.store.getState().outcome !== "applied") {
            notices.info(`Tileset “${name}” is up to date with its source.`);
            return false;
        }
        notices.info(`Updated tileset “${name}”.`);
        return true;
    } finally {
        running = false;
    }
}

/** Asks for the source files of a source of `kind`; resolves null when the user cancels. */
export function pickUpdateFiles(
    kind: Exclude<TilesetSourceKind, "collection">,
): Promise<PickedFile[] | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = updatePickerAccept(kind);
        // An atlas is picked with its PNG.
        input.multiple = kind === "atlas";
        input.hidden = true;
        input.dataset.updateTilesetInput = "";
        const finish = (files: readonly File[] | null) => {
            input.remove();
            resolve(files && files.length > 0 ? files.map(pickedFile) : null);
        };
        input.addEventListener("change", () => finish(Array.from(input.files ?? [])), {
            once: true,
        });
        input.addEventListener("cancel", () => finish(null), { once: true });
        document.body.append(input);
        input.click();
    });
}

/** Whether the shown tileset can be updated now: one is shown, of a kind TE-028 reads. */
export function canUpdateCurrentTileset(): boolean {
    const tileset = currentTileset();
    return tileset !== null && tileset.source.kind !== "collection" && historyIdle() && !running;
}

/** Tileset → Update Tileset from Source…: asks for the source, then updates the shown tileset. */
export async function updateCurrentTileset(): Promise<boolean> {
    const tileset = currentTileset();
    if (!tileset || running) return false;
    const { kind, fileName } = tileset.source;
    if (kind === "collection") return false;
    notices.info(`Pick “${fileName}”, the source of tileset “${tileset.name}”.`);
    const files = await pickUpdateFiles(kind);
    return files ? updateTilesetFromFiles(tileset.id, files) : false;
}
