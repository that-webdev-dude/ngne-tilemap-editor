import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { shapeArea, shapePlan } from "../../src/app/tools/fill/shapeFill.tools";
import { CellStore, cellValue } from "../../src/core/cells";
import type { CellRect, Stamp } from "../../src/core/cells";
import {
    clipRegion,
    ellipseRegion,
    floodRegion,
    forEachTileFillCell,
    rectRegion,
    regionBounds,
    regionCells,
    regionContains,
    regionOf,
    regionSize,
} from "../../src/core/fill";
import type { Region } from "../../src/core/fill";

// TE-019: `core/fill` (SPEC §4.3). The flood fill of the bucket and the magic wand, 4-connected
// over cells equal by tile and flags, bounded by the map or a region; the rectangle and ellipse
// regions of the shape fill (the ellipse inscribed in the rectangle, as Tiled's shape fill
// draws it); and the stamp tiled over a region from its bounding box top-left (Tiled's
// `TileFill`). Regions are
// compared with golden pictures: `#` a cell of the region, `.` not.

/** The region of a picture whose top-left cell is `(x, y)`. */
function picture(rows: readonly string[], x = 0, y = 0): Region {
    const cells: { x: number; y: number }[] = [];
    rows.forEach((row, dy) => {
        [...row].forEach((char, dx) => {
            if (char === "#") cells.push({ x: x + dx, y: y + dy });
        });
    });
    return regionOf(cells);
}

/** The picture of `region` over `rect`. */
function draw(region: Region, rect: CellRect): string[] {
    const rows: string[] = [];
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        let row = "";
        for (let x = rect.x; x < rect.x + rect.width; x++) {
            row += regionContains(region, x, y) ? "#" : ".";
        }
        rows.push(row);
    }
    return rows;
}

/** A layer from a picture of tile ids (`0`–`9`, `.` empty) and the flags `h` `v` `d` after. */
function layer(rows: readonly string[]): CellStore {
    const store = new CellStore();
    rows.forEach((row, y) => {
        [...row].forEach((char, x) => {
            if (char === ".") return;
            // Upper case: the same tile flipped horizontally (orientation 4).
            const flipped = char >= "A" && char <= "J";
            const tile = flipped ? char.charCodeAt(0) - 65 : Number(char);
            store.set(x, y, cellValue(1, tile, flipped ? 4 : 0));
        });
    });
    return store;
}

const reader = (store: CellStore) => (x: number, y: number) => store.get(x, y);

/** The region is sorted by row and start, and its spans of a row neither meet nor overlap. */
function expectNormal(region: Region): void {
    for (let n = 1; n < region.length; n++) {
        const a = region[n - 1]!;
        const b = region[n]!;
        expect(a.y < b.y || (a.y === b.y && a.end < b.start), `${n}`).toBe(true);
    }
    for (const span of region) expect(span.start < span.end).toBe(true);
}

