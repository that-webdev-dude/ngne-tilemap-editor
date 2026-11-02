import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { CellSpec } from "./te-020-support";
import {
    activeTool,
    ants,
    clickAt,
    drag,
    expect,
    expectAntsAround,
    history,
    holding,
    moveTo,
    openEditor,
    pictured,
    pressAt,
    put,
    rectEntries,
    rectSelection,
    redo,
    selection,
    selectionStatus,
    setSelection,
    switchMap,
    undo,
} from "./te-020-support";

// TE-020: the tile selection tools (SPEC §4.3, Tiled's `TileSelectionTool`, `MagicWandTool`,
// `SelectSameTileTool`) in each mode — none = replace or the context bar's Mode, Shift add,
// Ctrl subtract, Ctrl+Shift intersect, right click clears — the Select menu's commands and
// keys (Ctrl+A, Ctrl+D, Ctrl+I), Escape with a tile tool, the marching ants and the status
// bar's selection size (DESIGN §4, §5, §7, §8.7, §10.3). Every change is one history entry.

/** The selection the tests start the modes from: cells (2..5, 2..4). */
const BASE = { x: 2, y: 2, width: 4, height: 3 };

/** Drags from cell `a` to cell `b` with `keys` held at the press. */
async function dragWith(
    page: Page,
    keys: string[],
    a: [number, number],
    b: [number, number],
): Promise<void> {
    await holding(page, keys, () => drag(page, a, [b]));
}

test.describe("rectangle select", () => {
    test.beforeEach(async ({ page }) => {
        await openEditor(page, "rectSelect");
    });

    test("a drag selects a rectangle of cells; undo and redo; ants and status", async ({
        page,
    }) => {
        await drag(
            page,
            [5, 4],
            [
                [3, 3],
                [2, 2],
            ],
        );
        expect(await selection(page)).toEqual(rectSelection(BASE));
        expect(await history(page)).toEqual({ undo: "Rectangle Select", redo: null });
        await expect(selectionStatus(page)).toHaveText("4 × 3");
        await expectAntsAround(page, BASE);
        expect((await ants(page))?.animating).toBe(true);

        expect(await undo(page)).toBe(true);
        expect(await selection(page)).toBeNull();
        // An empty field is not shown (statusFields.ts).
        await expect(selectionStatus(page)).toHaveCount(0);
        expect(await redo(page)).toBe(true);
        expect(await selection(page)).toEqual(rectSelection(BASE));

        // The rectangle is cut to the map.
        await drag(page, [37, 27], [[42, 33]]);
        expect(await selection(page)).toEqual(rectSelection({ x: 37, y: 27, width: 3, height: 3 }));
    });

    test("the ants show the rectangle while it is dragged", async ({ page }) => {
        await pressAt(page, 2, 2);
        await moveTo(page, 3, 3);
        await moveTo(page, 5, 4);
        await expectAntsAround(page, BASE);
        expect(await selection(page)).toBeNull();
        await page.mouse.up();
        expect(await selection(page)).toEqual(rectSelection(BASE));
    });

    test("Shift adds, Ctrl subtracts, Ctrl+Shift intersects", async ({ page }) => {
        await setSelection(page, BASE);
        await dragWith(page, ["Shift"], [4, 3], [7, 6]);
        expect(await selection(page)).toEqual(
            pictured(2, 2, ["####..", "######", "######", "..####", "..####"]),
        );
        await dragWith(page, ["Control"], [3, 0], [4, 9]);
        expect(await selection(page)).toEqual(
            pictured(2, 2, ["#..#..", "#..###", "#..###", "...###", "...###"]),
        );
        await dragWith(page, ["Control", "Shift"], [0, 3], [6, 4]);
        expect(await selection(page)).toEqual(pictured(2, 3, ["#..##", "#..##"]));
        expect(await history(page)).toEqual({ undo: "Rectangle Select", redo: null });
        expect(await undo(page)).toBe(true);
        expect(await undo(page)).toBe(true);
        expect(await undo(page)).toBe(true);
        expect(await selection(page)).toEqual(rectSelection(BASE));
    });

    test("the context bar's Mode stands for the modifiers", async ({ page }) => {
        const mode = page.getByRole("radiogroup", { name: "Mode" });
        await expect(mode.getByRole("radio")).toHaveText([
            "Replace",
            "Add",
            "Subtract",
            "Intersect",
        ]);
        await setSelection(page, BASE);
        await mode.getByRole("radio", { name: "Add" }).click();
        await drag(page, [6, 2], [[7, 2]]);
        expect(await selection(page)).toEqual(pictured(2, 2, ["######", "####..", "####.."]));
        await mode.getByRole("radio", { name: "Subtract" }).click();
        await drag(page, [2, 2], [[7, 2]]);
        expect(await selection(page)).toEqual(rectSelection({ x: 2, y: 3, width: 4, height: 2 }));
        await mode.getByRole("radio", { name: "Intersect" }).click();
        await drag(page, [4, 0], [[9, 9]]);
        expect(await selection(page)).toEqual(rectSelection({ x: 4, y: 3, width: 2, height: 2 }));
        // A modifier still wins over the locked mode: Shift adds.
        await dragWith(page, ["Shift"], [10, 10], [11, 10]);
        expect((await selection(page))?.width).toBe(8);
        await mode.getByRole("radio", { name: "Replace" }).click();
        await drag(page, [20, 20], [[21, 21]]);
        expect(await selection(page)).toEqual(rectSelection({ x: 20, y: 20, width: 2, height: 2 }));
    });

    test("a click without a drag, or a right click, clears the selection", async ({ page }) => {
        await setSelection(page, BASE);
        await clickAt(page, 10, 10);
        expect(await selection(page)).toBeNull();
        expect(await history(page)).toEqual({ undo: "Select None", redo: null });

        await setSelection(page, BASE);
        await pressAt(page, 10, 10, "right");
        await page.mouse.up({ button: "right" });
        expect(await selection(page)).toBeNull();
    });

    test("Escape or a right click during the drag cancels it", async ({ page }) => {
        await setSelection(page, BASE);
        await pressAt(page, 10, 10);
        await moveTo(page, 12, 12);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        expect(await selection(page)).toEqual(rectSelection(BASE));
        await expectAntsAround(page, BASE);

        await pressAt(page, 10, 10);
        await moveTo(page, 12, 12);
        await page.mouse.down({ button: "right" });
        await page.mouse.up({ button: "right" });
        await page.mouse.up();
        expect(await selection(page)).toEqual(rectSelection(BASE));
        expect(await history(page)).toEqual({ undo: null, redo: null });
    });
});

