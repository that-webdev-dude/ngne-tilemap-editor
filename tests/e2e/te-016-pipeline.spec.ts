import { test } from "@playwright/test";
import { pointsOnLine } from "../../src/core/raster/line";
import {
    LAYERS,
    expect,
    moveTo,
    openEditor,
    pageCall,
    painted,
    pressAt,
    statusMessage,
} from "./te-016-support";

// TE-016: the cell pointer pipeline (SPEC §3, §4.1) with a probe tool that paints one value at
// every cell its pointer samples carry, on the editor's own viewport and stores.

test.beforeEach(async ({ page }) => {
    await openEditor(page);
    expect(await pageCall(page, "selectTool", "probe")).toBe(true);
});

const canUndo = (page: Parameters<typeof painted>[0]) => pageCall<boolean>(page, "canUndo");

/** The cells of `pointsOnLine` from `a` to `b`, as the page module lists them: row by row. */
function lineCells(a: [number, number], b: [number, number]): string[] {
    return pointsOnLine({ x: a[0], y: a[1] }, { x: b[0], y: b[1] })
        .sort((p, q) => p.y - q.y || p.x - q.x)
        .map((p) => `${p.x},${p.y}`);
}

test("a fast drag changes every crossed cell, as one history entry", async ({ page }) => {
    await pressAt(page, 2, 3);
    // One pointer event 28 cells away: the pipeline joins the cells between.
    await moveTo(page, 30, 17);
    await page.mouse.up();
    expect(await painted(page)).toEqual(lineCells([2, 3], [30, 17]));
    expect(await canUndo(page)).toBe(true);
    await page.keyboard.press("Control+z");
    expect(await painted(page)).toEqual([]);
});

test("Escape mid-drag restores the cells", async ({ page }) => {
    await pressAt(page, 5, 5);
    await moveTo(page, 12, 5);
    expect(await painted(page)).toHaveLength(8);
    await page.keyboard.press("Escape");
    expect(await painted(page)).toEqual([]);
    // The rest of the drag paints nothing: the stroke has ended.
    await moveTo(page, 14, 9);
    await page.mouse.up();
    expect(await painted(page)).toEqual([]);
    expect(await canUndo(page)).toBe(false);
});

test("a right click during a drag restores the cells", async ({ page }) => {
    await pressAt(page, 5, 5);
    await moveTo(page, 9, 7);
    expect((await painted(page)).length).toBeGreaterThan(0);
    await page.mouse.down({ button: "right" });
    expect(await painted(page)).toEqual([]);
    await page.mouse.up({ button: "right" });
    await page.mouse.up();
    expect(await painted(page)).toEqual([]);
    expect(await canUndo(page)).toBe(false);
});

test('a locked layer refuses with "Layer is locked" and no change', async ({ page }) => {
    await pageCall(page, "setLayer", LAYERS.tile, { locked: true });
    await pressAt(page, 5, 5);
    await moveTo(page, 9, 5);
    await page.mouse.up();
    await expect(statusMessage(page)).toHaveText("Layer is locked");
    expect(await painted(page)).toEqual([]);
    expect(await canUndo(page)).toBe(false);

    // A tile layer under a locked group refuses the same way.
    await pageCall(page, "setLayer", LAYERS.tile, { locked: false });
    await pageCall(page, "setLayer", LAYERS.group, { locked: true });
    await pageCall(page, "setActiveLayer", LAYERS.grouped);
    await pressAt(page, 5, 5);
    await page.mouse.up();
    await expect(statusMessage(page)).toHaveText("Layer is locked");
    expect(await painted(page, LAYERS.grouped)).toEqual([]);
});

test("painting outside the map changes nothing", async ({ page }) => {
    // Zoomed out, the map leaves room around it in the viewport.
    await pageCall(page, "zoom", 0.5);
    await pressAt(page, -6, 4);
    // Down the left of the map, then along below it: no line between samples enters it.
    await moveTo(page, -2, 26);
    await moveTo(page, -3, 32);
    await moveTo(page, 35, 33);
    await page.mouse.up();
    expect(await painted(page)).toEqual([]);
    expect(await canUndo(page)).toBe(false);

    // A drag across the edge paints the cells inside only.
    await pressAt(page, -4, 2);
    await moveTo(page, 3, 2);
    await page.mouse.up();
    expect(await painted(page)).toEqual(["0,2", "1,2", "2,2", "3,2"]);
});
