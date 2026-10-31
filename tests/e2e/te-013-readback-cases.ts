import { expect, test } from "@playwright/test";
import { canvasSizes, compare, loadScene, openEditor } from "./te-013-support";

// TE-013: the image NGNE draws in the live tier, read back from the canvas in the page and
// compared with `core/compositor` (SPEC §15). The tests are declared by `readbackTests`, once
// per device pixel ratio: a ratio other than the configured one needs its own Chrome, so each
// ratio has its own spec file (te-013-readback-dpr*.spec.ts).
//
// The scene (tests/support/viewportScene.ts) holds the 8 orientations of tiles of an even size,
// an odd size and a tileset with a tile offset, a layer at half opacity, a layer with parallax
// 0.5 and a layer offset. The view is placed so that device pixels and the compositor's texels
// coincide (harness/te-013-page.ts). GPU blending of 8-bit premultiplied values differs from
// the compositor's by rounding: the tolerance is 2 per channel, and the histogram is reported.

const TOLERANCE = 2;
const ORIGIN = { originX: 37, originY: 23 };
const OPAQUE_BACKGROUND = 0x203040ff;

/** Declares the readback tests; the calling spec file has set Chrome up for `ratio`. */
export function readbackTests(ratio: number): void {
    test.describe(`device pixel ratio ${ratio}`, () => {
        for (const zoom of [1, 2]) {
            test(`zoom ${zoom}: every orientation, odd tiles, tile offset, opacity and parallax equal the compositor`, async ({
                page,
            }) => {
                await openEditor(page);
                expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
                const geometry = await loadScene(page, {
                    zoom,
                    background: OPAQUE_BACKGROUND,
                    ...ORIGIN,
                });
                const result = await compare(page, geometry, TOLERANCE);
                test.info().annotations.push({
                    type: "readback",
                    description: JSON.stringify({
                        histogram: result.histogram,
                        ties: result.ties,
                    }),
                });

                // The canvas is the host's size in device pixels, and the only canvas.
                const sizes = await canvasSizes(page);
                expect(Math.abs(sizes.canvas[0] - sizes.host[0])).toBeLessThan(1);
                expect(Math.abs(sizes.canvas[1] - sizes.host[1])).toBeLessThan(1);
                expect(sizes.canvases).toBe(1);

                // The map is 320 × 192 map pixels: the comparison covers all of its device
                // pixels but the ties (none at whole-number scales).
                const side = zoom * ratio;
                expect(result.compared + result.ties).toBe(
                    Math.round(320 * side) * Math.round(192 * side),
                );
                expect(result.ties === 0).toBe(Number.isInteger(side));
                expect(result.first).toEqual([]);
                expect(result.mismatches).toBe(0);
                // The corner of the canvas, far from the map, is the workspace colour.
                expect(result.outside.actual).toEqual(result.outside.expected);
            });
        }

        test("a map without background colour shows the checkerboard under its tiles", async ({
            page,
        }) => {
            await openEditor(page);
            const geometry = await loadScene(page, { zoom: 1, background: null, ...ORIGIN });
            const result = await compare(page, geometry, TOLERANCE);
            expect(result.first).toEqual([]);
            expect(result.mismatches).toBe(0);
            expect(result.outside.actual).toEqual(result.outside.expected);
        });

        test("the comparison sees a wrong orientation (control)", async ({ page }) => {
            await openEditor(page);
            const geometry = await loadScene(page, {
                zoom: 1,
                background: OPAQUE_BACKGROUND,
                ...ORIGIN,
            });
            const result = await compare(page, geometry, TOLERANCE, true);
            expect(result.mismatches).toBeGreaterThan(50);
        });
    });
}
