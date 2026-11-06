import { commandDialogs } from "../../dialogs/dialogRequests";
import { notices } from "../../notices/notices";
import { backgroundWorker } from "../../worker/client";
import type { WorkerClient } from "../../worker/client";
import { runTilesetWorkflow, tilesetWorkflowBusy } from "../tilesetWorkflow";
import { askImportTileset } from "./importDialog";
import { createImportSession } from "./importSession";
import { readImportSource } from "./importSources";
import type { PickedFile } from "./importSources";
import { pickTilesetFiles } from "./pickTilesetFiles";

// Import Tileset (SPEC §6.1; TE-024): the picked or dropped files are read into a source, the
// dialog shows it and imports it. It runs as a tileset file operation (`tilesetWorkflow.ts`):
// one at a time, with the drops, the file commands and the tileset dialogs unavailable meanwhile.
// An import given up after it started, because another dialog is open, is reported by a toast;
// one the user cancels is not.

/** Whether a tileset file operation, an import or an update, is in progress. */
export function importingTileset(): boolean {
    return tilesetWorkflowBusy();
}

/**
 * Opens the Import Tileset dialog for `files` and imports what it confirms. Resolves true once
 * a tileset is added; false when cancelled, when no file is one the import takes (reported by
 * a toast), or when a tileset file operation is in progress already.
 */
export async function importTilesetFiles(
    files: readonly PickedFile[],
    worker: Pick<WorkerClient, "run"> = backgroundWorker,
): Promise<boolean> {
    return runTilesetWorkflow(async () => {
        const source = await readImportSource(files);
        if (!source) {
            notices.error(
                "Import Tileset takes a .png, an .ngsprite, or an .atlas.json with its PNG.",
            );
            return false;
        }
        if (commandDialogs.store.getState().request !== null) {
            notices.error("Could not import the tileset. Another dialog is open.");
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
    });
}

/** File → Import Tileset…: asks for files, then `importTilesetFiles`. */
export async function importTileset(): Promise<boolean> {
    if (tilesetWorkflowBusy()) return false;
    const files = await pickTilesetFiles();
    return files ? importTilesetFiles(files) : false;
}
