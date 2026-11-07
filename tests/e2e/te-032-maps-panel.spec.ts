import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { Snapshot } from "./harness/te-032-page";
import { expect, openEditor } from "./te-013-support";
import { menuItem, openMenu } from "./te-007-support";

// TE-032: the Maps dock section (DESIGN §8.1). The page module (harness/te-032-page.ts) loads
// "Quest" with "Overworld" (40 × 30, active, the only tab), "Cave" (20 × 10) and "Dungeon"
// (64 × 64). Rows follow the project's map list; a click opens a map; a double click or F2
// renames in place; a drag reorders as one undo step; the row menu runs Map Properties…,
// Duplicate and Delete on its row's map.

const PAGE_MODULE = "/tests/e2e/harness/te-032-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const snapshot = (page: Page) => call<Snapshot>(page, "snapshot");
const panel = (page: Page) => page.locator("[data-maps-panel]");
const rows = (page: Page) => panel(page).locator("[data-map-row]");
const row = (page: Page, id: string) => page.locator(`[data-map-row="${id}"]`);
const tab = (page: Page, id: string) => page.locator(`[data-map-tab="${id}"]`);
const renameField = (page: Page) => panel(page).locator("[data-map-rename]");

/** Opens the editor on the test project; returns the IDs of Overworld, Cave and Dungeon. */
async function load(page: Page): Promise<[string, string, string]> {
    await openEditor(page);
    const ids = (await call<string[]>(page, "load")) as [string, string, string];
    await expect(rows(page)).toHaveCount(3);
    return ids;
}

/** What the rows show, top to bottom: name, open-tab dot, size, selected. */
async function shown(page: Page) {
    return rows(page).evaluateAll((elements) =>
        elements.map((element) => ({
            id: element.getAttribute("data-map-row"),
            name: element.querySelector(".maps-panel__name")?.textContent ?? null,
            open: element.querySelector("[data-open-tab]") !== null,
            size: element.querySelector("[data-map-size]")?.textContent ?? null,
            selected: element.getAttribute("aria-selected") === "true",
        })),
    );
}

/** The rows as the project's map list and the tabs say they should be. */
function expected(state: Snapshot) {
    return state.maps.map((map) => ({
        id: map.id,
        name: map.name,
        open: state.open.includes(map.id),
        size: `${map.width} × ${map.height}`,
        selected: map.id === state.active,
    }));
}

async function expectRowsMirror(page: Page): Promise<Snapshot> {
    const state = await snapshot(page);
    await expect.poll(() => shown(page)).toEqual(expected(state));
    return state;
}

/** Drags `source` by the mouse until its pointer is `dy` CSS pixels below where it started. */
async function drag(page: Page, source: Locator, dy: number): Promise<void> {
    const box = (await source.boundingBox())!;
    const x = box.x + 24;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step++) await page.mouse.move(x, y + (dy * step) / 8);
    await page.mouse.up();
}

test("rows mirror the map list, its tabs and the active map through every change", async ({
    page,
}) => {
    const [overworld, cave] = await load(page);
    let state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave", "Dungeon"]);
    // Only the active map has a tab: one dot.
    expect((await shown(page)).map((each) => each.open)).toEqual([true, false, false]);

    // A click opens the map in a tab and shows it.
    await row(page, cave).click();
    await expect(tab(page, cave)).toHaveAttribute("aria-selected", "true");
    state = await expectRowsMirror(page);
    expect(state.open).toEqual([overworld, cave]);
    expect(state.undo).toBe(0);

    // Duplicate from the Map menu adds a row after its map; Move Map Down moves it.
    await openMenu(page, "Map");
    await menuItem(page, "map.duplicate").click();
    state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.name)).toEqual([
        "Overworld",
        "Cave",
        "Cave Copy",
        "Dungeon",
    ]);
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Move Map Down");
    await page.keyboard.press("Enter");
    state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.name)).toEqual([
        "Overworld",
        "Cave",
        "Dungeon",
        "Cave Copy",
    ]);

    // Undo takes both back; the rows follow.
    await page.locator("[data-viewport-focus]").focus();
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave", "Dungeon"]);
});

