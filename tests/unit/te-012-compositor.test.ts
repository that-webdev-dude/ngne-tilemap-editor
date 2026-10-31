import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Orientation } from "../../src/core/cells";
import { MapCompositor, cellScale, compositeMap } from "../../src/core/compositor";
import { createGroupLayer, createMarkerLayer } from "../../src/core/model";
import type { PixelBuffer } from "../../src/core/model";
import {
    asciiOf,
    imageLayerOf,
    mapOf,
    pixelAt,
    projectOf,
    tileLayerOf,
    tilesetOf,
} from "./te-012-support";

// The CPU compositor (FORMAT §1.2, §1.3, §2.5, §3.4), checked against pictures written by hand.

/** The picture a tile of `rows` makes in an 8 × 8 view, on the bottom-left of its cell. */
function bottomLeft(rows: readonly string[], size = 8): string[] {
    const width = rows[0]!.length;
    const blank = ".".repeat(size);
    return [
        ...Array.from({ length: size - rows.length }, () => blank),
        ...rows.map((row) => row + ".".repeat(size - width)),
    ];
}

/** One tile in the only cell of an 8 × 8 map, in `orientation`, composited at 1:1. */
function oneTile(rows: readonly string[], orientation: Orientation): string[] {
    const tileset = tilesetOf([rows], { slot: 1 });
    const map = mapOf({
        width: 1,
        height: 1,
        tileWidth: 8,
        layers: [tileLayerOf(1, [[0, 0, 1, 0, orientation]])],
    });
    const out = compositeMap(projectOf(map, [tileset]), map, { x: 0, y: 0, width: 8, height: 8 });
    return asciiOf(out);
}

// FORMAT §1.2, one row per orientation: the tile as drawn and as the eight orientations make it.
const ODD = ["ABC", "DEF"];
const ODD_PICTURES: [string, Orientation, string[]][] = [
    ["000 as drawn", 0, ["ABC", "DEF"]],
    ["100 flipped horizontally", 4, ["CBA", "FED"]],
    ["010 flipped vertically", 2, ["DEF", "ABC"]],
    ["110 rotated 180°", 6, ["FED", "CBA"]],
    ["101 rotated 90° clockwise", 5, ["DA", "EB", "FC"]],
    ["011 rotated 90° counter-clockwise", 3, ["CF", "BE", "AD"]],
    ["001 flipped over the main diagonal", 1, ["AD", "BE", "CF"]],
    ["111 flipped over the anti-diagonal", 7, ["FC", "EB", "DA"]],
];
const EVEN = ["ABCD", "EFGH"];
const EVEN_PICTURES: [string, Orientation, string[]][] = [
    ["000 as drawn", 0, ["ABCD", "EFGH"]],
    ["100 flipped horizontally", 4, ["DCBA", "HGFE"]],
    ["010 flipped vertically", 2, ["EFGH", "ABCD"]],
    ["110 rotated 180°", 6, ["HGFE", "DCBA"]],
    ["101 rotated 90° clockwise", 5, ["EA", "FB", "GC", "HD"]],
    ["011 rotated 90° counter-clockwise", 3, ["DH", "CG", "BF", "AE"]],
    ["001 flipped over the main diagonal", 1, ["AE", "BF", "CG", "DH"]],
    ["111 flipped over the anti-diagonal", 7, ["HD", "GC", "FB", "EA"]],
];

describe("orientations (FORMAT §1.2)", () => {
    for (const [name, orientation, picture] of ODD_PICTURES) {
        it(`odd 3 × 2 tile, ${name}`, () => {
            expect(oneTile(ODD, orientation)).toEqual(bottomLeft(picture));
        });
    }
    for (const [name, orientation, picture] of EVEN_PICTURES) {
        it(`even 4 × 2 tile, ${name}`, () => {
            expect(oneTile(EVEN, orientation)).toEqual(bottomLeft(picture));
        });
    }
});

