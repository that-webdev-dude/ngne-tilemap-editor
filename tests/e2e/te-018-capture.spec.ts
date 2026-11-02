import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { overlayIdle } from "./te-014-support";
import type { CellSpec } from "./te-018-support";
import {
    LAYERS,
    activeTool,
    cells,
    clickAt,
    drag,
    expect,
    history,
    moveTo,
    openEditor,
    pageCall,
    pressAt,
    put,
    redo,
    setStamp,
    stamp,
    statusMessage,
    undo,
} from "./te-018-support";

// TE-018: capture of a stamp from the map with the stamp brush (SPEC §4.2, Tiled's
// `CaptureStampHelper`): a right drag captures the rectangle of the active layer, cut to its
// non-empty cells, empty cells inside kept empty; Shift at the release also erases it, one
// entry; a right click captures one cell. Cells are [tile, orientation].

/**
 * Ground: 3 × 3 at (4..6, 4..6) with an empty centre, each cell with another orientation, and
 * one cell far from it. Top has a cell over the empty centre, which a capture of Ground must
 * not take.
 */
const BLOCK: [number, number, CellSpec][] = [
    [4, 4, [0, 0]],
    [5, 4, [1, 3]],
    [6, 4, [2, 6]],
    [4, 5, [3, 1]],
    [6, 5, [0, 5]],
    [4, 6, [1, 2]],
    [5, 6, [2, 7]],
    [6, 6, [3, 4]],
];
const FAR: [number, number, CellSpec] = [20, 20, [3, 0]];

const BLOCK_STAMP = {
    width: 3,
    height: 3,
    cells: [[0, 0], [1, 3], [2, 6], [3, 1], null, [0, 5], [1, 2], [2, 7], [3, 4]],
};

const GROUND = [
    "4,4:0/0",
    "5,4:1/3",
    "6,4:2/6",
    "4,5:3/1",
    "6,5:0/5",
    "4,6:1/2",
    "5,6:2/7",
    "6,6:3/4",
    "20,20:3/0",
];

/** The stamp the beforeEach sets, which a capture replaces. */
const BEFORE = { width: 1, height: 1, cells: [[1, 0]] };

const cellDevice = (page: Page, x: number, y: number) =>
    pageCall<{ x: number; y: number; width: number; height: number }>(page, "cellDevice", x, y);
const pixel = (page: Page, x: number, y: number) => pageCall<number[]>(page, "overlayPixel", x, y);
const token = (page: Page, name: string) => pageCall<number>(page, "token", name);
const rgb = (colour: number) => [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];

/** A right click on cell `(x, y)`. */
async function rightClick(page: Page, x: number, y: number): Promise<void> {
    await pressAt(page, x, y, "right");
    await page.mouse.up({ button: "right" });
}

/** A right drag from `a` to `b` with Shift held at the release. */
async function shiftCapture(page: Page, a: [number, number], b: [number, number]): Promise<void> {
    await pressAt(page, a[0], a[1], "right");
    await moveTo(page, b[0], b[1]);
    await page.keyboard.down("Shift");
    await page.mouse.up({ button: "right" });
    await page.keyboard.up("Shift");
}

test.beforeEach(async ({ page }) => {
    await openEditor(page);
    await put(page, [...BLOCK, FAR]);
    await put(page, [[5, 5, [2, 0]]], LAYERS.top);
    await setStamp(page, BEFORE.width, BEFORE.height, BEFORE.cells as CellSpec[]);
});

test("a right drag captures the rectangle, empty cells kept empty, and paints nothing", async ({
    page,
}) => {
    // From (6, 7) to (3, 3), backwards through (5, 5): the empty row and column on the border
    // are left out (Tiled), the empty centre is kept.
    await pressAt(page, 6, 7, "right");
    await moveTo(page, 5, 5);
    await moveTo(page, 3, 3);

    // While the button is held the overlay outlines the rectangle in accent, with no stamp
    // preview.
    await overlayIdle(page);
    const accent = [...rgb(await token(page, "--accent")), 255];
    const corner = await cellDevice(page, 3, 3);
    const far = await cellDevice(page, 6, 7);
    expect(await pixel(page, corner.x, corner.y + corner.height)).toEqual(accent);
    expect(await pixel(page, far.x + far.width - 1, far.y)).toEqual(accent);
    // The cursor's cell: a 1 × 1 stamp preview would cover its centre.
    const middle = [
        corner.x + Math.floor(corner.width / 2),
        corner.y + Math.floor(corner.height / 2),
    ];
    expect((await pixel(page, middle[0]!, middle[1]!))[3]).toBe(0);

    await page.mouse.up({ button: "right" });
    expect(await stamp(page)).toEqual(BLOCK_STAMP);
    expect(await activeTool(page)).toBe("stamp");
    expect(await cells(page)).toEqual(GROUND);
    expect(await history(page)).toEqual({ undo: null, redo: null });
    await expect(page.locator('[data-tool-readout="size"] output')).toHaveText("3 × 3");

    // Painted over (20, 20), the empty centre leaves that cell as it is.
    await clickAt(page, 20, 20);
    const painted = (await cells(page)).filter((cell) => /^(19|20|21),(19|20|21):/.test(cell));
    expect(painted).toEqual([
        "19,19:0/0",
        "20,19:1/3",
        "21,19:2/6",
        "19,20:3/1",
        "20,20:3/0",
        "21,20:0/5",
        "19,21:1/2",
        "20,21:2/7",
        "21,21:3/4",
    ]);
});

