// The geometry of the source sheet of Replace with… (UpdateDialog): the grid of tiles and the
// size of the backing store of its canvas. Pure, so it unit-tests without a DOM.

/** Columns of the source grid of Replace with…, at least. */
const SHEET_COLUMNS = 12;
/** Rows of that grid, at most: more tiles take more columns. */
const SHEET_ROWS = 400;
/** Longest side of a canvas, in px: Chromium's kMaxSkiaDim. */
export const MAX_CANVAS_SIDE = 32767;
/** Largest area of a canvas, in px: Chromium's kMaxCanvasArea (32768 × 8192). */
export const MAX_CANVAS_AREA = 268435456;

export interface SheetLayout {
    columns: number;
    rows: number;
    pitchX: number;
    pitchY: number;
    /** The canvas size in CSS pixels. */
    width: number;
    height: number;
}

/** The grid for `count` tiles of `cellWidth` × `cellHeight` CSS pixels, one px between them. */
export function sheetLayout(count: number, cellWidth: number, cellHeight: number): SheetLayout {
    const columns = Math.min(count, Math.max(SHEET_COLUMNS, Math.ceil(count / SHEET_ROWS)));
    const rows = Math.ceil(count / columns);
    const pitchX = cellWidth + 1;
    const pitchY = cellHeight + 1;
    return {
        columns,
        rows,
        pitchX,
        pitchY,
        width: columns * pitchX + 1,
        height: rows * pitchY + 1,
    };
}

export interface SheetBacking {
    /** The backing store, in px. */
    width: number;
    height: number;
    /** Backing pixels per CSS pixel: the device pixel ratio, less when the limits need it. */
    scale: number;
}

/**
 * The backing store of a canvas of `cssWidth` × `cssHeight` at `dpr`: the largest scale up to
 * `dpr` that keeps both sides within `MAX_CANVAS_SIDE` and the area within `MAX_CANVAS_AREA`
 * (below 1 when even that does not fit), since a canvas past a limit renders blank.
 */
export function sheetBacking(cssWidth: number, cssHeight: number, dpr: number): SheetBacking {
    const fit = Math.min(
        MAX_CANVAS_SIDE / cssWidth,
        MAX_CANVAS_SIDE / cssHeight,
        Math.sqrt(MAX_CANVAS_AREA / (cssWidth * cssHeight)),
    );
    if (dpr <= fit) {
        return {
            width: Math.round(cssWidth * dpr),
            height: Math.round(cssHeight * dpr),
            scale: dpr,
        };
    }
    return {
        width: Math.floor(cssWidth * fit),
        height: Math.floor(cssHeight * fit),
        scale: fit,
    };
}