describe("orientations against the forward table (FORMAT §1.2, last column)", () => {
    // Each texel is sent where the table says, the way the rows of FORMAT §1.2 are written; the
    // compositor goes the other way, from the pixel to the texel.
    // Indexed `H<<2 | V<<1 | D`.
    const table = (o: number): ((a: number, b: number) => [number, number]) => {
        switch (o) {
            case 0:
                return (a, b) => [a, b];
            case 4:
                return (a, b) => [-a, b];
            case 2:
                return (a, b) => [a, -b];
            case 6:
                return (a, b) => [-a, -b];
            case 5:
                return (a, b) => [-b, a];
            case 3:
                return (a, b) => [b, -a];
            case 1:
                return (a, b) => [b, a];
            default:
                return (a, b) => [-b, -a];
        }
    };

    it("tiles of any size, grid, cell and offset land where the table sends them", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 1, max: 7 }),
                fc.integer({ min: 1, max: 7 }),
                fc.integer({ min: 0, max: 7 }),
                fc.integer({ min: 1, max: 8 }),
                fc.integer({ min: 1, max: 8 }),
                fc.integer({ min: 0, max: 2 }),
                fc.integer({ min: 0, max: 2 }),
                fc.integer({ min: -3, max: 3 }),
                fc.integer({ min: -3, max: 3 }),
                (tw, th, o, gw, gh, cx, cy, offX, offY) => {
                    const rows = Array.from({ length: th }, () => "A".repeat(tw));
                    const tileset = tilesetOf([rows], { slot: 1, offsetX: offX, offsetY: offY });
                    // A different colour for every texel.
                    for (let k = 0; k < tw * th; k += 1) {
                        tileset.pixels.data.set([k + 1, 7, 9, 255], k * 4);
                    }
                    const map = mapOf({
                        width: 3,
                        height: 3,
                        tileWidth: gw,
                        tileHeight: gh,
                        layers: [tileLayerOf(1, [[cx, cy, 1, 0, o as Orientation]])],
                    });
                    const margin = 20;
                    const size = { width: 3 * gw + 2 * margin, height: 3 * gh + 2 * margin };
                    const out = compositeMap(projectOf(map, [tileset]), map, {
                        x: -margin,
                        y: -margin,
                        ...size,
                    });

                    const expected = new Uint8ClampedArray(size.width * size.height * 4);
                    const swapped = (o & 1) !== 0;
                    const boxW = swapped ? th : tw;
                    const boxH = swapped ? tw : th;
                    const centreX = cx * gw + offX + boxW / 2;
                    const centreY = (cy + 1) * gh + offY - boxH / 2;
                    for (let j = 0; j < th; j += 1) {
                        for (let i = 0; i < tw; i += 1) {
                            const [dx, dy] = table(o)(i + 0.5 - tw / 2, j + 0.5 - th / 2);
                            const x = Math.floor(centreX + dx) + margin;
                            const y = Math.floor(centreY + dy) + margin;
                            expected.set([j * tw + i + 1, 7, 9, 255], (y * size.width + x) * 4);
                        }
                    }
                    expect([...out.data]).toEqual([...expected]);
                },
            ),
            { numRuns: 300 },
        );
    });
});

