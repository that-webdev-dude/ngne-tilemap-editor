import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { CellSpec } from "./te-020-support";
import {
    LAYERS,
    activeTool,
    cells,
    clickAt,
    expect,
    history,
    openEditor,
    pageCall,
    pictured,
    put,
    redo,
    selection,
    setSelectionRows,
    stamp,
    statusMessage,
    undo,
} from "./te-020-support";

// TE-021: the cell clipboard (SPEC §4.4, Tiled's `MapDocumentActionHandler` and
// `MapEditor::paste`) on the Edit menu and its keys (DESIGN §5, §10.3): Copy takes the selected
// cells of the active layer, cells outside the selection empty; Paste makes them the current
// stamp, cut to its non-empty cells, clears the selection and selects the stamp brush; Cut and
// Delete erase the selected cells as one entry each, Cut also clearing the selection. Cells are
// [tile, orientation] as in TE-018.

/** Ground: a 3 × 3 block at (4..6, 4..6), each cell another tile and orientation. */
const BLOCK: [number, number, CellSpec][] = [
    [4, 4, [0, 0]],
    [5, 4, [1, 3]],
    [6, 4, [2, 6]],
    [4, 5, [3, 1]],
    [5, 5, [0, 5]],
    [6, 5, [1, 2]],
    [4, 6, [2, 7]],
    [5, 6, [3, 4]],
    [6, 6, [0, 1]],
];

/** The selection over the block: a ring with a gap, its bounding box the block. */
const SHAPE = ["##.", "#.#", ".##"];

/** The block's cells under SHAPE as a stamp, cells outside it empty. */
const SHAPE_STAMP = {
    width: 3,
    height: 3,
    cells: [[0, 0], [1, 3], null, [3, 1], null, [1, 2], null, [3, 4], [0, 1]],
};

/** The block's cells outside SHAPE, as the page lists them. */
const OUTSIDE_SHAPE = ["6,4:2/6", "5,5:0/5", "4,6:2/7"];

const listed = (entries: [number, number, CellSpec][]) =>
    entries.map(([x, y, cell]) => `${x},${y}:${cell![0]}/${cell![1]}`);

/** The Edit menu's item of command `id` (as TE-007 finds items). */
const editMenuItem = (page: Page, id: string) =>
    page.locator(`[role="menuitem"][data-command="${id}"]`);

/** Runs the Edit menu's item of command `id`. */
async function editItem(page: Page, id: string): Promise<void> {
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await editMenuItem(page, id).click();
}

/** Whether the Edit menu's item of command `id` is disabled; the menu is closed again. */
async function editItemDisabled(page: Page, id: string): Promise<boolean> {
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const disabled = (await editMenuItem(page, id).getAttribute("aria-disabled")) === "true";
    await page.keyboard.press("Escape");
    return disabled;
}

test.beforeEach(async ({ page }) => {
    await openEditor(page, "rectSelect");
    await put(page, BLOCK);
});

test("copy then paste reproduces the selected shape with empty cells outside the mask", async ({
    page,
}) => {
    await setSelectionRows(page, 4, 4, SHAPE);
    await page.keyboard.press("Control+KeyC");
    // Copy reads only: no entry, the map and the selection as they were.
    expect(await history(page)).toEqual({ undo: null, redo: null });
    expect(await selection(page)).toEqual(pictured(4, 4, SHAPE));

    await page.keyboard.press("Control+KeyV");
    expect(await stamp(page)).toEqual(SHAPE_STAMP);

    // Painted over a block of tile 3: the cells outside the mask leave the map as it is.
    const under: [number, number, CellSpec][] = [];
    for (let y = 10; y < 13; y++) for (let x = 20; x < 23; x++) under.push([x, y, [3, 0]]);
    await put(page, under);
    // The stamp's anchor is its centre cell (SPEC §4.2): (21, 11) puts its top-left at (20, 10).
    await clickAt(page, 21, 11);
    const painted = (await cells(page)).filter((entry) => parseInt(entry.split(",")[1]!, 10) >= 10);
    expect(painted).toEqual([
        "20,10:0/0",
        "21,10:1/3",
        "22,10:3/0",
        "20,11:3/1",
        "21,11:3/0",
        "22,11:1/2",
        "20,12:3/0",
        "21,12:3/4",
        "22,12:0/1",
    ]);
    expect(await history(page)).toEqual({ undo: "Stamp Brush", redo: null });
});

test("Copy and Paste from the Edit menu; the stamp is cut to its non-empty cells", async ({
    page,
}) => {
    expect(await editItemDisabled(page, "edit.paste")).toBe(true);
    // The selection's border holds empty cells: (3..7, 3..7) around the block.
    await setSelectionRows(page, 3, 3, ["#####", "#####", "#####", "#####", "#####"]);
    await editItem(page, "edit.copy");
    expect(await editItemDisabled(page, "edit.paste")).toBe(false);
    await editItem(page, "edit.paste");
    // Tiled's `normalizeTileLayerPositionsAndMapSize`: the empty border is not part of the stamp.
    expect(await stamp(page)).toEqual({
        width: 3,
        height: 3,
        cells: BLOCK.map(([, , cell]) => cell),
    });
});

