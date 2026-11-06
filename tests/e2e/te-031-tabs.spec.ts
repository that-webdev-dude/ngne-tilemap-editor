import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { MapView } from "../../src/core/model";
import type { Snapshot } from "./harness/te-031-page";
import { expect, openEditor } from "./te-013-support";
import { menuItem, openMenu } from "./te-007-support";

// TE-031: map commands and map tabs (SPEC §3, §7.1; DESIGN §2). The page module
// (harness/te-031-page.ts) loads "Quest" with one map, "Overworld" (40 × 30 cells, tile layers
// 1 and 2), and makes the changes that get their own controls in TE-032 (New Map, Rename) or
// that a stroke or the Layers panel makes (a painted cell, the active layer). Duplicate, Delete,
// Previous and Next Map run from the Map menu, Close Map from Alt+W and the tab's close
// control, undo and redo from Ctrl+Z and Ctrl+Y.

const PAGE_MODULE = "/tests/e2e/harness/te-031-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const snapshot = (page: Page) => call<Snapshot>(page, "snapshot");
const mapSession = (page: Page, id: string) =>
    call<{ layer: number | null; view: MapView | null }>(page, "mapSession", id);
const strip = (page: Page) => page.locator("[data-map-tabs]");
const tab = (page: Page, id: string) => page.locator(`[data-map-tab="${id}"]`);
const tabNames = (page: Page) => strip(page).getByRole("tab").allTextContents();

/** Opens the editor on the test project; returns the ID of "Overworld". */
async function load(page: Page): Promise<string> {
    await openEditor(page);
    const id = await call<string>(page, "load");
    await expect(tab(page, id)).toHaveAttribute("aria-selected", "true");
    return id;
}

/** Runs a command of the Map menu by clicking its item. */
async function mapMenu(page: Page, commandId: string): Promise<void> {
    await openMenu(page, "Map");
    await menuItem(page, commandId).click();
}

/** Presses `key` with the focus on the selected tab: no text field, so the global keys apply. */
async function press(page: Page, key: string): Promise<void> {
    await page.locator('[data-map-tab][aria-selected="true"]').focus();
    await page.keyboard.press(key);
}

/** Clicks the close control of a tab, which shows while the pointer is over the tab. */
async function closeControl(page: Page, id: string): Promise<Locator> {
    await tab(page, id).hover();
    return tab(page, id).locator("[data-tab-close]");
}

