import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expect, openEditor as openTilesetEditor, tileColour } from "./te-025-support";

// TE-043: the Terrains panel (SPEC §5.1, DESIGN §8.6) on the project of harness/te-043-page.ts:
// tileset "Terrain" (12 tiles of 16 px, 4 columns, at 2×) with the sets "Cliffs" (corner),
// "Roads" (edge) and "Blend" (mixed), two terrains each and no tiles. A click on a tile assigns
// the selected terrain to the corner or edge under the pointer, picked as the terrain brush
// picks it; a right click clears it; Shift+click assigns the whole tile. Each is one history
// entry with the expected WangIds; the marks are read back from the canvas; the missing count
// follows. The panel's own commands add sets and terrains, and a type change clears indexes.

const PAGE_MODULE = "/tests/e2e/harness/te-043-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const panel = (page: Page) => page.locator("[data-terrains-panel]");
const canvas = (page: Page) => page.locator("[data-terrain-canvas]");
const setRow = (page: Page, set: number) => panel(page).locator(`[data-terrain-set="${set}"]`);
const terrainRow = (page: Page, set: number, terrain: number) =>
    panel(page).locator(`[data-terrain="${set}:${terrain}"]`);
const wangIds = (page: Page, set: number) => call<Record<number, number[]>>(page, "wangIds", set);
const history = (page: Page) => call<{ undo: number; label: string | null }>(page, "history");
const markPixel = (page: Page, tile: number, index: number) =>
    call<number[]>(page, "markPixel", tile, index);

const TOP = 0;
const TOP_RIGHT = 1;
const RIGHT = 2;
const BOTTOM_RIGHT = 3;
const BOTTOM = 4;
const BOTTOM_LEFT = 5;
const LEFT = 6;
const TOP_LEFT = 7;

async function open(page: Page): Promise<void> {
    await openTilesetEditor(page);
    await call(page, "load");
    const bottom = page.locator('[data-region="bottom-panel"]');
    await bottom.getByRole("tab", { name: "Terrains" }).click();
    await expect(panel(page)).toBeVisible();
    await expect(setRow(page, 2)).toBeVisible();
}

/** Selects terrain `terrain` of set `set` by clicking its name. */
async function selectTerrain(page: Page, set: number, terrain: number): Promise<void> {
    const name = terrainRow(page, set, terrain).locator("[data-terrain-name]");
    await name.click();
    await expect(name).toHaveAttribute("aria-pressed", "true");
}

/** Clicks tile `tile` at `(fx, fy)` across it, with `button` and Shift as given. */
async function clickTile(
    page: Page,
    tile: number,
    fx: number,
    fy: number,
    options: { button?: "left" | "right"; shift?: boolean } = {},
): Promise<void> {
    const box = await canvas(page).boundingBox();
    if (!box) throw new Error("the terrain canvas has no box");
    const at = await call<{ x: number; y: number }>(page, "tilePoint", tile, fx, fy);
    if (options.shift) await page.keyboard.down("Shift");
    await page.mouse.click(box.x + at.x, box.y + at.y, { button: options.button ?? "left" });
    if (options.shift) await page.keyboard.up("Shift");
}

/** Expects one more history entry, "Change Tile Terrain", than `before`. */
async function expectEntry(page: Page, before: number): Promise<void> {
    await expect
        .poll(() => history(page))
        .toEqual({ undo: before + 1, label: "Change Tile Terrain" });
}

const rgb = (pixel: number[]) => pixel.slice(0, 3);
/** Tile `id`'s own colour, where no mark is drawn. */
const tileRgb = (id: number) => tileColour(0, id);