test("rename in place: double click or F2, Enter or leaving applies, Escape and blank keep", async ({
    page,
}) => {
    const [overworld, cave, dungeon] = await load(page);

    // Double click, type, Enter: one entry "Rename Map"; the focus is back on the row.
    await row(page, cave).dblclick();
    await expect(renameField(page)).toBeFocused();
    await expect(renameField(page)).toHaveValue("Cave");
    await renameField(page).fill("Grotto");
    await renameField(page).press("Enter");
    await expect(renameField(page)).toHaveCount(0);
    await expect(row(page, cave)).toBeFocused();
    let state = await expectRowsMirror(page);
    expect(state.maps[1]!.name).toBe("Grotto");
    expect(state).toMatchObject({ undo: 1, undoLabel: "Rename Map" });
    // The export name stays (FORMAT §2.5).
    expect(state.maps[1]!.exportName).toBe("cave");

    // F2 on the focused row; Escape keeps the old name.
    await page.keyboard.press("ArrowDown");
    await expect(row(page, dungeon)).toBeFocused();
    await page.keyboard.press("F2");
    await expect(renameField(page)).toHaveValue("Dungeon");
    await renameField(page).fill("Crypt");
    await renameField(page).press("Escape");
    await expect(renameField(page)).toHaveCount(0);
    expect((await snapshot(page)).maps[2]!.name).toBe("Dungeon");

    // A blank name keeps the old one; leaving the field applies a typed one.
    await page.keyboard.press("F2");
    await renameField(page).fill("   ");
    await renameField(page).press("Enter");
    expect((await snapshot(page)).maps[2]!.name).toBe("Dungeon");
    await row(page, overworld).dblclick();
    await renameField(page).fill("World");
    await page.locator("[data-viewport-focus]").click();
    state = await expectRowsMirror(page);
    expect(state.maps[0]!.name).toBe("World");
    expect(state.undo).toBe(2);
    await expect(tab(page, overworld)).toHaveText("World");

    // Undo restores the names, one step each.
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave", "Dungeon"]);
});

test("a drag reorders the map list as one entry; undo and redo move it back and again", async ({
    page,
}) => {
    const [overworld, cave, dungeon] = await load(page);
    const height = (await row(page, cave).boundingBox())!.height;

    // Overworld dragged below Dungeon: one entry, whatever the rows it passed.
    await drag(page, row(page, overworld), height * 2.5);
    let state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.id)).toEqual([cave, dungeon, overworld]);
    expect(state).toMatchObject({ undo: 1, undoLabel: "Move Map Down" });
    // The tab strip has its own order; the shown map stays.
    expect(state.open).toEqual([overworld]);
    expect(state.active).toBe(overworld);

    // Dungeon dragged to the top.
    await drag(page, row(page, dungeon), -height * 1.5);
    state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.id)).toEqual([dungeon, cave, overworld]);
    expect(state).toMatchObject({ undo: 2, undoLabel: "Move Map Up" });
    // A drag opens nothing: Dungeon has no tab and is not shown.
    expect(state.open).toEqual([overworld]);
    expect(state.active).toBe(overworld);

    // A press that does not move is a click: no entry.
    await row(page, cave).click();
    expect((await snapshot(page)).undo).toBe(2);

    await page.locator("[data-viewport-focus]").focus();
    await page.keyboard.press("Control+z");
    state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.id)).toEqual([cave, dungeon, overworld]);
    await page.keyboard.press("Control+z");
    state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.id)).toEqual([overworld, cave, dungeon]);
    await page.keyboard.press("Control+y");
    state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.id)).toEqual([cave, dungeon, overworld]);
});

