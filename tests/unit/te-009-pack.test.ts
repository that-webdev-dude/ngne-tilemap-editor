import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GENERATOR } from "../../src/core/generator";
import type { AnimationFrame, PixelBuffer, Tileset } from "../../src/core/model";
import {
    TILESET_PACK_OPTIONS,
    TilesetPackError,
    atlasSizeFor,
    checkPackable,
    maxPackableTiles,
    packTileset,
    tileFrameId,
} from "../../src/core/pack";
import type { PackedTileset } from "../../src/core/pack";
import { validateAtlas } from "../../src/core/sprite/export/validateAtlas";
import { encodePng } from "../../src/core/sprite/png";

// `core/pack` (SPEC §6.1, §10.2): tilesets packed by the sprite editor's packer into the atlas
// of FORMAT §4, the UV table the viewport draws from, and the layout-only packability check.

const FINGERPRINT = "0".repeat(64);

interface TileSpec {
    id: number;
    /** Opaque pixels derived from `seed`; the same seed gives the same pixels. */
    seed: number;
    animation?: AnimationFrame[];
}

/** RGBA of pixel `index` of a tile drawn from `seed`: opaque, distinct per seed at index 0. */
function texel(seed: number, index: number): [number, number, number, number] {
    if (index === 0) return [seed & 255, (seed >> 8) & 255, (seed >> 16) & 255, 255];
    const mixed = Math.imul(seed * 31 + index, 0x9e3779b1) >>> 0;
    return [mixed & 255, (mixed >> 8) & 255, (mixed >> 16) & 255, 1 + ((mixed >>> 24) % 255)];
}

/**
 * A tileset of `tileWidth × tileHeight` tiles in the list order of `tiles` (display order,
 * which need not be ID order), stored on a grid as wide as 8192 px allows.
 */
function tilesetOf(
    tileWidth: number,
    tileHeight: number,
    tiles: TileSpec[],
    name = "Forest",
): Tileset {
    const columns = Math.max(1, Math.min(tiles.length, Math.floor(8192 / tileWidth)));
    const rows = Math.ceil(tiles.length / columns);
    const width = columns * tileWidth;
    const pixels: PixelBuffer = {
        width,
        height: rows * tileHeight,
        data: new Uint8ClampedArray(width * rows * tileHeight * 4),
    };
    tiles.forEach(({ seed }, position) => {
        const left = (position % columns) * tileWidth;
        const top = Math.floor(position / columns) * tileHeight;
        for (let y = 0; y < tileHeight; y++) {
            for (let x = 0; x < tileWidth; x++) {
                pixels.data.set(texel(seed, y * tileWidth + x), ((top + y) * width + left + x) * 4);
            }
        }
    });
    return {
        id: "ts-1",
        name,
        exportName: "forest",
        class: "",
        slot: 1,
        tileWidth,
        tileHeight,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels,
        nextTileId: Math.max(...tiles.map((tile) => tile.id)) + 1,
        source: { kind: "image", fileName: "forest.png", margin: 0, spacing: 0 },
        tiles: tiles.map(({ id, animation = [] }) => ({
            id,
            sourceKey: [id, 0],
            fingerprint: FINGERPRINT,
            class: "",
            collision: [],
            animation,
            properties: [],
        })),
        terrainSets: [],
        properties: [],
    };
}

/** `count` tiles with IDs and seeds 0.. */
function distinct(count: number): TileSpec[] {
    return Array.from({ length: count }, (_, id) => ({ id, seed: id }));
}

function pixelAt(image: PixelBuffer, x: number, y: number): number[] {
    const at = (y * image.width + x) * 4;
    return [...image.data.subarray(at, at + 4)];
}

/** The pixels of the tile with `id` as the tileset stores them. */
function storedPixel(tileset: Tileset, id: number, x: number, y: number): number[] {
    const position = tileset.tiles.findIndex((tile) => tile.id === id);
    const left = (position % tileset.columns) * tileset.tileWidth;
    const top = Math.floor(position / tileset.columns) * tileset.tileHeight;
    return pixelAt(tileset.pixels, left + x, top + y);
}

