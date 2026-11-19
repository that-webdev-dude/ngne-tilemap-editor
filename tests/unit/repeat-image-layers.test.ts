import { describe, expect, it } from "vitest";
import { createImageLayer } from "../../src/core/model";
import type { PixelBuffer, Project } from "../../src/core/model";
import { ImageLayerTextures, REPEAT_SAMPLING } from "../../src/engine/viewport/imageLayers";
import { LAYER } from "../../src/engine/viewport/liveTier";
import type { TextureSampling } from "../../src/engine/viewport/textures";
import { QUAD_CLIP, emitQuads } from "../support/imageLayerQuads";
import { createViewportSceneProject } from "../support/viewportScene";

// Repeated image layers (ENGINE §3, §4; GitHub #8): the texture of an image layer holds its image
// once; a layer that repeats on either axis registers it with repeat addressing and draws as one
// quad over the area drawn, whose UVs carry the repeat count and the offset of the copy under
// the area's start. What NGNE draws from it is the E2E readback's (te-036-image-layer.spec.ts).

function image(width: number, height: number): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 13) & 255;
    return { width, height, data };
}

describe("the quad of a repeated image layer", () => {
    it("covers the area along x, from the copy under its start, one image high", () => {
        const { count, sprites } = emitQuads(true, false);
        expect(count).toBe(1);
        // x: the area 0 .. 100 starts 10 px before the copy at 10, 6 px into the copy at −6.
        expect(sprites).toEqual([
            {
                x: 100,
                y: 10 + 8,
                width: 200,
                height: 16,
                rotation: 0,
                texture: "ed:img:7",
                u: 6 / 16,
                v: 0,
                uw: 100 / 16,
                vh: 1,
                alpha: 128 / 255,
                color: 0xffffffff,
                layer: LAYER.tiles,
                depth: 3,
            },
        ]);
    });

    it("covers the area along y, one image wide", () => {
        const { count, sprites } = emitQuads(false, true);
        expect(count).toBe(1);
        // y: the area 0 .. 50 starts 5 px before the copy at 5, 3 px into the copy at −3.
        expect(sprites[0]).toMatchObject({
            x: 20 + 16,
            y: 50,
            width: 32,
            height: 100,
            u: 0,
            v: 3 / 8,
            uw: 1,
            vh: 50 / 8,
        });
    });

    it("covers the whole area when both axes repeat", () => {
        const { count, sprites } = emitQuads(true, true);
        expect(count).toBe(1);
        expect(sprites[0]).toMatchObject({
            x: 100,
            y: 50,
            width: 200,
            height: 100,
            u: 6 / 16,
            v: 3 / 8,
            uw: 100 / 16,
            vh: 50 / 8,
        });
    });

    it("keeps the offset within one copy however far the shift is", () => {
        // −1000 is 62.5 copies before 0: the area starts half-way into a copy.
        const far = emitQuads(true, true, { x: -1000, y: 5 }).sprites[0]!;
        expect(far).toMatchObject({ u: 0.5, uw: 100 / 16, width: 200 });
        // A shift at a whole copy before the area: the area starts on a copy's edge.
        expect(emitQuads(true, false, { x: -32, y: 5 }).sprites[0]).toMatchObject({ u: 0 });
        // Past the area on the repeated axis, the copies still cover it.
        expect(emitQuads(true, false, { x: 1000, y: 5 }).sprites[0]).toMatchObject({
            u: 0.5,
            uw: 100 / 16,
        });
    });

    it("draws nothing when the image misses the area on an axis that does not repeat", () => {
        expect(emitQuads(true, false, { x: 10, y: 60 }).count).toBe(0);
        expect(emitQuads(false, true, { x: -40, y: 5 }).count).toBe(0);
    });

    it("carries the clip rectangle as its sprite clip", () => {
        const { sprites } = emitQuads(true, true, { x: 10, y: 5 }, true);
        const whole = emitQuads(true, true).sprites;
        expect(sprites).toEqual(whole.map((s) => ({ ...s, clip: QUAD_CLIP })));
    });
});

interface Upload {
    id: string;
    width: number;
    height: number;
    sampling: TextureSampling | undefined;
    resolve(): void;
}

function fakeTarget() {
    const uploads: Upload[] = [];
    const sources: PixelBuffer[] = [];
    const textures = new ImageLayerTextures(
        {
            texture: (id, source, _signal, sampling) =>
                new Promise<void>((resolve) => {
                    const { width, height } = source;
                    uploads.push({ id, width, height, sampling, resolve });
                }),
            releaseTexture: () => {},
        },
        async (pixels) => {
            sources.push(pixels);
            return { width: pixels.width, height: pixels.height, close() {} } as never;
        },
        { onChange: () => {}, onError: (error) => void error },
    );
    return { textures, uploads, sources };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function projectWithImage(): { project: Project; pixels: PixelBuffer } {
    const project = createViewportSceneProject({ background: null });
    const pixels = image(3, 2);
    project.images.push({ id: "sky", name: "sky", exportName: "sky", pixels });
    project.maps[0]!.layers.push(createImageLayer(90, "Sky", "sky"));
    return { project, pixels };
}

describe("the texture of a repeated image layer", () => {
    it("holds the image once, with repeat addressing for either axis or both", async () => {
        const { textures, uploads, sources } = fakeTarget();
        const { project, pixels } = projectWithImage();
        const map = project.maps[0]!;
        const sky = map.layers.at(-1)!;
        if (sky.type !== "image") throw new Error("not an image layer");

        // Not repeated: the default sampling.
        textures.use(project, map);
        await flush();
        expect(
            uploads.map(({ id, width, height, sampling }) => [id, width, height, sampling]),
        ).toEqual([["ed:img:90", 3, 2, undefined]]);
        uploads[0]!.resolve();
        await flush();
        expect(textures.ready(sky, pixels)).toMatchObject({
            texture: "ed:img:90",
            width: 3,
            height: 2,
        });

        // Repeat X, then Y alone, then both: one upload with repeat addressing, the image once.
        sky.repeatX = true;
        expect(textures.ready(sky, pixels)).toBeNull();
        textures.use(project, map);
        await flush();
        expect(
            uploads.slice(1).map(({ width, height, sampling }) => [width, height, sampling]),
        ).toEqual([[3, 2, REPEAT_SAMPLING]]);
        expect(REPEAT_SAMPLING).toEqual({ address: "repeat" });
        uploads[1]!.resolve();
        await flush();
        expect(textures.ready(sky, pixels)).toMatchObject({ width: 3, height: 2 });
        sky.repeatX = false;
        sky.repeatY = true;
        expect(textures.ready(sky, pixels)).not.toBeNull();
        sky.repeatX = true;
        textures.use(project, map);
        await flush();
        expect(uploads).toHaveLength(2);

        // Every upload's source is the image itself, not copies of it.
        expect(sources).toHaveLength(2);
        for (const source of sources) expect(source).toBe(pixels);

        // No repeat again: back to the default sampling.
        sky.repeatX = false;
        sky.repeatY = false;
        textures.use(project, map);
        await flush();
        expect(uploads.slice(2).map(({ sampling }) => sampling)).toEqual([undefined]);
    });
});