describe("tile offset and tiles larger than the grid (FORMAT §1.3)", () => {
    it("moves the tile by the tileset's offset", () => {
        const tileset = tilesetOf([["AB", "CD"]], { slot: 1, offsetX: 2, offsetY: -3 });
        const map = mapOf({
            width: 2,
            height: 2,
            tileWidth: 4,
            layers: [tileLayerOf(1, [[1, 1, 1, 0]])],
        });
        const out = compositeMap(projectOf(map, [tileset]), map, {
            x: 0,
            y: 0,
            width: 8,
            height: 8,
        });
        expect(asciiOf(out)).toEqual([
            "........",
            "........",
            "........",
            "......AB",
            "......CD",
            "........",
            "........",
            "........",
        ]);
    });

    const BIG = ["ABCDEF", "GHIJKL", "MNOPQR", "STUVWX", "YZABCD", "EFGHIJ"];

    it("grows a tile larger than the grid up and to the right", () => {
        const tileset = tilesetOf([BIG], { slot: 1 });
        const map = mapOf({
            width: 2,
            height: 2,
            tileWidth: 4,
            layers: [tileLayerOf(1, [[0, 1, 1, 0]])],
        });
        const out = compositeMap(projectOf(map, [tileset]), map, {
            x: 0,
            y: 0,
            width: 8,
            height: 8,
        });
        expect(asciiOf(out)).toEqual([
            "........",
            "........",
            "ABCDEF..",
            "GHIJKL..",
            "MNOPQR..",
            "STUVWX..",
            "YZABCD..",
            "EFGHIJ..",
        ]);
    });

    it("grows a rotated tile by its box as drawn", () => {
        const wide = ["ABCDEF", "GHIJKL", "MNOPQR", "STUVWX"];
        const tileset = tilesetOf([wide], { slot: 1 });
        const map = mapOf({
            width: 2,
            height: 2,
            tileWidth: 4,
            layers: [tileLayerOf(1, [[0, 1, 1, 0, 5]])],
        });
        const out = compositeMap(projectOf(map, [tileset]), map, {
            x: 0,
            y: 0,
            width: 8,
            height: 8,
        });
        expect(asciiOf(out)).toEqual([
            "........",
            "........",
            "SMGA....",
            "TNHB....",
            "UOIC....",
            "VPJD....",
            "WQKE....",
            "XRLF....",
        ]);
    });
});

describe("draw order within a layer (ENGINE §4)", () => {
    it("draws tilesets in project order, whatever the cells' order", () => {
        const a = tilesetOf([["AAAA", "AAAA", "AAAA", "AAAA"]], { slot: 1 });
        const b = tilesetOf([["BBBB", "BBBB", "BBBB", "BBBB"]], { slot: 2 });
        const map = mapOf({
            width: 2,
            height: 1,
            tileWidth: 2,
            layers: [
                tileLayerOf(1, [
                    [0, 0, 2, 0],
                    [1, 0, 1, 0],
                ]),
            ],
        });
        const out = compositeMap(projectOf(map, [a, b]), map, { x: 0, y: -2, width: 6, height: 4 });
        // Row-major alone would leave A over B at x 2..3.
        expect(asciiOf(out)).toEqual(Array.from({ length: 4 }, () => "BBBBAA"));
    });

    it("draws the cells of one tileset row by row", () => {
        const tileset = tilesetOf(
            [
                ["XXXX", "XXXX", "XXXX", "XXXX"],
                ["YYYY", "YYYY", "YYYY", "YYYY"],
            ],
            { slot: 1 },
        );
        const map = mapOf({
            width: 2,
            height: 1,
            tileWidth: 2,
            layers: [
                tileLayerOf(1, [
                    [0, 0, 1, 0],
                    [1, 0, 1, 1],
                ]),
            ],
        });
        const out = compositeMap(projectOf(map, [tileset]), map, {
            x: 0,
            y: -2,
            width: 6,
            height: 4,
        });
        expect(asciiOf(out)).toEqual(Array.from({ length: 4 }, () => "XXYYYY"));
    });
});

describe("opacity (FORMAT §2.5)", () => {
    const solid = tilesetOf([["A"]], { slot: 1 });
    const A = [30, 0, 255];

    function mapWith(layers: ReturnType<typeof tileLayerOf>[], backgroundColor: number | null) {
        const map = mapOf({ width: 1, height: 1, tileWidth: 1, layers, backgroundColor });
        return { map, project: projectOf(map, [solid]) };
    }

    it("blends a layer with its opacity over transparent and over a background", () => {
        const layer = tileLayerOf(1, [[0, 0, 1, 0]], { opacity: 128 });
        const over = mapWith([layer], null);
        const none = compositeMap(over.project, over.map, { x: 0, y: 0, width: 1, height: 1 });
        expect(pixelAt(none, 0, 0)).toEqual([...A, 128]);

        const green = mapWith([layer], 0x00ff00ff);
        const mixed = compositeMap(green.project, green.map, { x: 0, y: 0, width: 1, height: 1 });
        // Source-over: Bc + trunc((Sc − Bc) · 128 / 255), alpha 255.
        expect(pixelAt(mixed, 0, 0)).toEqual([15, 127, 128, 255]);
    });

    it("multiplies the opacity of a layer and its groups", () => {
        const group = {
            ...createGroupLayer(2, "Group"),
            opacity: 128,
            layers: [tileLayerOf(3, [[0, 0, 1, 0]], { opacity: 128 })],
        };
        const { map, project } = mapWith([], null);
        map.layers = [group];
        const out = compositeMap(project, map, { x: 0, y: 0, width: 1, height: 1 });
        // 255 · (128 / 255)² = 64.25, rounded.
        expect(pixelAt(out, 0, 0)).toEqual([...A, 64]);
    });

    it("draws nothing for opacity 0", () => {
        const { map, project } = mapWith([tileLayerOf(1, [[0, 0, 1, 0]], { opacity: 0 })], null);
        const out = compositeMap(project, map, { x: 0, y: 0, width: 1, height: 1 });
        expect(pixelAt(out, 0, 0)).toEqual([0, 0, 0, 0]);
    });
});

