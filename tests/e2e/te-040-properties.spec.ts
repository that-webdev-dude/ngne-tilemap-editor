import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { expect, openEditor as openTilesetEditor } from "./te-025-support";

// TE-040: the Properties panel (SPEC §9, DESIGN §8.3) on the project of harness/te-040-page.ts:
// map "Overworld" with Objects (markers 1 "exit" and 2 "spawn", each with hp and tag) over
// Ground (active), and the TE-025 tilesets "Terrain" and "Props". The panel follows the
// selection order (markers, else tiles with the focus, else the active layer, else the map;
// project and tileset from its menu); add, rename, change type, edit and remove each make one
// history entry, undone and redone; with several markers a common property whose values differ
// shows "—", and an edit sets it on all.

const PAGE_MODULE = "/tests/e2e/harness/te-040-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

type Property = { name: string; type: string; value: unknown };

const history = (page: Page) => call<{ undo: number; label: string | null }>(page, "history");
const properties = (page: Page, what: string) => call<Property[]>(page, "properties", what);
const subject = (page: Page) => page.locator("[data-properties-subject]");
const panel = (page: Page) => page.locator("[data-properties-panel]");
const row = (page: Page, name: string) => panel(page).locator(`[data-property="${name}"]`);
const value = (page: Page, name: string) => row(page, name).locator("[data-property-value]");
const builtin = (page: Page, key: string) => panel(page).locator(`[data-builtin-field="${key}"]`);

async function open(page: Page): Promise<void> {
    await openTilesetEditor(page);
    await call(page, "load");
    await expect(subject(page)).toHaveText("Layer · Ground");
}

/** Runs a command of the panel's header menu. */
async function headerMenu(page: Page, command: string): Promise<void> {
    await page.locator("[data-properties-menu]").click();
    await page.locator(`[role="menuitem"][data-command="${command}"]`).click();
}

/** Opens a row's menu and chooses `action` ("rename", "type", "remove"). */
async function rowMenu(page: Page, name: string, action: string): Promise<Locator> {
    await row(page, name).locator("[data-property-menu]").click();
    const item = page.locator(`[data-property-action="${action}"]`);
    await item.click();
    return item;
}

/** Row menu → Change Type ▸ `type`, from the keyboard inside the submenu. */
async function changeType(page: Page, name: string, type: string): Promise<void> {
    await rowMenu(page, name, "type");
    const item = page.locator(`[data-property-type="${type}"]`);
    await expect(item).toBeVisible();
    await item.focus();
    await page.keyboard.press("Enter");
}

/**
 * Expects the last step to be one entry labelled `label` that made `after` of `before` on
 * `what`, and undoes and redoes it.
 */
async function expectOneEntry(
    page: Page,
    what: string,
    count: number,
    label: string,
    before: Property[],
    after: Property[],
): Promise<void> {
    await expect.poll(() => history(page)).toEqual({ undo: count + 1, label });
    expect(await properties(page, what)).toEqual(after);
    expect(await call(page, "undo")).toBe(true);
    expect(await properties(page, what)).toEqual(before);
    expect(await call(page, "redo")).toBe(true);
    expect(await properties(page, what)).toEqual(after);
}

