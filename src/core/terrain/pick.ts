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

/**
 * The index the terrain brush paints at `(fx, fy)` within a cell, each 0 at the cell's left
 * (top) edge and 1 at its right (bottom) edge (SPEC §5.3; `wangbrush.cpp`, tag v1.12.2). `type`
 * is the painting mode, `effectiveTypeForColor` of the set and terrain: corner sets round to the
 * nearest corner; edge sets pick the edge by the cell's diagonals; mixed sets use a 3 × 3 grid
 * of the cell (`WangId::indexByGrid`), whose centre paints nothing (null). The Terrains panel
 * picks the index it assigns the same way (SPEC §5.1).
 */
export function brushIndexAt(type: TerrainSetType, fx: number, fy: number): WangIndex | null {
    if (type === "corner") {
        // Rounding to the nearest corner: from the middle on, the right (bottom) one.
        if (fx < 0.5) return fy < 0.5 ? TOP_LEFT : BOTTOM_LEFT;
        return fy < 0.5 ? TOP_RIGHT : BOTTOM_RIGHT;
    }
    if (type === "edge") {
        const x = fx - 0.5;
        const y = fy - 0.5;
        if (x < y) return x > -y ? BOTTOM : LEFT;
        return x > -y ? RIGHT : TOP;
    }
    const grid = (value: number) => Math.min(2, Math.max(0, Math.floor(value * 3)));
    return indexByGrid(grid(fx), grid(fy));
}