describe("parallax and offsets (FORMAT §3.4)", () => {
    const dot = tilesetOf([["A"]], { slot: 1 });

    /** A 16 × 1 map with one `A` pixel at cell 0, on a layer with the given values. */
    function row(
        values: Parameters<typeof tileLayerOf>[2],
        view: { x: number; y: number } | undefined,
        origin = 0,
        from = -4,
        count = 24,
        scale = 1,
    ): string {
        const map = mapOf({
            width: 16,
            height: 1,
            tileWidth: 1,
            parallaxOriginX: origin,
            layers: [tileLayerOf(1, [[0, 0, 1, 0]], values)],
        });
        const out = compositeMap(projectOf(map, [dot]), map, {
            x: from * scale,
            y: 0,
            width: count * scale,
            height: 1,
            scaleX: { texels: scale, pixels: 1 },
            scaleY: { texels: scale, pixels: 1 },
            viewCentre: view,
        });
        return asciiOf(out)[0]!;
    }

    /** The picture of `n` pixels starting at `from` with `A` at `at`, `n` wide. */
    const picture = (at: number, from = -4, n = 24): string =>
        Array.from({ length: n }, (_, i) => (i + from === at ? "A" : ".")).join("");

    it("moves a parallax layer with the view centre", () => {
        const half = { parallaxX: 0.5 };
        expect(row(half, { x: 0, y: 0 })).toBe(picture(0));
        expect(row(half, { x: 16, y: 0 })).toBe(picture(8));
    });

    it("rounds the shift to a whole pixel, half up", () => {
        const half = { parallaxX: 0.5 };
        expect(row(half, { x: 5, y: 0 })).toBe(picture(3)); // 2.5
        expect(row(half, { x: -5, y: 0 })).toBe(picture(-2)); // −2.5
        expect(row(half, { x: 3, y: 0 })).toBe(picture(2)); // 1.5
    });

    it("keeps a layer with factor 0 fixed on screen and a factor 1 layer on the map", () => {
        expect(row({ parallaxX: 0 }, { x: 10, y: 0 }, 4)).toBe(picture(6));
        expect(row({ parallaxX: 1 }, { x: 10, y: 0 }, 4)).toBe(picture(0));
    });

    it("adds the layer's offset and ignores parallax without a view centre", () => {
        expect(row({ offsetX: 3, parallaxX: 0.5 }, undefined)).toBe(picture(3));
        expect(row({ offsetX: 3, parallaxX: 0.5 }, { x: 16, y: 0 })).toBe(picture(11));
    });

    it("snaps the shift to the output texel at a whole-number scale", () => {
        // 2.5 pixels at scale 3 is 7.5 texels, rounded to 8: texels 8..10.
        const scaled = row({ parallaxX: 0.5 }, { x: 5, y: 0 }, 0, 0, 8, 3);
        expect(scaled).toBe(".".repeat(8) + "AAA" + ".".repeat(13));
    });
});

