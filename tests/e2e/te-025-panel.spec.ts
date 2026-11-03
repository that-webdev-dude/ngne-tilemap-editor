import { test } from "@playwright/test";
import { confirmButton, gridPng, importDialog } from "./te-024-support";
import {
    cells,
    clickCell,
    dragTiles,
    dropFilesOn,
    expect,
    openEditor,
    pageCall,
    panel,
    panelState,
    pixel,
    stamp,
    statusField,
    tileCanvas,
    tileClient,
    tileColour,
    tileGrid,
    tileOrigin,
    tilesetTab,
    token,
} from "./te-025-support";

// TE-025: the Tilesets panel (SPEC §6.2, DESIGN §8.5) on a project of two tilesets
// (harness/te-025-map.ts): "Terrain", 12 tiles of 16 px on 4 columns, and "Props", 3 tiles of
// 8 px. The grid starts at 2×: tile (column, row) at 1 + 33 · column, 1 + 33 · row.

/** The 3 × 2 tiles of Terrain from tile (1, 0) to tile (3, 1), as "slot:tile". */
const BLOCK = ["1:1", "1:2", "1:3", "1:5", "1:6", "1:7"];

test("a drag over 3 × 2 tiles makes a 3 × 2 stamp that paints those tiles", async ({ page }) => {
    await openEditor(page);
    expect(await pageCall(page, "selectedTool")).toBe("eraser");

    await dragTiles(page, [1, 0], [3, 1]);
    expect(await stamp(page)).toEqual({ width: 3, height: 2, cells: BLOCK });
    // Tiled's `MapEditor::setStamp`: a stamp from the panel selects the stamp brush.
    expect(await pageCall(page, "selectedTool")).toBe("stamp");

    // The stamp's anchor is its centre cell (1, 1): a click on (10, 5) paints from (9, 4).
    await clickCell(page, 10, 5);
    expect(await cells(page)).toEqual([
        "9,4:1:1",
        "10,4:1:2",
        "11,4:1:3",
        "9,5:1:5",
        "10,5:1:6",
        "11,5:1:7",
    ]);

    // The selection's 2 px accent outline lies over the gaps round the rectangle.
    const accent = await token(page, "--accent");
    const { x, y } = tileOrigin(16, 2, 1, 0);
    expect((await pixel(page, x - 1, y + 10)).slice(0, 3)).toEqual(accent);
    expect((await pixel(page, x + 10, y + 2 * 33 - 1)).slice(0, 3)).toEqual(accent);
});

test("a click makes a one-tile stamp; a drag back over the start selects up and left", async ({
    page,
}) => {
    await openEditor(page);
    const at = await tileClient(page, 2, 2);
    await page.mouse.click(at.x, at.y);
    expect(await stamp(page)).toEqual({ width: 1, height: 1, cells: ["1:10"] });

    await dragTiles(page, [3, 2], [2, 1]);
    expect(await stamp(page)).toEqual({
        width: 2,
        height: 2,
        cells: ["1:6", "1:7", "1:10", "1:11"],
    });
});

test("keyboard selection and Enter make the same stamp as the pointer", async ({ page }) => {
    await openEditor(page);
    await tileGrid(page).focus();
    // The first arrow selects the first tile; then the selection moves and Shift extends it.
    await page.keyboard.press("ArrowRight");
    expect(await stamp(page)).toBeNull();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    // Arrows only select; Enter makes the stamp.
    expect(await stamp(page)).toBeNull();
    await page.keyboard.press("Enter");
    expect(await stamp(page)).toEqual({ width: 3, height: 2, cells: BLOCK });
    await expect(statusField(page, "panelTile")).toHaveText("Terrain 3 × 2");

    // Arrows stay inside the grid; without Shift the selection is one tile again.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    expect(await stamp(page)).toEqual({ width: 1, height: 1, cells: ["1:11"] });

    // The grid is one tab stop: Tab leaves it.
    await page.keyboard.press("Tab");
    await expect(tileGrid(page)).not.toBeFocused();
});

