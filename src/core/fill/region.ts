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
 * Calls `plot` for every pixel of the ellipse inscribed in the box from `(x0, y0)` to
 * `(x1, y1)` (inclusive, `x0 <= x1`, `y0 <= y1`), after Alois Zingl's `plotEllipseRect`,
 * github.com/zingl/Bresenham, MIT licence, (c) 2020 zingl. It walks the four quadrants at once
 * from the middle rows outwards, then finishes the tips of a very narrow ellipse. Ported from
 * Alois Zingl's MIT-licensed `plotEllipseRect`; its notice is in THIRD_PARTY_NOTICES.md.
 */
function plotEllipseInBox(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    plot: (x: number, y: number) => void,
): void {
    const a = x1 - x0;
    const b = y1 - y0;
    const odd = b % 2;
    let dx = 4 * (1 - a) * b * b;
    let dy = 4 * (odd + 1) * a * a;
    let err = dx + dy + odd * a * a;
    const stepY = 8 * a * a;
    const stepX = 8 * b * b;
    let left = x0;
    let right = x1;
    // The lower half moves down from the middle, the upper half up.
    let down = y0 + Math.floor((b + 1) / 2);
    let up = down - odd;
    do {
        plot(right, down);
        plot(left, down);
        plot(left, up);
        plot(right, up);
        const e2 = 2 * err;
        if (e2 <= dy) {
            down++;
            up--;
            dy += stepY;
            err += dy;
        }
        if (e2 >= dx || 2 * err > dy) {
            left++;
            right--;
            dx += stepX;
            err += dx;
        }
    } while (left <= right);
    while (down - up <= b) {
        plot(left - 1, down);
        plot(right + 1, down);
        down++;
        plot(left - 1, up);
        plot(right + 1, up);
        up--;
    }
}

/**
 * The region of the ellipse inscribed in `rect` (it touches all four sides): each row from its
 * leftmost to its rightmost outline cell. With `clip`, only the part inside `clip`; rows it
 * leaves out cost no per-cell work. Empty for an empty rectangle.
 */
export function ellipseRegion(rect: CellRect, clip?: CellRect): Region {
    if (rect.width <= 0 || rect.height <= 0) return [];
    const top = clip ? Math.max(rect.y, clip.y) : rect.y;
    const bottom = clip
        ? Math.min(rect.y + rect.height, clip.y + clip.height)
        : rect.y + rect.height;
    if (top >= bottom) return [];
    const clipLeft = clip ? clip.x : -Infinity;
    const clipRight = clip ? clip.x + clip.width : Infinity;

    // The leftmost and rightmost outline cell of each kept row.
    const rows = bottom - top;
    const lefts = new Float64Array(rows).fill(Infinity);
    const rights = new Float64Array(rows).fill(-Infinity);
    const plot = (x: number, y: number): void => {
        if (y < top || y >= bottom) return;
        const row = y - top;
        if (x < lefts[row]!) lefts[row] = x;
        if (x > rights[row]!) rights[row] = x;
    };
    plotEllipseInBox(rect.x, rect.y, rect.x + rect.width - 1, rect.y + rect.height - 1, plot);

    const spans: RowSpan[] = [];
    for (let row = 0; row < rows; row++) {
        const start = Math.max(lefts[row]!, clipLeft);
        const end = Math.min(rights[row]! + 1, clipRight);
        if (start < end) spans.push({ y: top + row, start, end });
    }
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
    const bottom = region.at(-1)!.y + 1;
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
    return span?.y === y && span.start <= x && x < span.end;
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
    const spans: { y: number; start: number; end: number }[] = [];
    for (const { x, y } of sorted) {
        const last = spans.at(-1);
        if (last?.y === y && x <= last.end) last.end = Math.max(last.end, x + 1);
        else spans.push({ y, start: x, end: x + 1 });
    }
    return spans;
}
