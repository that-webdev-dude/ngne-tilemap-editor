import { test } from "@playwright/test";
import {
    activeTool,
    clickAt,
    drag,
    expect,
    expectOneEntry,
    history,
    holding,
    markers,
    moveTo,
    openEditor,
    pageCall,
    selection,
    undo,
} from "./te-038-support";
import { overlayIdle } from "./te-014-support";

// TE-038: the marker create tools (SPEC §8, DESIGN §6, §7, §10.3), Tiled's object tools for
// rectangles, ellipses, points, polygons and polylines. The map's cells are 16 px; Snap to Grid
// is on, so positions land on multiples of 16 (Ctrl or the context bar's Snap off: whole pixels).
// Each marker is one history entry ("Add Marker") and becomes the selection. Polygons and
// polylines take a point per click; Enter finishes, Escape cancels, Backspace removes the last
// point.

test("Rectangle (U): a drag makes a snapped rectangle, one entry, selected", async ({ page }) => {
    await openEditor(page, "markerSelect");
    await page.locator("[data-viewport]").focus();
    await page.keyboard.press("U");
    expect(await activeTool(page)).toBe("markerRectangle");
    await drag(page, [37, 21], [60, 40], [90, 60]);
    const rect = { id: 1, shape: "rectangle", x: 32, y: 16, width: 64, height: 48 };
    expect(await selection(page)).toEqual([1]);
    await expectOneEntry(page, "Add Marker", [], [rect]);

    // Ctrl inverts snapping: whole pixels.
    await holding(page, ["Control"], () => drag(page, [37, 121], [90, 160]));
    expect((await markers(page))[1]).toEqual({
        id: 2,
        shape: "rectangle",
        x: 37,
        y: 121,
        width: 53,
        height: 39,
    });
    // Shift: a square with the longer side, towards the pointer.
    await holding(page, ["Shift"], () => drag(page, [160, 160], [200, 130]));
    expect((await markers(page))[2]).toEqual({
        id: 3,
        shape: "rectangle",
        x: 160,
        y: 112,
        width: 48,
        height: 48,
    });
});

test("Ellipse (Shift+U) and Point (P); the context bar's Snap turns snapping off", async ({
    page,
}) => {
    await openEditor(page, "markerSelect");
    await page.locator("[data-viewport]").focus();
    await page.keyboard.press("Shift+U");
    expect(await activeTool(page)).toBe("markerEllipse");
    await drag(page, [40, 40], [100, 80]);
    const ellipse = { id: 1, shape: "ellipse", x: 48, y: 48, width: 48, height: 32 };
    await expectOneEntry(page, "Add Marker", [], [ellipse]);

    await page.keyboard.press("P");
    expect(await activeTool(page)).toBe("markerPoint");
    await clickAt(page, [70, 140]);
    const point = { id: 2, shape: "point", x: 64, y: 144 };
    expect(await selection(page)).toEqual([2]);
    await expectOneEntry(page, "Add Marker", [ellipse], [ellipse, point]);

    const snap = page.locator("[data-marker-snap]");
    await expect(snap).toHaveAttribute("aria-pressed", "true");
    await snap.click();
    expect(await pageCall(page, "snap")).toBe(false);
    await clickAt(page, [70.6, 140.2]);
    expect((await markers(page))[2]).toEqual({ id: 3, shape: "point", x: 71, y: 140 });
    // Ctrl inverts it again: snapped.
    await holding(page, ["Control"], () => clickAt(page, [70, 140]));
    expect((await markers(page))[3]).toEqual({ id: 4, shape: "point", x: 64, y: 144 });
});

test("Polygon (Shift+D): clicks add points, Enter finishes; one entry", async ({ page }) => {
    await openEditor(page, "markerPolygon");
    await clickAt(page, [20, 20]);
    await clickAt(page, [100, 20]);
    await clickAt(page, [60, 90]);
    expect(await markers(page)).toEqual([]);
    await page.keyboard.press("Enter");
    const polygon = {
        id: 1,
        shape: "polygon",
        x: 16,
        y: 16,
        points: [
            [0, 0],
            [80, 0],
            [48, 80],
        ],
    };
    expect(await selection(page)).toEqual([1]);
    await expectOneEntry(page, "Add Marker", [], [polygon]);

    // A click on the first point (208, 16) closes a polygon of three points or more.
    await clickAt(page, [200, 20]);
    await clickAt(page, [260, 20]);
    await clickAt(page, [230, 80]);
    await clickAt(page, [208, 16]);
    expect((await markers(page))[1]).toMatchObject({ id: 2, shape: "polygon", x: 208, y: 16 });
    expect(await history(page)).toEqual({ undo: "Add Marker", redo: null });
});

