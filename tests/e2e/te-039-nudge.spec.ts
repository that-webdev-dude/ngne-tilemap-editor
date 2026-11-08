import { test } from "@playwright/test";
import {
    AREAS,
    clickAt,
    expect,
    expectOneEntry,
    feedback,
    history,
    holding,
    markers,
    openEditor,
    pageCall,
    selection,
    undoCount,
} from "./te-039-support";
import type { MarkerValue, Pt } from "./te-039-support";

// TE-039: the arrows nudge the selected markers 1 px and Shift+arrows one cell (16 px), in the
// `markers` context (SPEC §8, DESIGN §10.3); each press is one entry. Without a marker
// selection the arrows nudge nothing. While a selected marker's layer is locked, nudge, Cut and
// Delete of markers or of the chosen point are refused, as Cut and Delete of cells are (SPEC
// §4.4); Copy only reads.
//
// Field: 1 polygon at (32, 32), 2 polyline at (160, 48), 3 rectangle at (32, 128).

const IN_ZONE: Pt = [80, 40];
const IN_BOX: Pt = [48, 144];
const EMPTY: Pt = [280, 200];

const moved = (all: MarkerValue[], ids: number[], dx: number, dy: number) =>
    all.map((marker) =>
        ids.includes(marker.id)
            ? { ...marker, x: (marker.x as number) + dx, y: (marker.y as number) + dy }
            : marker,
    );

test.beforeEach(async ({ page }) => {
    await openEditor(page, "markerSelect");
});

test("arrows nudge the selection 1 px, Shift+arrows one cell; one entry each", async ({ page }) => {
    const start = await markers(page);
    await clickAt(page, IN_ZONE);
    await holding(page, ["Shift"], () => clickAt(page, IN_BOX));
    expect(await selection(page)).toEqual([1, 3]);

    const steps: [string, number, number][] = [
        ["ArrowRight", 1, 0],
        ["ArrowLeft", -1, 0],
        ["ArrowDown", 0, 1],
        ["ArrowUp", 0, -1],
        ["Shift+ArrowRight", 16, 0],
        ["Shift+ArrowLeft", -16, 0],
        ["Shift+ArrowDown", 0, 16],
        ["Shift+ArrowUp", 0, -16],
    ];
    let before = start;
    for (const [key, dx, dy] of steps) {
        await page.keyboard.press(key);
        const after = moved(before, [1, 3], dx, dy);
        await expectOneEntry(page, "Move Markers", before, after);
        before = after;
    }
    expect(await undoCount(page)).toBe(steps.length);

    // One selected marker: "Move Marker".
    await clickAt(page, IN_BOX);
    await page.keyboard.press("Shift+ArrowRight");
    expect(await markers(page)).toEqual(moved(before, [3], 16, 0));
    expect(await history(page)).toEqual({ undo: "Move Marker", redo: null });
});

test("without a marker selection the arrows nudge nothing", async ({ page }) => {
    const start = await markers(page);
    await clickAt(page, EMPTY);
    expect(await selection(page)).toEqual([]);
    for (const key of ["ArrowRight", "ArrowLeft", "Shift+ArrowRight", "Shift+ArrowLeft"]) {
        await page.keyboard.press(key);
    }
    expect(await markers(page)).toEqual(start);
    expect(await undoCount(page)).toBe(0);
});

test("a layer locked after the selection refuses nudge, Cut and Delete; Copy still reads", async ({
    page,
}) => {
    const start = await markers(page);
    await clickAt(page, IN_ZONE);
    await pageCall(page, "setLayerFlag", AREAS, "locked", true);
    for (const key of ["ArrowRight", "Shift+ArrowDown", "Control+x", "Delete"]) {
        await page.keyboard.press(key);
        expect(await feedback(page)).toBe("Layer is locked");
    }
    expect(await markers(page)).toEqual(start);
    expect(await selection(page)).toEqual([1]);
    expect(await undoCount(page)).toBe(0);
    await page.keyboard.press("Control+c");
    expect(await pageCall(page, "clipboard")).toEqual({ kind: "markers", markers: 1 });

    // With Edit points, the chosen point is refused the same way.
    await pageCall(page, "setLayerFlag", AREAS, "locked", false);
    expect(await pageCall(page, "selectTool", "editPoints")).toBe(true);
    await clickAt(page, [96, 80]);
    await pageCall(page, "setLayerFlag", AREAS, "locked", true);
    for (const key of ["ArrowLeft", "Delete"]) {
        await page.keyboard.press(key);
        expect(await feedback(page)).toBe("Layer is locked");
    }
    expect(await markers(page)).toEqual(start);
    expect(await undoCount(page)).toBe(0);

    // Unlocked again, the keys act.
    await pageCall(page, "setLayerFlag", AREAS, "locked", false);
    await page.keyboard.press("ArrowLeft");
    expect(await undoCount(page)).toBe(1);
});

test("a layer locked after the selection refuses the context bar's X, Y, W and H", async ({
    page,
}) => {
    const start = await markers(page);
    await clickAt(page, IN_BOX);
    await pageCall(page, "setLayerFlag", AREAS, "locked", true);
    for (const key of ["x", "y", "width", "height"]) {
        const input = page.locator(`[data-marker-field="${key}"] input`);
        await input.fill("40");
        await input.press("Enter");
        expect(await feedback(page)).toBe("Layer is locked");
    }
    expect(await markers(page)).toEqual(start);
    expect(await undoCount(page)).toBe(0);

    await pageCall(page, "setLayerFlag", AREAS, "locked", false);
    const input = page.locator('[data-marker-field="x"] input');
    await input.fill("40");
    await input.press("Enter");
    expect(await undoCount(page)).toBe(1);
});
