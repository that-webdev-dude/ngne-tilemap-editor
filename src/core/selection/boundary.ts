import type { Region } from "../model";
import { maskBounds } from "./mask";

// The boundary of a cell mask as axis-aligned edge segments (TE-020), what the marching ants
// are drawn from. Coordinates are the map's cell grid lines: the line `y` runs between cell
// rows `y - 1` and `y`, the line `x` between cell columns `x - 1` and `x`; a cell outside the
// mask counts as not selected, so the map edge is a boundary too. Each segment is a maximal
// run of unit edges that have the selected side on the same hand.

/** A boundary along the grid line `y`, over the columns `[x0, x1)`. */
export interface HorizontalEdge {
    readonly y: number;
    readonly x0: number;
    readonly x1: number;
    /** The side of the selected cells: row `y - 1` ("above") or row `y` ("below"). */
    readonly inside: "above" | "below";
}

/** A boundary along the grid line `x`, over the rows `[y0, y1)`. */
export interface VerticalEdge {
    readonly x: number;
    readonly y0: number;
    readonly y1: number;
    /** The side of the selected cells: column `x - 1` ("left") or column `x` ("right"). */
    readonly inside: "left" | "right";
}

/**
 * A grid point where exactly one of the four cells around it is selected: an outer corner of
 * the selection, where the boundary turns around that cell.
 */
export interface OuterCorner {
    readonly x: number;
    readonly y: number;
    readonly selected: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}

export interface SelectionBoundary {
    /** By line, top first, then left to right. */
    readonly horizontal: readonly HorizontalEdge[];
    /** By line, left first, then top to bottom. */
    readonly vertical: readonly VerticalEdge[];
    /** By row of grid points, then left to right. */
    readonly corners: readonly OuterCorner[];
}

const NONE: SelectionBoundary = { horizontal: [], vertical: [], corners: [] };

/** The boundary of the set cells of `mask`; empty when none is set. */
export function selectionBoundary(mask: Region): SelectionBoundary {
    const bounds = maskBounds(mask);
    if (!bounds) return NONE;
    const left = bounds.x;
    const top = bounds.y;
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;

    // The cells of the bounds, one byte each, with a clear border of one cell all round: grid
    // cell (i, j) is map cell (left + i − 1, top + j − 1). A cell outside the bounds is not
    // selected, so the border stands for everything around them, the map edge too.
    const span = bounds.width + 2;
    const grid = new Uint8Array(span * (bounds.height + 2));
    for (let y = top; y < bottom; y++) {
        const row = (y - top + 1) * span + 1;
        const source = (y - mask.y) * mask.width - mask.x;
        for (let x = left; x < right; x++) {
            grid[row + x - left] = mask.mask[source + x] !== 0 ? 1 : 0;
        }
    }
    // Below, the grid cell of map cell (x, y) is `(y − top + 1) × span + (x − left + 1)`.

    // Runs along each line; the border cell after the last closes the last run.
    const horizontal: HorizontalEdge[] = [];
    for (let y = top; y <= bottom; y++) {
        const above = (y - top) * span + 1 - left;
        const below = above + span;
        let start = 0;
        let side = 0;
        for (let x = left; x <= right; x++) {
            const upper = grid[above + x];
            const now = upper === grid[below + x] ? 0 : upper ? 1 : 2;
            if (now === side) continue;
            if (side !== 0) {
                horizontal.push({ y, x0: start, x1: x, inside: side === 1 ? "above" : "below" });
            }
            side = now;
            start = x;
        }
    }

    const vertical: VerticalEdge[] = [];
    for (let x = left; x <= right; x++) {
        const column = x - left + 1;
        let start = 0;
        let side = 0;
        for (let y = top; y <= bottom; y++) {
            const cell = (y - top + 1) * span + column;
            const before = grid[cell - 1];
            const now = before === grid[cell] ? 0 : before ? 1 : 2;
            if (now === side) continue;
            if (side !== 0) {
                vertical.push({ x, y0: start, y1: y, inside: side === 1 ? "left" : "right" });
            }
            side = now;
            start = y;
        }
    }

    const corners: OuterCorner[] = [];
    for (let y = top; y <= bottom; y++) {
        // The grid cell of map cell (x − 1, y − 1), the top left of grid point (x, y), is `row + x`.
        const row = (y - top) * span - left;
        for (let x = left; x <= right; x++) {
            const topLeft = grid[row + x]!;
            const topRight = grid[row + x + 1]!;
            const bottomLeft = grid[row + x + span]!;
            const bottomRight = grid[row + x + span + 1]!;
            if (topLeft + topRight + bottomLeft + bottomRight !== 1) continue;
            const selected = topLeft
                ? "top-left"
                : topRight
                  ? "top-right"
                  : bottomLeft
                    ? "bottom-left"
                    : "bottom-right";
            corners.push({ x, y, selected });
        }
    }
    return { horizontal, vertical, corners };
}
