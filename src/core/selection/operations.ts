import type { CellRect } from "../cells";
import type { Region } from "../model";
import { createMask, maskHas, rectMask, selectionOf } from "./mask";

// The operations on a tile selection (SPEC §4.3, §4.4; TE-020): replace, add, subtract,
// intersect, invert, all and none. Each returns a new selection, or null when no cell is left
// selected; none changes the selection or the mask it was given. Masks may lie anywhere on the
// map; a result covers what it needs of both.

/** How a new shape combines with the selection (SPEC §4.3: Shift add, Ctrl subtract, both intersect). */
export type SelectionMode = "replace" | "add" | "subtract" | "intersect";

function rectOf(mask: Region): CellRect {
    return { x: mask.x, y: mask.y, width: mask.width, height: mask.height };
}

/** Copies the set cells of `from` into `into`, where their rectangles meet. */
function paint(into: Region, from: Region, value: 0 | 1): void {
    const left = Math.max(into.x, from.x);
    const top = Math.max(into.y, from.y);
    const right = Math.min(into.x + into.width, from.x + from.width);
    const bottom = Math.min(into.y + into.height, from.y + from.height);
    for (let y = top; y < bottom; y++) {
        const source = (y - from.y) * from.width - from.x;
        const target = (y - into.y) * into.width - into.x;
        for (let x = left; x < right; x++) {
            if (from.mask[source + x] !== 0) into.mask[target + x] = value;
        }
    }
}

/** The cells set in `a` or in `b`. */
export function unionMask(a: Region, b: Region): Region {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const out = createMask({
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
    });
    paint(out, a, 1);
    paint(out, b, 1);
    return out;
}

/** The cells set in `a` and not in `b`. */
export function subtractMask(a: Region, b: Region): Region {
    const out = createMask(rectOf(a));
    paint(out, a, 1);
    paint(out, b, 0);
    return out;
}

/** The cells set in both `a` and `b`. */
export function intersectMask(a: Region, b: Region): Region {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x);
    const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y);
    const out = createMask({ x, y, width, height });
    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            if (maskHas(a, x + u, y + v) && maskHas(b, x + u, y + v)) {
                out.mask[v * width + u] = 1;
            }
        }
    }
    return out;
}

/** The cells of a `width` × `height` map not set in `mask`. */
export function invertMask(mask: Region, width: number, height: number): Region {
    const out = rectMask({ x: 0, y: 0, width, height });
    paint(out, mask, 0);
    return out;
}

/** A mask with every cell of a `width` × `height` map set. */
export function fullMask(width: number, height: number): Region {
    return rectMask({ x: 0, y: 0, width, height });
}

/** Every cell of a `width` × `height` map: Select All. */
export function selectAll(width: number, height: number): Region {
    return fullMask(width, height);
}

/**
 * `shape` combined with `current` by `mode`: `replace` is the shape alone, `add` the union,
 * `subtract` what `current` keeps outside the shape, `intersect` what both select (Tiled's
 * `applySelectionPreview`). Without a current selection, `add` acts as `replace` and
 * `subtract` and `intersect` select nothing. The result may keep `shape` itself only for
 * `replace` (`selectionOf`). Null when no cell is selected.
 */
export function combineSelection(
    current: Region | null,
    shape: Region,
    mode: SelectionMode,
): Region | null {
    switch (mode) {
        case "replace":
            return selectionOf(shape);
        case "add":
            return selectionOf(current ? unionMask(current, shape) : shape);
        case "subtract":
            return current ? selectionOf(subtractMask(current, shape)) : null;
        case "intersect":
            return current ? selectionOf(intersectMask(current, shape)) : null;
    }
}

/**
 * The cells of a `width` × `height` map outside `current`: Invert Selection. With no
 * selection every cell is selected; a selection of every cell inverts to none (null).
 */
export function invertSelection(
    current: Region | null,
    width: number,
    height: number,
): Region | null {
    if (!current) return selectAll(width, height);
    return selectionOf(invertMask(current, width, height));
}