test.describe("the panel follows the selection order", () => {
    test("markers, else tiles, else the layer, else the map", async ({ page }) => {
        await open(page);
        await expect(builtin(page, "type")).toHaveText("Tile layer");

        await call(page, "selectMarkers", [1]);
        await expect(subject(page)).toHaveText("Marker · exit");
        await expect(builtin(page, "shape")).toHaveText("Rectangle");
        await call(page, "selectMarkers", [1, 2]);
        await expect(subject(page)).toHaveText("2 markers");

        // Tiles selected while markers are: the markers stay first.
        await call(page, "selectTiles", 0, [0, 0], [2, 0]);
        await expect(subject(page)).toHaveText("2 markers");
        await call(page, "selectMarkers", []);
        // The marker selection changed after the tiles: the layer.
        await expect(subject(page)).toHaveText("Layer · Ground");
        await call(page, "selectTiles", 0, [0, 0], [2, 0]);
        await expect(subject(page)).toHaveText("3 tiles");
        await call(page, "selectTiles", 0, [1, 0], [1, 0]);
        await expect(subject(page)).toHaveText("Tile · Terrain#1");
        await expect(builtin(page, "id")).toHaveText("1");

        // Another active layer takes the focus from the tiles.
        await call(page, "setActiveLayer", 2);
        await expect(subject(page)).toHaveText("Layer · Objects");
        // The tile menu's Properties gives it back.
        await page.locator("[data-tile-menu-button]").click();
        await page.getByRole("menuitem", { name: "Properties", exact: true }).click();
        await expect(subject(page)).toHaveText("Tile · Terrain#1");

        await call(page, "setActiveLayer", 99);
        await expect(subject(page)).toHaveText("Map · Overworld");
        await expect(builtin(page, "size")).toHaveText("30 × 20 cells");
    });

    test("the project and the tileset from the menu, until the selection changes", async ({
        page,
    }) => {
        await open(page);
        await headerMenu(page, "properties.showProject");
        await expect(subject(page)).toHaveText("Project · Markers");
        await headerMenu(page, "properties.showTileset");
        await expect(subject(page)).toHaveText("Tileset · Terrain");
        await headerMenu(page, "properties.showSelection");
        await expect(subject(page)).toHaveText("Layer · Ground");

        await headerMenu(page, "properties.showProject");
        await expect(subject(page)).toHaveText("Project · Markers");
        await call(page, "selectMarkers", [2]);
        await expect(subject(page)).toHaveText("Marker · spawn");

        // Going back to the selection the pin was made in does not bring it back.
        await call(page, "selectMarkers", []);
        await headerMenu(page, "properties.showTileset");
        await expect(subject(page)).toHaveText("Tileset · Terrain");
        await call(page, "setActiveLayer", 2);
        await expect(subject(page)).toHaveText("Layer · Objects");
        await call(page, "setActiveLayer", 1);
        await expect(subject(page)).toHaveText("Layer · Ground");
    });

    test("the tiles have the focus while the Tilesets panel has it", async ({ page }) => {
        await open(page);
        await call(page, "selectTiles", 0, [0, 0], [1, 0]);
        await expect(subject(page)).toHaveText("2 tiles");
        // The focus enters the Layers section: the layer.
        await page
            .locator('[data-dock-panel="layers"]')
            .getByRole("treeitem", { name: /Ground/ })
            .focus();
        await expect(subject(page)).toHaveText("Layer · Ground");
        // The focus enters the tile grid: the tiles again.
        await page.locator("[data-tile-grid]").focus();
        await expect(subject(page)).toHaveText("2 tiles");
    });
});

