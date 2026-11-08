import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
    AREAS,
    GROUND,
    clickAt,
    expect,
    feedback,
    history,
    holding,
    markers,
    openEditor,
    pageCall,
    redo,
    selection,
    selectionField,
    undo,
    undoCount,
} from "./te-039-support";
import type { MarkerValue, Pt } from "./te-039-support";

// TE-039: the clipboard of markers (SPEC §8): Ctrl+C copies the selected markers, Ctrl+X also
// deletes them (one entry, "Cut"), Ctrl+V adds them to the active marker layer of whichever map
// is active, at the positions they were copied from, with new IDs from that map's next marker
// ID, and selects them (one entry, "Paste"). Paste is refused with a status-bar message unless
// the active layer is a visible, unlocked marker layer. The clipboard holds cells or markers:
// the last copy wins.
//
// Field (map 0): 1 polygon "Zone", 2 polyline, 3 rectangle, next marker ID 4. Other (map 1): no
// markers, next marker ID 10.

const ZONE = {
    id: 1,
    shape: "polygon",
    x: 32,
    y: 32,
    points: [
        [0, 0],
        [64, 0],
        [64, 48],
    ],
    name: "Zone",
    class: "area",
    properties: [{ name: "depth", type: "int", value: 3 }],
};
const ROAD = {
    id: 2,
    shape: "polyline",
    x: 160,
    y: 48,
    points: [
        [0, 0],
        [64, 0],
    ],
    name: "",
    class: "",
    properties: [],
};
const BOX = {
    id: 3,
    shape: "rectangle",
    x: 32,
    y: 128,
    width: 32,
    height: 32,
    name: "",
    class: "",
    properties: [],
};
const ALL: MarkerValue[] = [ZONE, ROAD, BOX];

const IN_ZONE: Pt = [80, 40];
const ON_ROAD: Pt = [192, 48];
const IN_BOX: Pt = [48, 144];

const clipboard = (page: Page) =>
    pageCall<{ kind: string | null; markers: number }>(page, "clipboard");
const switchMap = (page: Page, index: number) => pageCall(page, "switchMap", index);
const setActiveLayer = (page: Page, id: number) => pageCall(page, "setActiveLayer", id);

test.beforeEach(async ({ page }) => {
    await openEditor(page, "markerSelect");
});

test("copy between two maps gives new IDs at the same positions; paste selects them", async ({
    page,
}) => {
    await clickAt(page, IN_ZONE);
    await holding(page, ["Shift"], () => clickAt(page, IN_BOX));
    expect(await selection(page)).toEqual([1, 3]);
    await page.keyboard.press("Control+c");
    expect(await clipboard(page)).toEqual({ kind: "markers", markers: 2 });
    expect(await history(page)).toEqual({ undo: null, redo: null });

    await switchMap(page, 1);
    await page.keyboard.press("Control+v");
    const pasted = [
        { ...ZONE, id: 10 },
        { ...BOX, id: 11 },
    ];
    expect(await markers(page)).toEqual(pasted);
    expect(await selection(page)).toEqual([10, 11]);
    expect(await selectionField(page)).toBe("2 markers");
    expect(await pageCall(page, "nextMarkerId")).toBe(12);
    expect(await history(page)).toEqual({ undo: "Paste", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await markers(page)).toEqual([]);
    expect(await selection(page)).toEqual([]);
    expect(await redo(page)).toBe(true);
    expect(await markers(page)).toEqual(pasted);

    // Within the same map: new IDs again, the copied markers untouched.
    await switchMap(page, 0);
    await page.keyboard.press("Control+v");
    expect(await markers(page)).toEqual([...ALL, { ...ZONE, id: 4 }, { ...BOX, id: 5 }]);
    expect(await selection(page)).toEqual([4, 5]);
});

test("paste on a tile layer, a locked or a hidden marker layer is refused with the message", async ({
    page,
}) => {
    await clickAt(page, ON_ROAD);
    await page.keyboard.press("Control+c");

    await setActiveLayer(page, GROUND);
    await page.keyboard.press("Control+v");
    expect(await feedback(page)).toBe("Not a marker layer");
    expect(await markers(page)).toEqual(ALL);
    expect(await undoCount(page)).toBe(0);

    await setActiveLayer(page, AREAS);
    await pageCall(page, "setLayerFlag", AREAS, "locked", true);
    await page.keyboard.press("Control+v");
    expect(await feedback(page)).toBe("Layer is locked");
    await pageCall(page, "setLayerFlag", AREAS, "locked", false);
    await pageCall(page, "setLayerFlag", AREAS, "visible", false);
    await page.keyboard.press("Control+v");
    expect(await feedback(page)).toBe("Layer is hidden");
    expect(await markers(page)).toEqual(ALL);
    expect(await undoCount(page)).toBe(0);
    await pageCall(page, "setLayerFlag", AREAS, "visible", true);

    // Cut takes the marker out as one entry; Paste puts it back with a new ID.
    expect(await selection(page)).toEqual([2]);
    await page.keyboard.press("Control+x");
    expect(await markers(page)).toEqual([ZONE, BOX]);
    expect(await history(page)).toEqual({ undo: "Cut", redo: null });
    expect(await clipboard(page)).toEqual({ kind: "markers", markers: 1 });
    await page.keyboard.press("Control+v");
    expect(await markers(page)).toEqual([ZONE, BOX, { ...ROAD, id: 4 }]);
    expect(await undo(page)).toBe(true);
    expect(await undo(page)).toBe(true);
    expect(await markers(page)).toEqual(ALL);
});

test("a cell copy after a marker copy replaces it, and the other way round", async ({ page }) => {
    await clickAt(page, IN_ZONE);
    await page.keyboard.press("Control+c");
    expect(await clipboard(page)).toEqual({ kind: "markers", markers: 1 });

    await setActiveLayer(page, GROUND);
    await pageCall(page, "setTileSelection", 0, 0, 2, 2);
    await page.keyboard.press("Control+c");
    expect(await clipboard(page)).toEqual({ kind: "cells", markers: 0 });

    // Back on the marker layer, Paste has no markers to paste.
    await setActiveLayer(page, AREAS);
    await page.keyboard.press("Control+v");
    expect(await markers(page)).toEqual(ALL);
    expect(await undoCount(page)).toBe(0);

    expect(await selection(page)).toEqual([1]);
    await page.keyboard.press("Control+c");
    expect(await clipboard(page)).toEqual({ kind: "markers", markers: 1 });
});
