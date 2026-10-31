import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cellValue, orientationMatrix } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import { emitAll, sparseCells, tilesetOf, wholeMap } from "./te-011-support";
import type { Quad } from "./te-011-support";

// Placement of the 8 orientations (FORMAT §1.2, §1.3), odd sizes included.

const HALF_PI = Math.PI / 2;

interface Row {
    hvd: string;
    fx: number;
    fy: number;
    theta: number;
    /** Where the texel at tile offset `(a, b)` from the centre lands (FORMAT §1.2, last column). */
    lands: (a: number, b: number) => [number, number];
}

// FORMAT §1.2, row by row.
const ROWS: Row[] = [
    { hvd: "000", fx: 1, fy: 1, theta: 0, lands: (a, b) => [a, b] },
    { hvd: "100", fx: -1, fy: 1, theta: 0, lands: (a, b) => [-a, b] },
    { hvd: "010", fx: 1, fy: -1, theta: 0, lands: (a, b) => [a, -b] },
    { hvd: "110", fx: -1, fy: -1, theta: 0, lands: (a, b) => [-a, -b] },
    { hvd: "101", fx: 1, fy: 1, theta: HALF_PI, lands: (a, b) => [-b, a] },
    { hvd: "011", fx: -1, fy: -1, theta: HALF_PI, lands: (a, b) => [b, -a] },
    { hvd: "001", fx: 1, fy: -1, theta: HALF_PI, lands: (a, b) => [b, a] },
    { hvd: "111", fx: -1, fy: 1, theta: HALF_PI, lands: (a, b) => [-b, -a] },
];

const orientationOf = (row: Row): Orientation => parseInt(row.hvd, 2) as Orientation;

/** NGNE's mapping of the texel at `(a, b)` from the rectangle's centre (FORMAT §1.2). */
function ngneMaps(quad: Quad, a: number, b: number): [number, number] {
    const fx = Math.sign(quad.width);
    const fy = Math.sign(quad.height);
    const p = fx * a;
    const q = fy * b;
    return [
        p * Math.cos(quad.rotation) - q * Math.sin(quad.rotation),
        p * Math.sin(quad.rotation) + q * Math.cos(quad.rotation),
    ];
}

/** One tile of the given size in cell `(cx, cy)`, emitted in slot mode. */
function emitOne(
    tw: number,
    th: number,
    grid: number,
    orientation: Orientation,
    cx = 0,
    cy = 0,
    offset: [number, number] = [0, 0],
): Quad {
    const tileset = tilesetOf({
        key: 1,
        tileWidth: tw,
        tileHeight: th,
        offsetX: offset[0],
        offsetY: offset[1],
    });
    const cells = sparseCells({ [`${cx},${cy}`]: cellValue(1, 1, orientation) });
    const { quads } = emitAll("slot", [tileset], cells, wholeMap(cx + 1, cy + 1, grid));
    expect(quads).toHaveLength(1);
    return quads[0]!;
}

describe("orientation rows (FORMAT §1.2)", () => {
    for (const row of ROWS) {
        it(`${row.hvd}: fx ${row.fx}, fy ${row.fy}, θ ${row.theta === 0 ? "0" : "π/2"}, texel mapping`, () => {
            // A 3 × 2 tile: asymmetric, with an odd side (rectangle 4 × 2).
            const quad = emitOne(3, 2, 8, orientationOf(row));
            expect(quad.width).toBe(row.fx * 4);
            expect(quad.height).toBe(row.fy * 2);
            expect(quad.rotation).toBe(row.theta);

            for (const [a, b] of [
                [1, 0.5],
                [-1.5, 0.5],
                [0, -1],
                [1.5, -0.5],
            ] as const) {
                const [x, y] = ngneMaps(quad, a, b);
                const [ex, ey] = row.lands(a, b);
                expect(x).toBeCloseTo(ex, 9);
                expect(y).toBeCloseTo(ey, 9);
            }
        });

        it(`${row.hvd}: agrees with the orientation matrix of core/cells`, () => {
            const [m00, m01, m10, m11] = orientationMatrix(orientationOf(row));
            for (const [a, b] of [
                [2, 3],
                [-1, 4],
            ] as const) {
                const [ex, ey] = row.lands(a, b);
                expect([m00 * a + m01 * b, m10 * a + m11 * b]).toEqual([ex, ey]);
            }
        });
    }
});

