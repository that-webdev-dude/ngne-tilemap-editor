import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type {} from "./harness/te-010-worker";

// TE-010: the background worker in Chrome (harness/te-010-worker.ts). Decoding a 4096 × 4096
// PNG through the worker keeps every main-thread task within 16 ms; a running task is
// cancelled; a crashed worker is replaced.
//
// Method of the 16 ms check: the browser's long-task observer reports only tasks over 50 ms,
// so the harness also runs a message loop on the main thread during the decode and records
// the longest gap between two of its steps, which bounds the longest task from above. A
// positive control (a deliberate 60 ms task) must show in both before the decode is measured.
// Both are performance assertions (SPEC §15): enforced locally, reported only under CI. The
// test runs @alone (playwright.config.ts): beside other tests' work the loop's steps come late.

const HARNESS = "/tests/e2e/harness/te-010-worker.html";
const TASK_BUDGET_MS = 16;
const CONTROL_MS = 60;
const ci = !!process.env.CI;

async function openHarness(page: Page): Promise<void> {
    await page.goto(HARNESS);
    await expect(page.locator("#ready")).toHaveText("ready");
}

test("decoding a 4096 × 4096 PNG in the worker keeps every main-thread task within 16 ms @alone", async ({
    page,
}) => {
    test.setTimeout(ci ? 300_000 : 120_000);
    await openHarness(page);
    const pngBytes = await page.evaluate(() => window.te010!.prepare());
    expect(pngBytes).toBeGreaterThan(0);

    const control = await page.evaluate((ms) => window.te010!.control(ms), CONTROL_MS);
    expect(control.maxGapMs).toBeGreaterThanOrEqual(CONTROL_MS);
    expect(control.longTasks.some((duration) => duration >= CONTROL_MS)).toBe(true);

    const decoded = await page.evaluate(() => window.te010!.decode());
    expect({
        width: decoded.width,
        height: decoded.height,
        mismatches: decoded.mismatches,
    }).toEqual({ width: 4096, height: 4096, mismatches: 0 });
    const report =
        `decode ${decoded.ms.toFixed(0)} ms, PNG ${pngBytes} bytes, longest main-thread gap ` +
        `${decoded.maxGapMs.toFixed(1)} ms, long tasks [${decoded.longTasks.join(", ")}]`;
    test.info().annotations.push({ type: "main thread", description: report });
    console.log(`TE-010 ${report}`);
    if (!ci) {
        expect(decoded.longTasks).toEqual([]);
        expect(decoded.maxGapMs).toBeLessThanOrEqual(TASK_BUDGET_MS);
    }
});

test("cancelling a running task stops it; the next request runs in a new worker", async ({
    page,
}) => {
    test.setTimeout(ci ? 300_000 : 120_000);
    await openHarness(page);
    await page.evaluate(() => window.te010!.prepare());
    const result = await page.evaluate(() => window.te010!.cancelRunning());
    expect(result).toEqual({ outcome: "cancelled", workersBefore: 1, workersAfter: 2 });
});

test("a crashed worker rejects its request and is replaced by the next one", async ({ page }) => {
    test.setTimeout(ci ? 300_000 : 120_000);
    await openHarness(page);
    const result = await page.evaluate(() => window.te010!.crash());
    expect(result).toMatchObject({ outcome: "crashed", queued: "3x2", workers: 2 });
    expect(result.message).toContain("TE-010 deliberate crash");
});
