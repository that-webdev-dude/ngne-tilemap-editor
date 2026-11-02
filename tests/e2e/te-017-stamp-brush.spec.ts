import { test } from "@playwright/test";
import { pointsOnLine } from "../../src/core/raster/line";
import { GOLDEN } from "./te-017-goldens";
import {
    LAYERS,
    cells,
    clickAt,
    drag,
    expect,
    history,
    moveTo,
    openEditor,
    pageCall,
    pressAt,
    rowOrder,
    redo,
    setStamp,
    statusMessage,
    undo,
} from "./te-017-support";

// TE-017: the stamp brush (SPEC §4.2, §4.3) with a stamp set from code, on the editor's own
// viewport, pointer pipeline and history.

test.beforeEach(async ({ page }) => {
    await openEditor(page, "stamp");
});

test("a drag paints the stamp at every crossed cell, one entry; undo and redo", async ({
    page,
}) => {
    await setStamp(page, 1, 1, [2]);
    await drag(page, [2, 3], [[20, 12]]);
    const line = pointsOnLine({ x: 2, y: 3 }, { x: 20, y: 12 }).map((p) => `${p.x},${p.y}:2`);
    expect(await cells(page)).toEqual(rowOrder(line));
    expect(await history(page)).toEqual({ undo: "Stamp Brush", redo: null });

    // One entry: one undo empties the layer and leaves nothing to undo.
    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: null, redo: "Stamp Brush" });
    expect(await redo(page)).toBe(true);
    expect(await cells(page)).toEqual(rowOrder(line));

    // Ctrl+Z and Ctrl+Y reach the same history.
    await page.keyboard.press("Control+z");
    expect(await cells(page)).toEqual([]);
    await page.keyboard.press("Control+y");
    expect(await cells(page)).toEqual(rowOrder(line));
});

test("the stamp's anchor is its centre cell, and later placements overwrite earlier", async ({
    page,
}) => {
    // 3 × 2: anchor (1, 1), so the click at (10, 10) covers (9..11, 9..10).
    await setStamp(page, 3, 2, [0, 1, 2, 3, 0, 1]);
    await clickAt(page, 10, 10);
    expect(await cells(page)).toEqual([
        "9,9:0",
        "10,9:1",
        "11,9:2",
        "9,10:3",
        "10,10:0",
        "11,10:1",
    ]);
});

test("along a drag, a later placement lies over an earlier one", async ({ page }) => {
    await setStamp(page, 3, 2, [0, 1, 2, 3, 0, 1]);
    // One cell right: the second stamp covers two thirds of the first.
    await drag(page, [20, 20], [[21, 20]]);
    expect(await cells(page)).toEqual([
        "19,19:0",
        "20,19:0",
        "21,19:1",
        "22,19:2",
        "19,20:3",
        "20,20:3",
        "21,20:0",
        "22,20:1",
    ]);
    expect(await history(page)).toEqual({ undo: "Stamp Brush", redo: null });
});

test("empty stamp cells keep the map", async ({ page }) => {
    await pageCall(page, "fill", LAYERS.ground, { x: 4, y: 4, width: 3, height: 3 }, 3);
    // A ring of tile 1 with an empty centre.
    await setStamp(page, 3, 3, [1, 1, 1, 1, null, 1, 1, 1, 1]);
    await clickAt(page, 5, 5);
    expect(await cells(page)).toEqual([
        "4,4:1",
        "5,4:1",
        "6,4:1",
        "4,5:1",
        "5,5:3",
        "6,5:1",
        "4,6:1",
        "5,6:1",
        "6,6:1",
    ]);
    // The entry holds the changed cells only: undo puts back the 3s, the centre untouched.
    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual([
        "4,4:3",
        "5,4:3",
        "6,4:3",
        "4,5:3",
        "5,5:3",
        "6,5:3",
        "4,6:3",
        "5,6:3",
        "6,6:3",
    ]);
});

test("Shift+click paints a line of stamps from the last painted point, as Tiled", async ({
    page,
}) => {
    await setStamp(page, 1, 1, [0]);
    await clickAt(page, 3, 4);
    await clickAt(page, 17, 9, ["Shift"]);
    await clickAt(page, 10, 20, ["Shift"]);
    expect(await cells(page)).toEqual(GOLDEN["line-1x1"]);
    // One entry per click: three undos empty the layer.
    for (let n = 0; n < 3; n++) expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: null, redo: "Stamp Brush" });
});

test("a line of a 2 × 2 stamp leaves out placements that meet earlier ones, as Tiled", async ({
    page,
}) => {
    await setStamp(page, 2, 2, [0, 1, 2, 3]);
    await clickAt(page, 4, 4);
    await clickAt(page, 12, 7, ["Shift"]);
    expect(await cells(page)).toEqual(GOLDEN["line-2x2"]);
});

