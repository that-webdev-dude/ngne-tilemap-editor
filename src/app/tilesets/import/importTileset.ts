import { notices } from "../../notices/notices";
import { backgroundWorker } from "../../worker/client";
import type { WorkerClient } from "../../worker/client";
import { askImportTileset } from "./importDialog";
import { createImportSession } from "./importSession";
import { readImportSource } from "./importSources";
import type { PickedFile } from "./importSources";
import { pickTilesetFiles } from "./pickTilesetFiles";

// Import Tileset (SPEC §6.1; TE-024): the picked or dropped files are read into a source, the
// dialog shows it and imports it. One import at a time: files picked or dropped while one is
// in progress are ignored.

let running = false;

/** Whether an import is in progress (its files are read, or its dialog is open). */
export function importingTileset(): boolean {
    return running;
}

/**
 * Opens the Import Tileset dialog for `files` and imports what it confirms. Resolves true once
 * a tileset is added; false when cancelled, when no file is one the import takes (reported by
 * a toast), or when an import is in progress already.
 */
export async function importTilesetFiles(
    files: readonly PickedFile[],
    worker: Pick<WorkerClient, "run"> = backgroundWorker,
): Promise<boolean> {
    if (running) return false;
    running = true;
    try {
        const source = await readImportSource(files);
        if (!source) {
            notices.error(
                "Import Tileset takes a .png, an .ngsprite, or an .atlas.json with its PNG.",
            );
            return false;
        }
        const session = createImportSession(source, { worker });
        try {
            if (!(await askImportTileset(session))) return false;
        } finally {
            session.dispose();
        }
        const { added } = session.store.getState();
        if (added) {
            notices.info(
                `Imported tileset “${added.name}”: ${added.tiles} ${added.tiles === 1 ? "tile" : "tiles"}`,
            );
        }
        return true;
    } finally {
        running = false;
    }
}

/** File → Import Tileset…: asks for files, then `importTilesetFiles`. */
export async function importTileset(): Promise<boolean> {
    if (running) return false;
    const files = await pickTilesetFiles();
    return files ? importTilesetFiles(files) : false;
}