test("cut is one entry: the selected cells are erased, the selection cleared; undo restores", async ({
    page,
}) => {
    await setSelectionRows(page, 4, 4, SHAPE);
    await page.keyboard.press("Control+KeyX");
    expect(await cells(page)).toEqual(OUTSIDE_SHAPE);
    expect(await selection(page)).toBeNull();
    expect(await history(page)).toEqual({ undo: "Cut", redo: null });

    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual(listed(BLOCK));
    expect(await selection(page)).toEqual(pictured(4, 4, SHAPE));
    expect(await history(page)).toEqual({ undo: null, redo: "Cut" });
    expect(await redo(page)).toBe(true);
    expect(await cells(page)).toEqual(OUTSIDE_SHAPE);
    expect(await selection(page)).toBeNull();

    // What was cut is on the clipboard.
    await page.keyboard.press("Control+KeyV");
    expect(await stamp(page)).toEqual(SHAPE_STAMP);
});

test("delete is one entry: the selected cells are erased, the selection kept; undo restores", async ({
    page,
}) => {
    await setSelectionRows(page, 4, 4, SHAPE);
    await page.keyboard.press("Delete");
    expect(await cells(page)).toEqual(OUTSIDE_SHAPE);
    expect(await selection(page)).toEqual(pictured(4, 4, SHAPE));
    expect(await history(page)).toEqual({ undo: "Delete", redo: null });

    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual(listed(BLOCK));
    expect(await history(page)).toEqual({ undo: null, redo: "Delete" });

    // From the menu; Delete puts nothing on the clipboard.
    await editItem(page, "edit.delete");
    expect(await cells(page)).toEqual(OUTSIDE_SHAPE);
    expect(await editItemDisabled(page, "edit.paste")).toBe(true);
    // Deleting empty cells changes nothing and records nothing (SPEC §3).
    await page.keyboard.press("Delete");
    expect(await history(page)).toEqual({ undo: "Delete", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await history(page)).toEqual({ undo: null, redo: "Delete" });
});

test("paste selects the stamp brush and clears the selection as one entry", async ({ page }) => {
    await setSelectionRows(page, 4, 4, SHAPE);
    await page.keyboard.press("Control+KeyC");
    // From a tool that uses the stamp too: Tiled's paste selects the stamp brush all the same.
    expect(await pageCall(page, "selectTool", "bucket")).toBe(true);
    await page.keyboard.press("Control+KeyV");
    expect(await activeTool(page)).toBe("stamp");
    expect(await selection(page)).toBeNull();
    expect(await history(page)).toEqual({ undo: "Select None", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await selection(page)).toEqual(pictured(4, 4, SHAPE));
    expect(await stamp(page)).toEqual(SHAPE_STAMP);

    // From the rectangle select, with no selection left to clear: no entry.
    expect(await pageCall(page, "selectTool", "rectSelect")).toBe(true);
    await page.keyboard.press("Control+KeyD");
    expect(await history(page)).toEqual({ undo: "Select None", redo: null });
    await page.keyboard.press("Control+KeyV");
    expect(await activeTool(page)).toBe("stamp");
    expect(await history(page)).toEqual({ undo: "Select None", redo: null });
});

test("a locked layer is copied, but cut and delete are refused", async ({ page }) => {
    await put(page, [[10, 10, [2, 0]]], LAYERS.locked);
    await pageCall(page, "setActiveLayer", LAYERS.locked);
    await setSelectionRows(page, 10, 10, ["#"]);
    await page.keyboard.press("Delete");
    await expect(statusMessage(page)).toHaveText("Layer is locked");
    await page.keyboard.press("Control+KeyX");
    expect(await cells(page, LAYERS.locked)).toEqual(["10,10:2/0"]);
    expect(await selection(page)).toEqual(pictured(10, 10, ["#"]));
    expect(await history(page)).toEqual({ undo: null, redo: null });
    // The refused cut copied nothing.
    expect(await editItemDisabled(page, "edit.paste")).toBe(true);

    await page.keyboard.press("Control+KeyC");
    expect(await editItemDisabled(page, "edit.paste")).toBe(false);
});

test("a hidden layer is cut and deleted: Tiled refuses a locked layer only", async ({ page }) => {
    // The Hidden layer sits under a hidden group (the TE-017 test map).
    await put(
        page,
        [
            [10, 10, [2, 0]],
            [11, 10, [3, 0]],
        ],
        LAYERS.hidden,
    );
    await pageCall(page, "setActiveLayer", LAYERS.hidden);
    await setSelectionRows(page, 10, 10, ["#"]);
    await page.keyboard.press("Delete");
    expect(await cells(page, LAYERS.hidden)).toEqual(["11,10:3/0"]);
    expect(await history(page)).toEqual({ undo: "Delete", redo: null });
    await setSelectionRows(page, 11, 10, ["#"]);
    await page.keyboard.press("Control+KeyX");
    expect(await cells(page, LAYERS.hidden)).toEqual([]);
    expect(await history(page)).toEqual({ undo: "Cut", redo: null });
    await page.keyboard.press("Control+KeyV");
    expect(await stamp(page)).toEqual({ width: 1, height: 1, cells: [[3, 0]] });
});