/** Every rule of FORMAT §4 and of `validateAtlas` for the packed tileset. */
function expectFormat4(tileset: Tileset, packed: PackedTileset): void {
    const { atlas, image, uvTable } = packed;
    const name = tileset.exportName;
    expect(validateAtlas(atlas, { width: image.width, height: image.height })).toEqual(atlas);
    expect(atlas.image).toBe(`${name}.png`);
    expect(atlas.generator).toBe(GENERATOR);
    expect(image.width).toBeLessThanOrEqual(8192);
    expect(image.height).toBeLessThanOrEqual(8192);

    const ids = tileset.tiles.map((tile) => tile.id).sort((a, b) => a - b);
    expect(Object.keys(atlas.frames)).toEqual(ids.map((id) => `${name}-${id}`));
    expect(uvTable.ids).toEqual(ids);
    const w = tileset.tileWidth + (tileset.tileWidth % 2);
    const h = tileset.tileHeight + (tileset.tileHeight % 2);
    ids.forEach((id, index) => {
        const frame = atlas.frames[tileFrameId(name, id)];
        expect(frame).toMatchObject({
            w: Math.max(2, w),
            h: Math.max(2, h),
            sourceW: tileset.tileWidth,
            sourceH: tileset.tileHeight,
            offsetX: 0,
            offsetY: 0,
            pivot: [0, 1],
        });
        expect(uvTable.index.get(id)).toBe(index);
        expect([...uvTable.rects.subarray(index * 4, index * 4 + 4)]).toEqual([
            frame.x,
            frame.y,
            frame.w,
            frame.h,
        ]);
        const uv = [
            frame.x / image.width,
            frame.y / image.height,
            frame.w / image.width,
            frame.h / image.height,
        ];
        expect([...uvTable.uv.subarray(index * 4, index * 4 + 4)]).toEqual([
            ...new Float32Array(uv),
        ]);
        // The rectangle shows the tile's own pixels.
        const shown: number[] = [];
        const stored: number[] = [];
        for (let y = 0; y < tileset.tileHeight; y++) {
            for (let x = 0; x < tileset.tileWidth; x++) {
                shown.push(...pixelAt(image, frame.x + x, frame.y + y));
                stored.push(...storedPixel(tileset, id, x, y));
            }
        }
        expect(shown).toEqual(stored);
    });

    const animated = tileset.tiles
        .filter((tile) => tile.animation.length > 0)
        .sort((a, b) => a.id - b.id);
    expect(Object.keys(atlas.animations)).toEqual(animated.map((tile) => `${name}-${tile.id}`));
    for (const tile of animated) {
        const entries = tile.animation.map((frame) => ({
            frame: `${name}-${frame.tile}`,
            ms: frame.ms,
        }));
        expect(atlas.animations[tileFrameId(name, tile.id)]).toEqual({
            playback: "loop",
            durationMs: entries.reduce((sum, entry) => sum + entry.ms, 0),
            entries,
        });
    }
}