test.describe("each edit is one entry", () => {
    test("add, rename, change type, edit and remove", async ({ page }) => {
        await open(page);
        const what = "layer:1";
        let { undo: count } = await history(page);

        // Add: Name, Type, Add.
        await page.locator("[data-property-add]").click();
        await page.locator("[data-property-add-name]").fill("speed");
        await page.locator("[data-property-add-type]").getByRole("combobox").click();
        await page.getByRole("option", { name: "int", exact: true }).click();
        await page.locator("[data-property-add-confirm]").click();
        const added = [{ name: "speed", type: "int", value: 0 }];
        await expectOneEntry(page, what, count++, "Add Property", [], added);
        await expect(row(page, "speed").locator("[data-property-type-chip]")).toHaveText("int");

        // A taken name is refused in the popover.
        await page.locator("[data-property-add]").click();
        await page.locator("[data-property-add-name]").fill("speed");
        await expect(page.locator("[data-property-add-confirm]")).toBeDisabled();
        await page.keyboard.press("Escape");

        // Edit: the int field, applied on Enter.
        const input = value(page, "speed").getByRole("spinbutton");
        await input.fill("12");
        await input.press("Enter");
        const edited = [{ name: "speed", type: "int", value: 12 }];
        await expectOneEntry(page, what, count++, "Change Property", added, edited);

        // Rename in place from the row menu.
        await rowMenu(page, "speed", "rename");
        const rename = page.locator("[data-property-rename]");
        await rename.fill("velocity");
        await rename.press("Enter");
        const renamed = [{ name: "velocity", type: "int", value: 12 }];
        await expectOneEntry(page, what, count++, "Rename Property", edited, renamed);

        // Change Type ▸ string: the value converted.
        await changeType(page, "velocity", "string");
        const retyped = [{ name: "velocity", type: "string", value: "12" }];
        await expectOneEntry(page, what, count++, "Change Property Type", renamed, retyped);
        await expect(value(page, "velocity")).toHaveValue("12");

        // Edit: the string field, applied on Enter.
        await value(page, "velocity").fill("fast");
        await value(page, "velocity").press("Enter");
        const fast = [{ name: "velocity", type: "string", value: "fast" }];
        await expectOneEntry(page, what, count++, "Change Property", retyped, fast);

        // Change Type ▸ color with the pointer: no conversion, the default.
        await row(page, "velocity").locator("[data-property-menu]").click();
        const sub = page.locator('[data-property-action="type"]');
        await sub.hover();
        const colourItem = page.locator('[data-property-type="color"]');
        await expect(colourItem).toBeVisible();
        // Across into the submenu, then down to the item, as a hand does.
        const box = (await colourItem.boundingBox())!;
        const from = (await sub.boundingBox())!;
        const y = from.y + from.height / 2;
        await page.mouse.move(box.x + 8, y, { steps: 8 });
        await page.mouse.move(box.x + 8, box.y + box.height / 2, { steps: 8 });
        await page.mouse.down();
        await page.mouse.up();
        const coloured = [{ name: "velocity", type: "color", value: "#000000ff" }];
        await expectOneEntry(page, what, count++, "Change Property Type", fast, coloured);

        // Edit: the colour picker, applied when its popover closes.
        await value(page, "velocity").click();
        const hex = page.getByRole("textbox", { name: "Hex" });
        await hex.fill("#ff0000");
        await hex.press("Enter");
        expect((await history(page)).undo).toBe(count);
        await page.keyboard.press("Escape");
        const red = [{ name: "velocity", type: "color", value: "#ff0000ff" }];
        await expectOneEntry(page, what, count++, "Change Property", coloured, red);
        await expect(value(page, "velocity")).toContainText("#ff0000ff");

        // Remove from the row menu.
        await rowMenu(page, "velocity", "remove");
        await expectOneEntry(page, what, count, "Remove Property", red, []);
        await expect(row(page, "velocity")).toHaveCount(0);
    });

    test("the controls of bool, float, string and file", async ({ page }) => {
        await open(page);
        const what = "map";
        await call(page, "setActiveLayer", 99);
        await expect(subject(page)).toHaveText("Map · Overworld");
        for (const [name, type] of [
            ["alive", "bool"],
            ["ratio", "float"],
            ["sprite", "file"],
        ] as const) {
            await page.locator("[data-property-add]").click();
            await page.locator("[data-property-add-name]").fill(name);
            await page.locator("[data-property-add-type]").getByRole("combobox").click();
            await page.getByRole("option", { name: type, exact: true }).click();
            await page.locator("[data-property-add-confirm]").click();
            await expect(row(page, name)).toHaveCount(1);
        }
        let { undo: count } = await history(page);
        const base: Property[] = [
            { name: "alive", type: "bool", value: false },
            { name: "ratio", type: "float", value: 0 },
            { name: "sprite", type: "file", value: "" },
        ];

        await value(page, "alive").check();
        const checked = [{ ...base[0]!, value: true }, base[1]!, base[2]!];
        await expectOneEntry(page, what, count++, "Change Property", base, checked);

        const ratio = value(page, "ratio").getByRole("spinbutton");
        await ratio.fill("0.125");
        await ratio.press("Enter");
        const ratioSet = [checked[0]!, { ...base[1]!, value: 0.125 }, base[2]!];
        await expectOneEntry(page, what, count++, "Change Property", checked, ratioSet);
        // Text that is no number is dropped.
        await ratio.fill("abc");
        await ratio.press("Enter");
        await expect(ratio).toHaveValue("0.125");
        expect((await history(page)).undo).toBe(count);

        // Pick takes the chosen file's name.
        const chooser = page.waitForEvent("filechooser");
        await row(page, "sprite").locator("[data-property-pick]").click();
        await (
            await chooser
        ).setFiles({ name: "hero.png", mimeType: "image/png", buffer: Buffer.from([1, 2, 3]) });
        const picked = [ratioSet[0]!, ratioSet[1]!, { ...base[2]!, value: "hero.png" }];
        await expectOneEntry(page, what, count++, "Change Property", ratioSet, picked);

        // Escape keeps the old text.
        const file = value(page, "sprite");
        await file.fill("other.png");
        await file.press("Escape");
        await expect(file).toHaveValue("hero.png");
        expect((await history(page)).undo).toBe(count);
    });

    test("a built-in field: the layer's name", async ({ page }) => {
        await open(page);
        const { undo } = await history(page);
        const name = builtin(page, "name");
        await name.fill("Floor");
        await name.press("Enter");
        await expect(subject(page)).toHaveText("Layer · Floor");
        expect(await history(page)).toEqual({ undo: undo + 1, label: "Rename Layer" });
    });

    test("a refused edit changes nothing and says why", async ({ page }) => {
        await open(page);
        for (const name of ["a", "b"]) {
            await page.locator("[data-property-add]").click();
            await page.locator("[data-property-add-name]").fill(name);
            await page.locator("[data-property-add-confirm]").click();
            await expect(row(page, name)).toHaveCount(1);
        }
        const before = await history(page);
        await rowMenu(page, "b", "rename");
        await page.locator("[data-property-rename]").fill("a");
        await page.locator("[data-property-rename]").press("Enter");
        await expect(page.getByRole("alert")).toContainText("The property “a” exists.");
        expect(await history(page)).toEqual(before);
        expect((await properties(page, "layer:1")).map((each) => each.name)).toEqual(["a", "b"]);
    });
});

