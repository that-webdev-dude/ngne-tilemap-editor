import { test as base } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Sample } from "./te-015-support";
import { WINDOW, expect, loadScene, pageCall } from "./te-015-support";
import { openEditor } from "./te-013-support";

// TE-015: tier switching (ENGINE §4), the pan across the threshold. The other tier test is in
// te-015-tiers.spec.ts.
//
// The pan submits a frame per sample without waiting for the GPU. Under SwiftShader (CI) that
// leaves about a minute of queued GPU work when the test ends, and until it has run no other
// page of the same Chrome gets a WebGPU adapter: the next test of the worker would stall at
// start-up. A worker-scoped option of this file's own gives it a worker, and so a Chrome, of
// its own, which closes once the test is through instead of serving later tests. Worker
// options can only be set for a whole file, hence the file of its own.
const test = base.extend<object, { ownBrowser: boolean }>({
    ownBrowser: [false, { scope: "worker", option: true }],
});
test.use({ ownBrowser: true });

const LIVE_LIMIT = 65_536;
const LIVE_RETURN = 58_982;
const MAP_WIDTH = 256 * 16;
const MAP_HEIGHT = 128 * 16;

test.use({ viewport: WINDOW });

const countAt = (page: Page, x: number, y: number, scale: number) =>
    pageCall<number>(page, "countAt", x, y, scale);

/** The value in `[low, high]` where `f`, increasing or decreasing, reaches `target`. */
async function bisect(
    low: number,
    high: number,
    target: number,
    f: (value: number) => Promise<number>,
): Promise<number> {
    const rising = (await f(high)) > (await f(low));
    for (let step = 0; step < 40; step += 1) {
        const middle = (low + high) / 2;
        const above = (await f(middle)) > target;
        if (above === rising) high = middle;
        else low = middle;
    }
    return (low + high) / 2;
}

/** Tier changes along the samples, each way. */
function changes(samples: Sample[], from = "live") {
    let tier = from;
    let up = 0;
    let down = 0;
    for (const sample of samples) {
        if (sample.tier !== tier) {
            if (sample.tier === "chunk") up += 1;
            else down += 1;
        }
        tier = sample.tier;
    }
    return { up, down };
}

/** How often the counts cross `level`. */
function crossings(samples: Sample[], level: number): number {
    let count = 0;
    for (let i = 1; i < samples.length; i += 1) {
        if (samples[i - 1]!.count > level !== samples[i]!.count > level) count += 1;
    }
    return count;
}

test("a pan back and forth across the threshold changes tier at most once each way", async ({
    page,
}) => {
    await openEditor(page);
    await loadScene(page, { scale: 0.25, originX: 37, originY: 23, background: 0x203040ff });
    const centreX = MAP_WIDTH / 2;
    const centreY = MAP_HEIGHT / 2;

    // A zoom at which the centred view counts 72,000 cells, and the view centre to the right
    // where it counts 50,000: the pan between them crosses both thresholds.
    const scale = await bisect(0.2, 2, 72_000, (s) => countAt(page, centreX, centreY, s));
    const far = await bisect(centreX, centreX + MAP_WIDTH, 50_000, (x) =>
        countAt(page, x, centreY, scale),
    );
    expect(await countAt(page, centreX, centreY, scale)).toBeGreaterThan(LIVE_LIMIT);
    expect(await countAt(page, far, centreY, scale)).toBeLessThan(LIVE_RETURN);

    // Back and forth: a step forward and part of one back, over and over, so the count crosses
    // each threshold several times.
    const steps = 160;
    const stride = (centreX - far) / steps;
    const path: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i += 1) {
        const jitter = (i % 2 === 0 ? -1.5 : 1.5) * stride;
        path.push({ x: far + i * stride + jitter, y: centreY });
    }
    const route = [...path, ...[...path].reverse()];

    const before = await page.evaluate(() => window.__ngneTest!.viewport!.stats.tierChanges);
    await pageCall(page, "sweep", [{ x: far, y: centreY }], scale);
    const samples = await pageCall<Sample[]>(page, "sweep", route, scale);
    const after = await page.evaluate(() => window.__ngneTest!.viewport!.stats.tierChanges);

    // The pan crossed both thresholds, the upper one back and forth.
    expect(Math.min(...samples.map((s) => s.count))).toBeLessThan(LIVE_RETURN);
    expect(Math.max(...samples.map((s) => s.count))).toBeGreaterThan(LIVE_LIMIT);
    expect(crossings(samples, LIVE_LIMIT)).toBeGreaterThanOrEqual(3);
    expect(crossings(samples, LIVE_RETURN)).toBeGreaterThanOrEqual(3);

    // The tier changed once each way, and only between the thresholds' sides.
    expect(changes(samples)).toEqual({ up: 1, down: 1 });
    expect(after - before).toBe(2);
    for (const [i, sample] of samples.entries()) {
        const previous = i === 0 ? "live" : samples[i - 1]!.tier;
        if (sample.tier === "chunk" && previous === "live") {
            expect(sample.count).toBeGreaterThan(LIVE_LIMIT);
        }
        if (sample.tier === "live" && previous === "chunk") {
            expect(sample.count).toBeLessThanOrEqual(LIVE_RETURN);
        }
    }
});
