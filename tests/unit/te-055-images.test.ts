import { describe, expect, it } from "vitest";
import { evenImage, exportFiles } from "../../src/core/export";
import type { PixelBuffer } from "../../src/core/model";
import type { SpriteLike } from "../../src/core/runtime/emit";
import { drawTilemap, readTilemap } from "../../src/core/runtime/runtime";
import { decodePng } from "../../src/core/sprite/png";
import { createConformanceProject } from "../support/conformanceProject";

// TE-055: an image of odd size is exported padded to even sides, and the runtime draws the whole
// padded PNG with its top-left corner on the image's (FORMAT §3.4, §5). With `pixelSnap`, NGNE
// rounds a quad's centre; an odd quad would then have its edges on half pixels, where the GPU's
// tie rule picks the pixels (SwiftShader one pixel off from Intel UHD and RTX 4060).

const decoder = new TextDecoder();

function pixels(width: number, height: number): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 1) data[i] = (i * 7 + 1) & 0xff || 1;
    return { width, height, data };
}

describe("evenImage", () => {
    it("pads an odd image with a transparent column on the right and row at the bottom", () => {
        const image = pixels(7, 3);
        const even = evenImage(image);
        expect([even.width, even.height]).toEqual([8, 4]);
        for (let y = 0; y < 4; y += 1) {
            for (let x = 0; x < 8; x += 1) {
                const at = (y * 8 + x) * 4;
                const got = Array.from(even.data.subarray(at, at + 4));
                if (x < 7 && y < 3) {
                    const from = (y * 7 + x) * 4;
                    expect(got).toEqual(Array.from(image.data.subarray(from, from + 4)));
                } else {
                    expect(got).toEqual([0, 0, 0, 0]);
                }
            }
        }
    });

    it("pads only the odd side, and leaves an even image as it is", () => {
        expect([evenImage(pixels(6, 5)).width, evenImage(pixels(6, 5)).height]).toEqual([6, 6]);
        expect([evenImage(pixels(1, 4)).width, evenImage(pixels(1, 4)).height]).toEqual([2, 4]);
        const even = pixels(4, 2);
        expect(evenImage(even)).toBe(even);
    });
});

describe("an odd image in the export and the runtime", () => {
    const project = createConformanceProject();
    const sky = project.images[0]!;
    const files = exportFiles(project);
    const file = (name: string) => {
        const found = files.find((item) => item.name === name);
        if (!found) throw new Error(`No ${name}`);
        return found.bytes;
    };

    it("writes the PNG padded to even, and the tilemap with the image's own size", async () => {
        expect([sky.pixels.width, sky.pixels.height]).toEqual([41, 21]);
        const png = await decodePng(file("sky.png"));
        expect([png.width, png.height]).toEqual([42, 22]);
        expect(png.data).toEqual(evenImage(sky.pixels).data);
        const json = JSON.parse(decoder.decode(file("layers.tilemap.json")));
        const layer = json.layers.find((item: { type: string }) => item.type === "image");
        expect([layer.imageWidth, layer.imageHeight]).toEqual([41, 21]);
    });

    /** The sprites `drawTilemap` gives for the layers map's image layer, `repeatX` as given. */
    function imageQuads(scale: number, repeatX: boolean): SpriteLike[] {
        const json = JSON.parse(decoder.decode(file("layers.tilemap.json")));
        for (const layer of json.layers) if (layer.type === "image") layer.repeatX = repeatX;
        const atlases = Object.fromEntries(
            project.tilesets.map((tileset) => [
                tileset.exportName,
                JSON.parse(decoder.decode(file(`${tileset.exportName}.atlas.json`))) as unknown,
            ]),
        );
        const tilemap = readTilemap(json, atlases);
        const quads: SpriteLike[] = [];
        drawTilemap(
            { sprite: (s) => quads.push({ ...s }) },
            tilemap,
            { x: 0, y: 0 },
            {
                elapsedMs: 0,
                viewWidth: 200 * scale,
                viewHeight: 150 * scale,
                scale,
                assets: { has: () => true },
                layers: (layer) => layer.type === "image",
            },
        );
        return quads;
    }

    it("draws the whole padded PNG with its top-left corner on the image's, at scales 1 and 3", () => {
        // The Sky layer is offset by (70, 18): the 42 × 22 quad covers 70..112 by 18..40.
        for (const scale of [1, 3]) {
            const [quad, ...rest] = imageQuads(scale, false);
            expect(rest).toEqual([]);
            expect(quad).toMatchObject({
                width: 42 * scale,
                height: 22 * scale,
                x: (70 + 21) * scale,
                y: (18 + 11) * scale,
                u: 0,
                v: 0,
                uw: 1,
                vh: 1,
                rotation: 0,
            });
            // Even sides at an integer scale: the centre, rounded or not, puts the edges on pixels.
            expect(Number.isInteger(quad!.x - quad!.width / 2)).toBe(true);
        }
    });

    it("repeats the image every 41 pixels, its own width, not the PNG's", () => {
        const quads = imageQuads(1, true);
        expect(quads.length).toBeGreaterThan(2);
        const lefts = quads.map((quad) => quad.x - quad.width / 2);
        for (let i = 1; i < lefts.length; i += 1) expect(lefts[i]! - lefts[i - 1]!).toBe(41);
        expect(lefts).toContain(70);
    });
});