test("tabs switch tilesets; [ and ] step through them in the panel and on the canvas", async ({
    page,
}) => {
    const ids = await openEditor(page);
    const terrain = tilesetTab(page, "Terrain");
    const props = tilesetTab(page, "Props");
    await expect(terrain).toHaveAttribute("aria-selected", "true");

    await props.click();
    await expect(props).toHaveAttribute("aria-selected", "true");
    await expect(terrain).toHaveAttribute("aria-selected", "false");
    await expect(tileGrid(page)).toHaveAttribute("data-tile-grid", ids[1]!);
    // Props: 3 tiles of 8 px at 2× on one row.
    const props0 = tileOrigin(8, 2, 0, 0);
    expect((await pixel(page, props0.x + 8, props0.y + 8)).slice(0, 3)).toEqual(tileColour(1, 0));
    const at = await tileClient(page, 2, 0, 8);
    await page.mouse.click(at.x, at.y);
    expect(await stamp(page)).toEqual({ width: 1, height: 1, cells: ["2:2"] });

    // In the panel context (the grid focused): [ goes back; as Tiled's, neither key wraps
    // round at the ends.
    await tileGrid(page).focus();
    await page.keyboard.press("]");
    expect((await panelState(page)).active).toBe(ids[1]);
    await page.keyboard.press("[");
    expect((await panelState(page)).active).toBe(ids[0]);
    await expect(terrain).toHaveAttribute("aria-selected", "true");
    // The grid keeps the focus across the switch: the keys go on acting on the new tileset.
    await expect(tileGrid(page)).toBeFocused();
    await page.keyboard.press("[");
    expect((await panelState(page)).active).toBe(ids[0]);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    expect(await stamp(page)).toEqual({ width: 1, height: 1, cells: ["1:0"] });

    // In the canvas context (nothing focused) the same keys act.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("]");
    expect((await panelState(page)).active).toBe(ids[1]);
    await page.keyboard.press("[");
    expect((await panelState(page)).active).toBe(ids[0]);

    // Each tileset keeps its own selection.
    await terrain.click();
    await dragTiles(page, [0, 0], [1, 0]);
    await props.click();
    await expect(statusField(page, "panelTile")).toHaveText("Props#2");

    // Arrows on the tab strip move between tabs.
    await props.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(terrain).toBeFocused();
    await expect(terrain).toHaveAttribute("aria-selected", "true");
});

test("the zoom select changes the grid's scale", async ({ page }) => {
    await openEditor(page);
    const grid = tileGrid(page);
    await expect(grid).toHaveAttribute("data-zoom", "2");
    // At 2× the point (98, 33) is in tile (2, 0); at 4× in tile (1, 0).
    expect((await pixel(page, 98, 20)).slice(0, 3)).toEqual(tileColour(0, 2));

    await panel(page).getByRole("combobox", { name: "Zoom" }).click();
    await page.getByRole("option", { name: "4×" }).click();
    await expect(grid).toHaveAttribute("data-zoom", "4");
    expect((await panelState(page)).zoom).toBe(4);
    // Four columns of 64 px tiles with 1 px gaps.
    const sizer = await grid.locator(".tilesets-panel__sizer").boundingBox();
    expect(sizer?.width).toBe(4 * 65 + 1);
    expect((await pixel(page, 98, 20)).slice(0, 3)).toEqual(tileColour(0, 1));

    // A drag at 4× still selects by tile.
    const start = await tileClient(page, 0, 0, 16, 4);
    const end = await tileClient(page, 1, 1, 16, 4);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    await page.mouse.up();
    expect(await stamp(page)).toEqual({ width: 2, height: 2, cells: ["1:0", "1:1", "1:4", "1:5"] });
});