describe("packTileset", () => {
    it("uses the packer options of SPEC §10.2", () => {
        expect(TILESET_PACK_OPTIONS).toEqual({
            layout: "grid",
            padding: 0,
            extrude: 1,
            trim: false,
            mergeDuplicates: true,
        });
    });

    it("writes the generator of package.json", () => {
        const manifest = JSON.parse(
            readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
        ) as { name: string; version: string };
        expect(GENERATOR).toBe(`${manifest.name} ${manifest.version}`);
    });

    const cases: [string, Tileset][] = [
        ["even tiles", tilesetOf(16, 16, distinct(10))],
        ["odd tiles", tilesetOf(15, 15, distinct(5))],
        ["1 × 1 tiles", tilesetOf(1, 1, distinct(3))],
        ["3 × 5 tiles", tilesetOf(3, 5, distinct(7))],
        ["256 × 256 tile", tilesetOf(256, 256, distinct(1))],
        [
            "tiles out of ID order, with gaps",
            tilesetOf(8, 8, [
                { id: 9, seed: 1 },
                { id: 2, seed: 2 },
                { id: 40, seed: 3 },
                { id: 0, seed: 4 },
            ]),
        ],
        [
            "animated tiles",
            tilesetOf(8, 6, [
                {
                    id: 0,
                    seed: 0,
                    animation: [
                        { tile: 0, ms: 100 },
                        { tile: 1, ms: 250 },
                    ],
                },
                { id: 1, seed: 1 },
                { id: 3, seed: 3, animation: [{ tile: 1, ms: 65535 }] },
            ]),
        ],
    ];
    it.each(cases)("passes validateAtlas and FORMAT §4: %s", (_, tileset) => {
        expectFormat4(tileset, packTileset(tileset));
    });

    it("lays the tiles out in ID order, whatever their display order", () => {
        const { atlas } = packTileset(cases[5][1]);
        const at = (id: number) => {
            const { x, y } = atlas.frames[`forest-${id}`];
            return [x, y];
        };
        // 2 × 2 cells of 8 + 2 px, filled row by row: IDs 0, 2, 9, 40.
        expect([at(0), at(2), at(9), at(40)]).toEqual([
            [1, 1],
            [11, 1],
            [1, 11],
            [11, 11],
        ]);
    });

    it("packs the whole tile, transparent border included (no trim)", () => {
        const tileset = tilesetOf(6, 4, distinct(3));
        const { width } = tileset.pixels;
        for (let y = 0; y < tileset.pixels.height; y++) {
            for (let x = 0; x < width; x++) {
                if (x % 6 === 0 || x % 6 === 5 || y === 0 || y === 3) {
                    tileset.pixels.data.fill(0, (y * width + x) * 4, (y * width + x + 1) * 4);
                }
            }
        }
        expectFormat4(tileset, packTileset(tileset));
    });

    it("passes validateAtlas and FORMAT §4 for random tilesets", () => {
        const tileset = fc
            .record({
                width: fc.integer({ min: 1, max: 24 }),
                height: fc.integer({ min: 1, max: 24 }),
                seeds: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 40 }),
            })
            .map(({ width, height, seeds }) =>
                tilesetOf(
                    width,
                    height,
                    seeds.map((seed, id) => ({ id: id * 3, seed })),
                ),
            );
        fc.assert(
            fc.property(tileset, (value) => expectFormat4(value, packTileset(value))),
            { numRuns: 60 },
        );
    });

    it("gives the same bytes for the same tileset", () => {
        const first = packTileset(tilesetOf(15, 9, distinct(20)));
        const second = packTileset(tilesetOf(15, 9, distinct(20)));
        expect(encodePng(second.image)).toEqual(encodePng(first.image));
        expect(JSON.stringify(second.atlas)).toBe(JSON.stringify(first.atlas));
        expect(second.uvTable.rects).toEqual(first.uvTable.rects);
    });

    it("lets identical tiles share one rectangle", () => {
        const tileset = tilesetOf(8, 8, [
            { id: 0, seed: 1 },
            { id: 1, seed: 2 },
            { id: 2, seed: 1 },
            { id: 3, seed: 1 },
        ]);
        // Colour under alpha 0 does not make a tile distinct (FORMAT §2.4 fingerprint).
        const transparent = tilesetOf(8, 8, [
            { id: 0, seed: 7 },
            { id: 1, seed: 7 },
        ]);
        for (let position = 0; position < 2; position++) {
            const at = (4 * transparent.pixels.width + position * 8 + 3) * 4;
            transparent.pixels.data.set([position * 50, 9, 9, 0], at);
        }
        const { atlas } = packTileset(tileset);
        const rect = (id: number) => {
            const { x, y } = atlas.frames[`forest-${id}`];
            return [x, y];
        };
        expect(rect(2)).toEqual(rect(0));
        expect(rect(3)).toEqual(rect(0));
        expect(rect(1)).not.toEqual(rect(0));
        expect(atlas.width).toBe(2 * 10);
        expect(atlas.height).toBe(10);

        const packed = packTileset(transparent);
        expect(packed.atlas.frames["forest-1"]).toEqual(packed.atlas.frames["forest-0"]);
        expect(packed.image.width).toBe(10);
    });

    it("leaves an odd tile's extra column and row and their ring transparent", () => {
        const tileset = tilesetOf(3, 5, distinct(4));
        const { atlas, image } = packTileset(tileset);
        for (let id = 0; id < 4; id++) {
            const { x, y, w, h } = atlas.frames[`forest-${id}`];
            expect([w, h]).toEqual([4, 6]);
            // Extra column x + 3, its ring x + 4; extra row y + 5, its ring y + 6.
            for (let row = y - 1; row <= y + h; row++) {
                expect(pixelAt(image, x + 3, row)).toEqual([0, 0, 0, 0]);
                expect(pixelAt(image, x + 4, row)).toEqual([0, 0, 0, 0]);
            }
            for (let column = x - 1; column <= x + w; column++) {
                expect(pixelAt(image, column, y + 5)).toEqual([0, 0, 0, 0]);
                expect(pixelAt(image, column, y + 6)).toEqual([0, 0, 0, 0]);
            }
            // The other sides of the ring repeat the edge pixels (extrude 1).
            for (let row = 0; row < 5; row++) {
                expect(pixelAt(image, x - 1, y + row)).toEqual(storedPixel(tileset, id, 0, row));
            }
            for (let column = 0; column < 3; column++) {
                expect(pixelAt(image, x + column, y - 1)).toEqual(
                    storedPixel(tileset, id, column, 0),
                );
            }
        }
    });

    it("fails an image above 8192 px with an error naming the tileset", () => {
        // 962 distinct tiles of 256 × 2: 32 columns of 258 px, 8256 px wide.
        const tileset = tilesetOf(256, 2, distinct(962), "Big meadow");
        let error: unknown;
        try {
            packTileset(tileset);
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(TilesetPackError);
        const failure = error as TilesetPackError;
        expect(failure.message).toContain('"Big meadow"');
        expect(failure.message).toContain("8192");
        expect(failure.code).toBe("atlas-size");
        expect(failure.tilesetId).toBe("ts-1");
        expect(failure.required).toEqual({ width: 8256, height: 31 * 4 });
    });
});

