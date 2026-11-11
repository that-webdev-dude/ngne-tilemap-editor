import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { createProjectSession, exportNames } from "../../core/model";
import {
    importTmjCommand,
    rebindTmjImages,
    tmjFileKind,
    tmjImportProject,
    tmjTilesetName,
} from "../../core/tmj";
import type { TmjFileKind, TmjImport, TmjImportReport, TmjRequiredFile } from "../../core/tmj";
import { fitWhenShown } from "../maps/maps";
import { activeHistory, sessionStore } from "../state/session";
import type { PickedFile } from "../tilesets/import/importSources";
import { toolPipeline } from "../tools/appPipeline";
import type { WorkerClient } from "../worker/client";
import { reason } from "../worker/errorReason";
import { WorkerError } from "../worker/protocol";
import { importFromWire } from "../worker/tasks/tmj.task";
import { findTmjFile, mapsOf, readText, withAddedFiles } from "./tmjFiles";
import type { TmjFileSet, TmjSetFile } from "./tmjFiles";

// One run of the Import Tiled Map dialog (SPEC §13, DESIGN §9; TE-061): the picked files, the
// map chosen among them, the files it needs with their status, and the report of its
// conversion. Reading the map for the files it needs, decompressing and converting run in the
// background worker. While a file is missing, nothing is converted: the dialog lists it and Add
// files… adds it (found by base name). Import adds the import in one history entry, into the
// open project, or as a new project when none is open; Cancel adds nothing.

/** A file the map needs, found among the picked files or not. */
export interface TmjFileRow {
    readonly path: string;
    readonly kind: TmjFileKind;
    readonly found: boolean;
}

/**
 * - `reading`: the map is read for the files it needs.
 * - `missing`: a file it needs is missing; Add files… can add it.
 * - `converting`: the map and its files are converted.
 * - `ready`: the report is there; Import can add the map.
 * - `refused`: the map cannot be imported; `refusal` says why.
 */
export type TmjImportPhase = "reading" | "missing" | "converting" | "ready" | "refused";

export interface TmjImportSessionState {
    readonly set: TmjFileSet;
    /** The maps among the files, by path; the dialog offers a choice when there are several. */
    readonly maps: readonly string[];
    readonly map: string | null;
    readonly files: readonly TmjFileRow[];
    readonly phase: TmjImportPhase;
    readonly report: TmjImportReport | null;
    readonly refusal: string | null;
    /** Import adds the map. */
    readonly importing: boolean;
    /** Why the last Import added nothing; cleared by the next change. */
    readonly failure: string | null;
    /** The map Import added: its name. */
    readonly added: { name: string } | null;
}

export interface TmjImportSession {
    readonly store: StoreApi<TmjImportSessionState>;
    /** Resolves once the first map's files are read (and converted, when none is missing). */
    readonly loaded: Promise<void>;
    /** Imports the map at `path` of the files instead. */
    chooseMap(path: string): void;
    /** Adds files (Add files…), found by base name, and reads the map again. */
    addFiles(files: readonly PickedFile[]): Promise<void>;
    canImport(): boolean;
    /** Adds the import; resolves with the map's name once added, else null. */
    confirm(): Promise<{ name: string } | null>;
    /** Stops the work in the worker. */
    dispose(): void;
}

export interface TmjImportSessionOptions {
    /** The worker that reads and converts; the app's by default. */
    worker: Pick<WorkerClient, "run">;
}

/** The message when no file of the set is a map. */
export const NO_MAP_MESSAGE =
    "None of the files is a Tiled map: pick the map (.tmj, or .json saved by Tiled) with its files.";

/** The history can take a command now: no transaction, no stroke. */
const historyIdle = () => !activeHistory().transaction && !toolPipeline.stroking;

const isCancelled = (error: unknown) => error instanceof WorkerError && error.code === "cancelled";

/** The TMJ refusal a worker request rejected with, or null for any other failure. */
function tmjRefusal(error: unknown): { code: string; message: string; path: string | null } | null {
    if (!(error instanceof WorkerError) || error.code !== "failed") return null;
    const remote = error.remote as { name?: string; code?: string; path?: string | null } | null;
    if (remote?.name !== "TmjError" || typeof remote.code !== "string") return null;
    return { code: remote.code, message: error.message, path: remote.path ?? null };
}

function kindOf(path: string): TmjFileKind {
    const kind = tmjFileKind(path);
    return kind === "tileset" || kind === "template" ? kind : "image";
}

