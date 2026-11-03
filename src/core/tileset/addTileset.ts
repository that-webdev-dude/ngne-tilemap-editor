import type { Command } from "../history";
import { exportNames, freeSlot, idKey, pixelBytes } from "../model";
import type { Tileset } from "../model";
import { TilesetImportError } from "./errors";
import { checkLimits } from "./room";

// The add-tileset command of SPEC §6.1: an imported tileset goes to the end of the Tilesets
// list in the lowest free slot (SPEC §2.2); undo removes it. Removing it takes its tiles away,
// so the app empties the current stamp's and the clipboard's cells on it (SPEC §4.2); the
// command says so through `touched`.

/** The label of the history entry. */
export const IMPORT_TILESET_LABEL = "Import Tileset";

/** Bytes a command claims besides the pixels it holds. */
const OVERHEAD_BYTES = 256;

/**
 * The command that adds `tileset`, an import's result, to the project. Its `do` throws
 * `TilesetImportError` before changing anything when the project no longer has room for it (a
 * limit of FORMAT §2.8, its ID or export name taken since the import) and `SlotError` when no
 * slot is free.
 */
export function addTilesetCommand(tileset: Tileset): Command {
    const bytes = pixelBytes(tileset.pixels);
    return {
        label: IMPORT_TILESET_LABEL,
        bytes: bytes + OVERHEAD_BYTES,
        projectBytes: bytes,
        touched: {
            mapId: null,
            layerIds: [],
            cellRects: [],
            tilesetIds: [tileset.id],
            structure: true,
        },
        do(session) {
            const { project } = session;
            checkLimits(project, {
                name: tileset.name,
                tileCount: tileset.tiles.length,
                tileWidth: tileset.tileWidth,
                tileHeight: tileset.tileHeight,
                columns: tileset.columns,
            });
            const key = idKey(tileset.id);
            const ids = [project, ...project.maps, ...project.tilesets, ...project.images];
            if (ids.some((owner) => idKey(owner.id) === key)) {
                throw new TilesetImportError("conflict", `The ID ${tileset.id} is taken.`);
            }
            if (exportNames(project).includes(tileset.exportName)) {
                throw new TilesetImportError(
                    "conflict",
                    `The export name ${JSON.stringify(tileset.exportName)} is taken.`,
                );
            }
            tileset.slot = freeSlot(project.tilesets);
            project.tilesets.push(tileset);
        },
        undo(session) {
            const { tilesets } = session.project;
            const index = tilesets.lastIndexOf(tileset);
            if (index >= 0) tilesets.splice(index, 1);
        },
    };
}
