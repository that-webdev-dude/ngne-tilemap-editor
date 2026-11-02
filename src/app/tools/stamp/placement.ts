import type { Stamp } from "../../../core/cells";
import type { PixelPoint } from "../../../core/raster/line";

// Where the stamp brush puts the current stamp (SPEC §4.2, §4.3), as Tiled's `StampBrush`
// (`src/tiled/stampbrush.cpp`, checked at v1.12.2) does. Pure: no store.
//
// - A stamp is placed with its anchor, the cell `floor(w/2), floor(h/2)`, on the point.
// - Its empty cells leave the map as it is (Tiled's `TileLayer::merge` skips empty cells).
// - Along a line or an ellipse (`drawPreviewLayer`), a placement whose non-empty cells meet
//   the cells of a placement before it is left out, so the stamps do not overlap.

/** The anchor of a stamp: its centre cell (SPEC §4.2). */
export function stampAnchor(stamp: Pick<Stamp, "width" | "height">): PixelPoint {
    return { x: Math.floor(stamp.width / 2), y: Math.floor(stamp.height / 2) };
}

/** The top-left cell of the stamp placed with its anchor on `point`. */
export function stampOrigin(stamp: Pick<Stamp, "width" | "height">, point: PixelPoint): PixelPoint {
    const anchor = stampAnchor(stamp);
    return { x: point.x - anchor.x, y: point.y - anchor.y };
}

/** Whether every cell of the stamp is empty: it paints nothing. */
export function stampIsEmpty(stamp: Stamp): boolean {
    return stamp.cells.every((value) => value === 0);
}

/** One cell a placement writes: its map position and the stamp's value there. */
export interface StampCell {
    readonly x: number;
    readonly y: number;
    readonly value: number;
}

/** The non-empty cells of the stamp placed with its anchor on `point`, row by row. */
export function placedCells(stamp: Stamp, point: PixelPoint): StampCell[] {
    const origin = stampOrigin(stamp, point);
    const cells: StampCell[] = [];
    for (let y = 0; y < stamp.height; y++) {
        for (let x = 0; x < stamp.width; x++) {
            const value = stamp.cells[y * stamp.width + x]!;
            if (value !== 0) cells.push({ x: origin.x + x, y: origin.y + y, value });
        }
    }
    return cells;
}

/**
 * The points of `points` whose placement of `stamp` meets no earlier accepted one, in order
 * (Tiled's `drawPreviewLayer`: a stamp whose non-empty cells intersect the painted region is
 * left out). Repeated points are left out with it.
 */
export function separatePlacements(stamp: Stamp, points: readonly PixelPoint[]): PixelPoint[] {
    const painted = new Set<string>();
    const accepted: PixelPoint[] = [];
    for (const point of points) {
        const cells = placedCells(stamp, point);
        if (cells.some((cell) => painted.has(`${cell.x},${cell.y}`))) continue;
        for (const cell of cells) painted.add(`${cell.x},${cell.y}`);
        accepted.push(point);
    }
    return accepted;
}