/** Creates the session of `set`; it starts reading its first map at once. */
export async function createTmjImportSession(
    initial: TmjFileSet,
    { worker }: TmjImportSessionOptions,
): Promise<TmjImportSession> {
    let set = initial;
    let entries = await mapsOf(set);
    const store = createStore<TmjImportSessionState>(() => ({
        set,
        maps: entries.map((entry) => entry.path),
        map: entries[0]?.path ?? null,
        files: [],
        phase: "reading",
        report: null,
        refusal: null,
        importing: false,
        failure: null,
        added: null,
    }));
    let disposed = false;
    let generation = 0;
    let controller: AbortController | null = null;
    /** The import of the current map, once converted. */
    let imported: TmjImport | null = null;
    /** Files the conversion found missing that the map's reading did not name (by path). */
    const missingFound = new Set<string>();

    const project = () => sessionStore.getState().session.project;

    const refresh = async (): Promise<void> => {
        const own = ++generation;
        controller?.abort();
        const signal = (controller = new AbortController()).signal;
        const stale = () => disposed || own !== generation;
        imported = null;
        const { map } = store.getState();
        const entry = entries.find((each) => each.path === map);
        if (!entry || map === null) {
            store.setState({ phase: "refused", refusal: NO_MAP_MESSAGE, files: [], report: null });
            return;
        }
        store.setState({ phase: "reading", report: null, refusal: null, failure: null });
        const find = (path: string): TmjSetFile | undefined => findTmjFile(set, map, path);
        const fail = (error: unknown) => {
            if (stale() || isCancelled(error)) return;
            store.setState({ phase: "refused", refusal: reason(error) });
        };
        try {
            const mapText = await readText(entry.file);
            const texts: Record<string, string> = {};
            let required: TmjRequiredFile[] = [];
            // A tileset's images are known once its text is read: read the found tilesets,
            // then ask again (one more round at most: tilesets name no tilesets).
            for (let round = 0; round < 2; round += 1) {
                required = await worker.run("tmj.files", { mapText, texts }, { signal });
                if (stale()) return;
                let more = false;
                for (const file of required) {
                    const found = file.kind === "tileset" ? find(file.path) : undefined;
                    if (!found || file.path in texts) continue;
                    texts[file.path] = await readText(found.file);
                    more = true;
                }
                if (!more) break;
            }
            if (stale()) return;
            const listed = new Set(required.map((file) => file.path));
            const rows: TmjFileRow[] = [
                ...required.map((file) => ({ ...file, found: find(file.path) !== undefined })),
                ...[...missingFound]
                    .filter((path) => !listed.has(path))
                    .map((path) => ({ path, kind: kindOf(path), found: !!find(path) })),
            ];
            store.setState({ files: rows });
            if (rows.some((row) => !row.found)) {
                store.setState({ phase: "missing" });
                return;
            }
            store.setState({ phase: "converting" });
            const bytes: Record<string, Uint8Array> = {};
            for (const row of rows) {
                const found = find(row.path)!;
                if (row.kind === "image") bytes[row.path] = await found.file.read();
                else if (!(row.path in texts)) texts[row.path] = await readText(found.file);
            }
            if (stale()) return;
            const open = sessionStore.getState().open;
            const names = new Set(
                required
                    .filter((file) => file.kind === "tileset")
                    .map((f) => tmjTilesetName(f.path)),
            );
            const candidates = open
                ? project().tilesets.filter((tileset) => names.has(tileset.name))
                : [];
            const output = await worker.run(
                "tmj.import",
                {
                    mapText,
                    fileName: entry.file.name,
                    texts,
                    bytes,
                    candidates,
                    takenExportNames: open ? exportNames(project()) : [],
                },
                { signal },
            );
            if (stale()) return;
            imported = importFromWire(output);
            store.setState({ phase: "ready", report: imported.report });
        } catch (error) {
            if (stale()) return;
            const refusal = tmjRefusal(error);
            if (refusal?.code === "missing-file" && refusal.path !== null) {
                const { path } = refusal;
                missingFound.add(path);
                const { files } = store.getState();
                if (!files.some((row) => row.path === path)) {
                    store.setState({
                        files: [...files, { path, kind: kindOf(path), found: false }],
                    });
                }
                store.setState({ phase: "missing" });
                return;
            }
            fail(error);
        }
    };

    const loaded = refresh();

    const canImport = () => {
        const state = store.getState();
        return state.phase === "ready" && !state.importing && imported !== null;
    };

    const confirm = async (): Promise<{ name: string } | null> => {
        if (disposed || !canImport() || !imported) return null;
        const fail = (failure: string) => {
            store.setState({ importing: false, failure });
            return null;
        };
        store.setState({ importing: true, failure: null });
        const pieces = rebindTmjImages(project(), imported);
        try {
            if (sessionStore.getState().open) {
                if (!historyIdle()) return fail("Finish the stroke on the map first.");
                activeHistory().execute(importTmjCommand(pieces));
            } else {
                sessionStore.getState().replace(createProjectSession(tmjImportProject(pieces)));
                const { history, touch } = sessionStore.getState();
                // Unsaved until saved, as a recovered project: no history position is -1.
                history.markSaved({ position: -1, exportOnSave: false });
                touch();
            }
        } catch (error) {
            return fail(reason(error));
        }
        fitWhenShown(pieces.map.id);
        const added = { name: pieces.map.name };
        store.setState({ importing: false, added });
        return added;
    };

    return {
        store,
        loaded,
        chooseMap(path) {
            if (disposed || store.getState().importing || !entries.some((e) => e.path === path)) {
                return;
            }
            missingFound.clear();
            store.setState({ map: path, files: [] });
            void refresh();
        },
        async addFiles(files) {
            if (disposed || store.getState().importing) return;
            set = withAddedFiles(set, files);
            entries = await mapsOf(set);
            const { map } = store.getState();
            const maps = entries.map((each) => each.path);
            store.setState({
                set,
                maps,
                map: map !== null && maps.includes(map) ? map : (maps[0] ?? null),
            });
            await refresh();
        },
        canImport,
        confirm,
        dispose() {
            disposed = true;
            controller?.abort();
        },
    };
}