describe("tile placement (FORMAT §1.3)", () => {
    it("places a 15 × 15 tile in a 15 px grid at (8, 8), flipped H at (7, 8), rotated right at (7, 8)", () => {
        const asDrawn = emitOne(15, 15, 15, 0);
        expect([asDrawn.x, asDrawn.y, asDrawn.width, asDrawn.height]).toEqual([8, 8, 16, 16]);

        const flippedH = emitOne(15, 15, 15, 0b100);
        expect([flippedH.x, flippedH.y, flippedH.width, flippedH.height]).toEqual([7, 8, -16, 16]);

        const rotatedRight = emitOne(15, 15, 15, 0b101);
        expect([rotatedRight.x, rotatedRight.y]).toEqual([7, 8]);
        expect(rotatedRight.rotation).toBe(HALF_PI);
    });

    it("places the FORMAT §3.10 cell (3, 1) at (56, 24), from a slot value and from a GID", () => {
        const slotTileset = tilesetOf({ key: 1, tileWidth: 16, tileHeight: 16, tiles: 4 });
        const gidTileset = tilesetOf({ key: 1, tileWidth: 16, tileHeight: 16, tiles: 4 });
        // 2684354562 is 0xA0000002: H and D, GID 2, so tile 1 with firstGid 1.
        const fromGid = emitAll(
            "gid",
            [gidTileset],
            sparseCells({ "3,1": 2684354562 }),
            wholeMap(4, 3, 16),
        );
        const fromSlot = emitAll(
            "slot",
            [slotTileset],
            sparseCells({ "3,1": cellValue(1, 1, 0b101) }),
            wholeMap(4, 3, 16),
        );
        for (const { quads } of [fromGid, fromSlot]) {
            expect(quads).toHaveLength(1);
            const quad = quads[0]!;
            expect([quad.x, quad.y, quad.width, quad.height]).toEqual([56, 24, 16, 16]);
            expect(quad.rotation).toBe(HALF_PI);
        }
        expect(fromGid.quads).toEqual(fromSlot.quads);
    });

    it("keeps the tile's content on the §1.3 centre for every size, offset, cell and orientation", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 64 }),
                fc.integer({ min: 1, max: 64 }),
                fc.integer({ min: 1, max: 64 }),
                fc.integer({ min: -40, max: 40 }),
                fc.integer({ min: -40, max: 40 }),
                fc.integer({ min: 0, max: 6 }),
                fc.integer({ min: 0, max: 6 }),
                fc.integer({ min: 0, max: 7 }),
                (tw, th, grid, offX, offY, cx, cy, o) => {
                    const quad = emitOne(tw, th, grid, o as Orientation, cx, cy, [offX, offY]);
                    const d = (o & 1) === 1;
                    const boxW = d ? th : tw;
                    const boxH = d ? tw : th;
                    const centre = [cx * grid + offX + boxW / 2, (cy + 1) * grid + offY - boxH / 2];

                    // The atlas rectangle is the tile size rounded up to even, content top-left.
                    const w = tw + (tw & 1);
                    const h = th + (th & 1);
                    expect(Math.abs(quad.width)).toBe(w);
                    expect(Math.abs(quad.height)).toBe(h);

                    // The content centre sits `(−pw/2, −ph/2)` from the rectangle centre in
                    // texel space; NGNE maps that offset to where the content lands.
                    const [dx, dy] = ngneMaps(quad, -(w - tw) / 2, -(h - th) / 2);
                    expect(quad.x + dx).toBeCloseTo(centre[0]!, 9);
                    expect(quad.y + dy).toBeCloseTo(centre[1]!, 9);
                },
            ),
        );
    });

    it("applies scale to positions and sizes, translate before it, and not to rotation", () => {
        const tileset = tilesetOf({ key: 1, tileWidth: 15, tileHeight: 15 });
        const options = { ...wholeMap(1, 1, 15), scale: 3, translateX: 10, translateY: -4 };
        const { quads } = emitAll(
            "slot",
            [tileset],
            sparseCells({ "0,0": cellValue(1, 1, 0b101) }),
            options,
        );
        const quad = quads[0]!;
        expect([quad.x, quad.y, quad.width, quad.height]).toEqual([
            (7 + 10) * 3,
            (8 - 4) * 3,
            48,
            48,
        ]);
        expect(quad.rotation).toBe(HALF_PI);
    });
});
