import type { Camera, Frame } from "@ngne/core";
import { describe, expect, it } from "vitest";
import { createImageLayer } from "../../src/core/model";
import type { ImageLayer, PixelBuffer, Project } from "../../src/core/model";
import { packTileset } from "../../src/core/pack";
import { checkerSpec } from "../../src/engine/viewport/checker";
import { ImageLayerTextures, imageTextureId } from "../../src/engine/viewport/imageLayers";
import type { ReadyImage } from "../../src/engine/viewport/imageLayers";
import { EmitterCache, LAYER, buildLiveFrame } from "../../src/engine/viewport/liveTier";
import type { ViewportScene } from "../../src/engine/viewport/liveTier";
import { tilesetTextureId } from "../../src/engine/viewport/textures";
import { QUAD_CLIP, emitQuads } from "../support/imageLayerQuads";
import { createViewportSceneProject } from "../support/viewportScene";

// TE-036: image layers in the viewport (ENGINE §3, §4): one texture per image layer
// (`ed:img:<layerId>`) holding the image once, drawn at the layer's shift and opacity as one quad
// that a repeated axis stretches over the area drawn, its UVs tiling the image with repeat
// addressing (repeat-image-layers.test.ts). What NGNE draws from the frame is the E2E readback's
// (te-036-image-layer.spec.ts).

interface Recorded {
    x: number;
    y: number;
    width: number;
    height: number;
    texture?: string;
    u?: number;
    v?: number;
    uw?: number;
    vh?: number;
    alpha?: number;
    layer?: number;
    depth?: number;
    clip?: { x: number; y: number; width: number; height: number };
}

class RecordingFrame {
    sprites: Recorded[] = [];
    reset() {
        this.sprites = [];
    }
    scene() {}
    sprite(s: Recorded) {
        this.sprites.push({ ...s });
    }
    rect() {}
}

function image(width: number, height: number): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 13) & 255;
    return { width, height, data };
}

describe("textures of repeated axes", () => {
    /** Uploads the image layer of an image of `width × height` with each repeat setting. */
    async function uploads(width: number, height: number): Promise<PixelBuffer[]> {
        const sources: PixelBuffer[] = [];
        const project = createViewportSceneProject({ background: null });
        project.images.push({ id: "i", name: "i", exportName: "i", pixels: image(width, height) });
        const map = project.maps[0]!;
        const layer = createImageLayer(90, "Image", "i");
        map.layers.push(layer);
        for (const [repeatX, repeatY] of [
            [false, false],
            [true, false],
            [false, true],
            [true, true],
        ] as const) {
            const textures = new ImageLayerTextures(
                { texture: async () => {}, releaseTexture: () => {} },
                async (pixels) => {
                    sources.push(pixels);
                    return { width: pixels.width, height: pixels.height, close() {} } as never;
                },
                { onChange: () => {}, onError: (error) => void error },
            );
            Object.assign(layer, { repeatX, repeatY });
            textures.use(project, map);
            await flush();
        }
        return sources;
    }

    it("hold the image once, whatever its size and repeat", async () => {
        for (const [width, height] of [
            [16, 16],
            [300, 1],
            [1, 5000],
            [8192, 2],
        ] as const) {
            const sides = (await uploads(width, height)).map((s) => [s.width, s.height]);
            expect(sides).toEqual(Array.from({ length: 4 }, () => [width, height]));
        }
    });

    it("hold the image's own pixels, pixel for pixel", async () => {
        const sources = await uploads(3, 2);
        expect(sources).toHaveLength(4);
        const [first, ...rest] = sources;
        for (const source of rest) expect(source).toBe(first);
        expect([...first!.data]).toEqual([...image(3, 2).data]);
    });
});

describe("quads of an image layer", () => {
    it("draws one quad with its top-left corner at the shift, at the layer's opacity", () => {
        const { count, sprites } = emitQuads(false, false);
        expect(count).toBe(1);
        expect(sprites).toEqual([
            expect.objectContaining({
                // Map (10, 5) is device (20, 10); the quad is 32 × 16 device pixels.
                x: 20 + 16,
                y: 10 + 8,
                width: 32,
                height: 16,
                texture: "ed:img:7",
                u: 0,
                v: 0,
                uw: 1,
                vh: 1,
                alpha: 128 / 255,
                layer: LAYER.tiles,
                depth: 3,
            }),
        ]);
        // Outside the area: nothing.
        expect(emitQuads(false, false, { x: 200, y: 5 }).count).toBe(0);
    });

    it("covers the area with one quad along each repeated axis", () => {
        // x: the quad spans 0 .. 100 (device 0 .. 200), starting 6 px into the copy at −6
        // (copies at 10 in steps of 16); y: one image high, at 5.
        const x = emitQuads(true, false);
        expect(x.count).toBe(1);
        expect(x.sprites.map((s) => [s.x, s.width, s.u, s.uw, s.y, s.height, s.v, s.vh])).toEqual([
            [100, 200, 6 / 16, 100 / 16, 18, 16, 0, 1],
        ]);
        // y: the quad spans 0 .. 50, starting 3 px into the copy at −3 (copies at 5 in steps
        // of 8); x: one image wide, at 10.
        const y = emitQuads(false, true);
        expect(y.count).toBe(1);
        expect(y.sprites.map((s) => [s.x, s.width, s.u, s.uw, s.y, s.height, s.v, s.vh])).toEqual([
            [36, 32, 0, 1, 50, 100, 3 / 8, 50 / 8],
        ]);
        expect(emitQuads(true, true).count).toBe(1);
        // Far away on a repeated axis, the quad still covers the area.
        expect(emitQuads(true, false, { x: -1000, y: 5 }).sprites).toEqual([
            expect.objectContaining({ x: 100, width: 200, u: 0.5, uw: 100 / 16 }),
        ]);
    });

    it("draws the quad uncut, with the clip rectangle as its sprite clip", () => {
        const { sprites } = emitQuads(true, false, { x: 10, y: 5 }, true);
        const whole = emitQuads(true, false, { x: 10, y: 5 }).sprites;
        // The quad of the area, whole and clipped by the GPU.
        expect(whole).toHaveLength(1);
        expect(sprites).toEqual(whole.map((s) => ({ ...s, clip: QUAD_CLIP })));
        for (const s of sprites) expect(s).toMatchObject({ width: 200, u: 6 / 16, uw: 100 / 16 });
    });
});

