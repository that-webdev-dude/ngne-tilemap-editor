import type { CellRect } from "../cells";
import type { Region as Spans, RowSpan } from "../fill";
import type { Region } from "../model";

// Cell masks (SPEC §3, §4.4; TE-020), in the layout of the model's `Region`: a rectangle of
// cells in map coordinates and one byte per cell of it, row by row, 1 for a selected cell and
// 0 for any other. A selection is a mask whose rectangle is the bounding box of its selected
// cells; "no selection" is null, never an empty mask.
//
// Masks and selections are values: nothing here changes a mask it was given, and the
// selection commands never change the `Region` a map session holds; they put another one in
// its place. A stroke can therefore take the session's mask as its clip and keep it.

function assertRect(rect: CellRect, caller: string): void {
    const { x, y, width, height } = rect;
    if (![x, y, width, height].every(Number.isInteger) || width < 0 || height < 0) {
        throw new RangeError(
            `${caller}: a mask covers whole cells, got ${x}, ${y}, ${width} × ${height}.`,
        );
    }
}

/** An empty mask over `rect` (which may be empty). */
export function createMask(rect: CellRect): Region {
    assertRect(rect, "createMask");
    const { x, y, width, height } = rect;
    return { x, y, width, height, mask: new Uint8Array(width * height) };
}

/** A copy of `mask` that shares no memory with it. */
export function copyMask(mask: Region): Region {
    return { ...mask, mask: mask.mask.slice() };
}

/** Whether cell `x, y` is set; false outside the mask's rectangle. */
export function maskHas(mask: Region, x: number, y: number): boolean {
    const u = x - mask.x;
    const v = y - mask.y;
    if (u < 0 || v < 0 || u >= mask.width || v >= mask.height) return false;
    return mask.mask[v * mask.width + u] !== 0;
}

/** Sets cell `x, y` of a mask being built; a cell outside its rectangle is ignored. */
export function setMaskCell(mask: Region, x: number, y: number): void {
    setMaskRun(mask, y, x, x + 1);
}

/** Sets the cells `[x0, x1)` of row `y` of a mask being built, clipped to its rectangle. */
export function setMaskRun(mask: Region, y: number, x0: number, x1: number): void {
    const v = y - mask.y;
    if (v < 0 || v >= mask.height) return;
    const from = Math.max(0, x0 - mask.x);
    const to = Math.min(mask.width, x1 - mask.x);
    if (to > from) mask.mask.fill(1, v * mask.width + from, v * mask.width + to);
}

/** The bounding rectangle of the set cells, or null when none is set. */
export function maskBounds(mask: Region): CellRect | null {
    const { width, height, mask: data } = mask;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let v = 0; v < height; v++) {
        const row = v * width;
        for (let u = 0; u < width; u++) {
            if (data[row + u] === 0) continue;
            if (u < minX) minX = u;
            if (u > maxX) maxX = u;
            if (v < minY) minY = v;
            maxY = v;
        }
    }
    return maxX < 0
        ? null
        : { x: mask.x + minX, y: mask.y + minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * The selection of the set cells of `mask`: the mask itself when its rectangle is already
 * their bounding box, else a copy cut to it; null when no cell is set. A selection made from
 * `mask` may keep it: the caller hands it over and does not change it afterwards.
 */
export function selectionOf(mask: Region): Region | null {
    const bounds = maskBounds(mask);
    if (!bounds) return null;
    if (
        bounds.x === mask.x &&
        bounds.y === mask.y &&
        bounds.width === mask.width &&
        bounds.height === mask.height
    ) {
        return mask;
    }
    const out = createMask(bounds);
    for (let v = 0; v < bounds.height; v++) {
        const from = (bounds.y - mask.y + v) * mask.width + (bounds.x - mask.x);
        out.mask.set(mask.mask.subarray(from, from + bounds.width), v * bounds.width);
    }
    return out;
}

/** Whether two masks set the same cells, wherever their rectangles lie. */
export function masksEqual(a: Region, b: Region): boolean {
    const left = selectionOf(a);
    const right = selectionOf(b);
    if (!left || !right) return left === right;
    if (
        left.x !== right.x ||
        left.y !== right.y ||
        left.width !== right.width ||
        left.height !== right.height
    ) {
        return false;
    }
    for (let index = 0; index < left.mask.length; index++) {
        if ((left.mask[index] !== 0) !== (right.mask[index] !== 0)) return false;
    }
    return true;
}

/** Whether two selections (or their absence) select the same cells. */
export function selectionsEqual(a: Region | null, b: Region | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return masksEqual(a, b);
}

/** The mask of every cell of `rect`. */
export function rectMask(rect: CellRect): Region {
    const mask = createMask(rect);
    mask.mask.fill(1);
    return mask;
}

/** The mask of the cells of `spans` (a region of `core/fill`) over their bounding box. */
export function spansMask(spans: Spans): Region {
    if (spans.length === 0) return createMask({ x: 0, y: 0, width: 0, height: 0 });
    let left = Infinity;
    let right = -Infinity;
    for (const span of spans) {
        left = Math.min(left, span.start);
        right = Math.max(right, span.end);
    }
    const top = spans[0]!.y;
    const bottom = spans[spans.length - 1]!.y + 1;
    const mask = createMask({ x: left, y: top, width: right - left, height: bottom - top });
    for (const span of spans) setMaskRun(mask, span.y, span.start, span.end);
    return mask;
}

/** The set cells of `mask` as row spans (a region of `core/fill`), sorted by row. */
export function maskSpans(mask: Region): Spans {
    const spans: RowSpan[] = [];
    const { width, height, mask: data } = mask;
    for (let v = 0; v < height; v++) {
        const row = v * width;
        let u = 0;
        while (u < width) {
            if (data[row + u] === 0) {
                u++;
                continue;
            }
            const start = u;
            while (u < width && data[row + u] !== 0) u++;
            spans.push({ y: mask.y + v, start: mask.x + start, end: mask.x + u });
        }
    }
    return spans;
}

/** How many cells `mask` sets. */
export function maskSize(mask: Region): number {
    let count = 0;
    for (const value of mask.mask) if (value !== 0) count++;
    return count;
}