test("Ctrl+Shift+click paints an ellipse centred on the last painted point, as Tiled", async ({
    page,
}) => {
    await setStamp(page, 1, 1, [0]);
    await clickAt(page, 20, 14);
    await clickAt(page, 27, 18, ["Control", "Shift"]);
    expect(await cells(page)).toEqual(GOLDEN["ellipse-1x1"]);
    expect(await history(page)).toEqual({ undo: "Stamp Brush", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual(["20,14:0"]);
});

test("a flat ellipse gets its tips, as Tiled", async ({ page }) => {
    await setStamp(page, 1, 1, [0]);
    await clickAt(page, 5, 15);
    await clickAt(page, 6, 22, ["Control", "Shift"]);
    expect(await cells(page)).toEqual(GOLDEN["ellipse-flat"]);
});

test("an ellipse of a stamp with holes, as Tiled", async ({ page }) => {
    await setStamp(page, 3, 2, [0, null, 1, null, 2, null]);
    await clickAt(page, 20, 15);
    await clickAt(page, 28, 20, ["Control", "Shift"]);
    expect(await cells(page)).toEqual(GOLDEN["ellipse-3x2"]);
});

test("the first Shift+click with nothing painted sets the line's start only", async ({ page }) => {
    await setStamp(page, 1, 1, [0]);
    await clickAt(page, 6, 6, ["Shift"]);
    expect(await cells(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: null, redo: null });
    await clickAt(page, 9, 6, ["Shift"]);
    expect(await cells(page)).toEqual(["6,6:0", "7,6:0", "8,6:0", "9,6:0"]);
});

test("Escape mid-drag restores the cells and makes no entry", async ({ page }) => {
    await setStamp(page, 1, 1, [0]);
    await pressAt(page, 5, 8);
    await moveTo(page, 12, 8);
    expect(await cells(page)).toHaveLength(8);
    await page.keyboard.press("Escape");
    expect(await cells(page)).toEqual([]);
    await page.mouse.up();
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("with no stamp the brush paints nothing and says so", async ({ page }) => {
    await clickAt(page, 5, 5);
    expect(await cells(page)).toEqual([]);
    await expect(statusMessage(page)).toHaveText("No stamp");
});

test("on a locked layer the brush refuses and changes nothing", async ({ page }) => {
    await setStamp(page, 1, 1, [0]);
    await pageCall(page, "setActiveLayer", LAYERS.locked);
    await clickAt(page, 5, 5);
    await expect(statusMessage(page)).toHaveText("Layer is locked");
    expect(await cells(page, LAYERS.locked)).toEqual([]);
});

test("the context bar reads the stamp size; the status bar the modifier hint", async ({ page }) => {
    const readout = page.locator('[data-tool-readout="size"] output');
    await expect(readout).toHaveText("—");
    await setStamp(page, 3, 2, [0, 1, 2, 3, 0, 1]);
    await expect(readout).toHaveText("3 × 2");
    await expect(statusMessage(page)).toHaveText("Shift: line · Ctrl+Shift: ellipse");
});

test("the rail's stamp preview shows the stamp; a click selects the stamp brush", async ({
    page,
}) => {
    await setStamp(page, 2, 1, [0, 2]);
    const preview = page.locator("[data-stamp-preview]");
    await expect(preview).toHaveAccessibleName(/2 × 1/);
    const box = await preview.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(28);
    expect(box!.height).toBeLessThanOrEqual(28);
    // The left half shows tile 0 (red), the right half tile 2 (blue).
    const sample = await preview.evaluate((button) => {
        const canvas = button.querySelector("canvas")!;
        const context = canvas.getContext("2d")!;
        const y = Math.floor(canvas.height / 2);
        const left = [...context.getImageData(Math.floor(canvas.width / 4), y, 1, 1).data];
        const right = [...context.getImageData(Math.floor((canvas.width * 3) / 4), y, 1, 1).data];
        return { left, right };
    });
    expect(sample.left).toEqual([0xd0, 0x40, 0x20, 255]);
    expect(sample.right).toEqual([0x20, 0x50, 0xd0, 255]);

    expect(await pageCall(page, "selectTool", "eraser")).toBe(true);
    await preview.click();
    await expect.poll(() => page.evaluate(() => window.__ngneTest!.tools!.active)).toBe("stamp");
});

test("B and E select the stamp brush and the eraser (DESIGN §10.3)", async ({ page }) => {
    const active = () => page.evaluate(() => window.__ngneTest!.tools!.active);
    // A click on the map focuses the viewport; with no stamp it paints nothing.
    await clickAt(page, 30, 25);
    await page.keyboard.press("e");
    await expect.poll(active).toBe("eraser");
    await page.keyboard.press("b");
    await expect.poll(active).toBe("stamp");
});

test("Shift released before the button: the press draws no shape, as Tiled", async ({ page }) => {
    await setStamp(page, 1, 1, [0]);
    await clickAt(page, 3, 3);
    // Shift held at the press: the line from (3, 3) to (6, 3).
    await page.keyboard.down("Shift");
    await pressAt(page, 6, 3);
    await page.keyboard.up("Shift");
    // Released without Shift: Tiled's brush is back to free, the release draws nothing.
    await moveTo(page, 6, 9);
    await page.mouse.up();
    expect(await cells(page)).toEqual(["3,3:0", "4,3:0", "5,3:0", "6,3:0"]);

    // Ctrl released with Shift still held: the press's ellipse becomes a line at the release.
    await page.keyboard.down("Shift");
    await page.keyboard.down("Control");
    await pressAt(page, 10, 10);
    await page.keyboard.up("Control");
    await moveTo(page, 14, 10);
    await page.mouse.up();
    await page.keyboard.up("Shift");
    // The press drew the ellipse around (6, 3) through (10, 10), x 2..10; the release adds the
    // line from (10, 10) to (14, 10), whose cells right of x 10 only the line paints.
    const row = (await cells(page)).filter((cell) => cell.endsWith(",10:0"));
    expect(row.filter((cell) => Number(cell.split(",")[0]) > 10)).toEqual([
        "11,10:0",
        "12,10:0",
        "13,10:0",
        "14,10:0",
    ]);
});

test("another project forgets the last painted point", async ({ page }) => {
    await setStamp(page, 1, 1, [0]);
    await clickAt(page, 3, 3);
    // The same project again: its map has the same id.
    await pageCall(page, "reopen");
    await setStamp(page, 1, 1, [0]);
    await clickAt(page, 9, 3, ["Shift"]);
    expect(await cells(page)).toEqual([]);
});
