import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateRuntime } from "../../src/core/runtime/generate";
import type * as Runtime from "../../src/core/runtime/runtime";
import {
    drawTilemap,
    findLayer,
    readTilemap,
    setCell,
    validateTilemap,
} from "../../src/core/runtime/runtime";
import type { DrawOptions, TileLayerData, Tilemap } from "../../src/core/runtime/runtime";
import type { SpriteLike } from "../../src/core/runtime/emit";
import { atlasFor, layer, meadowAtlases, meadowJson, tilemapJson } from "./te-050-support";

// TE-051: `drawTilemap` (SPEC 11.2) into a recording sink, against hand-computed quads.

type Json = Record<string, unknown>;

/** A sink that keeps a copy of every sprite and the objects it was handed. */
class Recorder {
    readonly quads: SpriteLike[] = [];
    readonly objects = new Set<SpriteLike>();

    sprite(s: SpriteLike): void {
        this.objects.add(s);
        this.quads.push({ ...s });
    }

    clear(): void {
        this.quads.length = 0;
    }
}

const TS = "ngne-tilemap:test-game/ts";
const TB = "ngne-tilemap:test-game/tb";
const SKY = "ngne-tilemap:test-game/sky";
const EVERY_ASSET = new Set([TS, TB, SKY]);

function imageLayer(id: number, name: string, extra: Json): Json {
    return layer(id, name, {
        type: "image",
        image: "sky.png",
        imageWidth: 10,
        imageHeight: 8,
        repeatX: false,
        repeatY: false,
        ...extra,
    });
}

/**
 * An 8 x 6 map of 16 px cells and two tilesets, `ts` (GIDs 1..4) and `tb` (GIDs 5..6). Layers,
 * bottom to top: 0 Ground (tile 1 everywhere), 1 Spawns (markers), 2 Hidden (tile 2 at 0, 0;
 * not visible), 3 Sky (image 10 x 8 at 0, 0), 4 Top (GID 5 at 1, 1).
 */
function stackJson(): Json {
    const cells = 8 * 6;
    const hidden = new Array<number>(cells).fill(0);
    hidden[0] = 2;
    const top = new Array<number>(cells).fill(0);
    top[1 * 8 + 1] = 5;
    const json = tilemapJson(
        { width: 8, height: 6, tileWidth: 16, tileHeight: 16 },
        { name: "ts", tileWidth: 16, tileHeight: 16, nextTileId: 4, tiles: [] },
        [
            layer(1, "Ground", { data: new Array<number>(cells).fill(1) }),
            layer(2, "Spawns", { type: "marker", markers: [] }),
            layer(3, "Hidden", { visible: false, data: hidden }),
            imageLayer(4, "Sky", {}),
            layer(5, "Top", { data: top }),
        ],
    );
    (json.tilesets as Json[]).push({
        ...(json.tilesets as Json[])[0],
        name: "tb",
        atlas: "tb.atlas.json",
        firstGid: 5,
        nextTileId: 2,
    });
    return json;
}

function stack(edit?: (json: Json) => void): Tilemap {
    const json = stackJson();
    edit?.(json);
    return readTilemap(json, { ts: atlasFor("ts", 4, 16, 16), tb: atlasFor("tb", 2, 16, 16) });
}

function options(extra: Partial<DrawOptions> = {}): DrawOptions {
    return {
        elapsedMs: 0,
        viewWidth: 128,
        viewHeight: 96,
        assets: EVERY_ASSET,
        report: () => {},
        ...extra,
    };
}

function draw(
    tilemap: Tilemap,
    extra: Partial<DrawOptions> = {},
    camera = { x: 0, y: 0 },
): Recorder {
    const sink = new Recorder();
    drawTilemap(sink, tilemap, camera, options(extra));
    return sink;
}

