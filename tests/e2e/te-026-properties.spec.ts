import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { menuItem, openMenu } from "./te-007-support";
import { expect, openEditor, panel, tileColour, tileGrid, tilesetTab } from "./te-025-support";

// TE-026: Tileset Properties (DESIGN §9) and the tileset commands of SPEC §6.2, on the TE-025
// project (harness/te-025-map.ts): "Terrain", 12 tiles of 16 px, and "Props", 3 tiles of 8 px,
// on a 30 × 20 map of 16 px cells. The dialog applies its edits as one history entry each time
// OK is pressed; a tile offset moves the drawn tiles, read back from the viewport's canvas; the
// source fields are read-only.

const PAGE_MODULE = "/tests/e2e/harness/te-026-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

interface TilesetView {
    id: string;
    name: string;
    exportName: string;
    class: string;
    offsetX: number;
    offsetY: number;
}

const history = (page: Page) => call<{ undo: number; label: string | null }>(page, "history");
const tilesets = (page: Page) => call<TilesetView[]>(page, "tilesets");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Tileset Properties" });
const field = (dialog: Locator, name: string) => dialog.locator(`[data-tileset-field="${name}"]`);
const source = (dialog: Locator, name: string) => dialog.locator(`[data-tileset-source="${name}"]`);

/** Tileset → Tileset Properties…; returns the open dialog. */
async function openProperties(page: Page): Promise<Locator> {
    await openMenu(page, "Tileset");
    await menuItem(page, "tileset.properties").click();
    await expect(dialog(page)).toBeVisible();
    return dialog(page);
}

async function setOffset(dialog: Locator, axis: "X" | "Y", value: number): Promise<void> {
    const input = dialog.getByRole("spinbutton", { name: axis, exact: true });
    await input.fill(String(value));
    await input.press("Tab");
}

async function ok(dialog: Locator): Promise<void> {
    await dialog.locator("[data-tileset-properties-ok]").click();
    await expect(dialog).toHaveCount(0);
}

/** Within 2 of each channel: the canvas is read back through a 2D copy. */
function expectColour(actual: number[], expected: readonly number[]): void {
    for (let index = 0; index < 3; index++) {
        expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThanOrEqual(2);
    }
}

function differs(actual: number[], expected: readonly number[]): boolean {
    return actual.some((value, index) => Math.abs(value - expected[index]!) > 8);
}

test("dialog edits apply as one entry each; Cancel and an unchanged OK make none", async ({
    page,
}) => {
    await openEditor(page);
    const start = await history(page);

    // Name, export name and class together: one entry, "Tileset Properties".
    let props = await openProperties(page);
    await expect(field(props, "name")).toHaveValue("Terrain");
    await field(props, "name").fill("Ground");
    await field(props, "export-name").fill("ground");
    await field(props, "class").fill("Floor");
    await ok(props);
    expect(await history(page)).toEqual({ undo: start.undo + 1, label: "Tileset Properties" });
    expect((await tilesets(page))[0]).toMatchObject({
        name: "Ground",
        exportName: "ground",
        class: "Floor",
    });
    await expect(tilesetTab(page, "Ground")).toBeVisible();

    // Both offsets: one more entry.
    props = await openProperties(page);
    await setOffset(props, "X", 4);
    await setOffset(props, "Y", -3);
    await ok(props);
    expect(await history(page)).toEqual({ undo: start.undo + 2, label: "Change Tile Offset" });
    expect((await tilesets(page))[0]).toMatchObject({ offsetX: 4, offsetY: -3 });

    // OK with nothing changed, and Cancel after an edit: no entry.
    props = await openProperties(page);
    await ok(props);
    props = await openProperties(page);
    await field(props, "name").fill("Discarded");
    await props.getByRole("button", { name: "Cancel" }).click();
    await expect(props).toHaveCount(0);
    expect((await history(page)).undo).toBe(start.undo + 2);
    expect((await tilesets(page))[0]!.name).toBe("Ground");

    // A taken export name is refused in the dialog: OK stays disabled, the reason shows.
    props = await openProperties(page);
    await field(props, "export-name").fill("props");
    await expect(props.locator("[data-tileset-problem]")).toHaveText(
        "The export name “props” is taken.",
    );
    await expect(props.locator("[data-tileset-properties-ok]")).toBeDisabled();
    await props.getByRole("button", { name: "Cancel" }).click();

    // Each entry undoes as a whole.
    await call(page, "undo");
    expect((await tilesets(page))[0]).toMatchObject({ name: "Ground", offsetX: 0, offsetY: 0 });
    await call(page, "undo");
    expect((await tilesets(page))[0]).toMatchObject({
        name: "Terrain",
        exportName: "terrain",
        class: "",
    });
});

