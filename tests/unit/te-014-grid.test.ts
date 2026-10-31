import { describe, expect, it } from "vitest";
import {
    GRID_MIN_SPACING,
    axesOf,
    axisLines,
    cellGridLines,
    lineRects,
    visiblePart,
} from "../../src/app/overlay/gridLines";

// The cell grid's placement (TE-014): a 1 device pixel line on the first device pixel of every
// cell, along an axis only while its cells are at least 4 device pixels.

const CANVAS = { width: 400, height: 300 };
const MAP = { width: 16 * 20, height: 16 * 10 };

function axes(scale: number, origin = { x: 40, y: 30 }) {
    return axesOf(origin, scale, MAP, CANVAS);
}

describe("axisLines", () => {
    it("puts a line on the first device pixel of every cell, the first cell included", () => {
        const lines = axisLines(axes(2).x, 16);
        // The canvas is 400 wide: 12 cells of 32 start on it.
        expect(lines).toHaveLength(12);
        expect(lines[0]).toBe(40);
        expect(lines[1]).toBe(72);
        expect(lines[11]).toBe(40 + 11 * 32);
        // A canvas wide enough for the map: one line per cell, none at the far edge.
        const wide = axisLines({ ...axes(2).x, canvas: 2000 }, 16);
        expect(wide).toHaveLength(20);
        expect(wide).not.toContain(40 + 20 * 32);
    });

    it("lists only the lines on the canvas, ascending, each once", () => {
        const lines = axisLines(axes(4, { x: -100, y: 0 }).x, 16);
        expect(lines[0]).toBe(-100 + 2 * 64);
        expect(lines.every((line) => line >= 0 && line < CANVAS.width)).toBe(true);
        expect([...lines].sort((a, b) => a - b)).toEqual(lines);
        expect(new Set(lines).size).toBe(lines.length);
    });

    it("lies on the cell edges where the map corner is on a whole pixel", () => {
        for (const scale of [1, 2, 3, 5, 8]) {
            const { x } = axes(scale);
            const step = 16 * scale;
            const lines = axisLines(x, 16);
            for (const [n, line] of lines.entries()) expect(line).toBe(40 + n * step);
        }
    });

    it("has none for a map without cells or a step below 1", () => {
        expect(axisLines({ ...axes(2).x, length: 0 }, 16)).toEqual([]);
        expect(axisLines(axes(2).x, 0)).toEqual([]);
    });

    it("rounds the overview steps and starts each line once", () => {
        // 16 map pixels at 1/8 are 2 device pixels apart; a cell of 1 pixel would collide.
        const lines = axisLines(axes(1 / 8).x, 1);
        expect(new Set(lines).size).toBe(lines.length);
    });
});

describe("cellGridLines", () => {
    it("appears from 4 device pixels per cell and not below", () => {
        const at = (scale: number) => cellGridLines(axes(scale), 16, 16);
        expect(GRID_MIN_SPACING).toBe(4);
        // 16 × 1/4 = 4: shown. 16 × 1/8 = 2: hidden.
        expect(at(1 / 4).columns.length).toBeGreaterThan(0);
        expect(at(1 / 4).rows.length).toBeGreaterThan(0);
        expect(at(1 / 8)).toEqual({ columns: [], rows: [] });
        expect(at(1 / 32)).toEqual({ columns: [], rows: [] });
    });

    it("decides each axis from its own cell size", () => {
        // 16 × 8 cells at 1/4: 4 device pixels wide, 2 high.
        const lines = cellGridLines(axes(1 / 4), 16, 8);
        expect(lines.columns.length).toBeGreaterThan(0);
        expect(lines.rows).toEqual([]);
    });
});

describe("lineRects and visiblePart", () => {
    it("makes 1 pixel lines across the visible map", () => {
        const area = visiblePart({ x: 40, y: 30, width: 640, height: 320 }, CANVAS);
        expect(area).toEqual({ x: 40, y: 30, width: 360, height: 270 });
        const rects = lineRects({ columns: [40, 72], rows: [30] }, area!);
        expect(rects).toEqual([
            { x: 40, y: 30, width: 1, height: 270 },
            { x: 72, y: 30, width: 1, height: 270 },
            { x: 40, y: 30, width: 360, height: 1 },
        ]);
    });

    it("has no visible part for a map off the canvas", () => {
        expect(visiblePart({ x: 400, y: 0, width: 10, height: 10 }, CANVAS)).toBeNull();
        expect(visiblePart({ x: -20, y: 0, width: 10, height: 10 }, CANVAS)).toBeNull();
    });
});
