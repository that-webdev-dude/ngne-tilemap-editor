import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Comparison, Geometry } from "./te-015-support";
import { chunkStats, chunksReady, compare, expect, loadScene, pageCall } from "./te-015-support";
import type { PaintResult } from "./harness/te-015-page";
import { openEditor } from "./te-013-support";

// TE-015: painting at overview (ENGINE §4) and the failure handling of ENGINE §3. A cell changed
// by a command is drawn as live quads in the next submitted frame, over its chunk, until the
// chunk's patch settles; then the chunk shows it. A rejected update is recovered by compositing
// again from the document. Each check compares the whole canvas with the chunk reference of the
// document as it is (harness/te-015-page.ts); where live quads draw over a chunk, with the live
// tier's reference of TE-013. The scale is 0.375 device pixels per map pixel: at 0.25 the centre
// of every device pixel lies on an edge between two map pixels, where a live quad's sampling is
// undefined and every pixel of a patch would be left out.

const TOLERANCE = 2;
const SCALE = 0.375;

// The whole map fits the viewport at this scale.
test.use({ viewport: { width: 1920, height: 1080 } });

async function open(page: Page): Promise<Geometry> {
    await openEditor(page);
    const geometry = await loadScene(page, {
        scale: SCALE,
        originX: 37,
        originY: 23,
        background: 0x203040ff,
    });
    const settled = await compare(page, geometry, TOLERANCE);
    expect(settled.tier).toBe("chunk");
    expect(settled.mismatches).toBe(0);
    return geometry;
}

/** A value for cell `(x, y)` other than the one it holds: an opaque-edged tile of tileset 1. */
async function newValue(page: Page, x: number, y: number): Promise<number> {
    const current = await pageCall<number>(page, "cellAt", x, y);
    for (const orientation of [5, 2, 0]) {
        const value = await pageCall<number>(page, "tileValue", 1, 3, orientation);
        if (value !== current) return value;
    }
    throw new Error("no other value");
}

async function paint(page: Page, geometry: Geometry, x: number, y: number) {
    const value = await newValue(page, x, y);
    return pageCall<PaintResult>(page, "paintAndCompare", x, y, value, geometry, TOLERANCE);
}

test("a cell changed by a command at overview shows in the next frame and in the chunk after the patch", async ({
    page,
}) => {
    const geometry = await open(page);

    // The next submitted frame shows the change: it equals the changed document, with the
    // patch still pending and the cell drawn as live quads over its chunk.
    const next = await paint(page, geometry, 100, 60);
    expect(next.live).toBe(1);
    expect(next.pending).toBeGreaterThanOrEqual(1);
    expect(next.comparison.patched).toBeGreaterThan(0);
    expect(next.changed).toBeGreaterThan(0);
    expect(next.comparison.tier).toBe("chunk");
    expect(next.comparison.tileQuads).toBeGreaterThan(0);
    expect(next.comparison.first).toEqual([]);
    expect(next.comparison.mismatches).toBe(0);

    // Once the patch settles the live quads are gone and the chunk shows the change.
    await chunksReady(page);
    const settled = await compare(page, geometry, TOLERANCE);
    expect(settled.live).toBe(0);
    expect(settled.tileQuads).toBe(0);
    expect(settled.first).toEqual([]);
    expect(settled.mismatches).toBe(0);
});

test("undo at overview shows the old cell in the next frame and in the chunk", async ({ page }) => {
    const geometry = await open(page);
    await paint(page, geometry, 40, 90);
    await chunksReady(page);
    const next = await pageCall<Comparison>(page, "undoAndCompare", geometry, TOLERANCE);
    expect(next.live).toBe(1);
    expect(next.patched).toBeGreaterThan(0);
    expect(next.first).toEqual([]);
    expect(next.mismatches).toBe(0);
    await chunksReady(page);
    const settled = await compare(page, geometry, TOLERANCE);
    expect(settled.live).toBe(0);
    expect(settled.mismatches).toBe(0);
});

test("the comparison sees a chunk that was not patched (control)", async ({ page }) => {
    const geometry = await open(page);
    const value = await newValue(page, 100, 60);
    await pageCall(page, "changeSilently", 100, 60, value);
    const stale = await compare(page, geometry, TOLERANCE);
    expect(stale.mismatches).toBeGreaterThan(5);
});

for (const drop of [false, true]) {
    const how = drop ? "dropping its registration" : "keeping the texture's image";
    test(`a rejected chunk update (${how}) is recovered by compositing again; no stale pixels`, async ({
        page,
    }) => {
        const geometry = await open(page);
        const before = await chunkStats(page);
        const id = "ed:chunk:1:3:1";

        // The update of the painted cell's chunk is rejected twice; the third one goes through.
        const rejections = drop ? 1 : 2;
        await page.evaluate(
            ([count, dropped]) =>
                window.__ngneTest!.viewport!.rejectChunkUpdates(
                    count as number,
                    dropped as boolean,
                ),
            [rejections, drop],
        );
        const next = await paint(page, geometry, 100, 60);
        expect(next.comparison.mismatches).toBe(0);

        // While it is retried the frame still equals the document.
        await page.waitForFunction(
            (count) => window.__ngneTest!.viewport!.chunkStats().rejected >= count,
            before.rejected + rejections,
        );
        const retrying = await compare(page, geometry, TOLERANCE);
        expect(retrying.first).toEqual([]);
        expect(retrying.mismatches).toBe(0);

        await chunksReady(page);
        const after = await chunkStats(page);
        expect(after.rejected).toBe(before.rejected + rejections);
        expect(after.live).toBe(0);
        const ids = await page.evaluate(() => window.__ngneTest!.viewport!.textureIds());
        expect(ids).toContain(id);
        const settled = await compare(page, geometry, TOLERANCE);
        expect(settled.tileQuads).toBe(0);
        expect(settled.first).toEqual([]);
        expect(settled.mismatches).toBe(0);
    });
}
