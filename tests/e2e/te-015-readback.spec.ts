import { test } from "@playwright/test";
import { compare, expect, loadScene, openAtRatio } from "./te-015-support";

// TE-015: the image NGNE draws in the chunk tier, read back from the canvas in the page and
// compared with the chunk reference of `core/compositor` (SPEC §15): each chunk set composited
// in its layers' own space at the tier's resolution, placed as the chunk quads place it.
//
// The scene (harness/te-015-page.ts) is 256 × 128 cells of three layers, above the live tier's
// limit: even and odd tiles in every orientation, a tileset with a tile offset, a layer at half
// opacity and a layer with parallax and an offset, which is a chunk set of its own. At scale
// 0.25 one texel of T = 4 is one device pixel; at 0.3 texels are sampled. GPU blending and the
// 2D canvas the chunks are uploaded from round 8-bit values: the tolerance is 2 per channel.

const TOLERANCE = 2;
const ORIGIN = { originX: 37, originY: 23 };
const OPAQUE_BACKGROUND = 0x203040ff;

for (const ratio of [1, 1.25]) {
    test.describe(`device pixel ratio ${ratio}`, () => {
        for (const scale of [0.25, 0.3]) {
            for (const background of [OPAQUE_BACKGROUND, null]) {
                const under = background === null ? "the checkerboard" : "a background colour";
                test(`scale ${scale} over ${under}: the canvas equals the chunk reference`, async ({
                    playwright,
                    launchOptions,
                    baseURL,
                }) => {
                    const { page, browser } = await openAtRatio(
                        playwright.chromium,
                        launchOptions,
                        baseURL,
                        ratio,
                    );
                    try {
                        const geometry = await loadScene(page, { scale, background, ...ORIGIN });
                        const result = await compare(page, geometry, TOLERANCE);
                        test.info().annotations.push({
                            type: "readback",
                            description: JSON.stringify({
                                texelsPerCell: result.texelsPerCell,
                                histogram: result.histogram,
                                ties: result.ties,
                                chunkQuads: result.chunkQuads,
                            }),
                        });
                        // Drawn by the chunk tier: chunk quads, no live quad.
                        expect(result.tier).toBe("chunk");
                        expect(result.chunkQuads).toBeGreaterThan(0);
                        expect(result.tileQuads).toBe(0);
                        expect(result.texelsPerCell).toBe(4);
                        // Every device pixel but the ties is compared: none at scale 0.25, where
                        // texels and device pixels coincide; at 0.3 the centres of some columns and
                        // rows lie on texel edges.
                        const pixels = geometry.width * geometry.height;
                        expect(result.compared + result.ties).toBe(pixels);
                        if (scale === 0.25) expect(result.ties).toBe(0);
                        expect(result.compared).toBeGreaterThan(0.6 * pixels);
                        expect(result.first).toEqual([]);
                        expect(result.mismatches).toBe(0);
                    } finally {
                        await browser.close();
                    }
                });
            }
        }
    });
}
