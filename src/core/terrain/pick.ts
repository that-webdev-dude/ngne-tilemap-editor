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

// The index under the pointer within one cell (SPEC §5.3; the Terrains panel of §5.1 picks the
// index it assigns the same way). Corner sets take the nearest corner: the cell's quadrant.
// Edge sets take the side whose triangle between the cell's two diagonals holds the point.
// Mixed sets split the cell into a 3 × 3 grid: the corner squares are corners, the side squares
// edges, and the middle square paints nothing.

/** The grid column or row of a fraction: thirds of the cell, its far edge in the last one. */
const third = (f: number): number => Math.min(2, Math.max(0, Math.floor(f * 3)));

/**
 * The index painted at fraction `(fx, fy)` of a cell (0 at its left or top edge, 1 at its right
 * or bottom edge) in a set of `type`; null for the middle of a mixed set's cell.
 */
export function brushIndexAt(type: TerrainSetType, fx: number, fy: number): WangIndex | null {
    if (type === "corner") return cornerAt(fx, fy);
    if (type === "edge") return edgeAt(fx, fy);
    return indexByGrid(third(fx), third(fy));
}

/** The corner of the quarter of the cell that fraction `(fx, fy)` lies in. */
function cornerAt(fx: number, fy: number): WangIndex {
    const right = fx >= 0.5;
    if (fy >= 0.5) return right ? BOTTOM_RIGHT : BOTTOM_LEFT;
    return right ? TOP_RIGHT : TOP_LEFT;
}

/**
 * The edge nearest fraction `(fx, fy)`, measured from the centre: the axis the point is further
 * along names the side; a point on a diagonal goes to the top or bottom edge.
 */
function edgeAt(fx: number, fy: number): WangIndex {
    const dx = fx - 0.5;
    const dy = fy - 0.5;
    if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? TOP : BOTTOM;
    return dx < 0 ? LEFT : RIGHT;
}
