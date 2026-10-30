import type { CellRect, CellStore } from "../cells";
import { findLayer } from "../model";
import type { ProjectSession } from "../model";
import type { Command } from "./command";

/** Words a patched cell takes: its index in the map, its value before and after. */
export const CELL_PATCH_WORDS = 3;
/** Bytes a patched cell takes (SPEC §3: 12 bytes a cell). */
export const BYTES_PER_PATCHED_CELL = CELL_PATCH_WORDS * 4;
/** Bytes a cell patch command retains besides its cells: the fixed overhead of its entry. */
export const CELL_PATCH_OVERHEAD_BYTES = 64;

/** What a cell patch command stores: the cells of one tile layer before and after a stroke. */
export interface CellPatch {
    label: string;
    mapId: string;
    layerId: number;
    /** The map's width when the patch was made: a cell's index is `y × width + x`. */
    width: number;
    /** Triplets `index, before, after`, one per changed cell. The command keeps this buffer. */
    words: Uint32Array;
    /** Bounding rectangle of the changed cells. */
    cellRect: CellRect;
}

/** The cells of tile layer `layerId` of map `mapId`; throws naming what is missing. */
export function tileLayerCells(session: ProjectSession, mapId: string, layerId: number): CellStore {
    const map = session.project.maps.find((candidate) => candidate.id === mapId);
    if (!map) throw new Error(`The project has no map "${mapId}".`);
    const entry = findLayer(map, layerId);
    if (!entry) throw new Error(`Map "${mapId}" has no layer ${layerId}.`);
    if (entry.layer.type !== "tile") {
        throw new Error(`Layer ${layerId} of map "${mapId}" is a ${entry.layer.type} layer.`);
    }
    return entry.layer.cells;
}

/**
 * The command of a stored patch: `do` writes every `after` value, `undo` every `before`.
 * Its `bytes` are 12 per cell plus `CELL_PATCH_OVERHEAD_BYTES`.
 */
export function cellPatchCommand(patch: CellPatch): Command {
    const { label, mapId, layerId, width, words, cellRect } = patch;
    const write = (session: ProjectSession, offset: 1 | 2) => {
        const cells = tileLayerCells(session, mapId, layerId);
        for (let at = 0; at < words.length; at += CELL_PATCH_WORDS) {
            const index = words[at]!;
            cells.set(index % width, Math.floor(index / width), words[at + offset]!);
        }
    };
    return {
        label,
        bytes: words.byteLength + CELL_PATCH_OVERHEAD_BYTES,
        touched: {
            mapId,
            layerIds: [layerId],
            cellRects: [{ ...cellRect }],
            tilesetIds: [],
            structure: false,
        },
        do: (session) => write(session, 2),
        undo: (session) => write(session, 1),
    };
}
