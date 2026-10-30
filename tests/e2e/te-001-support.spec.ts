import { expect, test } from "@playwright/test";
import type {} from "./harness/te-001-support";
import { afterFrames, framesSubmitted, stableSize } from "./support/wait";

// The shared wait helpers against a page whose state they must wait for.

test.beforeEach(async ({ page }) => {
    await page.goto("/tests/e2e/harness/te-001-support.html");
    await page.waitForFunction(() => window.te001 !== undefined);
});

test("stableSize waits until the element stops growing", async ({ page }) => {
    await page.evaluate(() => window.te001.grow());
    expect(await stableSize(page.locator("#growing"))).toEqual({ width: 100, height: 60 });
});

test("framesSubmitted waits for that many more frames", async ({ page }) => {
    const counter = () => window.te001.frames;
    // 10 frames first, so that "12 more" differs from "12 in total".
    await page.evaluate(() => window.te001.submit(10));
    await page.waitForFunction(() => window.te001.frames === 10);
    // The wait starts from 10 (or a frame or two more, if the loop starts first) and ends at
    // 12 more, well before the loop's 40.
    const waiting = framesSubmitted(page, counter, 12);
    await page.evaluate(() => window.te001.submit(30));
    expect(await waiting).toBeGreaterThanOrEqual(22);
    await afterFrames(page, 40);
    expect(await page.evaluate(counter)).toBe(40);
});
