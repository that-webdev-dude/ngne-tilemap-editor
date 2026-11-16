import { describe, expect, it } from "vitest";
import { ellipseOutlineCells } from "../../src/core/raster/ellipse";
import { separatePlacements, stampAnchor, stampOrigin } from "../../src/app/tools/stamp/placement";

// TE-017: the ellipse outline of the stamp brush's Ctrl+Shift+click and the stamp placement
// along a line or an ellipse. The expected outline cells for nonzero radii are captured from
// Tiled 1.12.2 on 2026-11-16 (capture folder `ngne-captures/tiled-1.12.2`): each ellipse drawn
// with the stamp brush on its own layer and the map saved as JSON, as cells relative to the
// centre. A saved map shows which cells are painted, not their order or repeats, so these tests
// compare sets; the TE-017 stamp goldens cover the order of the stamps.

const points = (cx: number, cy: number, a: number, b: number) =>
    ellipseOutlineCells({ x: cx, y: cy }, a, b).map((p) => [p.x, p.y]);

/** The distinct cells of `cells`, sorted. */
const cellSet = (cells: readonly (readonly number[])[]) =>
    [...new Set(cells.map(([x, y]) => `${x},${y}`))].sort();

describe("ellipseOutlineCells", () => {
    // Expected points from Alois Zingl's MIT-licensed `plotOptimizedEllipse`, the reference
    // `ellipse.ts` is ported from (notice in THIRD_PARTY_NOTICES.md): for radii 0, 0 it plots
    // the centre once per quadrant.
    it("is the centre four times for radii 0, 0", () => {
        expect(points(3, 4, 0, 0)).toEqual([
            [3, 4],
            [3, 4],
            [3, 4],
            [3, 4],
        ]);
    });

    it("gives Tiled's cells for a 1 × 1 circle", () => {
        expect(cellSet(points(0, 0, 1, 1))).toEqual(
            cellSet([
                [0, -1],
                [-1, 0],
                [1, 0],
                [0, 1],
            ]),
        );
    });

    it("gives Tiled's cells for flat ellipses", () => {
        expect(cellSet(points(0, 0, 3, 1))).toEqual(
            cellSet([
                [-2, -1],
                [-1, -1],
                [0, -1],
                [1, -1],
                [2, -1],
                [-3, 0],
                [3, 0],
                [-2, 1],
                [-1, 1],
                [0, 1],
                [1, 1],
                [2, 1],
            ]),
        );
        expect(cellSet(points(0, 0, 1, 7))).toEqual(
            cellSet([
                [0, -7],
                [0, -6],
                [0, -5],
                [-1, -4],
                [1, -4],
                [-1, -3],
                [1, -3],
                [-1, -2],
                [1, -2],
                [-1, -1],
                [1, -1],
                [-1, 0],
                [1, 0],
                [-1, 1],
                [1, 1],
                [-1, 2],
                [1, 2],
                [-1, 3],
                [1, 3],
                [-1, 4],
                [1, 4],
                [0, 5],
                [0, 6],
                [0, 7],
            ]),
        );
        expect(cellSet(points(0, 0, 0, 3))).toEqual(
            cellSet([
                [0, -3],
                [0, -2],
                [0, -1],
                [0, 0],
                [0, 1],
                [0, 2],
                [0, 3],
            ]),
        );
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
        expect(() => ellipseOutlineCells({ x: 0, y: 0 }, -1, 2)).toThrow(RangeError);
        expect(() => ellipseOutlineCells({ x: 0.5, y: 0 }, 1, 2)).toThrow(RangeError);
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