describe("flood fill", () => {
    const MAP = { x: 0, y: 0, width: 8, height: 6 };
    const GROUND = ["11112222", "1..12..2", "1..1222.", "11.1....", "...11111", "2.2.1..1"];

    it("fills the 4-connected empty region, not through diagonal gaps", () => {
        const region = floodRegion(reader(layer(GROUND)), { x: 1, y: 1 }, MAP);
        expect(draw(region, MAP)).toEqual([
            "........",
            ".##.....",
            ".##.....",
            "..#.....",
            "###.....",
            ".#......",
        ]);
        expectNormal(region);
    });

    it("fills a region of one tile around holes and spans of several runs per row", () => {
        const region = floodRegion(reader(layer(GROUND)), { x: 0, y: 0 }, MAP);
        expect(draw(region, MAP)).toEqual([
            "####....",
            "#..#....",
            "#..#....",
            "##.#....",
            "...#####",
            "....#..#",
        ]);
        expectNormal(region);
    });

    it("tells cells apart by their flags, as Tiled's Cell equality", () => {
        // B is tile 1 flipped horizontally.
        const rows = ["11BB", "1B1B", "BBB1"];
        const rect = { x: 0, y: 0, width: 4, height: 3 };
        const plain = floodRegion(reader(layer(rows)), { x: 0, y: 0 }, rect);
        expect(draw(plain, rect)).toEqual(["##..", "#...", "...."]);
        const flipped = floodRegion(reader(layer(rows)), { x: 2, y: 0 }, rect);
        expect(draw(flipped, rect)).toEqual(["..##", "...#", "...."]);
    });

    it("stops at the bounds and gives nothing for an origin outside them", () => {
        const empty = reader(new CellStore());
        const bounds = { x: 2, y: 1, width: 3, height: 2 };
        const region = floodRegion(empty, { x: 3, y: 2 }, bounds);
        expect(region).toEqual(rectRegion(bounds));
        expect(floodRegion(empty, { x: 1, y: 1 }, bounds)).toEqual([]);
        expect(floodRegion(empty, { x: 0, y: 0 }, { x: 0, y: 0, width: 0, height: 4 })).toEqual([]);
    });

    it("is bounded by a region: only its cells, through its cells", () => {
        const bound = picture(["###.###", "#.#.#.#", "###.###"]);
        const rect = { x: 0, y: 0, width: 7, height: 3 };
        const region = floodRegion(reader(new CellStore()), { x: 0, y: 0 }, bound);
        expect(draw(region, rect)).toEqual(["###....", "#.#....", "###...."]);
        expect(floodRegion(reader(new CellStore()), { x: 1, y: 1 }, bound)).toEqual([]);
    });

    it("takes a match condition instead of equality", () => {
        const store = layer(["1.2", "3.4", "..5"]);
        const rect = { x: 0, y: 0, width: 3, height: 3 };
        const filled = floodRegion(reader(store), { x: 0, y: 0 }, rect, (value) => value !== 0);
        expect(draw(filled, rect)).toEqual(["#..", "#..", "..."]);
    });

    it("fills a 256 × 256 layer of one value as one span per row", () => {
        const map = { x: 0, y: 0, width: 256, height: 256 };
        const region = floodRegion(() => 0, { x: 100, y: 200 }, map);
        expect(region).toEqual(rectRegion(map));
        expect(regionSize(region)).toBe(65_536);
    });
});

describe("flood fill properties", () => {
    const WIDTH = 12;
    const HEIGHT = 9;
    /** A layer of a few values (some flipped) and an origin inside it. */
    const arbitraryLayer = fc.record({
        values: fc.array(fc.constantFrom(0, cellValue(1, 0), cellValue(1, 1), cellValue(1, 0, 4)), {
            minLength: WIDTH * HEIGHT,
            maxLength: WIDTH * HEIGHT,
        }),
        x: fc.integer({ min: 0, max: WIDTH - 1 }),
        y: fc.integer({ min: 0, max: HEIGHT - 1 }),
    });
    const bounds = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

    it("is 4-connected, uniform and maximal, and holds the origin", () => {
        fc.assert(
            fc.property(arbitraryLayer, ({ values, x, y }) => {
                const read = (cx: number, cy: number) => values[cy * WIDTH + cx]!;
                const region = floodRegion(read, { x, y }, bounds);
                expectNormal(region);
                const cells = regionCells(region);
                const key = (cx: number, cy: number) => `${cx},${cy}`;
                const inRegion = new Set(cells.map((cell) => key(cell.x, cell.y)));
                expect(inRegion.has(key(x, y))).toBe(true);
                const target = read(x, y);
                // Uniform: every cell has the origin's value.
                for (const cell of cells) expect(read(cell.x, cell.y)).toBe(target);
                // Maximal: no 4-neighbour of the region inside the bounds has that value.
                const sides = [
                    [1, 0],
                    [-1, 0],
                    [0, 1],
                    [0, -1],
                ] as const;
                for (const cell of cells) {
                    for (const [dx, dy] of sides) {
                        const nx = cell.x + dx;
                        const ny = cell.y + dy;
                        if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT) continue;
                        if (read(nx, ny) === target) expect(inRegion.has(key(nx, ny))).toBe(true);
                    }
                }
                // 4-connected: a walk over 4-neighbours from the origin reaches every cell.
                const reached = new Set([key(x, y)]);
                const queue = [{ x, y }];
                while (queue.length > 0) {
                    const cell = queue.shift()!;
                    for (const [dx, dy] of sides) {
                        const next = key(cell.x + dx, cell.y + dy);
                        if (!inRegion.has(next) || reached.has(next)) continue;
                        reached.add(next);
                        queue.push({ x: cell.x + dx, y: cell.y + dy });
                    }
                }
                expect(reached.size).toBe(inRegion.size);
            }),
            { numRuns: 300 },
        );
    });
});

