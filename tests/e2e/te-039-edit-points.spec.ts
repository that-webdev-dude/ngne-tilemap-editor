import { test } from "@playwright/test";
import {
    clickAt,
    doubleClickAt,
    drag,
    expect,
    expectOneEntry,
    feedback,
    history,
    holding,
    markers,
    openEditor,
    pageCall,
    selection,
    selectionField,
    undo,
    undoCount,
} from "./te-039-support";
import type { MarkerValue, Pt } from "./te-039-support";

// TE-039: the Edit points tool (O; SPEC §8, DESIGN §4, §10.4), Tiled's `EditPolygonTool` for one
// point at a time: a point of a selected polygon or polyline is dragged (snapped to the 16 px
// grid, Ctrl inverts); a double click on an edge inserts a point there; Delete removes the
// chosen point, a polygon keeping 3 points and a polyline 2; the arrows nudge it 1 px and
// Shift+arrows one cell. Every edit is one "Edit Marker Points" entry, undone and redone.
//
// Field's markers (map pixels): 1 polygon "Zone" at (32, 32) through (32, 32), (96, 32),
// (96, 80); 2 polyline at (160, 48) through (160, 48), (224, 48); 3 rectangle (32, 128) 32 × 32.

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
const LABEL = "Edit Marker Points";

const withPoints = (marker: MarkerValue, points: number[][], at?: Partial<MarkerValue>) =>
    ALL.map((each) => (each.id === marker.id ? { ...marker, ...at, points } : each));

test.beforeEach(async ({ page }) => {
    await openEditor(page, "editPoints");
});

test("a dragged point snaps to the grid, Ctrl places it on whole pixels; one entry", async ({
    page,
}) => {
    await clickAt(page, IN_ZONE);
    expect(await selection(page)).toEqual([1]);
    expect(await selectionField(page)).toBe("1 marker");

    // The point (96, 32) dragged to (118, 36) snaps to (112, 32).
    await drag(page, [96, 32], [110, 34], [118, 36]);
    await expectOneEntry(
        page,
        LABEL,
        ALL,
        withPoints(ZONE, [
            [0, 0],
            [80, 0],
            [64, 48],
        ]),
    );
    expect(await undo(page)).toBe(true);

    await holding(page, ["Control"], () => drag(page, [96, 32], [110, 34], [117, 37]));
    expect(await markers(page)).toEqual(
        withPoints(ZONE, [
            [0, 0],
            [85, 5],
            [64, 48],
        ]),
    );
    expect(await history(page)).toEqual({ undo: LABEL, redo: null });

    // A press on a point without a drag changes nothing.
    const entries = await undoCount(page);
    await clickAt(page, [117, 37]);
    expect(await undoCount(page)).toBe(entries);
});

test("a double click on an edge inserts a point; Delete removes it, never below the minimum", async ({
    page,
}) => {
    await clickAt(page, IN_ZONE);
    // On the edge (32, 32)–(96, 32), away from its points.
    await doubleClickAt(page, [50, 32]);
    const inserted = withPoints(ZONE, [
        [0, 0],
        [18, 0],
        [64, 0],
        [64, 48],
    ]);
    await expectOneEntry(page, LABEL, ALL, inserted);

    // The inserted point is the chosen one: Delete removes it, one entry.
    await page.keyboard.press("Delete");
    expect(await markers(page)).toEqual(ALL);
    expect(await history(page)).toEqual({ undo: LABEL, redo: null });
    expect(await undo(page)).toBe(true);
    expect(await markers(page)).toEqual(inserted);
    expect(await pageCall(page, "redo")).toBe(true);
    expect(await markers(page)).toEqual(ALL);

    // A polygon of 3 points keeps them; the status bar says why.
    const entries = await undoCount(page);
    await clickAt(page, [32, 32]);
    await page.keyboard.press("Delete");
    expect(await markers(page)).toEqual(ALL);
    expect(await feedback(page)).toBe("A polygon keeps at least 3 points");
    expect(await undoCount(page)).toBe(entries);
    expect(await selection(page)).toEqual([1]);

    // A polyline: a point inserted, the first deleted (the others stay put), then 2 are kept.
    await clickAt(page, [192, 48]);
    expect(await selection(page)).toEqual([2]);
    await doubleClickAt(page, [200, 48]);
    expect(await markers(page)).toEqual(
        withPoints(ROAD, [
            [0, 0],
            [40, 0],
            [64, 0],
        ]),
    );
    await clickAt(page, [160, 48]);
    await page.keyboard.press("Delete");
    const twoLeft = withPoints(ROAD, [
        [40, 0],
        [64, 0],
    ]);
    expect(await markers(page)).toEqual(twoLeft);
    await clickAt(page, [224, 48]);
    await page.keyboard.press("Delete");
    expect(await markers(page)).toEqual(twoLeft);
    expect(await feedback(page)).toBe("A polyline keeps at least 2 points");

    // Undo goes back through each edit to the polyline as it was.
    expect(await undo(page)).toBe(true);
    expect(await undo(page)).toBe(true);
    expect(await markers(page)).toEqual(ALL);
});

test("the chosen point nudges by keyboard: 1 px, Shift one cell; each undoable", async ({
    page,
}) => {
    await clickAt(page, IN_ZONE);
    await clickAt(page, [96, 80]);
    await page.keyboard.press("ArrowLeft");
    const left = withPoints(ZONE, [
        [0, 0],
        [64, 0],
        [63, 48],
    ]);
    await expectOneEntry(page, LABEL, ALL, left);

    await page.keyboard.press("Shift+ArrowDown");
    const down = withPoints(ZONE, [
        [0, 0],
        [64, 0],
        [63, 64],
    ]);
    await expectOneEntry(page, LABEL, left, down);

    // A click where no marker is lets the point go and keeps the selection: the arrows then
    // nudge the marker (TE-039's marker nudge), a second click clears the selection.
    await clickAt(page, [280, 200]);
    expect(await selection(page)).toEqual([1]);
    await page.keyboard.press("ArrowRight");
    expect(await markers(page)).toEqual(withPoints(ZONE, down[0]!.points as number[][], { x: 33 }));
    expect(await history(page)).toEqual({ undo: "Move Marker", redo: null });
    await clickAt(page, [280, 200]);
    expect(await selection(page)).toEqual([]);
    expect(await selectionField(page)).toBe("");
});