test("the row menu runs Map Properties…, Duplicate and Delete on its row's map", async ({
    page,
}) => {
    const [overworld, cave, dungeon] = await load(page);
    const menu = page.getByRole("menu");
    const items = () => menu.getByRole("menuitem").allTextContents();

    // Right click on Cave: its map is shown and the menu lists the three commands.
    await row(page, cave).click({ button: "right" });
    await expect(menu).toBeVisible();
    expect(await items()).toEqual(["Map Properties…", "Duplicate Map", "Delete Map"]);
    await expect(tab(page, cave)).toHaveAttribute("aria-selected", "true");
    await menu.getByRole("menuitem", { name: "Duplicate Map" }).click();
    let state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.name)).toEqual([
        "Overworld",
        "Cave",
        "Cave Copy",
        "Dungeon",
    ]);
    expect(state).toMatchObject({ undoLabel: "Duplicate Map" });

    // The overflow button of Dungeon's row: Delete. The map goes; undo brings it back.
    await row(page, dungeon).hover();
    await row(page, dungeon).locator("[data-map-row-menu]").click();
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Delete Map" }).click();
    state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave", "Cave Copy"]);
    expect(state).toMatchObject({ undo: 2, undoLabel: "Delete Map" });

    // The Menu key on the focused row: Map Properties… of that row's map.
    await row(page, overworld).focus();
    await page.keyboard.press("ContextMenu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Map Properties…" }).click();
    const dialog = page.getByRole("dialog", { name: "Map Properties" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-map-field="name"]')).toHaveValue("Overworld");
    await dialog.locator('[data-map-field="class"]').fill("World");
    await dialog.locator("[data-map-properties-ok]").click();
    state = await expectRowsMirror(page);
    expect(state.maps[0]).toMatchObject({ id: overworld, class: "World" });
    expect(state).toMatchObject({ undo: 3, undoLabel: "Change Map Class" });

    // The last map cannot be deleted: Delete is disabled in its menu.
    await call(page, "load");
    await expect(rows(page)).toHaveCount(3);
    for (const id of (await snapshot(page)).maps.slice(1).map((map) => map.id)) {
        await row(page, id).click({ button: "right" });
        await menu.getByRole("menuitem", { name: "Delete Map" }).click();
    }
    await expect(rows(page)).toHaveCount(1);
    await rows(page).first().click({ button: "right" });
    await expect(menu.getByRole("menuitem", { name: "Delete Map" })).toBeDisabled();
});

test("from the keyboard the list is one tab stop: arrows, Home, End move; Enter and Space open", async ({
    page,
}) => {
    const [overworld, cave, dungeon] = await load(page);
    // The tab stop is the active map's row.
    await expect(rows(page).and(page.locator('[tabindex="0"]'))).toHaveCount(1);
    await expect(row(page, overworld)).toHaveAttribute("tabindex", "0");
    await row(page, overworld).focus();
    await page.keyboard.press("ArrowDown");
    await expect(row(page, cave)).toBeFocused();
    await page.keyboard.press("End");
    await expect(row(page, dungeon)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(row(page, dungeon)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(row(page, overworld)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(row(page, overworld)).toBeFocused();
    // Moving the focus opens nothing; Enter and Space open the focused row's map.
    expect((await snapshot(page)).open).toEqual([overworld]);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(tab(page, dungeon)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press(" ");
    await expect(tab(page, cave)).toHaveAttribute("aria-selected", "true");
    const state = await expectRowsMirror(page);
    expect(state.open).toEqual([overworld, dungeon, cave]);
    expect(state.undo).toBe(0);
});

test("the header's New Map (+) opens New Map, and the new map gets a row", async ({ page }) => {
    await load(page);
    await page.locator("[data-new-map]").click();
    const dialog = page.getByRole("dialog", { name: "New Map" });
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-new-map-create]").click();
    const state = await expectRowsMirror(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave", "Dungeon", "Map 1"]);
    expect(state.active).toBe(state.maps[3]!.id);
});
