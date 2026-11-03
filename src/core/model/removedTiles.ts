import { cellSlot, cellTileId } from "../cells";
import type { Stamp } from "../cells";
import type { Project } from "./types";

// Removed tiles (SPEC §4.2): the current stamp and the clipboard hold slots and tile IDs, so a
// change that removes a tileset or a tile empties their cells on it. One rule for every such
// change (undoing an import, Delete Tileset, Delete and Replace in an update from source, and
// the undo or redo of any of them): a cell is kept while its slot names a tileset of the
// project that has its tile ID.

/**
 * `stamp` with every cell that names no tile of `project` emptied: the same object when every
 * cell does, else a new stamp of the same size. Whether a stamp with no non-empty cell is left
 * is the caller's to decide (`hasTiles`).
 */
export function withoutRemovedTiles(stamp: Stamp, project: Project): Stamp {
    const bySlot = new Map(project.tilesets.map((tileset) => [tileset.slot, tileset]));
    /** Tile IDs of each slot the stamp uses, looked up once; null for a slot with no tileset. */
    const idsBySlot = new Map<number, Set<number> | null>();
    let cells: Uint32Array | null = null;
    stamp.cells.forEach((value, index) => {
        if (value === 0) return;
        const slot = cellSlot(value);
        let ids = idsBySlot.get(slot);
        if (ids === undefined) {
            const tileset = bySlot.get(slot);
            ids = tileset ? new Set(tileset.tiles.map((tile) => tile.id)) : null;
            idsBySlot.set(slot, ids);
        }
        if (ids?.has(cellTileId(value))) return;
        cells ??= Uint32Array.from(stamp.cells);
        cells[index] = 0;
    });
    return cells ? { width: stamp.width, height: stamp.height, cells } : stamp;
}

/** Whether `stamp` has a non-empty cell. */
export function hasTiles(stamp: Stamp): boolean {
    return stamp.cells.some((value) => value !== 0);
}