test("a right drag past the map's edge captures the part inside the map", async ({ page }) => {
    await put(page, [[0, 0, [3, 6]]]);
    // From (5, 5) to (-3, -2): the map's part is (0, 0)..(5, 5); its non-empty cells are
    // (0, 0) and the block's top-left corner, so the stamp is 6 × 6.
    await drag(page, [5, 5], [[-3, -2]], "right");
    const empty = (count: number) => Array<CellSpec>(count).fill(null);
    expect(await stamp(page)).toEqual({
        width: 6,
        height: 6,
        cells: [
            ...[[3, 6], ...empty(5)],
            ...empty(18),
            ...[...empty(4), [0, 0], [1, 3]],
            ...[...empty(4), [3, 1], null],
        ],
    });
});

test("Shift at the release cuts: the cells erased in one entry, undo restores them", async ({
    page,
}) => {
    await shiftCapture(page, [4, 4], [6, 6]);
    expect(await stamp(page)).toEqual(BLOCK_STAMP);
    expect(await activeTool(page)).toBe("stamp");
    expect(await cells(page)).toEqual(["20,20:3/0"]);
    // Top is not the active layer: its cell stays.
    expect(await cells(page, LAYERS.top)).toEqual(["5,5:2/0"]);
    expect(await history(page)).toEqual({ undo: "Cut", redo: null });

    // One entry: one undo restores every cell and leaves nothing to undo.
    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual(GROUND);
    expect(await history(page)).toEqual({ undo: null, redo: "Cut" });
    // The captured stamp is not part of the history.
    expect(await stamp(page)).toEqual(BLOCK_STAMP);
    expect(await redo(page)).toBe(true);
    expect(await cells(page)).toEqual(["20,20:3/0"]);
});

test("Shift let go before the release does not cut", async ({ page }) => {
    await pressAt(page, 4, 4, "right");
    await page.keyboard.down("Shift");
    await moveTo(page, 6, 6);
    await page.keyboard.up("Shift");
    await page.mouse.up({ button: "right" });
    expect(await stamp(page)).toEqual(BLOCK_STAMP);
    expect(await cells(page)).toEqual(GROUND);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("a right click captures one cell; on an empty cell it leaves no stamp", async ({ page }) => {
    await rightClick(page, 6, 4);
    expect(await stamp(page)).toEqual({ width: 1, height: 1, cells: [[2, 6]] });
    expect(await activeTool(page)).toBe("stamp");
    expect(await cells(page)).toEqual(GROUND);

    // The empty centre of Ground: Top's cell above it is on another layer.
    await rightClick(page, 5, 5);
    expect(await stamp(page)).toBeNull();
    await expect(page.locator('[data-tool-readout="size"] output')).toHaveText("—");
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("Escape during a right drag cancels the capture", async ({ page }) => {
    await pressAt(page, 4, 4, "right");
    await moveTo(page, 6, 6);
    await page.keyboard.press("Escape");
    await page.mouse.up({ button: "right" });
    expect(await stamp(page)).toEqual(BEFORE);
    expect(await cells(page)).toEqual(GROUND);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("a locked layer is captured but not cut (Tiled)", async ({ page }) => {
    await put(page, [[8, 8, [2, 3]]], LAYERS.locked);
    await pageCall(page, "setActiveLayer", LAYERS.locked);
    await shiftCapture(page, [8, 8], [8, 8]);
    expect(await stamp(page)).toEqual({ width: 1, height: 1, cells: [[2, 3]] });
    expect(await cells(page, LAYERS.locked)).toEqual(["8,8:2/3"]);
    expect(await history(page)).toEqual({ undo: null, redo: null });
    await expect(statusMessage(page)).toHaveText("Layer is locked");
});

test("a hidden layer refuses the press; Ctrl+right does not capture (Tiled)", async ({ page }) => {
    await put(page, [[8, 8, [2, 3]]], LAYERS.hidden);
    await pageCall(page, "setActiveLayer", LAYERS.hidden);
    await rightClick(page, 8, 8);
    expect(await stamp(page)).toEqual(BEFORE);
    await expect(statusMessage(page)).toHaveText("Layer is hidden");

    await pageCall(page, "setActiveLayer", LAYERS.ground);
    await page.keyboard.down("Control");
    await rightClick(page, 6, 4);
    await page.keyboard.up("Control");
    expect(await stamp(page)).toEqual(BEFORE);
    expect(await cells(page)).toEqual(GROUND);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});
