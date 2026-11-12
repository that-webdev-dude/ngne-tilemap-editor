import { test } from "@playwright/test";
import type { Sample } from "./te-015-support";
import { WINDOW, expect, loadScene, pageCall } from "./te-015-support";
import { openEditor } from "./te-013-support";

// TE-015: tier switching (ENGINE §4). The chunk tier draws above 65,536 visible cells once it is
// built; the live tier comes back at 58,982 or below, so a pan back and forth across the
// threshold changes tier at most once each way. That pan is in te-015-tiers-pan.spec.ts, in a
// Chrome of its own.

const LIVE_LIMIT = 65_536;

test.use({ viewport: WINDOW });

test("the live tier draws while the chunk tier is still building", async ({ page }) => {
    await openEditor(page);
    await loadScene(page, { scale: 0.25, originX: 37, originY: 23, background: 0x203040ff });
    // The whole map in view: above the limit, so the chunk tier draws once built.
    const [built] = await pageCall<Sample[]>(page, "sweep", [{ x: 2048, y: 1024 }], 0.25);
    expect(built).toMatchObject({ tier: "chunk" });
    expect(built!.count).toBeGreaterThan(LIVE_LIMIT);

    // A layer's opacity changes: its set is composited again, and until then the live tier
    // draws, beyond its budget.
    await page.evaluate(() => {
        const state = window.__ngneTest!.session.getState();
        state.session.project.maps[0]!.layers[1]!.opacity = 200;
        state.touch();
    });
    const [rebuilding] = await pageCall<Sample[]>(page, "sweep", [{ x: 2048, y: 1024 }], 0.25);
    expect(rebuilding).toMatchObject({ tier: "live" });
    await page.waitForFunction(() => window.__ngneTest!.viewport!.chunkStats().ready);
    const [rebuilt] = await pageCall<Sample[]>(page, "sweep", [{ x: 2048, y: 1024 }], 0.25);
    expect(rebuilt).toMatchObject({ tier: "chunk" });
});