function tileLayer(tilemap: Tilemap, name: string): TileLayerData {
    const found = findLayer(tilemap, name);
    if (found?.type !== "tile") throw new Error(`No tile layer ${name}.`);
    return found;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("drawTilemap layers", () => {
    it("draws visible tile and image layers bottom to top, layer i at depth + i", () => {
        const sink = draw(stack(), { depth: 10, layer: 3 });
        const depths = sink.quads.map((quad) => quad.depth);
        // Ground (48 cells), Sky, Top; the marker layer and the hidden layer draw nothing.
        expect(depths).toEqual([...new Array<number>(48).fill(10), 13, 14]);
        expect(new Set(sink.quads.map((quad) => quad.layer))).toEqual(new Set([3]));
        expect(sink.quads[48]!.texture).toBe(SKY);
        expect(sink.quads[49]!.texture).toBe(TB);
    });

    it("defaults to engine layer 0 and depth 0", () => {
        const sink = draw(stack());
        expect(sink.quads[0]).toMatchObject({ layer: 0, depth: 0 });
        expect(sink.quads.at(-1)).toMatchObject({ layer: 0, depth: 4 });
    });

    it("draws the layers options.layers accepts in place of the visible ones", () => {
        const calls: number[] = [];
        const sink = draw(stack(), {
            layers: (_, index) => {
                calls.push(index);
                return index === 2 || index === 1;
            },
        });
        expect(calls).toEqual([0, 2, 3, 4]);
        expect(sink.quads.map((quad) => [quad.depth, quad.texture, quad.x, quad.y])).toEqual([
            [2, TS, 8, 8],
        ]);
        const images = draw(stack(), { layers: (layer) => layer.type === "image" });
        expect(images.quads.map((quad) => quad.texture)).toEqual([SKY]);
    });
});

describe("drawTilemap geometry", () => {
    it("places quads in map pixels times scale", () => {
        const only = { layers: (_: unknown, index: number) => index === 4 };
        const one = draw(stack(), only);
        expect(one.quads).toEqual([
            expect.objectContaining({ x: 24, y: 24, width: 16, height: 16, rotation: 0 }),
        ]);
        const three = draw(stack(), { ...only, scale: 3, viewWidth: 384, viewHeight: 288 });
        expect(three.quads).toEqual([
            expect.objectContaining({ x: 72, y: 72, width: 48, height: 48, rotation: 0 }),
        ]);
        // The view is in world units: at scale 3 a 384 x 288 view covers the whole map.
        const ground = draw(stack(), {
            layers: (_, i) => i === 0,
            scale: 3,
            viewWidth: 384,
            viewHeight: 288,
        });
        expect(ground.quads).toHaveLength(48);
    });

    it("culls to the view, in world units", () => {
        const ground = { layers: (_: unknown, index: number) => index === 0 };
        // The last cell alone: map pixels 112..128 x 80..96 at scale 2.
        const corner = draw(
            stack(),
            { ...ground, scale: 2, viewWidth: 32, viewHeight: 32 },
            { x: 224, y: 160 },
        );
        expect(corner.quads.map((quad) => [quad.x, quad.y])).toEqual([[240, 176]]);
        expect(draw(stack(), ground, { x: 1000, y: 1000 }).quads).toEqual([]);
        expect(draw(stack(), ground, { x: -128, y: 0 }).quads).toEqual([]);
    });

    it("shifts a layer by its offset and parallax about the view's centre", () => {
        const map = (camera: { x: number; y: number }) =>
            draw(
                stack((json) => {
                    json.parallaxOriginX = 8;
                    json.parallaxOriginY = 4;
                    Object.assign((json.layers as Json[])[4]!, {
                        offsetX: 3,
                        offsetY: 2,
                        parallaxX: 0.5,
                        parallaxY: 0.25,
                    });
                }),
                { layers: (_, index) => index === 4, scale: 2, viewWidth: 128, viewHeight: 96 },
                camera,
            ).quads.map((quad) => [quad.x, quad.y]);
        // Camera 0, 0: view 64 x 48 map px, centre (32, 24), from the origin (24, 20); shift
        // (3 + 24 * 0.5, 2 + 20 * 0.75) = (15, 17); the tile's centre (24, 24) moves to (39, 41),
        // times 2.
        expect(map({ x: 0, y: 0 })).toEqual([[78, 82]]);
        // Camera 40, 20: view from (20, 10), centre (52, 34), from the origin (44, 30); shift
        // (3 + 44 * 0.5, 2 + 30 * 0.75) = (25, 24.5).
        expect(map({ x: 40, y: 20 })).toEqual([[98, 97]]);
    });

    it("draws an image at the layer's shift, and a repeated image as copies covering the view", () => {
        const sky = (extra: Json, camera: { x: number; y: number }) =>
            draw(
                stack((json) => Object.assign((json.layers as Json[])[3]!, extra)),
                { layers: (_, index) => index === 3, viewWidth: 64, viewHeight: 48 },
                camera,
            ).quads;
        expect(sky({ offsetX: 5, offsetY: 3 }, { x: 0, y: 0 })).toEqual([
            expect.objectContaining({
                texture: SKY,
                x: 10,
                y: 7,
                width: 10,
                height: 8,
                u: 0,
                v: 0,
                uw: 1,
                vh: 1,
            }),
        ]);
        // Out of view when it does not repeat.
        expect(sky({ offsetX: 5, offsetY: 3 }, { x: 100, y: 0 })).toEqual([]);

        const camera = { x: 37, y: -21 };
        const view = { x0: 37, y0: -21, x1: 37 + 64, y1: -21 + 48 };
        const quads = sky(
            { offsetX: 5, offsetY: 3, parallaxX: 0.25, repeatX: true, repeatY: true },
            camera,
        );
        // Every quad overlaps the view, and the quads cover it without a gap.
        const boxes = quads.map((quad) => ({
            x0: quad.x - quad.width / 2,
            y0: quad.y - quad.height / 2,
            x1: quad.x + quad.width / 2,
            y1: quad.y + quad.height / 2,
        }));
        for (const box of boxes) {
            expect(
                box.x1 > view.x0 && box.x0 < view.x1 && box.y1 > view.y0 && box.y0 < view.y1,
            ).toBe(true);
        }
        for (let y = view.y0 + 0.5; y < view.y1; y += 1) {
            for (let x = view.x0 + 0.5; x < view.x1; x += 1) {
                expect(boxes.some((b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1)).toBe(
                    true,
                );
            }
        }
        // The copies lie on the grid that starts at the shift: the view's centre (69, 3) gives
        // the shift (5 + 69 * (1 - 0.25), 3) = (56.75, 3); columns -2..4 and rows -3..2 cover it.
        for (const box of boxes) {
            expect((((box.x0 - 56.75) % 10) + 10) % 10).toBeCloseTo(0, 9);
            expect((((box.y0 - 3) % 8) + 8) % 8).toBeCloseTo(0, 9);
        }
        expect(Math.min(...boxes.map((box) => box.x0))).toBe(36.75);
        expect(Math.max(...boxes.map((box) => box.x1))).toBe(106.75);
        expect(Math.min(...boxes.map((box) => box.y0))).toBe(-21);
        expect(Math.max(...boxes.map((box) => box.y1))).toBe(27);
        expect(boxes).toHaveLength(7 * 6);

        // One axis repeated: a row of copies at the image's own height.
        const row = sky({ repeatX: true }, { x: 3, y: 0 });
        expect(row.map((quad) => [quad.x, quad.y])).toEqual(
            [0, 1, 2, 3, 4, 5, 6].map((k) => [k * 10 + 5, 4]),
        );
    });
});

describe("drawTilemap animation, alpha and colour", () => {
    const meadowLayers = {
        layers: (_: unknown, index: number) => index === 0,
        assets: new Set(["ngne-tilemap:meadow-game/grass"]),
    };
    const GRASS_2 = [1 / 36, 19 / 36, 16 / 36, 16 / 36];
    const GRASS_1 = [19 / 36, 1 / 36, 16 / 36, 16 / 36];

    /** The UV of the animated tile at cell (2, 0) of meadow at `elapsedMs`. */
    function animatedUv(tilemap: Tilemap, elapsedMs: number): number[] {
        const quad = draw(tilemap, { ...meadowLayers, elapsedMs }).quads.find(
            (q) => q.x === 40 && q.y === 8,
        );
        if (quad === undefined) throw new Error("No quad at cell 2, 0.");
        return [quad.u, quad.v, quad.uw, quad.vh];
    }

    it("shows the frame at elapsedMs, one clock from 0 for every tile", () => {
        const tilemap = readTilemap(meadowJson(), meadowAtlases());
        expect(animatedUv(tilemap, 0)).toEqual(GRASS_2);
        expect(animatedUv(tilemap, 249.9)).toEqual(GRASS_2);
        expect(animatedUv(tilemap, 250)).toEqual(GRASS_1);
        expect(animatedUv(tilemap, 499)).toEqual(GRASS_1);
        expect(animatedUv(tilemap, 500)).toEqual(GRASS_2);
        expect(animatedUv(tilemap, 760)).toEqual(GRASS_1);
        // A clock that goes back shows its frame as well.
        expect(animatedUv(tilemap, 100)).toEqual(GRASS_2);
        expect(animatedUv(tilemap, -10)).toEqual(GRASS_1);

        // Two cells of the animated tile show the same frame.
        setCell(tilemap, tileLayer(tilemap, "Ground"), 0, 0, 3);
        const quads = draw(tilemap, { ...meadowLayers, elapsedMs: 300 }).quads;
        const animated = quads.filter((q) => (q.x === 8 || q.x === 40) && q.y === 8);
        expect(animated.map((q) => [q.u, q.v])).toEqual([
            [GRASS_1[0], GRASS_1[1]],
            [GRASS_1[0], GRASS_1[1]],
        ]);
        // A tile that is not animated keeps its frame: grass-0, flipped, at cell 1, 1.
        expect(quads.find((q) => q.x === 24 && q.y === 24)).toMatchObject({
            u: 1 / 36,
            v: 1 / 36,
            width: -16,
        });
    });

    it("keeps the frames of each tilemap apart", () => {
        const a = readTilemap(meadowJson(), meadowAtlases());
        const b = readTilemap(meadowJson(), meadowAtlases());
        const sinkA = new Recorder();
        const sinkB = new Recorder();
        drawTilemap(sinkA, a, { x: 0, y: 0 }, options({ ...meadowLayers, elapsedMs: 0 }));
        drawTilemap(sinkB, b, { x: 0, y: 0 }, options({ ...meadowLayers, elapsedMs: 300 }));
        expect(sinkA.quads.find((q) => q.x === 40 && q.y === 8)).toMatchObject({ u: GRASS_2[0] });
        expect(sinkB.quads.find((q) => q.x === 40 && q.y === 8)).toMatchObject({ u: GRASS_1[0] });
    });

    it("multiplies layer opacity by options.alpha and passes options.color", () => {
        const tilemap = stack((json) => {
            (json.layers as Json[])[0]!.opacity = 128;
        });
        const sink = draw(tilemap, { alpha: 0.5, color: 0x112233 });
        expect(sink.quads[0]).toMatchObject({ alpha: (128 / 255) * 0.5, color: 0x112233 });
        // Sky and Top at full opacity.
        expect(sink.quads.slice(48).map((q) => [q.alpha, q.color])).toEqual([
            [0.5, 0x112233],
            [0.5, 0x112233],
        ]);
        const plain = draw(tilemap);
        expect(plain.quads[0]).toMatchObject({ alpha: 128 / 255, color: 0xffffff });
        expect(plain.quads[48]).toMatchObject({ alpha: 1, color: 0xffffff });
        // A layer at opacity 0, or alpha 0, draws nothing.
        expect(draw(tilemap, { alpha: 0 }).quads).toEqual([]);
    });
});

describe("drawTilemap robustness", () => {
    it("skips a tileset whose texture is missing and reports it once over many frames", () => {
        const tilemap = stack();
        const report = vi.fn();
        const sink = new Recorder();
        const assets = new Map<string, unknown>([
            [TS, {}],
            [SKY, {}],
        ]);
        for (let frame = 0; frame < 50; frame += 1) {
            sink.clear();
            drawTilemap(
                sink,
                tilemap,
                { x: 0, y: 0 },
                options({ assets, report, elapsedMs: frame * 16 }),
            );
        }
        expect(sink.quads.map((q) => q.texture)).not.toContain(TB);
        expect(sink.quads).toHaveLength(49);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]![0]).toMatch(/"tb"/);
        expect(report.mock.calls[0]![0]).toContain(TB);

        // Once the texture is there it draws; missing again, it is not reported twice.
        sink.clear();
        drawTilemap(sink, tilemap, { x: 0, y: 0 }, options({ report }));
        expect(sink.quads.map((q) => q.texture)).toContain(TB);
        drawTilemap(sink, tilemap, { x: 0, y: 0 }, options({ assets, report }));
        expect(report).toHaveBeenCalledTimes(1);

        // A missing image is reported once as well; each tilemap reports its own.
        const other = stack();
        const images = vi.fn();
        for (let frame = 0; frame < 5; frame += 1) {
            drawTilemap(
                sink,
                other,
                { x: 0, y: 0 },
                options({ assets: new Set([TS, TB]), report: images }),
            );
        }
        expect(images).toHaveBeenCalledTimes(1);
        expect(images.mock.calls[0]![0]).toContain(SKY);
    });

    it("reports through console.warn by default", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const sink = new Recorder();
        const tilemap = stack();
        const noReport: DrawOptions = {
            elapsedMs: 0,
            viewWidth: 128,
            viewHeight: 96,
            assets: new Set([TS, SKY]),
        };
        drawTilemap(sink, tilemap, { x: 0, y: 0 }, noReport);
        drawTilemap(sink, tilemap, { x: 0, y: 0 }, noReport);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toContain(TB);
    });

    it("never throws for a malformed options value the types allow", () => {
        const tilemap = stack();
        const thrower = () => {
            throw new Error("boom");
        };
        const variants: Partial<DrawOptions>[] = [
            { elapsedMs: NaN },
            { elapsedMs: Infinity },
            { elapsedMs: -Infinity },
            { elapsedMs: -1e300 },
            { elapsedMs: 1e300 },
            { viewWidth: NaN },
            { viewWidth: 0 },
            { viewWidth: -10 },
            { viewHeight: Infinity },
            { scale: 0 },
            { scale: -2 },
            { scale: NaN },
            { scale: Infinity },
            { scale: 1e-300 },
            { scale: 1e-307 },
            { scale: 5e-324 },
            { layer: NaN },
            { layer: 2.5 },
            { depth: -Infinity },
            { alpha: NaN },
            { alpha: -1 },
            { alpha: 7 },
            { color: NaN },
            { color: -1 },
            { layers: thrower },
            { report: thrower, assets: new Set<string>() },
            { assets: { has: thrower } },
            { assets: { has: () => true } },
        ];
        // Variants whose own function throws stop the draw on purpose; no other does.
        const stopping = new Set<Partial<DrawOptions>>(variants.slice(-3, -1));
        for (const variant of variants) {
            const sink = new Recorder();
            const report = vi.fn();
            expect(() =>
                drawTilemap(sink, stack(), { x: 0, y: 0 }, options({ report, ...variant })),
            ).not.toThrow();
            if (!stopping.has(variant) && variant.layers === undefined) {
                expect(report.mock.calls.flat().join(" | ")).not.toMatch(/stopped/);
            }
            for (const quad of sink.quads) {
                for (const value of [
                    quad.x,
                    quad.y,
                    quad.width,
                    quad.height,
                    quad.alpha,
                    quad.depth,
                ]) {
                    expect(Number.isFinite(value)).toBe(true);
                }
                expect(quad.alpha).toBeGreaterThanOrEqual(0);
                expect(quad.alpha).toBeLessThanOrEqual(1);
            }
        }
        for (const camera of [
            { x: NaN, y: 0 },
            { x: Infinity, y: -Infinity },
            { x: 1e308, y: 1e308 },
        ]) {
            expect(() => drawTilemap(new Recorder(), tilemap, camera, options())).not.toThrow();
        }
        // A scale so small that a repeated image would take endless copies draws none, once said.
        const repeated = stack((json) => {
            Object.assign((json.layers as Json[])[3]!, { repeatX: true, repeatY: true });
        });
        const copies = vi.fn();
        for (const scale of [1e-300, 1e-6]) {
            const sink = new Recorder();
            drawTilemap(sink, repeated, { x: 0, y: 0 }, options({ scale, report: copies }));
            expect(sink.quads.map((q) => q.texture)).not.toContain(SKY);
        }
        expect(copies).toHaveBeenCalledTimes(1);
        expect(copies.mock.calls[0]![0]).toMatch(/copies/);
        // A sink that throws stops the draw; it is reported, not thrown.
        const report = vi.fn();
        expect(() =>
            drawTilemap({ sprite: thrower }, stack(), { x: 0, y: 0 }, options({ report })),
        ).not.toThrow();
        expect(report).toHaveBeenCalledWith(expect.stringContaining("boom"));
    });

    it("draws nothing of a tile layer for a tilemap readTilemap did not return, and says so", () => {
        const json = stackJson();
        const tilemap = validateTilemap(json, {
            ts: atlasFor("ts", 4, 16, 16),
            tb: atlasFor("tb", 2, 16, 16),
        });
        const report = vi.fn();
        const sink = draw(tilemap, { report });
        draw(tilemap, { report });
        expect(sink.quads.map((q) => q.texture)).toEqual([SKY]);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]![0]).toMatch(/readTilemap/);
    });
});