/**
 * The reference ellipse: the pixels of `plotEllipseRect(x0, y0, x1, y1)` from Alois Zingl's
 * "Bresenham" (github.com/zingl/Bresenham, `bresenham.js`, MIT licence, (c) 2020 zingl), with
 * each row filled between its leftmost and rightmost pixel, for checking the row-span version
 * against.
 */
function referenceEllipse(rect: CellRect): Set<string> {
    const rows = new Map<number, [number, number]>();
    const setPixel = (x: number, y: number) => {
        const row = rows.get(y);
        if (row) rows.set(y, [Math.min(row[0], x), Math.max(row[1], x)]);
        else rows.set(y, [x, x]);
    };
    let x0 = rect.x;
    let x1 = rect.x + rect.width - 1;
    let y0 = rect.y;
    let y1 = rect.y + rect.height - 1;
    let a = Math.abs(x1 - x0);
    const b = Math.abs(y1 - y0);
    let b1 = b & 1;
    let dx = 4 * (1.0 - a) * b * b;
    let dy = 4 * (b1 + 1) * a * a;
    let err = dx + dy + b1 * a * a;
    y0 += (b + 1) >> 1;
    y1 = y0 - b1;
    a = 8 * a * a;
    b1 = 8 * b * b;
    do {
        setPixel(x1, y0);
        setPixel(x0, y0);
        setPixel(x0, y1);
        setPixel(x1, y1);
        const e2 = 2 * err;
        if (e2 <= dy) {
            y0++;
            y1--;
            dy += a;
            err += dy;
        }
        if (e2 >= dx || 2 * err > dy) {
            x0++;
            x1--;
            dx += b1;
            err += dx;
        }
    } while (x0 <= x1);
    while (y0 - y1 <= b) {
        setPixel(x0 - 1, y0);
        setPixel(x1 + 1, y0++);
        setPixel(x0 - 1, y1);
        setPixel(x1 + 1, y1--);
    }
    const cells = new Set<string>();
    for (const [y, [left, right]] of rows) {
        for (let x = left; x <= right; x++) cells.add(`${x},${y}`);
    }
    return cells;
}

