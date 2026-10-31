import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Orientation } from "../../src/core/cells";
import { MapCompositor } from "../../src/core/compositor";
import type { CompositeRequest, Ratio } from "../../src/core/compositor";
import { createGroupLayer } from "../../src/core/model";
import type { Layer, PixelBuffer } from "../../src/core/model";
import { imageLayerOf, mapOf, projectOf, tileLayerOf, tilesetOf } from "./te-012-support";

// A rectangle composited alone equals the same rectangle of the whole composite, so a dirty
// rectangle can be patched into a chunk (ENGINE §4).

const sizes = fc.integer({ min: 1, max: 6 });

const layerValues = fc.record({
    opacity: fc.constantFrom(255, 200, 128, 40),
    offsetX: fc.integer({ min: -7, max: 7 }),
    offsetY: fc.integer({ min: -7, max: 7 }),
    parallaxX: fc.constantFrom(1, 0.5, 0, 1.25),
    parallaxY: fc.constantFrom(1, 0.5, 0, 0.75),
    visible: fc.boolean(),
});

const scales: fc.Arbitrary<[Ratio, Ratio]> = fc.constantFrom(
    [
        { texels: 1, pixels: 1 },
        { texels: 1, pixels: 1 },
    ],
    [
        { texels: 3, pixels: 1 },
        { texels: 3, pixels: 1 },
    ],
    [
        { texels: 2, pixels: 5 },
        { texels: 3, pixels: 4 },
    ],
    [
        { texels: 7, pixels: 3 },
        { texels: 1, pixels: 2 },
    ],
);

function tileset(slot: number, tw: number, th: number, seed: number, offX: number, offY: number) {
    const rows = Array.from({ length: th }, () => "A".repeat(tw));
    const set = tilesetOf([rows, rows, rows], { slot, offsetX: offX, offsetY: offY });
    // Pseudo-random pixels, some transparent and some translucent.
    let state = seed >>> 0 || 1;
    for (let i = 0; i < set.pixels.data.length; i += 4) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        set.pixels.data.set(
            [
                state & 255,
                (state >>> 8) & 255,
                (state >>> 16) & 255,
                [0, 90, 255, 255][state >>> 30]!,
            ],
            i,
        );
    }
    return set;
}

describe("dirty rectangle (ENGINE §4)", () => {
    it("recomposites a rectangle to the same pixels as the full composite", () => {
        fc.assert(
            fc.property(
                fc.record({
                    gw: sizes,
                    gh: sizes,
                    cols: fc.integer({ min: 1, max: 5 }),
                    rows: fc.integer({ min: 1, max: 5 }),
                    tiles: fc.array(
                        fc.record({
                            w: fc.integer({ min: 1, max: 9 }),
                            h: fc.integer({ min: 1, max: 9 }),
                            seed: fc.integer(),
                            offX: fc.integer({ min: -4, max: 4 }),
                            offY: fc.integer({ min: -4, max: 4 }),
                        }),
                        { minLength: 1, maxLength: 3 },
                    ),
                    cells: fc.array(
                        fc.tuple(
                            fc.nat(4),
                            fc.nat(4),
                            fc.integer({ min: 0, max: 2 }),
                            fc.integer({ min: 0, max: 2 }),
                            fc.integer({ min: 0, max: 7 }),
                            fc.integer({ min: 0, max: 2 }),
                        ),
                        { maxLength: 30 },
                    ),
                    values: fc.array(layerValues, { minLength: 3, maxLength: 3 }),
                    group: fc.record({
                        opacity: fc.constantFrom(255, 128),
                        offsetX: fc.integer({ min: -3, max: 3 }),
                    }),
                    background: fc.constantFrom<number | null>(null, 0x336699ff, 0x33669980),
                    image: fc.record({ repeatX: fc.boolean(), repeatY: fc.boolean() }),
                    scale: scales,
                    view: fc.record({
                        x: fc.integer({ min: -20, max: 40 }),
                        y: fc.integer({ min: -20, max: 40 }),
                    }),
                    rect: fc.tuple(
                        fc.integer({ min: 0, max: 100 }),
                        fc.integer({ min: 0, max: 100 }),
                        fc.integer({ min: 0, max: 100 }),
                        fc.integer({ min: 0, max: 100 }),
                    ),
                }),
                (c) => {
                    const sets = c.tiles.map((t, i) =>
                        tileset(i + 1, t.w, t.h, t.seed, t.offX, t.offY),
                    );
                    const layers: Layer[] = [];
                    const tileLayers = c.values.map((values, index) => {
                        const cells = c.cells
                            .filter(([x, y]) => x < c.cols && y < c.rows)
                            .map(([x, y, s, t, o]) => {
                                const slot = (s % sets.length) + 1;
                                return [x, y, slot, t, o as Orientation] as const;
                            });
                        return tileLayerOf(
                            index + 1,
                            index === 1 ? cells.slice().reverse() : cells,
                            values,
                        );
                    });
                    layers.push(tileLayers[0]!);
                    layers.push(imageLayerOf(10, "img", { ...c.image, offsetX: 2, opacity: 200 }));
                    layers.push({
                        ...createGroupLayer(11, "Group"),
                        ...c.group,
                        layers: [tileLayers[1]!, tileLayers[2]!],
                    });

                    const map = mapOf({
                        width: c.cols,
                        height: c.rows,
                        tileWidth: c.gw,
                        tileHeight: c.gh,
                        layers,
                        backgroundColor: c.background,
                        parallaxOriginX: 3,
                        parallaxOriginY: 2,
                    });
                    const project = projectOf(map, sets, [{ id: "img", rows: ["AB.", "CDE"] }]);
                    const compositor = new MapCompositor(project, map);

                    const [scaleX, scaleY] = c.scale;
                    const whole: CompositeRequest = {
                        x: -8,
                        y: -8,
                        width: 90,
                        height: 90,
                        scaleX,
                        scaleY,
                        viewCentre: c.view,
                    };
                    const full = compositor.composite(whole);

                    const [dx, dy, rw, rh] = c.rect;
                    const x = whole.x + (dx % whole.width);
                    const y = whole.y + (dy % whole.height);
                    const width = Math.min(rw, whole.x + whole.width - x);
                    const height = Math.min(rh, whole.y + whole.height - y);
                    const part = compositor.composite({ ...whole, x, y, width, height });

                    const expected = crop(full, x - whole.x, y - whole.y, width, height);
                    expect([...part.data]).toEqual([...expected.data]);
                },
            ),
            { numRuns: 150 },
        );
    });

    it("is not trivially empty: the generated pictures show something", () => {
        const set = tileset(1, 3, 3, 5, 0, 0);
        const map = mapOf({
            width: 2,
            height: 2,
            tileWidth: 3,
            layers: [
                tileLayerOf(1, [[0, 0, 1, 0]]),
                tileLayerOf(2, [[1, 1, 1, 2, 5]], { opacity: 128 }),
            ],
        });
        const out = new MapCompositor(projectOf(map, [set]), map).composite({
            x: 0,
            y: 0,
            width: 6,
            height: 6,
        });
        expect(out.data.some((v) => v !== 0)).toBe(true);
    });
});

function crop(
    buffer: PixelBuffer,
    x: number,
    y: number,
    width: number,
    height: number,
): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
        const from = ((y + row) * buffer.width + x) * 4;
        data.set(buffer.data.subarray(from, from + width * 4), row * width * 4);
    }
    return { width, height, data };
}