test("a tile offset moves the drawn tiles (readback)", async ({ page }) => {
    await openEditor(page);
    const colour = tileColour(0, 0);
    await call(page, "paint", 5, 5, 1, 0);
    const centre = (x: number, y: number) => call<[number, number]>(page, "cellCentre", x, y);
    const points = [await centre(5, 5), await centre(6, 6)];

    await expect
        .poll(async () => {
            const [at, below] = await call<number[][]>(page, "readMap", points);
            return !differs(at!, colour) && differs(below!, colour);
        })
        .toBe(true);

    // One cell right and one down (FORMAT §1.3: +x right, +y down).
    const props = await openProperties(page);
    await setOffset(props, "X", 16);
    await setOffset(props, "Y", 16);
    await ok(props);

    await expect
        .poll(async () => {
            const [at, moved] = await call<number[][]>(page, "readMap", points);
            return differs(at!, colour) && !differs(moved!, colour);
        })
        .toBe(true);
    const [, moved] = await call<number[][]>(page, "readMap", points);
    expectColour(moved!, colour);

    // Undo puts the tile back.
    await call(page, "undo");
    await expect
        .poll(async () => {
            const [at, below] = await call<number[][]>(page, "readMap", points);
            return !differs(at!, colour) && differs(below!, colour);
        })
        .toBe(true);
});

test("the source fields are read-only", async ({ page }) => {
    await openEditor(page);
    const props = await openProperties(page);
    const expected: Record<string, string> = {
        kind: "Grid PNG",
        file: "Terrain.png",
        "tile-size": "16 × 16 px",
        margin: "0 px",
        spacing: "0 px",
    };
    for (const [name, value] of Object.entries(expected)) {
        const input = source(props, name);
        await expect(input).toHaveValue(value);
        await expect(input).toHaveAttribute("readonly", "");
        await expect(input).not.toBeEditable();
        // Typing into it changes nothing.
        await input.focus();
        await page.keyboard.type("x");
        await expect(input).toHaveValue(value);
    }
    // The editable fields are not read-only.
    for (const name of ["name", "export-name", "class"]) {
        await expect(field(props, name)).toBeEditable();
    }
    await props.getByRole("button", { name: "Cancel" }).click();
    expect((await history(page)).label).toBeNull();
});

test("F2 renames the shown tileset in its tab; Escape keeps the name", async ({ page }) => {
    await openEditor(page);
    const start = await history(page);
    await tileGrid(page).focus();
    await page.keyboard.press("F2");
    const rename = panel(page).locator("[data-tileset-rename]");
    await expect(rename).toBeFocused();
    await expect(rename).toHaveValue("Terrain");
    await page.keyboard.type("Ground");
    await page.keyboard.press("Enter");
    await expect(tilesetTab(page, "Ground")).toBeFocused();
    expect(await history(page)).toEqual({ undo: start.undo + 1, label: "Rename Tileset" });

    await page.keyboard.press("F2");
    await page.keyboard.type("Other");
    await page.keyboard.press("Escape");
    await expect(rename).toHaveCount(0);
    await expect(tilesetTab(page, "Ground")).toBeVisible();
    expect((await history(page)).undo).toBe(start.undo + 1);
});

test("Delete Tileset is refused while a map uses it, naming the map; else it deletes", async ({
    page,
}) => {
    await openEditor(page);
    await call(page, "paint", 2, 3, 1, 4);
    const start = await history(page);

    await openMenu(page, "Tileset");
    await menuItem(page, "tileset.delete").click();
    await expect(page.getByRole("alert")).toHaveText(
        "Delete Tileset failed: “Terrain” is used by the map “Map 1”.",
    );
    expect(await history(page)).toEqual(start);
    expect((await tilesets(page)).map((each) => each.name)).toEqual(["Terrain", "Props"]);

    // Props is unused: its tab's menu deletes it, one entry.
    await tilesetTab(page, "Props").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete Tileset" }).click();
    expect(await history(page)).toEqual({ undo: start.undo + 1, label: "Delete Tileset" });
    expect((await tilesets(page)).map((each) => each.name)).toEqual(["Terrain"]);
    await expect(tilesetTab(page, "Props")).toHaveCount(0);
});

test("Move Tileset Right in a tab's menu reorders the tabs, one entry", async ({ page }) => {
    await openEditor(page);
    const start = await history(page);
    await tilesetTab(page, "Terrain").click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Move Tileset Left" })).toHaveAttribute(
        "data-disabled",
        "",
    );
    await page.getByRole("menuitem", { name: "Move Tileset Right" }).click();
    expect(await history(page)).toEqual({ undo: start.undo + 1, label: "Move Tileset Right" });
    const names = await panel(page).getByRole("tab").allTextContents();
    expect(names).toEqual(["Props", "Terrain"]);
    await expect(tilesetTab(page, "Terrain")).toHaveAttribute("aria-selected", "true");
});