describe("packability", () => {
    it("passes 961 tiles of 256 × 256 and refuses 962 with the limit in the message", () => {
        expect(maxPackableTiles(256, 256)).toBe(961);
        expect(checkPackable("Forest", 961, 256, 256)).toEqual({
            ok: true,
            width: 31 * 258,
            height: 31 * 258,
        });
        const refused = checkPackable("Forest", 962, 256, 256);
        expect(refused.ok).toBe(false);
        if (refused.ok) return;
        expect(refused.maxTiles).toBe(961);
        expect(refused.width).toBe(32 * 258);
        expect(refused.message).toContain('"Forest"');
        expect(refused.message).toContain("962");
        expect(refused.message).toContain("at most 961");
        expect(refused.message).toContain("8192 px");
    });

    it("rounds odd tile sizes up to even", () => {
        expect(maxPackableTiles(255, 255)).toBe(961);
        expect(atlasSizeFor(5, 3, 1)).toEqual({ width: 3 * 6, height: 2 * 4 });
    });

    it("agrees with a real pack on random tile counts and sizes", () => {
        // Sizes up to 256 and counts past the limit, kept to a few MB of tile pixels.
        const input = fc
            .record({
                width: fc.integer({ min: 1, max: 256 }),
                height: fc.integer({ min: 1, max: 256 }),
                wide: fc.boolean(),
            })
            .chain(({ width, height, wide }) => {
                const [w, h] = wide ? [width, 1 + (height % 8)] : [width, height];
                const limit = maxPackableTiles(w, h);
                const budget = Math.max(1, Math.floor(2_000_000 / (w * h)));
                const most = Math.min(budget, limit + 40, 4000);
                return fc.record({
                    width: fc.constant(w),
                    height: fc.constant(h),
                    count: fc.oneof(
                        fc.integer({ min: 1, max: most }),
                        fc.integer({ min: Math.max(1, Math.min(most, limit - 2)), max: most }),
                    ),
                    duplicates: fc.integer({ min: 0, max: 5 }),
                });
            });
        let refusals = 0;
        fc.assert(
            fc.property(input, ({ width, height, count, duplicates }) => {
                const tiles = distinct(count);
                for (let extra = 0; extra < duplicates; extra++) {
                    tiles.push({ id: count + extra, seed: extra % count });
                }
                const check = checkPackable("Forest", count, width, height);
                let packed: PackedTileset | null = null;
                let error: unknown = null;
                try {
                    packed = packTileset(tilesetOf(width, height, tiles));
                } catch (caught) {
                    error = caught;
                }
                if (check.ok) {
                    expect(error).toBeNull();
                    expect(packed?.image.width).toBe(check.width);
                    expect(packed?.image.height).toBe(check.height);
                } else {
                    refusals++;
                    expect(error).toBeInstanceOf(TilesetPackError);
                    expect((error as TilesetPackError).required).toEqual({
                        width: check.width,
                        height: check.height,
                    });
                }
            }),
            { numRuns: 80, seed: 9 },
        );
        expect(refusals).toBeGreaterThan(0);
        // 80 real packs of up to 2 MB of tile pixels: 2.7 s alone, over 5 s on a loaded CI runner.
    }, 30_000);
});
