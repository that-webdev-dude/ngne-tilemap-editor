import type { DeviceSize } from "../../engine/viewport/geometry";

// Where the overlay's cell grid goes, in device pixels of the overlay canvas (TE-014). Pure: no
// DOM and no store, so the placement is unit-tested in Node.
//
// A grid line is 1 device pixel wide and lies on the first device pixel of a cell: at a zoom
// step of 1 and above that is exactly where NGNE starts the cell's first texel (the map's
// corner is on a whole device pixel there, `navigate.ts`). Every cell has its line, the first
// one included, so every cell shows the same width of clear pixels.

/** The grid is drawn along an axis while one cell is at least this many device pixels there (DESIGN §4). */
export const GRID_MIN_SPACING = 4;

/** A rectangle in device pixels. */
export interface DeviceRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The map along one axis of the canvas. */
export interface Axis {
    /** Device position of the map's first pixel along the axis. */
    origin: number;
    /** Device pixels per map pixel. */
    scale: number;
    /** Map pixels the map covers along the axis. */
    length: number;
    /** Device pixels of the canvas along the axis. */
    canvas: number;
}

/** The two axes of a map on a canvas. */
export function axesOf(
    origin: { x: number; y: number },
    scale: number,
    map: { width: number; height: number },
    canvas: DeviceSize,
): { x: Axis; y: Axis } {
    return {
        x: { origin: origin.x, scale, length: map.width, canvas: canvas.width },
        y: { origin: origin.y, scale, length: map.height, canvas: canvas.height },
    };
}

/** The device pixel at which map position `position` starts, rounded to a whole pixel. */
export function devicePosition(axis: Axis, position: number): number {
    return Math.round(axis.origin + position * axis.scale);
}

/**
 * The device pixels (columns or rows) of the lines at the map positions `n × step` from 0 up
 * to the map's far edge (not included) that lie on the canvas; ascending, each once. `step`
 * is the cell size in map pixels, at least 1.
 */
export function axisLines(axis: Axis, step: number): number[] {
    const lines: number[] = [];
    if (!(step >= 1) || axis.length < 1 || !(axis.scale > 0)) return lines;
    const first = Math.max(0, Math.floor(-axis.origin / axis.scale / step) - 1);
    const last = Math.ceil(axis.length / step) - 1;
    const start = Math.round(axis.origin);
    const end = Math.round(axis.origin + axis.length * axis.scale);
    for (let n = first; n <= last; n++) {
        const device = devicePosition(axis, n * step);
        if (device >= axis.canvas) break;
        // Inside the map and on the canvas, also where the overview steps round.
        if (device < 0 || device < start || device >= end) continue;
        // At the overview steps two cells can start on the same device pixel.
        if (lines[lines.length - 1] !== device) lines.push(device);
    }
    return lines;
}

/** Lines of the grid: device columns of its vertical lines and rows of its horizontal ones. */
export interface GridLines {
    columns: number[];
    rows: number[];
}

/**
 * The cell grid: a line at the start of every cell, along each axis whose cells are at least
 * `GRID_MIN_SPACING` device pixels on screen; closer lines would tint the map evenly.
 */
export function cellGridLines(
    axes: { x: Axis; y: Axis },
    tileWidth: number,
    tileHeight: number,
): GridLines {
    const along = (axis: Axis, size: number) =>
        size * axis.scale >= GRID_MIN_SPACING ? axisLines(axis, size) : [];
    return { columns: along(axes.x, tileWidth), rows: along(axes.y, tileHeight) };
}

/** The part of `rect` on a canvas of `size`; null when none of it is. */
export function visiblePart(rect: DeviceRect, size: DeviceSize): DeviceRect | null {
    const x = Math.max(0, rect.x);
    const y = Math.max(0, rect.y);
    const right = Math.min(size.width, rect.x + rect.width);
    const bottom = Math.min(size.height, rect.y + rect.height);
    if (right <= x || bottom <= y) return null;
    return { x, y, width: right - x, height: bottom - y };
}

/** The 1-pixel rectangles of `lines`, each across `area` (the visible map). */
export function lineRects(lines: GridLines, area: DeviceRect): DeviceRect[] {
    return [
        ...lines.columns.map((x) => ({ x, y: area.y, width: 1, height: area.height })),
        ...lines.rows.map((y) => ({ x: area.x, y, width: area.width, height: 1 })),
    ];
}
