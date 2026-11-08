import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
    clickAt,
    drag,
    expect,
    expectOneEntry,
    history,
    holding,
    markers,
    openEditor,
    pageCall,
    redo,
    selection,
    undo,
} from "./te-038-support";
import type { MarkerGeometry, Pt } from "./te-038-support";

// TE-038: the marker select tool (SPEC §8, DESIGN §6, §7), Tiled's `ObjectSelectionTool`: click,
// Shift-click and a rubber band select; a drag moves the selection, its least position snapped to
// the 16 px grid (Ctrl inverts); the 8 handles of a lone rectangle or ellipse resize it, the
// handle snapped (Alt inverts), Ctrl keeping the aspect; the context bar's X, Y, W, H edit the
// selection's box; Delete removes. Selecting makes no history entry; every edit is one.
//
// The markers (map pixels): 1 rectangle (32, 32) 32 × 32, 2 rectangle (128, 32) 32 × 16,
// 3 ellipse (32, 128) 48 × 32, 4 point (200, 160).

const A = { id: 1, shape: "rectangle", x: 32, y: 32, width: 32, height: 32 };
const B = { id: 2, shape: "rectangle", x: 128, y: 32, width: 32, height: 16 };
const C = { id: 3, shape: "ellipse", x: 32, y: 128, width: 48, height: 32 };
const D = { id: 4, shape: "point", x: 200, y: 160 };
const ALL = [A, B, C, D];

const IN_A: Pt = [48, 48];
const IN_B: Pt = [144, 40];
const IN_C: Pt = [56, 144];
const EMPTY: Pt = [280, 200];

const replaced = (index: number, marker: MarkerGeometry) =>
    ALL.map((each, k) => (k === index ? marker : each));

const field = (page: Page, key: string) => page.locator(`[data-marker-field="${key}"] input`);

async function setField(page: Page, key: string, value: number): Promise<void> {
    const input = field(page, key);
    await input.fill(String(value));
    await input.press("Enter");
}

test.beforeEach(async ({ page }) => {
    await openEditor(page, "markerSelect", true);
});