test.describe("magic wand", () => {
    // Ground: a 3 × 2 block of tile 1 at (2..4, 2..3), tile 1 again apart at (8, 2), and tile 1
    // with another orientation beside the block at (5, 2).
    const BLOCK = { x: 2, y: 2, width: 3, height: 2 };
    const ONE: CellSpec = [1, 0];

    test.beforeEach(async ({ page }) => {
        await openEditor(page, "wand");
        await put(page, [...rectEntries(BLOCK, ONE), [8, 2, ONE], [5, 2, [1, 4]]]);
    });

    test("finds the 4-connected region equal to the pressed cell at the press", async ({
        page,
    }) => {
        // The ants show it at the press; the release records it (Tiled).
        await pressAt(page, 3, 3);
        await expectAntsAround(page, BLOCK);
        expect(await selection(page)).toBeNull();
        await page.mouse.up();
        expect(await selection(page)).toEqual(rectSelection(BLOCK));
        expect(await history(page)).toEqual({ undo: "Magic Wand", redo: null });
        await expectAntsAround(page, BLOCK);

        // An empty cell: the empty region around everything.
        await clickAt(page, 0, 0);
        const empty = await selection(page);
        expect([empty?.x, empty?.y, empty?.width, empty?.height]).toEqual([0, 0, 40, 30]);
        expect(empty?.rows[2]).toBe(`##....##.${"#".repeat(31)}`);
    });

    test("Shift adds, Ctrl subtracts, Ctrl+Shift intersects, the Mode option locks one", async ({
        page,
    }) => {
        await holding(page, ["Shift"], () => clickAt(page, 8, 2));
        expect(await selection(page)).toEqual(pictured(8, 2, ["#"]));
        await holding(page, ["Shift"], () => clickAt(page, 2, 2));
        expect(await selection(page)).toEqual(pictured(2, 2, ["###...#", "###...."]));
        await holding(page, ["Control"], () => clickAt(page, 8, 2));
        expect(await selection(page)).toEqual(rectSelection(BLOCK));
        await setSelection(page, { x: 4, y: 0, width: 10, height: 10 });
        await holding(page, ["Control", "Shift"], () => clickAt(page, 2, 3));
        expect(await selection(page)).toEqual(rectSelection({ x: 4, y: 2, width: 1, height: 2 }));

        await page
            .getByRole("radiogroup", { name: "Mode" })
            .getByRole("radio", { name: "Add" })
            .click();
        await clickAt(page, 5, 2);
        expect(await selection(page)).toEqual(pictured(4, 2, ["##", "#."]));
        await page
            .getByRole("radiogroup", { name: "Mode" })
            .getByRole("radio", { name: "Subtract" })
            .click();
        await clickAt(page, 4, 3);
        expect(await selection(page)).toEqual(pictured(5, 2, ["#"]));
        await page
            .getByRole("radiogroup", { name: "Mode" })
            .getByRole("radio", { name: "Intersect" })
            .click();
        await clickAt(page, 2, 2);
        expect(await selection(page)).toBeNull();
    });

    test("Escape or a right click before the release cancels the press", async ({ page }) => {
        const kept = { x: 10, y: 10, width: 2, height: 2 };
        await setSelection(page, kept);
        await pressAt(page, 3, 3);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        expect(await selection(page)).toEqual(rectSelection(kept));
        await expectAntsAround(page, kept);

        await pressAt(page, 3, 3);
        await page.mouse.down({ button: "right" });
        await page.mouse.up({ button: "right" });
        await page.mouse.up();
        expect(await selection(page)).toEqual(rectSelection(kept));
        expect(await history(page)).toEqual({ undo: null, redo: null });
    });

    test("a right click clears the selection", async ({ page }) => {
        await clickAt(page, 2, 2);
        await pressAt(page, 20, 20, "right");
        await page.mouse.up({ button: "right" });
        expect(await selection(page)).toBeNull();
        expect(await history(page)).toEqual({ undo: "Select None", redo: null });
    });
});