describe("ellipse region", () => {
    const GOLDENS: [width: number, height: number, rows: string[]][] = [
        [1, 1, ["#"]],
        [2, 2, ["##", "##"]],
        [3, 3, [".#.", "###", ".#."]],
        [4, 4, [".##.", "####", "####", ".##."]],
        [5, 5, [".###.", "#####", "#####", "#####", ".###."]],
        [7, 7, ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."]],
        [6, 4, [".####.", "######", "######", ".####."]],
        [8, 3, ["..####..", "########", "..####.."]],
        [2, 8, ["##", "##", "##", "##", "##", "##", "##", "##"]],
        [1, 5, ["#", "#", "#", "#", "#"]],
        [5, 1, ["#####"]],
        [9, 5, ["..#####..", ".#######.", "#########", ".#######.", "..#####.."]],
    ];

    it("is Tiled's ellipseRegion: goldens", () => {
        for (const [width, height, rows] of GOLDENS) {
            const rect = { x: 3, y: -2, width, height };
            const region = ellipseRegion(rect);
            expect(draw(region, rect), `${width} × ${height}`).toEqual(rows);
            expectNormal(region);
        }
    });

    it("matches Zingl's plotEllipseRect cell for cell up to 40 × 40, and touches every side", () => {
        const wrong: string[] = [];
        for (let width = 1; width <= 40; width++) {
            for (let height = 1; height <= 40; height++) {
                const rect = { x: -5, y: 7, width, height };
                const region = ellipseRegion(rect);
                const reference = referenceEllipse(rect);
                const ours = regionCells(region).map(({ x, y }) => `${x},${y}`);
                if (ours.length !== reference.size || ours.some((cell) => !reference.has(cell))) {
                    wrong.push(`${width}×${height}`);
                }
                if (JSON.stringify(regionBounds(region)) !== JSON.stringify(rect)) {
                    wrong.push(`${width}×${height} bounds`);
                }
                expectNormal(region);
            }
        }
        expect(wrong).toEqual([]);
    });

    it("clips to a rectangle, also for rectangles far larger than a map", () => {
        const rect = { x: 0, y: 0, width: 9, height: 5 };
        const clip = { x: 1, y: 1, width: 3, height: 10 };
        expect(ellipseRegion(rect, clip)).toEqual(clipRegion(ellipseRegion(rect), clip));
        const huge = { x: -30_000, y: -20_000, width: 60_001, height: 40_001 };
        const map = { x: 0, y: 0, width: 4, height: 4 };
        // The middle of the huge ellipse: every cell of the map is inside.
        expect(ellipseRegion(huge, map)).toEqual(rectRegion(map));
        // Its top and bottom rows: one run each, the same, about the middle column.
        const top = ellipseRegion(huge, { ...huge, height: 1 });
        const bottom = ellipseRegion(huge, { ...huge, y: 20_000, height: 1 });
        expect(top).toHaveLength(1);
        expect(top[0]!.start + top[0]!.end).toBe(2 * huge.x + huge.width);
        expect(bottom).toEqual([{ ...top[0]!, y: 20_000 }]);
        expect(ellipseRegion({ x: 0, y: 0, width: 0, height: 3 })).toEqual([]);
        expect(ellipseRegion(rect, { x: 0, y: 9, width: 9, height: 2 })).toEqual([]);
    });
});

describe("regions", () => {
    it("rectangle regions hold one span per row", () => {
        expect(rectRegion({ x: -1, y: 2, width: 3, height: 2 })).toEqual([
            { y: 2, start: -1, end: 2 },
            { y: 3, start: -1, end: 2 },
        ]);
        expect(rectRegion({ x: 0, y: 0, width: 2, height: 0 })).toEqual([]);
    });

    it("joins cells into sorted spans and answers bounds, size and membership", () => {
        const region = regionOf([
            { x: 4, y: 1 },
            { x: 2, y: 1 },
            { x: 3, y: 1 },
            { x: 3, y: 1 },
            { x: 7, y: 1 },
            { x: 0, y: 0 },
        ]);
        expect(region).toEqual([
            { y: 0, start: 0, end: 1 },
            { y: 1, start: 2, end: 5 },
            { y: 1, start: 7, end: 8 },
        ]);
        expect(regionBounds(region)).toEqual({ x: 0, y: 0, width: 8, height: 2 });
        expect(regionBounds([])).toBeNull();
        expect(regionSize(region)).toBe(5);
        expect(regionContains(region, 4, 1)).toBe(true);
        expect(regionContains(region, 5, 1)).toBe(false);
        expect(regionContains(region, 7, 1)).toBe(true);
        expect(regionContains(region, 0, 2)).toBe(false);
    });
});

describe("tile fill", () => {
    const v = (tile: number) => cellValue(1, tile);
    /** A 2 × 2 stamp: tiles 1 2 over 3 and an empty cell. */
    const STAMP: Stamp = { width: 2, height: 2, cells: Uint32Array.from([v(1), v(2), v(3), 0]) };

    function filled(region: Region, origin: { x: number; y: number }): string[] {
        const out: string[] = [];
        forEachTileFillCell(STAMP, region, origin, (x, y, value) => {
            out.push(`${x},${y}:${value === v(1) ? 1 : value === v(2) ? 2 : 3}`);
        });
        return out;
    }

    it("tiles the stamp from the origin, row by row, and skips empty stamp cells", () => {
        const region = rectRegion({ x: 5, y: 5, width: 3, height: 2 });
        expect(filled(region, { x: 5, y: 5 })).toEqual([
            "5,5:1",
            "6,5:2",
            "7,5:1",
            "5,6:3",
            "7,6:3",
        ]);
    });

    it("tiles from an origin outside the region, either side of it", () => {
        const region = rectRegion({ x: 0, y: 0, width: 2, height: 1 });
        expect(filled(region, { x: -1, y: -1 })).toEqual(["1,0:3"]);
        expect(filled(region, { x: 3, y: 2 })).toEqual(["0,0:2", "1,0:1"]);
    });
});

describe("shape fill area and plan", () => {
    const start = { x: 5, y: 5 };
    const MAP = { width: 10, height: 8 };
    const STAMP: Stamp = { width: 1, height: 1, cells: Uint32Array.of(cellValue(1, 0)) };

    it("spans the pressed and the pointer's cell, either way round", () => {
        const none = { shift: false, alt: false };
        expect(shapeArea(start, { x: 8, y: 6 }, none)).toEqual({ x: 5, y: 5, width: 4, height: 2 });
        expect(shapeArea(start, { x: 2, y: 1 }, none)).toEqual({ x: 2, y: 1, width: 4, height: 5 });
        expect(shapeArea(start, start, none)).toEqual({ x: 5, y: 5, width: 1, height: 1 });
    });

    it("Shift squares with the shorter side, Alt centres on the pressed cell", () => {
        expect(shapeArea(start, { x: 9, y: 3 }, { shift: true, alt: false })).toEqual({
            x: 5,
            y: 3,
            width: 3,
            height: 3,
        });
        expect(shapeArea(start, { x: 7, y: 6 }, { shift: false, alt: true })).toEqual({
            x: 3,
            y: 4,
            width: 5,
            height: 3,
        });
        expect(shapeArea(start, { x: 1, y: 7 }, { shift: true, alt: true })).toEqual({
            x: 3,
            y: 3,
            width: 5,
            height: 5,
        });
    });

    it("keeps the cells in the map and tiles from the whole shape's top-left", () => {
        const plan = shapePlan("rectangle", { x: -2, y: 6, width: 4, height: 4 }, MAP, STAMP)!;
        expect(plan.region).toEqual(rectRegion({ x: 0, y: 6, width: 2, height: 2 }));
        expect(plan.origin).toEqual({ x: -2, y: 6 });
        const ellipse = shapePlan("ellipse", { x: -1, y: -1, width: 5, height: 5 }, MAP, STAMP)!;
        // The ellipse touches every side of its area: the stamp is tiled from the area's corner.
        expect(ellipse.origin).toEqual({ x: -1, y: -1 });
        expect(draw(ellipse.region, { x: 0, y: 0, width: 4, height: 4 })).toEqual([
            "####",
            "####",
            "####",
            "###.",
        ]);
        expect(shapePlan("ellipse", { x: 20, y: 0, width: 3, height: 3 }, MAP, STAMP)).toBeNull();
    });
});