interface Upload {
    id: string;
    resolve(): void;
}

function fakeTarget() {
    const uploads: Upload[] = [];
    const released: string[] = [];
    let changes = 0;
    const textures = new ImageLayerTextures(
        {
            texture: (id) =>
                new Promise<void>((resolve) => {
                    uploads.push({ id, resolve });
                }),
            releaseTexture: (id) => void released.push(id),
        },
        async (pixels) => ({ width: pixels.width, height: pixels.height, close() {} }) as never,
        { onChange: () => void (changes += 1), onError: (error) => void error },
    );
    return { textures, uploads, released, changes: () => changes };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function projectWithImages(): { project: Project; sky: ImageLayer; sea: ImageLayer } {
    const project = createViewportSceneProject({ background: null });
    project.images.push(
        { id: "sky", name: "sky", exportName: "sky", pixels: image(4, 2) },
        { id: "sea", name: "sea", exportName: "sea", pixels: image(2, 2) },
    );
    const map = project.maps[0]!;
    const sky = createImageLayer(90, "Sky", "sky");
    const sea = createImageLayer(91, "Sea", "sea");
    map.layers.splice(1, 0, sky);
    map.layers.push(sea);
    return { project, sky, sea };
}

describe("image layer textures", () => {
    it("upload one texture per image layer of the shown map and release them with it", async () => {
        const { textures, uploads, released, changes } = fakeTarget();
        const { project, sky, sea } = projectWithImages();
        const map = project.maps[0]!;
        textures.use(project, map);
        await flush();
        expect(uploads.map((u) => u.id)).toEqual([imageTextureId(90), imageTextureId(91)]);
        expect(textures.ready(sky, project.images[0]!.pixels)).toBeNull();
        uploads[0]!.resolve();
        await flush();
        expect(changes()).toBe(1);
        expect(textures.ready(sky, project.images[0]!.pixels)).toEqual({
            texture: "ed:img:90",
            width: 4,
            height: 2,
            pixels: project.images[0]!.pixels,
            repeat: false,
        });
        // A frame that changes nothing uploads nothing.
        textures.use(project, map);
        await flush();
        expect(uploads).toHaveLength(2);

        // Repeat changes the texture's content: uploaded again, and not drawn meanwhile.
        sky.repeatX = true;
        expect(textures.ready(sky, project.images[0]!.pixels)).toBeNull();
        textures.use(project, map);
        await flush();
        expect(uploads.map((u) => u.id)).toEqual(["ed:img:90", "ed:img:91", "ed:img:90"]);
        uploads[2]!.resolve();
        await flush();
        expect(textures.ready(sky, project.images[0]!.pixels)).toMatchObject({
            width: 4,
            height: 2,
            repeat: true,
        });

        // Another image: the old texture is not drawn for it.
        sky.imageId = "sea";
        expect(textures.ready(sky, project.images[1]!.pixels)).toBeNull();

        // The layer gone, then no map: released.
        map.layers.splice(map.layers.indexOf(sea), 1);
        textures.use(project, map);
        expect(released).toEqual(["ed:img:91"]);
        textures.use(null, null);
        expect(released).toEqual(["ed:img:91", "ed:img:90"]);
    });
});

describe("the live tier", () => {
    it("draws an image layer between tile layers at its own depth", () => {
        const { project, sky } = projectWithImages();
        const map = project.maps[0]!;
        sky.opacity = 200;
        const scene: ViewportScene = {
            project,
            map,
            view: { centreX: 160, centreY: 96, zoom: 1 },
            dpr: 1,
            checker: { a: 0x3a3a3a, b: 0x4a4a4a, size: 8 },
        };
        const frame = new RecordingFrame();
        const emitter = new EmitterCache().emitter(
            project.tilesets.map((tileset) => ({
                tileset,
                texture: tilesetTextureId(tileset.id),
                uvTable: packTileset(tileset).uvTable,
                version: 1,
            })),
        );
        const ready = (layer: ImageLayer): ReadyImage | null =>
            layer.id === sky.id ? { texture: "ed:img:90", width: 4, height: 2 } : null;
        const counts = buildLiveFrame(frame as unknown as Frame, {
            scene,
            size: { width: 400, height: 240 },
            camera: {} as Camera,
            emitter,
            checkerReady: checkerSpec(scene.checker),
            images: { ready },
        });
        // The sea's texture is not ready: only the sky's quad.
        expect(counts.imageQuads).toBe(1);
        const images = frame.sprites.filter((s) => s.texture?.startsWith("ed:img:"));
        expect(images).toEqual([
            expect.objectContaining({ texture: "ed:img:90", alpha: 200 / 255, depth: 2 }),
        ]);
        // Tiles of the bottom layer below it, of the next tile layer above it.
        const depths = new Set(
            frame.sprites
                .filter((s) => s.layer === LAYER.tiles && !s.texture?.startsWith("ed:img:"))
                .map((s) => s.depth),
        );
        expect(depths.has(1)).toBe(true);
        expect(depths.has(2)).toBe(false);
        expect(depths.has(3)).toBe(true);
    });
});