test("new, duplicate, rename and delete; undo restores each step and redo repeats it", async ({
    page,
}) => {
    const overworld = await load(page);
    await expect(page.locator("[data-project-name]")).toHaveText("Quest");

    const cave = await call<string>(page, "addMap", { name: "Cave", width: 20, height: 10 });
    await expect(tab(page, cave)).toHaveAttribute("aria-selected", "true");
    expect(await tabNames(page)).toEqual(["Overworld", "Cave"]);
    // The project's unsaved marker sits before the first tab.
    await expect(page.locator("[data-project-name] [data-unsaved-marker]")).toHaveCount(1);

    await mapMenu(page, "map.duplicate");
    let state = await snapshot(page);
    const copy = state.active;
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave", "Cave Copy"]);
    expect(state.open).toEqual([overworld, cave, copy]);
    await expect(tab(page, copy)).toHaveAttribute("aria-selected", "true");

    await call(page, "rename", copy, "Dungeon");
    await expect(tab(page, copy)).toHaveText("Dungeon");

    await mapMenu(page, "map.delete");
    state = await snapshot(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave"]);
    expect(state.active).toBe(cave);
    await expect(tab(page, copy)).toHaveCount(0);
    expect(state.undoLabel).toBe("Delete Map");

    // Undo, step by step.
    await press(page, "Control+z");
    state = await snapshot(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave", "Dungeon"]);
    expect(state.active).toBe(copy);
    expect(state.open).toEqual([overworld, cave, copy]);
    await press(page, "Control+z");
    await expect(tab(page, copy)).toHaveText("Cave Copy");
    await press(page, "Control+z");
    state = await snapshot(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave"]);
    expect(state.active).toBe(cave);
    await press(page, "Control+z");
    state = await snapshot(page);
    expect(state.maps.map((map) => map.id)).toEqual([overworld]);
    expect(state).toMatchObject({ active: overworld, open: [overworld], undo: 0, dirty: false });
    await expect(page.locator("[data-project-name] [data-unsaved-marker]")).toHaveCount(0);

    // Redo repeats them.
    for (let step = 0; step < 4; step++) await press(page, "Control+y");
    state = await snapshot(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave"]);
    expect(state).toMatchObject({ active: cave, open: [overworld, cave], redo: 0 });
});

test("Delete Map is disabled for the last map", async ({ page }) => {
    await load(page);
    await openMenu(page, "Map");
    await expect(menuItem(page, "map.delete")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "map.duplicate")).not.toHaveAttribute("aria-disabled", "true");
});

test("closing a tab keeps the map; Previous and Next Map go through the open tabs", async ({
    page,
}) => {
    const overworld = await load(page);
    const cave = await call<string>(page, "addMap", { name: "Cave" });
    const hall = await call<string>(page, "addMap", { name: "Hall" });
    expect((await snapshot(page)).open).toEqual([overworld, cave, hall]);

    await mapMenu(page, "map.next");
    expect((await snapshot(page)).active).toBe(overworld);
    await mapMenu(page, "map.previous");
    expect((await snapshot(page)).active).toBe(hall);

    // The close control of a background tab closes it; the active map stays.
    await (await closeControl(page, cave)).click();
    let state = await snapshot(page);
    expect(state.open).toEqual([overworld, hall]);
    expect(state.active).toBe(hall);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave", "Hall"]);
    await expect(tab(page, cave)).toHaveCount(0);

    // Alt+W closes the active tab; the one before it takes its place.
    await press(page, "Alt+w");
    state = await snapshot(page);
    expect(state).toMatchObject({ open: [overworld], active: overworld });
    expect(state.maps).toHaveLength(3);
    // Closing tabs is no change of the project: nothing to undo for it.
    expect(state.undoLabel).toBe("New Map");

    // A middle click closes the last tab: no map is shown, the project keeps all three.
    await tab(page, overworld).click({ button: "middle" });
    state = await snapshot(page);
    expect(state).toMatchObject({ open: [], active: "" });
    expect(state.maps).toHaveLength(3);
    await expect(strip(page).getByRole("tab")).toHaveCount(0);
});

test("undo of a change on an inactive or closed map opens its tab first", async ({ page }) => {
    const overworld = await load(page);
    const cave = await call<string>(page, "addMap", { name: "Cave" });
    await call(page, "paint", 5, 5);
    expect(await call<number>(page, "cell", cave, 5, 5)).not.toBe(0);

    // Inactive: the Cave tab is selected again and its cell undone.
    await tab(page, overworld).click();
    await press(page, "Control+z");
    let state = await snapshot(page);
    expect(state.active).toBe(cave);
    await expect(tab(page, cave)).toHaveAttribute("aria-selected", "true");
    expect(await call<number>(page, "cell", cave, 5, 5)).toBe(0);

    // Redo of a change on another map switches to it too.
    await tab(page, overworld).click();
    await press(page, "Control+y");
    expect((await snapshot(page)).active).toBe(cave);
    expect(await call<number>(page, "cell", cave, 5, 5)).not.toBe(0);

    // Closed: the tab comes back, selected, and the cell is undone.
    await press(page, "Alt+w");
    state = await snapshot(page);
    expect(state).toMatchObject({ open: [overworld], active: overworld });
    await press(page, "Control+z");
    state = await snapshot(page);
    expect(state).toMatchObject({ open: [overworld, cave], active: cave });
    expect(await call<number>(page, "cell", cave, 5, 5)).toBe(0);
});

test("the view and the active layer of a map survive a tab switch", async ({ page }) => {
    const overworld = await load(page);
    await call(page, "setActiveLayer", 2);
    await call(page, "zoom", 3);
    const before = await mapSession(page, overworld);
    expect(before.layer).toBe(2);
    expect(before.view!.zoom).not.toBe(1);

    const cave = await call<string>(page, "addMap", { name: "Cave" });
    await call(page, "zoom", 0.5);
    expect((await mapSession(page, cave)).layer).toBe(1);

    await tab(page, overworld).click();
    expect((await snapshot(page)).active).toBe(overworld);
    expect(await mapSession(page, overworld)).toEqual(before);
});

test("a new map opens fitted and keeps its view when switched away and back", async ({ page }) => {
    const overworld = await load(page);
    const cave = await call<string>(page, "addMap", { name: "Cave", width: 20, height: 10 });
    const fitted = (await mapSession(page, cave)).view!;
    expect(fitted.zoom).not.toBe(1);
    // Fit again changes nothing: the map was fitted.
    await page.evaluate(() => window.__ngneTest!.commands.get("view.fit")!.run());
    expect((await mapSession(page, cave)).view).toEqual(fitted);

    await call(page, "zoom", 1);
    const zoomed = (await mapSession(page, cave)).view!;
    expect(zoomed).not.toEqual(fitted);
    await tab(page, overworld).click();
    await tab(page, cave).click();
    expect((await mapSession(page, cave)).view).toEqual(zoomed);

    // Duplicate fits its copy too, whatever the view of the map it copies.
    await mapMenu(page, "map.duplicate");
    const copy = (await snapshot(page)).active;
    expect((await mapSession(page, copy)).view).toEqual(fitted);
});

test("tabs reorder from the keyboard and by dragging; the map list keeps its order", async ({
    page,
}) => {
    const overworld = await load(page);
    const cave = await call<string>(page, "addMap", { name: "Cave" });
    await tab(page, overworld).focus();
    await page.keyboard.press("Control+Shift+ArrowRight");
    expect((await snapshot(page)).open).toEqual([cave, overworld]);
    await expect(tab(page, overworld)).toBeFocused();

    const from = await tab(page, overworld).boundingBox();
    const to = await tab(page, cave).boundingBox();
    if (!from || !to) throw new Error("no tab box");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 4 });
    await page.mouse.up();
    const state = await snapshot(page);
    expect(state.open).toEqual([overworld, cave]);
    expect(state.maps.map((map) => map.id)).toEqual([overworld, cave]);
    expect(state.undoLabel).toBe("New Map");
});

test("a tileset's texture is released when no open map uses it", async ({ page }) => {
    const overworld = await load(page);
    const cave = await call<string>(page, "addMap", { name: "Cave" });
    await call(page, "paint", 5, 5);
    await expect.poll(() => call<string[]>(page, "tilesetTextures")).toEqual(["ed:ts:ts"]);

    // Only Cave uses the tileset; closing its tab releases the texture (ENGINE §3).
    await press(page, "Alt+w");
    expect((await snapshot(page)).open).toEqual([overworld]);
    await expect.poll(() => call<string[]>(page, "tilesetTextures")).toEqual([]);

    // Undo of the cell opens Cave again; once it has a cell of the tileset, the texture is back.
    await press(page, "Control+z");
    expect((await snapshot(page)).active).toBe(cave);
    await call(page, "paint", 6, 6);
    await expect.poll(() => call<string[]>(page, "tilesetTextures")).toEqual(["ed:ts:ts"]);
});