test.describe("several items", () => {
    test("show — for values that differ and set all", async ({ page }) => {
        await open(page);
        await call(page, "selectMarkers", [1, 2]);
        await expect(subject(page)).toHaveText("2 markers");

        // hp differs (1, 2), tag is the same ("a").
        const hp = value(page, "hp").getByRole("spinbutton");
        await expect(hp).toHaveValue("");
        await expect(hp).toHaveAttribute("placeholder", "—");
        await expect(value(page, "tag")).toHaveValue("a");
        await expect(builtin(page, "name")).toHaveAttribute("placeholder", "—");
        await expect(builtin(page, "name")).toHaveValue("");

        const { undo: count } = await history(page);
        await hp.fill("5");
        await hp.press("Enter");
        await expect
            .poll(() => history(page))
            .toEqual({ undo: count + 1, label: "Change Property" });
        const five = [
            { name: "hp", type: "int", value: 5 },
            { name: "tag", type: "string", value: "a" },
        ];
        expect(await properties(page, "marker:1")).toEqual(five);
        expect(await properties(page, "marker:2")).toEqual(five);
        await expect(hp).toHaveValue("5");

        // A built-in field with different values sets all too.
        await builtin(page, "class").fill("npc");
        await builtin(page, "class").press("Enter");
        expect(await call(page, "markerTexts")).toEqual([
            { name: "exit", class: "npc" },
            { name: "spawn", class: "npc" },
        ]);
        expect(await history(page)).toEqual({ undo: count + 2, label: "Marker Class" });
    });

    test("a property only some items have is not shown; Add sets all", async ({ page }) => {
        await open(page);
        await call(page, "selectMarkers", [1]);
        await page.locator("[data-property-add]").click();
        await page.locator("[data-property-add-name]").fill("solo");
        await page.locator("[data-property-add-confirm]").click();
        await expect(row(page, "solo")).toHaveCount(1);

        await call(page, "selectMarkers", [1, 2]);
        await expect(subject(page)).toHaveText("2 markers");
        await expect(row(page, "solo")).toHaveCount(0);
        await expect(row(page, "hp")).toHaveCount(1);

        // Tiles: Add puts the property on each selected tile.
        await call(page, "selectMarkers", []);
        await call(page, "selectTiles", 1, [0, 0], [2, 0]);
        await expect(subject(page)).toHaveText("3 tiles");
        await page.locator("[data-property-add]").click();
        await page.locator("[data-property-add-name]").fill("loot");
        await page.locator("[data-property-add-confirm]").click();
        for (const id of [0, 1, 2]) {
            expect(await properties(page, `tile:1:${id}`)).toEqual([
                { name: "loot", type: "string", value: "" },
            ]);
        }
        await builtin(page, "class").fill("crate");
        await builtin(page, "class").press("Enter");
        expect(await call(page, "tileClasses", 1, [0, 1, 2])).toEqual(["crate", "crate", "crate"]);
    });
});