test("the class filter hides non-matching tiles; marks show class, animation and collision", async ({
    page,
}) => {
    await openEditor(page);
    const muted = await token(page, "--text-muted");
    const text = await token(page, "--text");
    const centre = (column: number, row: number) => {
        const { x, y } = tileOrigin(16, 2, column, row);
        return pixel(page, x + 16, y + 16);
    };
    const topRight = (column: number, row: number) => {
        const { x, y } = tileOrigin(16, 2, column, row);
        return pixel(page, x + 31, y);
    };

    // Class (tiles 1, 2) and properties (tile 9): the corner triangle.
    expect((await topRight(1, 0)).slice(0, 3)).toEqual(muted);
    // DESIGN §4: a 4 px triangle; just past its edges is the tile.
    const classed = tileOrigin(16, 2, 1, 0);
    expect((await pixel(page, classed.x + 30, classed.y + 1)).slice(0, 3)).toEqual(muted);
    expect((await pixel(page, classed.x + 27, classed.y)).slice(0, 3)).toEqual(tileColour(0, 1));
    expect((await pixel(page, classed.x + 31, classed.y + 4)).slice(0, 3)).toEqual(
        tileColour(0, 1),
    );
    expect((await topRight(2, 0)).slice(0, 3)).toEqual(muted);
    expect((await topRight(1, 2)).slice(0, 3)).toEqual(muted);
    expect((await topRight(0, 0)).slice(0, 3)).toEqual(tileColour(0, 0));
    // Animated (tile 5): ▶ at the bottom left, on its chip.
    const animated = tileOrigin(16, 2, 1, 1);
    expect((await pixel(page, animated.x + 4, animated.y + 26)).slice(0, 3)).toEqual(text);
    const still = tileOrigin(16, 2, 0, 1);
    expect((await pixel(page, still.x + 4, still.y + 26)).slice(0, 3)).toEqual(tileColour(0, 4));
    // Collision (tile 6): an outline square at the bottom right, hollow.
    const solid = tileOrigin(16, 2, 2, 1);
    expect((await pixel(page, solid.x + 24, solid.y + 24)).slice(0, 3)).toEqual(text);
    expect((await pixel(page, solid.x + 26, solid.y + 26)).slice(0, 3)).not.toEqual(text);
    const plain = tileOrigin(16, 2, 3, 1);
    expect((await pixel(page, plain.x + 24, plain.y + 24)).slice(0, 3)).toEqual(tileColour(0, 7));

    // "solid" matches "solid" and "Solid wall"; every other tile is left clear in place.
    const filter = panel(page).getByRole("textbox", { name: "Filter by tile class" });
    await filter.fill("solid");
    await expect.poll(async () => (await centre(0, 0))[3]).toBe(0);
    expect((await centre(1, 0)).slice(0, 3)).toEqual(tileColour(0, 1));
    expect((await centre(2, 0)).slice(0, 3)).toEqual(tileColour(0, 2));
    expect((await centre(3, 0))[3]).toBe(0);
    expect((await centre(1, 1))[3]).toBe(0);

    // A hidden tile takes no press and is an empty cell of a stamp across it.
    const hidden = await tileClient(page, 0, 0);
    await page.mouse.click(hidden.x, hidden.y);
    expect(await stamp(page)).toBeNull();
    await dragTiles(page, [1, 0], [2, 1]);
    expect(await stamp(page)).toEqual({ width: 2, height: 2, cells: ["1:1", "1:2", "", ""] });

    await filter.fill("");
    await expect.poll(async () => (await centre(0, 0)).slice(0, 3)).toEqual(tileColour(0, 0));
});

test("the status bar shows the hovered tile, else the selected one", async ({ page }) => {
    await openEditor(page);
    const field = statusField(page, "panelTile");
    await expect(field).toHaveCount(0);
    const hovered = await tileClient(page, 1, 0);
    await page.mouse.move(hovered.x, hovered.y);
    await expect(field).toHaveText("Terrain#1 (solid)");
    const other = await tileClient(page, 1, 2);
    await page.mouse.move(other.x, other.y);
    await expect(field).toHaveText("Terrain#9");

    await page.mouse.click(other.x, other.y);
    const box = await tileCanvas(page).boundingBox();
    await page.mouse.move(box!.x + box!.width + 200, box!.y - 100);
    await expect(field).toHaveText("Terrain#9");
});

test("the tile menu lists the commands registered for it", async ({ page }) => {
    await openEditor(page);
    const button = panel(page).getByRole("button", { name: "Tile menu" });
    // Nothing registers in the tile menu before the tile editors (TE-029, TE-030, TE-040).
    await expect(button).toBeDisabled();
    await pageCall(page, "addTileCommand", "Edit Test…");
    await expect(button).toBeDisabled();

    const at = await tileClient(page, 1, 1);
    await page.mouse.click(at.x, at.y);
    await expect(button).toBeEnabled();
    await button.click();
    await page.getByRole("menuitem", { name: "Edit Test…" }).click();
    expect(await pageCall(page, "tileCommandRuns")).toBe(1);

    // A right click on the grid opens the same menu.
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByRole("menuitem", { name: "Edit Test…" }).click();
    expect(await pageCall(page, "tileCommandRuns")).toBe(2);
});

test("a PNG dropped on the panel opens the import dialog; the new tileset gets a tab", async ({
    page,
}) => {
    await openEditor(page);
    const file = gridPng("rocks.png", 64, 32);
    // New Tileset (+) is Import Tileset…: it asks for files.
    const chooser = page.waitForEvent("filechooser");
    await panel(page).getByRole("button", { name: "New Tileset" }).click();
    await (await chooser).setFiles([]);

    // On the window only a sprite project imports (TE-024); a PNG there does nothing.
    await dropFilesOn(page, "body", [file]);
    await expect(importDialog(page)).toHaveCount(0);

    await dropFilesOn(page, "[data-tile-grid]", [file]);
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await confirmButton(dialog).click();
    await expect(dialog).toBeHidden();
    // As Tiled's dock, adding a tileset leaves the tab shown as it is.
    await expect(panel(page).getByRole("tab")).toHaveText(["Terrain", "Props", "rocks"]);
    await expect(tilesetTab(page, "Terrain")).toHaveAttribute("aria-selected", "true");
    await tilesetTab(page, "rocks").click();
    const first = tileOrigin(16, 2, 0, 0);
    expect((await pixel(page, first.x + 16, first.y + 16)).slice(0, 3)).toEqual([8, 8, 7]);
});