describe("drawTilemap data and sprite", () => {
    it("hands the sink one reused sprite object", () => {
        const tilemap = stack();
        const sink = new Recorder();
        for (let frame = 0; frame < 3; frame += 1) {
            drawTilemap(sink, tilemap, { x: frame * 5, y: 0 }, options({ elapsedMs: frame * 100 }));
        }
        expect(sink.quads.length).toBeGreaterThan(100);
        expect(sink.objects.size).toBe(1);
    });

    it("draws the game's edits to data at once, and no tile for a value with bit 28 set", () => {
        const tilemap = stack();
        const top = tileLayer(tilemap, "Top");
        const only = { layers: (_: unknown, index: number) => index === 4 };
        top.data[0] = 6;
        expect(draw(tilemap, only).quads.map((q) => [q.texture, q.x, q.y])).toEqual([
            [TB, 8, 8],
            [TB, 24, 24],
        ]);
        top.data[0] = (0x10000000 | 6) >>> 0;
        top.data[2] = 0x80000000;
        expect(draw(tilemap, only).quads.map((q) => [q.x, q.y])).toEqual([[24, 24]]);
    });
});

describe("the generated runtime", () => {
    it("draws as the source does, with the emitter inlined", async () => {
        const folder = mkdtempSync(join(tmpdir(), "te-051-"));
        try {
            const output = ts.transpileModule(
                generateRuntime({ tilemaps: ["meadow"], tilesets: ["grass"], images: [] }),
                {
                    compilerOptions: {
                        target: ts.ScriptTarget.ES2022,
                        module: ts.ModuleKind.ESNext,
                    },
                },
            );
            const file = join(folder, "ngne-tilemap.mjs");
            writeFileSync(file, output.outputText);
            const generated = (await import(
                /* @vite-ignore */ pathToFileURL(file).href
            )) as typeof Runtime;
            const drawOptions = options({
                elapsedMs: 300,
                assets: new Set(["ngne-tilemap:meadow-game/grass"]),
            });
            const fromSource = new Recorder();
            drawTilemap(
                fromSource,
                readTilemap(meadowJson(), meadowAtlases()),
                { x: 3, y: 5 },
                drawOptions,
            );
            const fromGenerated = new Recorder();
            generated.drawTilemap(
                fromGenerated,
                generated.readTilemap(meadowJson(), meadowAtlases()),
                { x: 3, y: 5 },
                drawOptions,
            );
            expect(fromSource.quads.length).toBeGreaterThan(0);
            expect(fromGenerated.quads).toEqual(fromSource.quads);
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    });
});