describe("image layers", () => {
    const IMAGE = [{ id: "img", rows: ["AB", "CD"] }];

    function picture(repeatX: boolean, repeatY: boolean): string[] {
        const map = mapOf({
            width: 3,
            height: 3,
            tileWidth: 2,
            layers: [imageLayerOf(1, "img", { offsetX: 1, offsetY: 1, repeatX, repeatY })],
        });
        const out = compositeMap(projectOf(map, [], IMAGE), map, {
            x: 0,
            y: 0,
            width: 6,
            height: 6,
        });
        return asciiOf(out);
    }

    it("draws the image once with its top-left corner at the layer's shift", () => {
        expect(picture(false, false)).toEqual([
            "......",
            ".AB...",
            ".CD...",
            "......",
            "......",
            "......",
        ]);
    });

    it("repeats along x only", () => {
        expect(picture(true, false)).toEqual([
            "......",
            "BABABA",
            "DCDCDC",
            "......",
            "......",
            "......",
        ]);
    });

    it("repeats along y only", () => {
        expect(picture(false, true)).toEqual([
            ".CD...",
            ".AB...",
            ".CD...",
            ".AB...",
            ".CD...",
            ".AB...",
        ]);
    });

    it("repeats along both axes without end", () => {
        expect(picture(true, true)).toEqual([
            "DCDCDC",
            "BABABA",
            "DCDCDC",
            "BABABA",
            "DCDCDC",
            "BABABA",
        ]);
    });
});

describe("layers and background", () => {
    const solid = tilesetOf([["A"]], { slot: 1 });
    const cell = [[0, 0, 1, 0]] as const;
    const one = { x: 0, y: 0, width: 1, height: 1 };

    it("starts from the background colour", () => {
        const map = mapOf({
            width: 1,
            height: 1,
            tileWidth: 1,
            layers: [],
            backgroundColor: 0xff0000ff,
        });
        expect(pixelAt(compositeMap(projectOf(map, []), map, one), 0, 0)).toEqual([255, 0, 0, 255]);
        map.backgroundColor = 0x12345600;
        expect(pixelAt(compositeMap(projectOf(map, []), map, one), 0, 0)).toEqual([0, 0, 0, 0]);
    });

    it("skips hidden layers, layers under a hidden group and marker layers", () => {
        const hidden = tileLayerOf(1, cell, { visible: false });
        const group = {
            ...createGroupLayer(2, "Group"),
            visible: false,
            layers: [tileLayerOf(3, cell)],
        };
        const map = mapOf({
            width: 1,
            height: 1,
            tileWidth: 1,
            layers: [hidden, group, createMarkerLayer(4, "Markers")],
        });
        expect(pixelAt(compositeMap(projectOf(map, [solid]), map, one), 0, 0)).toEqual([
            0, 0, 0, 0,
        ]);
    });

    it("draws layers bottom to top, groups' children in place", () => {
        const second = tilesetOf([["B"]], { slot: 2 });
        const group = { ...createGroupLayer(2, "Group"), layers: [tileLayerOf(3, [[0, 0, 2, 0]])] };
        const map = mapOf({
            width: 1,
            height: 1,
            tileWidth: 1,
            layers: [tileLayerOf(1, cell), group, tileLayerOf(4, cell)],
        });
        const project = projectOf(map, [solid, second]);
        expect(asciiOf(compositeMap(project, map, one))).toEqual(["A"]);
        map.layers = [tileLayerOf(1, cell), group];
        expect(asciiOf(compositeMap(project, map, one))).toEqual(["B"]);
    });

    it("skips cells whose tileset or tile does not exist and images that are missing", () => {
        const map = mapOf({
            width: 3,
            height: 1,
            tileWidth: 1,
            layers: [
                tileLayerOf(1, [
                    [0, 0, 9, 0], // no tileset in slot 9
                    [1, 0, 1, 7], // no tile 7
                    [2, 0, 1, 0],
                ]),
                imageLayerOf(2, "gone"),
            ],
        });
        const out = compositeMap(projectOf(map, [solid]), map, { x: 0, y: 0, width: 3, height: 1 });
        expect(asciiOf(out)).toEqual(["..A"]);
    });

    it("does not draw cells outside the map", () => {
        // The store holds a cell at x = 1, beyond the 1-cell width.
        const map = mapOf({
            width: 1,
            height: 1,
            tileWidth: 2,
            layers: [
                tileLayerOf(1, [
                    [0, 0, 1, 0],
                    [1, 0, 1, 0],
                ]),
            ],
        });
        const tile = tilesetOf([["AA", "AA"]], { slot: 1 });
        const out = compositeMap(projectOf(map, [tile]), map, {
            x: -2,
            y: -2,
            width: 8,
            height: 6,
        });
        expect(asciiOf(out)).toEqual([
            "........",
            "........",
            "..AA....",
            "..AA....",
            "........",
            "........",
        ]);
    });
});