test.describe("select same tile", () => {
    const ONE: CellSpec = [1, 0];

    test.beforeEach(async ({ page }) => {
        await openEditor(page, "sameTile");
        // Tile 1 at (2, 2) and (10, 5); tile 2 at (4, 4); tile 1 flipped at (6, 6).
        await put(page, [
            [2, 2, ONE],
            [10, 5, ONE],
            [4, 4, [2, 0]],
            [6, 6, [1, 4]],
        ]);
    });

    test("selects every cell equal to the pressed one, at the release", async ({ page }) => {
        await pressAt(page, 2, 2);
        await expectAntsAround(page, { x: 2, y: 2, width: 1, height: 1 });
        expect(await selection(page)).toBeNull();
        await page.mouse.up();
        const ones = pictured(2, 2, ["#........", ".........", ".........", "........#"]);
        expect(await selection(page)).toEqual(ones);
        expect(await history(page)).toEqual({ undo: "Select Same Tile", redo: null });

        // An empty cell selects every empty cell.
        await clickAt(page, 0, 0);
        const empty = await selection(page);
        expect([empty?.x, empty?.y, empty?.width, empty?.height]).toEqual([0, 0, 40, 30]);
        expect(empty?.rows[2]?.slice(0, 4)).toBe("##.#");
        expect(empty?.rows[6]?.slice(5, 8)).toBe("#.#");
    });

    test("dragging adds each further value hovered, as one entry", async ({ page }) => {
        await drag(
            page,
            [2, 2],
            [
                [3, 3],
                [4, 4],
            ],
        );
        // Tile 1 and tile 2; the empty cell (3, 3) crossed on the way counts too: every cell
        // of the map but the flipped tile at (6, 6).
        const after = await selection(page);
        expect([after?.x, after?.y, after?.width, after?.height]).toEqual([0, 0, 40, 30]);
        expect(after?.rows[6]?.slice(5, 8)).toBe("#.#");
        expect(after?.rows.join("").replace(/#/g, "")).toBe(".");
        expect(await history(page)).toEqual({ undo: "Select Same Tile", redo: null });
        expect(await undo(page)).toBe(true);
        expect(await selection(page)).toBeNull();
    });

    test("Shift adds, Ctrl subtracts, Ctrl+Shift intersects; a right click clears", async ({
        page,
    }) => {
        await clickAt(page, 4, 4);
        await holding(page, ["Shift"], () => clickAt(page, 6, 6));
        expect(await selection(page)).toEqual(pictured(4, 4, ["#..", "...", "..#"]));
        await holding(page, ["Control"], () => clickAt(page, 4, 4));
        expect(await selection(page)).toEqual(pictured(6, 6, ["#"]));
        await setSelection(page, { x: 0, y: 0, width: 5, height: 5 });
        await holding(page, ["Control", "Shift"], () => clickAt(page, 10, 5));
        expect(await selection(page)).toEqual(pictured(2, 2, ["#"]));
        await pressAt(page, 20, 20, "right");
        await page.mouse.up({ button: "right" });
        expect(await selection(page)).toBeNull();
    });

    test("the context bar's Mode stands for the modifiers", async ({ page }) => {
        const mode = page.getByRole("radiogroup", { name: "Mode" });
        await setSelection(page, { x: 0, y: 0, width: 5, height: 5 });
        await mode.getByRole("radio", { name: "Intersect" }).click();
        await clickAt(page, 10, 5);
        expect(await selection(page)).toEqual(pictured(2, 2, ["#"]));
        await mode.getByRole("radio", { name: "Add" }).click();
        await clickAt(page, 4, 4);
        expect(await selection(page)).toEqual(pictured(2, 2, ["#..", "...", "..#"]));
        await mode.getByRole("radio", { name: "Subtract" }).click();
        await clickAt(page, 2, 2);
        expect(await selection(page)).toEqual(pictured(4, 4, ["#"]));
    });
});

test.describe("Select menu, keys and Escape", () => {
    test.beforeEach(async ({ page }) => {
        await openEditor(page, "stamp");
    });

    test("Select All, Select None and Invert Selection from the menu", async ({ page }) => {
        const item = async (name: string) => {
            await page.getByRole("menuitem", { name: "Select", exact: true }).click();
            await page.getByRole("menuitem", { name }).click();
        };
        await item("Select All");
        expect(await selection(page)).toEqual(rectSelection({ x: 0, y: 0, width: 40, height: 30 }));
        await expect(selectionStatus(page)).toHaveText("40 × 30");
        expect(await history(page)).toEqual({ undo: "Select All", redo: null });
        await item("Select None");
        expect(await selection(page)).toBeNull();
        await setSelection(page, { x: 0, y: 0, width: 40, height: 29 });
        await item("Invert Selection");
        expect(await selection(page)).toEqual(rectSelection({ x: 0, y: 29, width: 40, height: 1 }));
        expect(await history(page)).toEqual({ undo: "Invert Selection", redo: null });
    });

    test("Ctrl+A, Ctrl+D and Ctrl+I", async ({ page }) => {
        await page.locator("[data-viewport]").focus();
        await page.keyboard.press("Control+KeyA");
        expect(await selection(page)).toEqual(rectSelection({ x: 0, y: 0, width: 40, height: 30 }));
        await page.keyboard.press("Control+KeyD");
        expect(await selection(page)).toBeNull();
        await page.keyboard.press("Control+KeyI");
        expect(await selection(page)).toEqual(rectSelection({ x: 0, y: 0, width: 40, height: 30 }));
        await page.keyboard.press("Control+KeyI");
        expect(await selection(page)).toBeNull();
        expect(await history(page)).toEqual({ undo: "Invert Selection", redo: null });
    });

    test("Escape with a tile tool active clears the selection; not with Hand", async ({ page }) => {
        await setSelection(page, BASE);
        await page.locator("[data-viewport]").focus();
        await page.keyboard.press("Escape");
        expect(await selection(page)).toBeNull();
        expect(await history(page)).toEqual({ undo: "Select None", redo: null });

        await setSelection(page, BASE);
        await page.keyboard.press("KeyH");
        expect(await activeTool(page)).toBe("hand");
        await page.keyboard.press("Escape");
        expect(await selection(page)).toEqual(rectSelection(BASE));

        // The selection tools are tile tools too; their keys are M, W and S.
        for (const [key, tool] of [
            ["KeyM", "rectSelect"],
            ["KeyW", "wand"],
            ["KeyS", "sameTile"],
        ] as const) {
            await setSelection(page, BASE);
            await page.keyboard.press(key);
            expect(await activeTool(page)).toBe(tool);
            await page.keyboard.press("Escape");
            expect(await selection(page)).toBeNull();
        }
    });

    test("the selection stays when another tile layer becomes active", async ({ page }) => {
        await setSelection(page, BASE);
        await page.keyboard.press("ArrowUp");
        expect(await selection(page)).toEqual(rectSelection(BASE));
    });

    test("each map has its own selection", async ({ page }) => {
        const all = rectSelection({ x: 0, y: 0, width: 20, height: 10 });
        await setSelection(page, BASE);
        const { left, active } = await switchMap(page, null);
        expect(await selection(page)).toBeNull();
        await page.locator("[data-viewport]").focus();
        await page.keyboard.press("Control+KeyA");
        expect(await selection(page)).toEqual(all);
        await switchMap(page, left);
        expect(await selection(page)).toEqual(rectSelection(BASE));
        await switchMap(page, active);
        expect(await selection(page)).toEqual(all);
    });
});
