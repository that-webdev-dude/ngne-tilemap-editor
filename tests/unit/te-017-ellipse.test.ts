import { describe, expect, it } from "vitest";
import { pointsOnEllipse } from "../../src/core/raster/ellipse";
import { separatePlacements, stampAnchor, stampOrigin } from "../../src/app/tools/stamp/placement";

// TE-017: the ellipse outline of the stamp brush's Ctrl+Shift+click (Zingl's `plotEllipse`, as
// Tiled v1.12.2 draws it) and the stamp placement along a line or an ellipse. The expected
// points are fixed data computed independently of the editor's code: points in the order the
// four quadrants are drawn, repeats included.

const points = (cx: number, cy: number, a: number, b: number) =>
    pointsOnEllipse({ x: cx, y: cy }, a, b).map((p) => [p.x, p.y]);

describe("pointsOnEllipse", () => {
    it("is the centre four times for radii 0, 0", () => {
        expect(points(3, 4, 0, 0)).toEqual([
            [3, 4],
            [3, 4],
            [3, 4],
            [3, 4],
        ]);
    });

    it("gives Tiled's points for a 1 × 1 circle", () => {
        expect(points(0, 0, 1, 1)).toEqual([
            [1, 0],
            [-1, 0],
            [-1, 0],
            [1, 0],
            [0, 1],
            [0, 1],
            [0, -1],
            [0, -1],
        ]);
    });

    it("gives Tiled's points for flat ellipses", () => {
        expect(points(0, 0, 3, 1)).toEqual([
            [3, 0],
            [-3, 0],
            [-3, 0],
            [3, 0],
            [2, 1],
            [-2, 1],
            [-2, -1],
            [2, -1],
            [1, 1],
            [-1, 1],
            [-1, -1],
            [1, -1],
            [0, 1],
            [0, 1],
            [0, -1],
            [0, -1],
        ]);
        // Radius x 1 stops the quadrant loop early; the closing loop adds the tips.
        expect(points(0, 0, 1, 7)).toEqual([
            [1, 0],
            [-1, 0],
            [-1, 0],
            [1, 0],
            [1, 1],
            [-1, 1],
            [-1, -1],
            [1, -1],
            [1, 2],
            [-1, 2],
            [-1, -2],
            [1, -2],
            [1, 3],
            [-1, 3],
            [-1, -3],
            [1, -3],
            [1, 4],
            [-1, 4],
            [-1, -4],
            [1, -4],
            [0, 5],
            [0, 5],
            [0, -5],
            [0, -5],
            [0, 6],
            [0, -6],
            [0, 7],
            [0, -7],
        ]);
        // Radius x 0: the centre, then the tips alone.
        expect(points(0, 0, 0, 3)).toEqual([
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 1],
            [0, -1],
            [0, 2],
            [0, -2],
            [0, 3],
            [0, -3],
        ]);
    });

    it("is symmetric about its centre", () => {
        const result = points(10, 7, 6, 4);
        const keys = new Set(result.map(([x, y]) => `${x},${y}`));
        for (const [x, y] of result) {
            expect(keys.has(`${20 - x!},${y}`)).toBe(true);
            expect(keys.has(`${x},${14 - y!}`)).toBe(true);
        }
        expect(keys.has("16,7")).toBe(true);
        expect(keys.has("10,11")).toBe(true);
    });

    it("refuses negative radii and fractions", () => {
        expect(() => pointsOnEllipse({ x: 0, y: 0 }, -1, 2)).toThrow(RangeError);
        expect(() => pointsOnEllipse({ x: 0.5, y: 0 }, 1, 2)).toThrow(RangeError);
    });
});

describe("stamp placement", () => {
    const stamp = (width: number, height: number, cells: number[]) => ({
        width,
        height,
        cells: Uint32Array.from(cells),
    });

    it("anchors a stamp at its centre cell, floor(w/2), floor(h/2)", () => {
        expect(stampAnchor({ width: 1, height: 1 })).toEqual({ x: 0, y: 0 });
        expect(stampAnchor({ width: 2, height: 2 })).toEqual({ x: 1, y: 1 });
        expect(stampAnchor({ width: 3, height: 2 })).toEqual({ x: 1, y: 1 });
        expect(stampAnchor({ width: 4, height: 5 })).toEqual({ x: 2, y: 2 });
        expect(stampOrigin({ width: 3, height: 3 }, { x: 5, y: 5 })).toEqual({ x: 4, y: 4 });
    });

    it("leaves out placements whose non-empty cells meet earlier ones, and repeats", () => {
        const block = stamp(2, 1, [1, 1]);
        const line = [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 }));
        expect(separatePlacements(block, line)).toEqual([
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 4, y: 0 },
        ]);
        // Empty cells do not count: a 2 × 1 stamp with one tile meets nothing on a line.
        const half = stamp(2, 1, [1, 0]);
        expect(separatePlacements(half, line)).toHaveLength(5);
        // A repeated point is left out.
        expect(separatePlacements(stamp(1, 1, [1]), [line[1]!, line[1]!])).toEqual([line[1]]);
    });
});