describe("texels per cell (ENGINE §4)", () => {
    it("samples the pixel under each texel's centre", () => {
        const tileset = tilesetOf([["ABCD", "EFGH", "IJKL", "MNOP"]], { slot: 1 });
        const map = mapOf({
            width: 1,
            height: 1,
            tileWidth: 4,
            layers: [tileLayerOf(1, [[0, 0, 1, 0]])],
        });
        const out = compositeMap(projectOf(map, [tileset]), map, {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
            scaleX: cellScale(2, 4),
            scaleY: cellScale(2, 4),
        });
        // Texel i samples pixel floor((i + ½) · 4 / 2) = 2i + 1.
        expect(asciiOf(out)).toEqual(["FH", "NP"]);
    });

    it("enlarges by whole texels", () => {
        const tileset = tilesetOf([["AB", "CD"]], { slot: 1 });
        const map = mapOf({
            width: 1,
            height: 1,
            tileWidth: 2,
            layers: [tileLayerOf(1, [[0, 0, 1, 0]])],
        });
        const out = compositeMap(projectOf(map, [tileset]), map, {
            x: 0,
            y: 0,
            width: 4,
            height: 4,
            scaleX: { texels: 2, pixels: 1 },
            scaleY: { texels: 2, pixels: 1 },
        });
        expect(asciiOf(out)).toEqual(["AABB", "AABB", "CCDD", "CCDD"]);
    });
});

describe("requests", () => {
    const tileset = tilesetOf([["AB", "CD"]], { slot: 1 });
    const map = mapOf({
        width: 1,
        height: 1,
        tileWidth: 2,
        layers: [tileLayerOf(1, [[0, 0, 1, 0]])],
    });
    const project = projectOf(map, [tileset]);

    it("composites into a given buffer, overwriting it", () => {
        const target: PixelBuffer = {
            width: 2,
            height: 2,
            data: new Uint8ClampedArray(16).fill(9),
        };
        const out = new MapCompositor(project, map).composite(
            { x: 0, y: 0, width: 2, height: 2 },
            target,
        );
        expect(out).toBe(target);
        expect(asciiOf(target)).toEqual(["AB", "CD"]);
    });

    it("refuses a target of another size, a fractional rectangle and a bad scale", () => {
        const compositor = new MapCompositor(project, map);
        const target: PixelBuffer = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
        expect(() => compositor.composite({ x: 0, y: 0, width: 2, height: 2 }, target)).toThrow(
            RangeError,
        );
        expect(() => compositor.composite({ x: 0.5, y: 0, width: 1, height: 1 })).toThrow(
            RangeError,
        );
        expect(() => compositor.composite({ x: 0, y: 0, width: -1, height: 1 })).toThrow(
            RangeError,
        );
        expect(() =>
            compositor.composite({
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                scaleX: { texels: 0, pixels: 1 },
            }),
        ).toThrow(RangeError);
        expect(() =>
            compositor.composite({
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                scaleY: { texels: 1.5, pixels: 1 },
            }),
        ).toThrow(RangeError);
    });

    it("gives an empty buffer for an empty rectangle", () => {
        const out = new MapCompositor(project, map).composite({ x: 3, y: 3, width: 0, height: 0 });
        expect(out.data).toHaveLength(0);
    });
});