test("Backspace removes the last point; with none left the polygon is cancelled", async ({
    page,
}) => {
    await openEditor(page, "markerPolygon");
    await clickAt(page, [16, 16]);
    await clickAt(page, [96, 16]);
    await clickAt(page, [200, 200]);
    await page.keyboard.press("Backspace");
    await clickAt(page, [48, 96]);
    await page.keyboard.press("Enter");
    expect(await markers(page)).toEqual([
        {
            id: 1,
            shape: "polygon",
            x: 16,
            y: 16,
            points: [
                [0, 0],
                [80, 0],
                [32, 80],
            ],
        },
    ]);
    expect(await undo(page)).toBe(true);

    await clickAt(page, [16, 16]);
    await clickAt(page, [96, 16]);
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    expect(await markers(page)).toEqual([]);
    // The gesture is gone: Enter makes nothing, and the next click starts a new polygon.
    await page.keyboard.press("Enter");
    expect(await markers(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: null, redo: "Add Marker" });
});

test("Escape cancels a polygon or a drag; too few points make nothing", async ({ page }) => {
    await openEditor(page, "markerPolygon");
    await clickAt(page, [16, 16]);
    await clickAt(page, [96, 16]);
    await moveTo(page, [96, 96]);
    await page.keyboard.press("Escape");
    expect(await markers(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: null, redo: null });

    // Two points do not make a polygon.
    await clickAt(page, [16, 16]);
    await clickAt(page, [96, 16]);
    await page.keyboard.press("Enter");
    expect(await markers(page)).toEqual([]);
    await expect(page.locator('[data-status="message"]')).toHaveText(
        "A polygon has at least 3 points",
    );

    // Escape during a rectangle's drag.
    await pageCall(page, "selectTool", "markerRectangle");
    await moveTo(page, [16, 16]);
    await page.mouse.down();
    await moveTo(page, [96, 96]);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await markers(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("Polyline (L): Enter or a double click finishes", async ({ page }) => {
    await openEditor(page, "markerSelect");
    await page.locator("[data-viewport]").focus();
    await page.keyboard.press("L");
    expect(await activeTool(page)).toBe("markerPolyline");
    await clickAt(page, [16, 16]);
    await clickAt(page, [80, 48]);
    await page.keyboard.press("Enter");
    const line = {
        id: 1,
        shape: "polyline",
        x: 16,
        y: 16,
        points: [
            [0, 0],
            [64, 32],
        ],
    };
    await expectOneEntry(page, "Add Marker", [], [line]);

    await clickAt(page, [160, 160]);
    await clickAt(page, [192, 160]);
    const at = await pageCall<{ x: number; y: number }>(page, "mapClient", 192, 208);
    await page.mouse.dblclick(at.x, at.y);
    expect((await markers(page))[1]).toEqual({
        id: 2,
        shape: "polyline",
        x: 160,
        y: 160,
        points: [
            [0, 0],
            [32, 0],
            [32, 48],
        ],
    });
    expect(await history(page)).toEqual({ undo: "Add Marker", redo: null });
});

test("a create tool refuses a locked or hidden marker layer", async ({ page }) => {
    await openEditor(page, "markerRectangle");
    await pageCall(page, "setLayerFlag", 2, "locked", true);
    await drag(page, [16, 16], [96, 96]);
    expect(await markers(page)).toEqual([]);
    await expect(page.locator('[data-status="message"]')).toHaveText("Layer is locked");
    await pageCall(page, "setLayerFlag", 2, "locked", false);
    await pageCall(page, "setLayerFlag", 2, "visible", false);
    await drag(page, [16, 16], [96, 96]);
    expect(await markers(page)).toEqual([]);
    await expect(page.locator('[data-status="message"]')).toHaveText("Layer is hidden");
});

test("a click near the first point closes a polygon; it is never added twice", async ({ page }) => {
    await openEditor(page, "markerPolygon");
    await clickAt(page, [200, 20]);
    await clickAt(page, [260, 20]);
    await clickAt(page, [230, 80]);
    // Snapped to the first point (208, 16), 4 map pixels from the pointer.
    await clickAt(page, [204, 18]);
    expect(await markers(page)).toEqual([
        {
            id: 1,
            shape: "polygon",
            x: 208,
            y: 16,
            points: [
                [0, 0],
                [48, 0],
                [16, 64],
            ],
        },
    ]);

    // With two points, a click on the first adds nothing.
    await clickAt(page, [16, 16]);
    await clickAt(page, [96, 16]);
    await clickAt(page, [16, 16]);
    await clickAt(page, [48, 96]);
    // A right click finishes.
    await clickAt(page, [150, 150], "right");
    expect((await markers(page))[1]).toEqual({
        id: 2,
        shape: "polygon",
        x: 16,
        y: 16,
        points: [
            [0, 0],
            [80, 0],
            [32, 80],
        ],
    });
});

test("points land under the pointer on a parallax layer after the view pans", async ({ page }) => {
    await openEditor(page, "markerPolyline");
    await pageCall(page, "setParallax", 2, 0.5);
    await clickAt(page, [100, 76]);
    await pageCall(page, "setCentre", 200, 120);
    await overlayIdle(page);
    await clickAt(page, [296, 76]);
    await page.keyboard.press("Enter");
    // The layer is drawn 60 px lower, and 80 px right at centre 160, 100 px at centre 200:
    // local (20, 16) → (16, 16), then (196, 16) → (192, 16).
    expect(await markers(page)).toEqual([
        {
            id: 1,
            shape: "polyline",
            x: 16,
            y: 16,
            points: [
                [0, 0],
                [176, 0],
            ],
        },
    ]);
});
