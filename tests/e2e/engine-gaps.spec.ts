import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./harness/engine-gaps";

// ENGINE §7: the status with the pinned engine of each row that needs the GPU. The page draws
// on one WebGPU canvas and reads it back (tests/e2e/harness/engine-gaps.ts); the rows that a
// declaration settles are in tests/unit/engine-gaps-surface.test.ts.

async function open(page: Page) {
    await page.goto("/tests/e2e/harness/engine-gaps.html");
    await expect(page.locator("#status")).toHaveText("ready");
}

test.beforeEach(async ({ page }) => open(page));

test("pixel snapping places odd-sized and flipped quads on whole pixels, texel for pixel", async ({
    page,
}) => {
    const result = await page.evaluate(() => window.engineGaps!.snap());
    expect(result).toEqual({ plain: [], plainBorder: [], flipped: [], flippedBorder: [] });
});

test("camera zoom 2 draws as the editor's scaling of positions and sizes does", async ({
    page,
}) => {
    const result = await page.evaluate(() => window.engineGaps!.zoom());
    expect(result).toEqual({ zoom: [2, 2], blocks: [], differingBytes: 0 });
});

test("repeat addressing tiles a whole texture; the default stays clamp", async ({ page }) => {
    const result = await page.evaluate(() => window.engineGaps!.repeat());
    expect(result).toEqual({ repeat: [], clamp: [] });
});

test("linear filtering blends texels, and bleeds across an atlas sub-rectangle's edge", async ({
    page,
}) => {
    const result = await page.evaluate(() => window.engineGaps!.linear());
    // Nearest: the two texels only. Linear: values between them along the ramp.
    expect(new Set(result.rampNearest)).toEqual(new Set([0, 255]));
    const between = result.rampLinear.filter((red) => red > 0 && red < 255);
    expect(between.length).toBeGreaterThanOrEqual(8);
    expect(result.rampLinear).toEqual([...result.rampLinear].sort((a, b) => a - b));
    // The last pixel of the red half takes green from the texel beyond it under linear only.
    expect(result.atlasNearestGreen).toBe(0);
    expect(result.atlasLinearGreen).toBeGreaterThan(0);
});

test("a sprite clip draws only the clip rectangle", async ({ page }) => {
    const result = await page.evaluate(() => window.engineGaps!.clip());
    expect(result).toEqual({ red: 16, inside: [], drawCalls: 1 });
});

test("batching still joins only consecutive quads of the same texture", async ({ page }) => {
    const result = await page.evaluate(() => window.engineGaps!.batching());
    expect(result).toEqual({ interleaved: 3, grouped: 2 });
});

test("submittedWorkDone settles after a frame, rejects when aborted and after disposal", async ({
    page,
}) => {
    const result = await page.evaluate(() => window.engineGaps!.submittedWork());
    expect(result).toEqual({
        afterFrame: "resolved",
        aborted: "rejected: AbortError",
        afterDispose: expect.stringMatching(/^rejected/),
    });
});

test("renderer creation has no time limit of its own while the adapter request hangs", async ({
    page,
}) => {
    const result = await page.evaluate(() => window.engineGaps!.hungCreate(2000, null));
    expect(result).toEqual({ outcome: "pending", error: "", requests: 1, ms: expect.any(Number) });
});

test("aborting renderer creation ends a hung adapter request", async ({ page }) => {
    const result = await page.evaluate(() => window.engineGaps!.hungCreate(2000, 50));
    expect(result).toEqual({
        outcome: "rejected",
        error: expect.stringMatching(/^AbortError/),
        requests: 1,
        ms: expect.any(Number),
    });
    expect(result.ms).toBeLessThan(1000);
});