test("click, Shift-click and a rubber band select; no history entry", async ({ page }) => {
    await clickAt(page, IN_A);
    expect(await selection(page)).toEqual([1]);
    expect(await pageCall(page, "markersContext")).toBe(true);
    await holding(page, ["Shift"], () => clickAt(page, IN_B));
    expect(await selection(page)).toEqual([1, 2]);
    // Shift-click on a selected marker takes it out (Tiled).
    await holding(page, ["Shift"], () => clickAt(page, IN_A));
    expect(await selection(page)).toEqual([2]);
    // A point is hit by its pin, above its position.
    await clickAt(page, [200, 154]);
    expect(await selection(page)).toEqual([4]);
    await clickAt(page, EMPTY);
    expect(await selection(page)).toEqual([]);
    expect(await pageCall(page, "markersContext")).toBe(false);

    // A band selects what it touches; with Shift it adds; with Alt only what it encloses.
    await drag(page, [20, 20], [100, 40], [136, 36]);
    expect(await selection(page)).toEqual([1, 2]);
    await holding(page, ["Shift"], () => drag(page, [20, 140], [40, 150]));
    expect(await selection(page)).toEqual([1, 2, 3]);
    await holding(page, ["Alt"], () => drag(page, [20, 20], [140, 70]));
    expect(await selection(page)).toEqual([1]);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("a drag moves the selection, snapped; Ctrl moves it by whole pixels", async ({ page }) => {
    await clickAt(page, IN_A);
    // By (27, 12): the position (59, 44) snaps to (64, 48).
    await drag(page, IN_A, [60, 54], [75, 60]);
    await expectOneEntry(page, "Move Marker", ALL, replaced(0, { ...A, x: 64, y: 48 }));
    expect(await undo(page)).toBe(true);

    await holding(page, ["Control"], () => drag(page, IN_A, [60, 54], [75, 60]));
    expect(await markers(page)).toEqual(replaced(0, { ...A, x: 59, y: 44 }));
    expect(await undo(page)).toBe(true);

    // Two selected markers move together, one entry.
    await holding(page, ["Shift"], () => clickAt(page, IN_B));
    expect(await selection(page)).toEqual([1, 2]);
    await drag(page, IN_B, [150, 60], [160, 72]);
    await expectOneEntry(page, "Move Markers", ALL, [
        { ...A, x: 48, y: 64 },
        { ...B, x: 144, y: 64 },
        C,
        D,
    ]);

    // Dragging a marker that is not selected selects it alone and moves it alone.
    await drag(page, IN_C, [70, 150], [90, 160]);
    expect(await selection(page)).toEqual([3]);
    expect((await markers(page))[2]).toEqual({ ...C, x: 64, y: 144 });
    expect(await history(page)).toEqual({ undo: "Move Marker", redo: null });
});

test("handles resize a rectangle; Ctrl keeps the aspect, Alt does not snap", async ({ page }) => {
    await clickAt(page, IN_A);
    // The south-east corner from (64, 64) to (90, 85): snapped to (96, 80).
    await drag(page, [64, 64], [80, 75], [90, 85]);
    await expectOneEntry(page, "Resize Marker", ALL, replaced(0, { ...A, width: 64, height: 48 }));
    expect(await undo(page)).toBe(true);

    // Ctrl: (96, 64) scales the width by 2, so the height follows.
    await holding(page, ["Control"], () => drag(page, [64, 64], [80, 68], [100, 70]));
    expect(await markers(page)).toEqual(replaced(0, { ...A, width: 64, height: 64 }));
    expect(await undo(page)).toBe(true);

    // Alt: whole pixels.
    await holding(page, ["Alt"], () => drag(page, [64, 64], [80, 75], [90, 85]));
    expect(await markers(page)).toEqual(replaced(0, { ...A, width: 58, height: 53 }));
    expect(await undo(page)).toBe(true);

    // Alt and Ctrl: whole pixels, the aspect kept.
    await holding(page, ["Alt", "Control"], () => drag(page, [64, 64], [80, 68], [90, 70]));
    expect(await markers(page)).toEqual(replaced(0, { ...A, width: 58, height: 58 }));
    expect(await undo(page)).toBe(true);

    // The north side's middle moves the top only.
    await drag(page, [48, 32], [48, 20], [48, 10]);
    expect(await markers(page)).toEqual(replaced(0, { ...A, y: 16, height: 48 }));
    expect(await history(page)).toEqual({ undo: "Resize Marker", redo: null });

    // An ellipse has handles too.
    await clickAt(page, IN_C);
    await drag(page, [80, 160], [90, 170], [96, 176]);
    expect((await markers(page))[2]).toEqual({ ...C, width: 64, height: 48 });
});

test("the context bar's X, Y, W and H edit the selection's box", async ({ page }) => {
    await expect(field(page, "x")).toBeDisabled();
    await clickAt(page, IN_A);
    await expect(field(page, "x")).toHaveValue("32");
    await expect(field(page, "width")).toHaveValue("32");

    await setField(page, "x", 100);
    await expectOneEntry(page, "Move Marker", ALL, replaced(0, { ...A, x: 100 }));
    await setField(page, "height", 50);
    expect(await markers(page)).toEqual(replaced(0, { ...A, x: 100, height: 50 }));
    expect(await history(page)).toEqual({ undo: "Resize Marker", redo: null });
    await expect(field(page, "height")).toHaveValue("50");
    expect(await undo(page)).toBe(true);
    expect(await undo(page)).toBe(true);
    expect(await markers(page)).toEqual(ALL);

    // Several markers: X and Y move them all; W and H are disabled.
    await holding(page, ["Shift"], () => clickAt(page, IN_B));
    await expect(field(page, "width")).toBeDisabled();
    await expect(field(page, "x")).toHaveValue("32");
    await setField(page, "y", 40);
    await expectOneEntry(page, "Move Markers", ALL, [{ ...A, y: 40 }, { ...B, y: 40 }, C, D]);
});

test("Delete removes the selected markers; undo puts them and the selection back", async ({
    page,
}) => {
    await clickAt(page, IN_A);
    await holding(page, ["Shift"], () => clickAt(page, IN_C));
    await page.keyboard.press("Delete");
    expect(await markers(page)).toEqual([B, D]);
    expect(await selection(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: "Delete Markers", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await markers(page)).toEqual(ALL);
    expect(await selection(page)).toEqual([1, 3]);
    expect(await redo(page)).toBe(true);
    expect(await markers(page)).toEqual([B, D]);
});

test("Escape during a drag cancels it", async ({ page }) => {
    await clickAt(page, IN_A);
    const at = await pageCall<{ x: number; y: number }>(page, "mapClient", ...IN_A);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 60, at.y + 40, { steps: 2 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await markers(page)).toEqual(ALL);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("a right click during a drag cancels it", async ({ page }) => {
    await clickAt(page, IN_A);
    const at = await pageCall<{ x: number; y: number }>(page, "mapClient", ...IN_A);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 60, at.y + 40, { steps: 2 });
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.mouse.up();
    expect(await markers(page)).toEqual(ALL);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("a click on a handle, without a drag, changes nothing", async ({ page }) => {
    await clickAt(page, IN_A);
    // Snap off: a click 1 map pixel off the south-east corner.
    await page.locator("[data-marker-snap]").click();
    await clickAt(page, [65, 65]);
    expect(await markers(page)).toEqual(ALL);
    expect(await history(page)).toEqual({ undo: null, redo: null });
    // Snap on: a click on the corner of a marker that is off the grid.
    await page.locator("[data-marker-snap]").click();
    await setField(page, "width", 37);
    const before = await markers(page);
    await clickAt(page, [69, 64]);
    expect(await markers(page)).toEqual(before);
    expect(await history(page)).toEqual({ undo: "Resize Marker", redo: null });
});

test("a resize keeping the aspect gives whole pixels", async ({ page }) => {
    await clickAt(page, IN_C);
    // The ellipse's south-east handle to (96, 160): its width scales by 4/3.
    await holding(page, ["Control"], () => drag(page, [80, 160], [90, 161], [98, 162]));
    expect((await markers(page))[2]).toEqual({ ...C, width: 64, height: 43 });
});

test("Undo and Redo wait while a drag is in progress", async ({ page }) => {
    await clickAt(page, IN_B);
    await drag(page, IN_B, [150, 60], [160, 72]);
    const moved = await markers(page);
    await clickAt(page, IN_A);
    const at = await pageCall<{ x: number; y: number }>(page, "mapClient", ...IN_A);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 54, at.y + 24, { steps: 2 });
    await page.keyboard.press("Control+Z");
    await page.mouse.up();
    expect(await markers(page)).toEqual(
        moved.map((each, k) => (k === 0 ? { ...A, x: 64, y: 48 } : each)),
    );
    expect(await history(page)).toEqual({ undo: "Move Marker", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await markers(page)).toEqual(moved);
});