test("corner set: a click assigns the nearest corner, right click clears it, marks read back", async ({
    page,
}) => {
    await open(page);
    await selectTerrain(page, 0, 2);
    const start = (await history(page)).undo;

    await clickTile(page, 0, 0.2, 0.2);
    await expectEntry(page, start);
    expect(await wangIds(page, 0)).toEqual({ 0: [0, 0, 0, 0, 0, 0, 0, 2] });
    await clickTile(page, 0, 0.8, 0.9);
    await expectEntry(page, start + 1);
    // The centre third rounds to a corner too (the brush's rule, SPEC §5.3).
    await clickTile(page, 0, 0.6, 0.4);
    await expectEntry(page, start + 2);
    expect(await wangIds(page, 0)).toEqual({ 0: [0, 2, 0, 2, 0, 0, 0, 2] });

    // Marks: the corners with a terrain in its colour, the others show the tile.
    await expect.poll(async () => rgb(await markPixel(page, 0, TOP_LEFT))).toEqual([0, 0, 255]);
    expect(rgb(await markPixel(page, 0, TOP_RIGHT))).toEqual([0, 0, 255]);
    expect(rgb(await markPixel(page, 0, BOTTOM_RIGHT))).toEqual([0, 0, 255]);
    expect(rgb(await markPixel(page, 0, BOTTOM_LEFT))).toEqual(tileRgb(0));
    expect(rgb(await markPixel(page, 1, TOP_LEFT))).toEqual(tileRgb(1));

    // Right click clears the corner under the pointer; the page's menu does not open.
    await clickTile(page, 0, 0.1, 0.1, { button: "right" });
    await expectEntry(page, start + 3);
    expect(await wangIds(page, 0)).toEqual({ 0: [0, 2, 0, 2, 0, 0, 0, 0] });
    await expect.poll(async () => rgb(await markPixel(page, 0, TOP_LEFT))).toEqual(tileRgb(0));
    await expect(page.locator('[role="menu"]')).toHaveCount(0);

    // Clearing the last corners takes the tile out of the set.
    await clickTile(page, 0, 0.9, 0.1, { button: "right" });
    await clickTile(page, 0, 0.9, 0.9, { button: "right" });
    await expectEntry(page, start + 5);
    expect(await wangIds(page, 0)).toEqual({});

    // Undo and redo step through the entries.
    expect(await call(page, "undo")).toBe(true);
    expect(await wangIds(page, 0)).toEqual({ 0: [0, 0, 0, 2, 0, 0, 0, 0] });
    await expect.poll(async () => rgb(await markPixel(page, 0, BOTTOM_RIGHT))).toEqual([0, 0, 255]);
    expect(await call(page, "redo")).toBe(true);
    expect(await wangIds(page, 0)).toEqual({});
});

test("Shift+click assigns the whole tile; the missing count and list follow", async ({ page }) => {
    await open(page);
    const missing = panel(page).locator("[data-missing-count]");
    await setRow(page, 0).locator("[data-terrain-set-name]").click();
    await expect(missing).toHaveText("16");

    await selectTerrain(page, 0, 2);
    const start = (await history(page)).undo;
    await clickTile(page, 1, 0.5, 0.5, { shift: true });
    await expectEntry(page, start);
    expect(await wangIds(page, 0)).toEqual({ 1: [0, 2, 0, 2, 0, 2, 0, 2] });
    await expect(missing).toHaveText("15");
    for (const index of [TOP_RIGHT, BOTTOM_RIGHT, BOTTOM_LEFT, TOP_LEFT]) {
        await expect.poll(async () => rgb(await markPixel(page, 1, index))).toEqual([0, 0, 255]);
    }

    await selectTerrain(page, 0, 1);
    await clickTile(page, 2, 0.5, 0.5, { shift: true });
    await expectEntry(page, start + 1);
    await expect(missing).toHaveText("14");

    // Shift+right click clears the whole tile.
    await clickTile(page, 1, 0.5, 0.5, { button: "right", shift: true });
    await expectEntry(page, start + 2);
    expect(await wangIds(page, 0)).toEqual({ 2: [0, 1, 0, 1, 0, 1, 0, 1] });
    await expect(missing).toHaveText("15");

    // The disclosure lists the missing combinations as diagrams, in Tiled's pattern order:
    // all Low is present; the first missing one has High at the top right.
    const toggle = panel(page).locator("[data-missing-toggle]");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const items = panel(page).locator("[data-missing-combination]");
    await expect(items).toHaveCount(15);
    await expect(items.first()).toHaveAttribute("data-missing-combination", "0,2,0,1,0,1,0,1");
    await expect(panel(page).locator('[data-missing-combination="0,1,0,1,0,1,0,1"]')).toHaveCount(
        0,
    );
});

test("edge set: the edge by the cell's diagonals; mixed set: a 3 × 3 grid, its centre dead", async ({
    page,
}) => {
    await open(page);
    await selectTerrain(page, 1, 1);
    const start = (await history(page)).undo;
    await clickTile(page, 4, 0.5, 0.15);
    await clickTile(page, 4, 0.85, 0.45);
    await clickTile(page, 4, 0.4, 0.8);
    await expectEntry(page, start + 2);
    await selectTerrain(page, 1, 2);
    await clickTile(page, 4, 0.15, 0.6);
    await expectEntry(page, start + 3);
    expect(await wangIds(page, 1)).toEqual({ 4: [1, 0, 1, 0, 1, 0, 2, 0] });
    await expect.poll(async () => rgb(await markPixel(page, 4, TOP))).toEqual([0, 255, 0]);
    expect(rgb(await markPixel(page, 4, RIGHT))).toEqual([0, 255, 0]);
    expect(rgb(await markPixel(page, 4, BOTTOM))).toEqual([0, 255, 0]);
    expect(rgb(await markPixel(page, 4, LEFT))).toEqual([255, 255, 0]);
    // A corner of an edge set is never marked.
    expect(rgb(await markPixel(page, 4, TOP_LEFT))).toEqual(tileRgb(4));

    await selectTerrain(page, 2, 2);
    const mixed = (await history(page)).undo;
    // The centre of a mixed set's tile assigns nothing.
    await clickTile(page, 5, 0.5, 0.5);
    await clickTile(page, 5, 0.1, 0.1);
    await clickTile(page, 5, 0.5, 0.1);
    await clickTile(page, 5, 0.9, 0.5);
    await expectEntry(page, mixed + 2);
    expect(await wangIds(page, 2)).toEqual({ 5: [2, 0, 2, 0, 0, 0, 0, 2] });
    await expect.poll(async () => rgb(await markPixel(page, 5, TOP_LEFT))).toEqual([0, 255, 255]);
    expect(rgb(await markPixel(page, 5, TOP))).toEqual([0, 255, 255]);
    expect(rgb(await markPixel(page, 5, RIGHT))).toEqual([0, 255, 255]);
    expect(rgb(await markPixel(page, 5, BOTTOM))).toEqual(tileRgb(5));
    // A mixed set shows no missing count (SPEC §5.1: corner and edge sets).
    await expect(panel(page).locator("[data-terrain-missing]")).toHaveCount(0);
});

