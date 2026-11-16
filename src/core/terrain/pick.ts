import type { TerrainSetType } from "../model";
import {
    BOTTOM,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
    LEFT,
    RIGHT,
    TOP,
    TOP_LEFT,
    TOP_RIGHT,
    indexByGrid,
} from "./wangId";
import type { WangIndex } from "./wangId";

// The index the terrain brush picks within a cell (SPEC §5.3, second item), also used by the
// Terrains panel when a click assigns a terrain to one index of a tile (SPEC §5.1).

/** The corner of the cell's quarter that holds `(fx, fy)`: the nearest corner. */
function nearestCorner(fx: number, fy: number): WangIndex {
    const right = fx >= 0.5;
    if (fy >= 0.5) return right ? BOTTOM_RIGHT : BOTTOM_LEFT;
    return right ? TOP_RIGHT : TOP_LEFT;
}

/**
 * The edge of the quarter between the cell's diagonals that holds `(fx, fy)`. On a diagonal the
 * left or right edge wins.
 */
function edgeBetweenDiagonals(fx: number, fy: number): WangIndex {
    const dx = fx - 0.5;
    const dy = fy - 0.5;
    if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? TOP : BOTTOM;
    return dx < 0 ? LEFT : RIGHT;
}

/** The third `0..2` of a cell that fraction `f` falls in; the far side counts as the last. */
function third(f: number): number {
    return Math.min(2, Math.max(0, Math.floor(f * 3)));
}

/**
 * The index the brush picks at fraction `(fx, fy)` of a cell in a set of `type` (SPEC §5.3);
 * null where it paints nothing.
 */
export function brushIndexAt(type: TerrainSetType, fx: number, fy: number): WangIndex | null {
    if (type === "corner") return nearestCorner(fx, fy);
    if (type === "edge") return edgeBetweenDiagonals(fx, fy);
    return indexByGrid(third(fx), third(fy));
}
