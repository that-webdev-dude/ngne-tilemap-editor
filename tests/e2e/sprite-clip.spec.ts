import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Geometry } from "./te-015-support";
import {
    chunksReady,
    compare,
    expect,
    loadScene,
    newValue,
    openAtRatio,
    pageCall,
} from "./te-015-support";
import type { PaintResult } from "./harness/te-015-page";

// Painting at overview (ENGINE §4) at device pixel ratios 1 and 1.25: the live quads drawn over a
// pending chunk patch reach only the patch, with the patch as their sprite clip. Each paint's next
// frame is compared with the reference of the changed document (harness/te-015-page.ts): inside
// the patch the live tier's image, around it the chunk's. Painting the far layer, a chunk set of
// its own with a parallax shift, puts the patch edges between device pixels; the patch redraws the
// half-opacity layer under it, so a fringe drawn twice or left out would show. Each result notes
// the frame's draw calls and a hash of its canvas.

const TOLERANCE = 2;
const SCALE = 0.375;
const FAR = 2;
/** The whole map fits the viewport at this scale, at both ratios. */
const WINDOW = { width: 1920, height: 1080 };

/** Paints cell `(x, y)` of layer `index` and checks the next frame; returns its result. */
async function paintChecked(
    page: Page,
    geometry: Geometry,
    cell: { x: number; y: number; index: number },
): Promise<PaintResult> {
    const { x, y, index } = cell;
    const value = await newValue(page, x, y, index);
    const next = await pageCall<PaintResult>(
        page,
        "paintAndCompare",
        x,
        y,
        value,
        geometry,
        TOLERANCE,
        index,
    );
    test.info().annotations.push({
        type: "paint",
        description: JSON.stringify({
            cell,
            drawCalls: next.drawCalls,
            tileQuads: next.comparison.tileQuads,
            patched: next.comparison.patched,
            ties: next.comparison.ties,
            hash: next.hash,
        }),
    });
    expect(next.live).toBe(1);
    expect(next.comparison.tier).toBe("chunk");
    expect(next.comparison.tileQuads).toBeGreaterThan(0);
    expect(next.comparison.patched).toBeGreaterThan(0);
    expect(next.comparison.first).toEqual([]);
    expect(next.comparison.mismatches).toBe(0);
    await chunksReady(page);
    return next;
}

for (const ratio of [1, 1.25]) {
    test(`device pixel ratio ${ratio}: live quads over a pending patch draw only the patch, translucent layers included`, async ({
        playwright,
        launchOptions,
        baseURL,
    }) => {
        const { page, browser } = await openAtRatio(
            playwright.chromium,
            launchOptions,
            baseURL,
            ratio,
            WINDOW,
        );
        try {
            const geometry = await loadScene(page, {
                scale: SCALE,
                originX: 37,
                originY: 23,
                background: 0x203040ff,
            });
            const settled = await compare(page, geometry, TOLERANCE);
            expect(settled.tier).toBe("chunk");
            expect(settled.mismatches).toBe(0);
            // The base layer under the half-opacity layer; a row of tiles with an offset, which
            // reach past the patch; the far layer, whose patch edges fall between device pixels.
            await paintChecked(page, geometry, { x: 60, y: 40, index: 0 });
            await paintChecked(page, geometry, { x: 40, y: 5, index: 0 });
            await paintChecked(page, geometry, { x: 30, y: 30, index: FAR });
            await paintChecked(page, geometry, { x: 51, y: 17, index: FAR });
        } finally {
            await browser.close();
        }
    });
}
