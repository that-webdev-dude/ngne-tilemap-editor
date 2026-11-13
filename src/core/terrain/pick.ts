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

// The index under the pointer within one cell (SPEC §5.3, used by the Terrains panel of §5.1
// too). Corner sets take the nearest corner, the halfway line counting as right and bottom.
// Edge sets cut the cell along both diagonals into four triangles, one per edge. Mixed sets
// cut it into a 3 × 3 grid: the sides are edges, the corners corners, the middle nothing.

/** The grid column or row (0..2) of a fraction of the cell, in a 3 × 3 split. */
function gridPosition(t: number): number {
    return Math.min(2, Math.max(0, Math.floor(3 * t)));
}

/** The corner nearest to `(fx, fy)`; exactly halfway counts as right and as bottom. */
function cornerAt(fx: number, fy: number): WangIndex {
    const left = fx < 0.5;
    if (fy < 0.5) return left ? TOP_LEFT : TOP_RIGHT;
    return left ? BOTTOM_LEFT : BOTTOM_RIGHT;
}

/** The edge whose triangle, between the cell's two diagonals, holds `(fx, fy)`. */
function edgeAt(fx: number, fy: number): WangIndex {
    const u = fx - 0.5;
    const v = fy - 0.5;
    const belowAnti = u > -v;
    if (u < v) return belowAnti ? BOTTOM : LEFT;
    return belowAnti ? RIGHT : TOP;
}

/**
 * The index painted at fraction `(fx, fy)` of a cell (0 at its left or top edge, 1 at its right
 * or bottom edge) in a set of `type`; null for the middle of a mixed set's cell.
 */
export function brushIndexAt(type: TerrainSetType, fx: number, fy: number): WangIndex | null {
    if (type === "corner") return cornerAt(fx, fy);
    if (type === "edge") return edgeAt(fx, fy);
    return indexByGrid(gridPosition(fx), gridPosition(fy));
}
