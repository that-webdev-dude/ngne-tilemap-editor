import { commandDialogs } from "../dialogs/dialogRequests";
import { fileWorkflows } from "../file/workflows";
import { notices } from "../notices/notices";
import type { PickedFile } from "../tilesets/import/importSources";
import { runTilesetWorkflow, tilesetWorkflowBusy } from "../tilesets/tilesetWorkflow";
import { backgroundWorker } from "../worker/client";
import type { WorkerClient } from "../worker/client";
import { reason } from "../worker/errorReason";
import { canPickFolder, fileSetOf, pickTmjFiles, pickTmjFolder } from "./tmjFiles";
import type { TmjFileSet } from "./tmjFiles";
import { createTmjImportSession } from "./tmjImportSession";
import type { TmjImportSession } from "./tmjImportSession";

// File → Import Tiled Map… (SPEC §13, DESIGN §9; TE-061): the folder holding the map is picked
// (File System Access), or without it the map and its files in one multi-select, or they are
// dropped on the window; the dialog shows the files the map needs and the report, and imports
// what it confirms. It runs as a tileset file operation (`tilesetWorkflow.ts`, it adds
// tilesets): one at a time, with the drops, the file commands and the tileset dialogs
// unavailable meanwhile.

export interface ImportTiledMapRequest {
    kind: "import-tiled-map";
    session: TmjImportSession;
    /** True once the map is added, null when cancelled. Closes the dialog. */
    answer(values: true | null): void;
}

/** Opens the dialog for `session`; resolves true once the map is added. */
export async function askImportTiledMap(session: TmjImportSession): Promise<boolean> {
    const answer = await commandDialogs.open<true>((answer): ImportTiledMapRequest => ({
        kind: "import-tiled-map",
        session,
        answer,
    }));
    return answer === true;
}

/** Whether Import Tiled Map can start: no file operation and no tileset operation runs. */
export function canImportTiledMap(): boolean {
    return !tilesetWorkflowBusy() && fileWorkflows.canAct();
}

/**
 * Opens the Import Tiled Map dialog for the files of `set` and imports what it confirms.
 * Resolves true once a map is added; false when cancelled, when another operation runs, or
 * when the set holds none of the files the import reads (reported by a toast).
 */
export async function importTiledMapSet(
    set: TmjFileSet,
    worker: Pick<WorkerClient, "run"> = backgroundWorker,
): Promise<boolean> {
    return runTilesetWorkflow(async () => {
        if (set.byPath.size === 0 && set.byName.size === 0) {
            notices.error(
                "Import Tiled Map takes a Tiled map (.tmj) with its tilesets, templates and images.",
            );
            return false;
        }
        if (commandDialogs.store.getState().request !== null) {
            notices.error("Could not import the map. Another dialog is open.");
            return false;
        }
        let session: TmjImportSession;
        try {
            session = await createTmjImportSession(set, { worker });
        } catch (error) {
            notices.error(`Could not import the map. ${reason(error)}`);
            return false;
        }
        try {
            if (!(await askImportTiledMap(session))) return false;
        } finally {
            session.dispose();
        }
        const { added } = session.store.getState();
        if (added) notices.info(`Imported map “${added.name}”`);
        return true;
    });
}

/** The files of a pick or a drop, as `importTiledMapSet` takes them. */
export function importTiledMapFiles(files: readonly PickedFile[]): Promise<boolean> {
    return importTiledMapSet(fileSetOf(files));
}

/**
 * File → Import Tiled Map…: asks for the folder holding the map (File System Access), else for
 * the map and its files, then `importTiledMapSet`.
 */
export async function importTiledMap(): Promise<boolean> {
    if (!canImportTiledMap()) return false;
    let set: TmjFileSet | null;
    try {
        if (canPickFolder()) set = await pickTmjFolder();
        else {
            const files = await pickTmjFiles();
            set = files ? fileSetOf(files) : null;
        }
    } catch (error) {
        notices.error(`Could not read the files. ${reason(error)}`);
        return false;
    }
    return set ? importTiledMapSet(set) : false;
}
