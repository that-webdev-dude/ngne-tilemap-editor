import type { CellRect } from "../cells";
import type { PixelPoint } from "../raster/line";

// Regions of cells (SPEC §4.3): what the flood fill, the shape fill and the magic wand (TE-020)
// work on, as row spans. A region is a list of spans sorted by row and then by start, none of
// them empty and no two of one row overlapping or touching: Tiled's `QRegion` of 1-cell-high
// rectangles. Pure, integer arithmetic only.

/** The cells `start .. end - 1` of row `y`. */
export interface RowSpan {
    readonly y: number;
    readonly start: number;
    /** One past the last cell. */
    readonly end: number;
}

/** Row spans, sorted by `y` and then `start`; in one row disjoint and not adjacent. */
export type Region = readonly RowSpan[];

/** The region of every cell of `rect`; empty for an empty rectangle. */
export function rectRegion(rect: CellRect): Region {
    if (rect.width <= 0 || rect.height <= 0) return [];
    const spans: RowSpan[] = [];
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        spans.push({ y, start: rect.x, end: rect.x + rect.width });
    }
    return spans;
}

/**
 * The region of the ellipse inscribed in `rect` (SPEC §4.3): Tiled's `ellipseRegion`
 * (`src/tiled/geometry.cpp`, checked at v1.12.2), Zingl's Bresenham ellipse ("A Rasterizing
 * Algorithm for Drawing Curves", `plotEllipseRect`) with each row filled between its two edge
 * cells. With `clip`, only its part inside `clip`; an empty rectangle gives an empty region.
 * The ellipse touches all four sides of `rect`, so `rect` is its bounding box. Tiled's own
 * arithmetic, in doubles, so its rounding is Tiled's too.
 */
export function ellipseRegion(rect: CellRect, clip?: CellRect): Region {
    if (rect.width <= 0 || rect.height <= 0) return [];
    const firstRow = clip ? Math.max(rect.y, clip.y) : rect.y;
    const lastRow = clip
        ? Math.min(rect.y + rect.height, clip.y + clip.height)
        : rect.y + rect.height;
    if (firstRow >= lastRow) return [];
    // The first cell of each row: a row's run is symmetric about the middle of `rect`.
    const firsts = new Float64Array(lastRow - firstRow).fill(Infinity);
    const addRow = (from: number, y: number) => {
        const row = y - firstRow;
        if (row >= 0 && row < firsts.length && from < firsts[row]!) firsts[row] = from;
    };

    // Tiled's code, its names and steps kept; `addRect(x0, y, x1, y)` becomes `addRow(x0, y)`
    // and `err += dy += a` two steps.
    let x0 = rect.x;
    let x1 = rect.x + rect.width - 1;
    let y0 = rect.y;
    let a = rect.width - 1;
    const b = rect.height - 1;
    let b1 = b & 1; // diameter
    let dx = 4 * (1 - a) * b * b; // error increment
    let dy = 4 * (b1 + 1) * a * a;
    let err = dx + dy + b1 * a * a; // error of 1. step
    y0 += Math.floor((b + 1) / 2); // starting pixel
    let y1 = y0 - b1;
    a = 8 * a * a;
    b1 = 8 * b * b;
    do {
        addRow(x0, y0); // bottom half
        addRow(x0, y1); // top half
        const e2 = 2 * err;
        // y step
        if (e2 <= dy) {
            y0++;
            y1--;
            dy += a;
            err += dy;
        }
        // x step
        if (e2 >= dx || 2 * err > dy) {
            x0++;
            x1--;
            dx += b1;
            err += dx;
        }
    } while (x0 <= x1);
    // Too early a stop for flat ellipses with a = 1: finish the tip.
    while (y0 - y1 <= b) {
        addRow(x0 - 1, y0);
        addRow(x0 - 1, y1);
        y0++;
        y1--;
    }

    const spans: RowSpan[] = [];
    firsts.forEach((first, row) => {
        if (first === Infinity) return;
        let start = first;
        let end = 2 * rect.x + rect.width - first;
        if (clip) {
            start = Math.max(start, clip.x);
            end = Math.min(end, clip.x + clip.width);
        }
        if (start < end) spans.push({ y: firstRow + row, start, end });
    });
    return spans;
}

/** The bounding box of `region`; null when it is empty. */
export function regionBounds(region: Region): CellRect | null {
    if (region.length === 0) return null;
    let left = Infinity;
    let right = -Infinity;
    for (const span of region) {
        left = Math.min(left, span.start);
        right = Math.max(right, span.end);
    }
    const top = region[0]!.y;
    const bottom = region[region.length - 1]!.y + 1;
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** How many cells `region` holds. */
export function regionSize(region: Region): number {
    let size = 0;
    for (const span of region) size += span.end - span.start;
    return size;
}

/** Whether `region` holds cell `(x, y)`. Binary search over its rows. */
export function regionContains(region: Region, x: number, y: number): boolean {
    let low = 0;
    let high = region.length;
    // The first span of row y or after it.
    while (low < high) {
        const mid = (low + high) >> 1;
        const span = region[mid]!;
        if (span.y < y || (span.y === y && span.end <= x)) low = mid + 1;
        else high = mid;
    }
    const span = region[low];
    return span !== undefined && span.y === y && span.start <= x && x < span.end;
}

/** The part of `region` inside `rect`. */
export function clipRegion(region: Region, rect: CellRect): Region {
    const spans: RowSpan[] = [];
    for (const span of region) {
        if (span.y < rect.y || span.y >= rect.y + rect.height) continue;
        const start = Math.max(span.start, rect.x);
        const end = Math.min(span.end, rect.x + rect.width);
        if (start < end) spans.push({ y: span.y, start, end });
    }
    return spans;
}

/** Calls `visit` for every cell of `region`, row by row. */
export function forEachRegionCell(region: Region, visit: (x: number, y: number) => void): void {
    for (const span of region) {
        for (let x = span.start; x < span.end; x++) visit(x, span.y);
    }
}

/** The cells of `region`, row by row. */
export function regionCells(region: Region): PixelPoint[] {
    const cells: PixelPoint[] = [];
    forEachRegionCell(region, (x, y) => cells.push({ x, y }));
    return cells;
}

/**
 * The region of `cells` (any order, repeats allowed): sorted rows, adjacent cells of a row
 * joined into one span.
 */
export function regionOf(cells: readonly PixelPoint[]): Region {
    const sorted = [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
    const spans: RowSpan[] = [];
    let open: { y: number; start: number; end: number } | null = null;
    for (const { x, y } of sorted) {
        if (open && open.y === y && x <= open.end) {
            open.end = Math.max(open.end, x + 1);
            continue;
        }
        if (open) spans.push(open);
        open = { y, start: x, end: x + 1 };
    }
    if (open) spans.push(open);
    return spans;
}
