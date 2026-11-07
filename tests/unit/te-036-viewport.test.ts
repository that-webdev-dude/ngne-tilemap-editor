import type { Camera, Frame } from "@ngne/core";
import { describe, expect, it } from "vitest";
import { createImageLayer } from "../../src/core/model";
import type { ImageLayer, PixelBuffer, Project } from "../../src/core/model";
import { packTileset } from "../../src/core/pack";
import { checkerSpec } from "../../src/engine/viewport/checker";
import {
    ImageLayerTextures,
    MIN_REPEAT_SPAN,
    emitImageLayer,
    imageTextureId,
    repeatCopies,
    repeatedPixels,
} from "../../src/engine/viewport/imageLayers";
import type { ReadyImage } from "../../src/engine/viewport/imageLayers";
import { EmitterCache, LAYER, buildLiveFrame } from "../../src/engine/viewport/liveTier";
import type { ViewportScene } from "../../src/engine/viewport/liveTier";
import { tilesetTextureId } from "../../src/engine/viewport/textures";
import { createViewportSceneProject } from "../support/viewportScene";

// TE-036: image layers in the viewport (ENGINE §3, §4): one texture per image layer
// (`ed:img:<layerId>`), drawn at the layer's shift and opacity, a repeated axis as a grid of
// quads over the area drawn; the texture of a repeated axis holds several copies so a small
// image does not take a quad per copy. What NGNE draws from the frame is the E2E readback's
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
    it("hold enough copies to span 512 px, within 8192 px", () => {
        expect(repeatCopies(16, false)).toBe(1);
        expect(repeatCopies(16, true)).toBe(MIN_REPEAT_SPAN / 16);
        expect(repeatCopies(300, true)).toBe(2);
        expect(repeatCopies(1, true)).toBe(512);
        expect(repeatCopies(5000, true)).toBe(1);
        expect(repeatCopies(8192, true)).toBe(1);
    });

    it("copy the image side by side, pixel for pixel", () => {
        const source = image(3, 2);
        expect(repeatedPixels(source, 1, 1)).toBe(source);
        const out = repeatedPixels(source, 3, 2);
        expect([out.width, out.height]).toEqual([9, 4]);
        for (let y = 0; y < out.height; y += 1) {
            for (let x = 0; x < out.width; x += 1) {
                const at = (y * out.width + x) * 4;
                const from = ((y % 2) * 3 + (x % 3)) * 4;
                expect([...out.data.subarray(at, at + 4)]).toEqual([
                    ...source.data.subarray(from, from + 4),
                ]);
            }
        }
    });
});

describe("quads of an image layer", () => {
    const camera = { centreX: 50, centreY: 25, scale: 2 };
    const size = { width: 200, height: 100 };
    const area = { x: 0, y: 0, width: 100, height: 50 };
    const ready: ReadyImage = { texture: "ed:img:7", spanX: 16, spanY: 8 };

    function emit(repeatX: boolean, repeatY: boolean, shift = { x: 10, y: 5 }, clip = false) {
        const frame = new RecordingFrame();
        const layer = { ...createImageLayer(7, "Sky", "img"), repeatX, repeatY };
        const count = emitImageLayer(
            frame as unknown as Frame,
            camera,
            size,
            { layer, ready, opacity: 128, shift },
            area,
            {
                layer: LAYER.tiles,
                depth: 3,
                clip: clip ? { x0: 0, y0: 0, x1: 40, y1: 30 } : null,
            },
        );
        return { count, sprites: frame.sprites };
    }

    it("draws one quad with its top-left corner at the shift, at the layer's opacity", () => {
        const { count, sprites } = emit(false, false);
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
        expect(emit(false, false, { x: 200, y: 5 }).count).toBe(0);
    });

    it("covers the area with a grid along each repeated axis", () => {
        // x: copies −1 .. 5 cover 0 .. 100 from 10 in steps of 16; y: one row.
        const x = emit(true, false);
        expect(x.count).toBe(7);
        expect(x.sprites.map((s) => (s.x - 16) / 2)).toEqual([-6, 10, 26, 42, 58, 74, 90]);
        // y: copies −1 .. 5 cover 0 .. 50 from 5 in steps of 8.
        const y = emit(false, true);
        expect(y.count).toBe(7);
        expect(y.sprites.map((s) => (s.y - 8) / 2)).toEqual([-3, 5, 13, 21, 29, 37, 45]);
        expect(emit(true, true).count).toBe(49);
        // Far away on a repeated axis, the grid still covers the area.
        expect(emit(true, false, { x: -1000, y: 5 }).count).toBe(7);
    });

    it("cuts each quad to a clip rectangle", () => {
        const { sprites } = emit(true, false, { x: 10, y: 5 }, true);
        for (const s of sprites) {
            expect(s.x - s.width / 2).toBeGreaterThanOrEqual(0);
            expect(s.x + s.width / 2).toBeLessThanOrEqual(40);
            expect(s.y + s.height / 2).toBeLessThanOrEqual(30);
        }
        // Copies −1 and 0 meet device x 0 .. 40 (device 20 + 32k, 32 wide).
        expect(sprites.length).toBe(2);
        expect(sprites[0]).toMatchObject({ u: 6 / 16, uw: 10 / 16 });
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
            spanX: 4,
            spanY: 2,
            pixels: project.images[0]!.pixels,
            copiesX: 1,
            copiesY: 1,
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
            spanX: 4 * (MIN_REPEAT_SPAN / 4),
            spanY: 2,
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
            layer.id === sky.id ? { texture: "ed:img:90", spanX: 4, spanY: 2 } : null;
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
