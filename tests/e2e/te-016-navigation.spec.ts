import { test } from "@playwright/test";
import { zoomStep } from "../../src/app/view/zoom";
import { activeTool, cellClient, expect, openEditor, pageCall, view } from "./te-016-support";

// TE-016: the Hand and Zoom tools (SPEC §4.3) and their keys H and Z (DESIGN §10.3).

test.beforeEach(async ({ page }) => {
    await openEditor(page);
    // The viewport has the focus, as after any press on it: the keys act in `canvas`.
    await page.locator("[data-viewport]").focus();
});

test("H and Z select the Hand and the Zoom tool", async ({ page }) => {
    await page.keyboard.press("h");
    expect(await activeTool(page)).toBe("hand");
    await page.keyboard.press("z");
    expect(await activeTool(page)).toBe("zoom");
    await page.keyboard.press("h");
    expect(await activeTool(page)).toBe("hand");
});

test("a Hand drag pans the view", async ({ page }) => {
    await page.keyboard.press("h");
    const before = await view(page);
    const at = await cellClient(page, 20, 15);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 30, at.y + 20, { steps: 4 });
    await page.mouse.move(at.x + 60, at.y + 40, { steps: 4 });
    await page.mouse.up();
    const after = await view(page);
    const ratio = await page.evaluate(() => devicePixelRatio);
    // The map follows the pointer: its centre moved the drag's distance in map pixels.
    const scale = before.zoom * ratio;
    expect(after.zoom).toBe(before.zoom);
    expect(after.centreX).toBeCloseTo(before.centreX - Math.round(60 * ratio) / scale, 6);
    expect(after.centreY).toBeCloseTo(before.centreY - Math.round(40 * ratio) / scale, 6);
});

test("a Zoom click zooms in, an Alt-click out", async ({ page }) => {
    await page.keyboard.press("z");
    const ratio = await page.evaluate(() => devicePixelRatio);
    const before = await view(page);
    const scale = before.zoom * ratio;
    const at = await cellClient(page, 24, 12);
    await page.mouse.click(at.x, at.y);
    const zoomedIn = await view(page);
    expect(zoomedIn.zoom * ratio).toBe(zoomStep(scale, 1));
    // The cell under the pointer stays under it.
    const still = await cellClient(page, 24, 12);
    expect(still.x).toBeCloseTo(at.x, 0);
    expect(still.y).toBeCloseTo(at.y, 0);

    await page.keyboard.down("Alt");
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up("Alt");
    const zoomedOut = await view(page);
    expect(zoomedOut.zoom * ratio).toBe(zoomStep(zoomStep(scale, 1), -1));
    expect(await pageCall(page, "canUndo")).toBe(false);
});