test("add a set and a terrain from the panel; a type change clears the unused indexes", async ({
    page,
}) => {
    await open(page);
    const start = (await history(page)).undo;

    // + → New Edge Set: "Unnamed Set" at the end, its rename open.
    await panel(page).locator("[data-terrain-set-add]").click();
    await page.locator('[role="menuitem"][data-command="terrain.newEdgeSet"]').click();
    await expect.poll(() => history(page)).toEqual({ undo: start + 1, label: "Add Terrain Set" });
    const rename = panel(page).locator("[data-terrain-rename]");
    await expect(rename).toBeFocused();
    await expect(rename).toHaveValue("Unnamed Set");
    await rename.fill("Rivers");
    await page.keyboard.press("Enter");
    await expect(setRow(page, 3).locator("[data-terrain-set-name]")).toHaveText("Rivers");
    await expect
        .poll(() => history(page))
        .toEqual({ undo: start + 2, label: "Change Terrain Set Name" });

    // The set's menu → Add Terrain: "Terrain 2", selected, its rename open; Escape keeps it.
    await setRow(page, 3).locator("[data-terrain-set-menu]").click();
    await page.locator('[role="menuitem"][data-command="terrain.add"]').click();
    await expect(panel(page).locator("[data-terrain-rename]")).toHaveValue("Terrain 2");
    await page.keyboard.press("Escape");
    await expect(terrainRow(page, 3, 2).locator("[data-terrain-name]")).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    const sets = await call<{ name: string; colors: { name: string; color: string }[] }[]>(
        page,
        "sets",
    );
    expect(sets[3]!.colors).toEqual([
        { name: "Terrain 1", color: "#ff0000ff", tile: null },
        { name: "Terrain 2", color: "#00ff00ff", tile: null },
    ]);

    // Mixed set "Blend" with corners and edges; its type → Corner clears the edges, one entry.
    await call(page, "setTiles", 2, [
        { tile: 0, wangId: [1, 2, 1, 2, 1, 2, 1, 2] },
        { tile: 3, wangId: [2, 0, 0, 0, 0, 0, 0, 0] },
    ]);
    const before = (await history(page)).undo;
    await setRow(page, 2).getByRole("combobox", { name: "Type of Blend" }).click();
    await page.getByRole("option", { name: "Corner" }).click();
    await expect
        .poll(() => history(page))
        .toEqual({ undo: before + 1, label: "Change Terrain Set Type" });
    expect(await wangIds(page, 2)).toEqual({ 0: [0, 2, 0, 2, 0, 2, 0, 2] });
    expect(await call(page, "undo")).toBe(true);
    expect(await wangIds(page, 2)).toEqual({
        0: [1, 2, 1, 2, 1, 2, 1, 2],
        3: [2, 0, 0, 0, 0, 0, 0, 0],
    });
});

test("the selection and the collapsed sets follow a moved set through undo and redo", async ({
    page,
}) => {
    await open(page);
    const name = (set: number) => setRow(page, set).locator("[data-terrain-set-name]");
    const toggle = (set: number) => setRow(page, set).locator("[data-terrain-set-toggle]");
    await toggle(0).click();
    await expect(toggle(0)).toHaveAttribute("aria-expanded", "false");
    await setRow(page, 0).locator("[data-terrain-set-menu]").click();
    await page.locator('[role="menuitem"][data-command="terrain.moveSetDown"]').click();
    await expect(name(1)).toHaveText("Cliffs");
    await expect(name(1)).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(1)).toHaveAttribute("aria-expanded", "false");
    await expect(toggle(0)).toHaveAttribute("aria-expanded", "true");

    expect(await call(page, "undo")).toBe(true);
    await expect(name(0)).toHaveText("Cliffs");
    await expect(name(0)).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(0)).toHaveAttribute("aria-expanded", "false");
    await expect(toggle(1)).toHaveAttribute("aria-expanded", "true");

    expect(await call(page, "redo")).toBe(true);
    await expect(name(1)).toHaveAttribute("aria-pressed", "true");
    await expect(toggle(1)).toHaveAttribute("aria-expanded", "false");
});