describe("review follow-ups", () => {
    it("parallax and the view centre work in y with the parallax origin's y", () => {
        const dot = tilesetOf([["A"]], { slot: 1 });
        const map = mapOf({
            width: 1,
            height: 16,
            tileWidth: 1,
            parallaxOriginY: 4,
            layers: [tileLayerOf(1, [[0, 0, 1, 0]], { parallaxX: 1, parallaxY: 0.5 })],
        });
        const out = compositeMap(projectOf(map, [dot]), map, {
            x: 0,
            y: -4,
            width: 1,
            height: 24,
            viewCentre: { x: 99, y: 20 },
        });
        // shift y = (20 − 4) · (1 − 0.5) = 8; x has factor 1 and does not move.
        const column = asciiOf(out);
        expect(column.indexOf("A") - 4).toBe(8);
        expect(column.filter((row) => row === "A")).toHaveLength(1);
    });

    it("draws the cells of one tileset in rows, not columns", () => {
        const tiles = tilesetOf(
            [
                ["XXXX", "XXXX", "XXXX", "XXXX"],
                ["YYYY", "YYYY", "YYYY", "YYYY"],
            ],
            { slot: 1 },
        );
        // Cell (1, 0) comes before (0, 1) row-major; they overlap where the big tiles meet.
        const map = mapOf({
            width: 2,
            height: 2,
            tileWidth: 2,
            layers: [
                tileLayerOf(1, [
                    [0, 1, 1, 1],
                    [1, 0, 1, 0],
                ]),
            ],
        });
        const out = compositeMap(projectOf(map, [tiles]), map, {
            x: 0,
            y: -2,
            width: 6,
            height: 6,
        });
        // (1, 0): x 2..5, y −2..1 → X. (0, 1): x 0..3, y 0..3 → Y, drawn after. Overlap x 2..3, y 0..1 is Y.
        expect(asciiOf(out)).toEqual(["..XXXX", "..XXXX", "YYYYXX", "YYYYXX", "YYYY..", "YYYY.."]);
    });

    it("finds tiles by ID in a multi-row atlas", () => {
        const set = tilesetOf([["A"], ["B"], ["C"], ["D"]], { slot: 1 });
        // Two columns, two rows, with tile IDs that are not list positions.
        set.columns = 2;
        set.pixels = {
            width: 2,
            height: 2,
            data: new Uint8ClampedArray([
                ...pixelAt(tilesetOf([["A"]], { slot: 1 }).pixels, 0, 0),
                ...pixelAt(tilesetOf([["B"]], { slot: 1 }).pixels, 0, 0),
                ...pixelAt(tilesetOf([["C"]], { slot: 1 }).pixels, 0, 0),
                ...pixelAt(tilesetOf([["D"]], { slot: 1 }).pixels, 0, 0),
            ]),
        };
        set.tiles[0]!.id = 7;
        set.tiles[1]!.id = 3;
        set.tiles[2]!.id = 9;
        set.tiles[3]!.id = 0;
        set.nextTileId = 10;
        const map = mapOf({
            width: 4,
            height: 1,
            tileWidth: 1,
            layers: [
                tileLayerOf(1, [
                    [0, 0, 1, 7],
                    [1, 0, 1, 3],
                    [2, 0, 1, 9],
                    [3, 0, 1, 0],
                ]),
            ],
        });
        const out = compositeMap(projectOf(map, [set]), map, { x: 0, y: 0, width: 4, height: 1 });
        expect(asciiOf(out)).toEqual(["ABCD"]);
    });

    it("draws legal extreme tileset offsets on a 1 pixel grid", () => {
        const side = Array.from({ length: 256 }, () => "A".repeat(256));
        const near = tilesetOf([side], { slot: 1, offsetX: -4096, offsetY: -4096 });
        const far = tilesetOf([side], { slot: 2, offsetX: 4096, offsetY: 4096 });
        const map = mapOf({
            width: 1,
            height: 1,
            tileWidth: 1,
            layers: [tileLayerOf(1, [[0, 0, 1, 0]])],
        });
        const out = compositeMap(projectOf(map, [near, far]), map, {
            x: -4096,
            y: -4351,
            width: 256,
            height: 256,
        });
        expect(pixelAt(out, 0, 0)).toEqual(pixelAt(near.pixels, 0, 0));
        expect(pixelAt(out, 255, 255)).toEqual(pixelAt(near.pixels, 0, 0));
    });
});
