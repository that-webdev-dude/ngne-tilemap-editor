import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { Sample, Snapshot } from "./harness/te-032-page";
import { expect, openEditor } from "./te-013-support";
import { menuItem, openMenu } from "./te-007-support";

// TE-032: the New Map and Map Properties dialogs (DESIGN §9, SPEC §7.1) on the TE-032 project
// (harness/te-032-page.ts): "Overworld" (40 × 30 cells of 16 px, active), "Cave" and "Dungeon",
// and a tileset whose export name is "tiles". Map Properties applies its edits as one history
// entry each time OK is pressed; the background colour is read back from the viewport's canvas.

const PAGE_MODULE = "/tests/e2e/harness/te-032-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const snapshot = (page: Page) => call<Snapshot>(page, "snapshot");
const newMapDialog = (page: Page) => page.getByRole("dialog", { name: "New Map" });
const propertiesDialog = (page: Page) => page.getByRole("dialog", { name: "Map Properties" });
const field = (dialog: Locator, name: string) => dialog.locator(`[data-map-field="${name}"]`);
const problems = (dialog: Locator) => dialog.locator("[data-map-problem]");

async function load(page: Page): Promise<string[]> {
    await openEditor(page);
    const ids = await call<string[]>(page, "load");
    await expect(page.locator("[data-map-row]")).toHaveCount(3);
    return ids;
}

/** The number field `name` of the group labelled `group`. */
function number(dialog: Locator, group: string, name: string): Locator {
    return dialog
        .getByRole("group", { name: group, exact: true })
        .getByRole("spinbutton", { name, exact: true });
}

async function setNumber(input: Locator, value: number): Promise<void> {
    await input.fill(String(value));
    await input.press("Tab");
}

/** Map → Map Properties… on the active map; returns the open dialog. */
async function openProperties(page: Page): Promise<Locator> {
    await openMenu(page, "Map");
    await menuItem(page, "map.properties").click();
    await expect(propertiesDialog(page)).toBeVisible();
    return propertiesDialog(page);
}

async function ok(dialog: Locator): Promise<void> {
    await dialog.locator("[data-map-properties-ok]").click();
    await expect(dialog).toHaveCount(0);
}

async function undo(page: Page): Promise<void> {
    await page.locator("[data-viewport-focus]").focus();
    await page.keyboard.press("Control+z");
}

/** Every sample within 2 of its expected colour (the canvas is read through a 2D copy). */
function expectSamples(samples: Sample[]): void {
    for (const sample of samples) {
        const diff = Math.max(
            ...sample.expected.map((value, i) => Math.abs(value - sample.actual[i]!)),
        );
        expect(
            diff,
            `map pixel (${sample.x}, ${sample.y}): ${JSON.stringify(sample)}`,
        ).toBeLessThanOrEqual(2);
    }
}

/** Reads the active map's background back from the canvas, once the checkerboard is uploaded. */
async function readBackground(
    page: Page,
): Promise<{ background: number | null; samples: Sample[] }> {
    await page.waitForFunction(() =>
        (window.__ngneTest?.viewport?.textureIds() ?? []).includes("ed:checker"),
    );
    return call(page, "readBackground");
}

test("New Map: the presets fill the size fields; values out of range are refused", async ({
    page,
}) => {
    await load(page);
    // Ctrl+Alt+M opens it, also from a text field (DESIGN §10.3 †): the Maps panel's rename.
    const dialog = newMapDialog(page);
    await page.locator("[data-map-row]").first().dblclick();
    await expect(page.locator("[data-map-rename]")).toBeFocused();
    await page.keyboard.press("Control+Alt+m");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await page.locator("[data-viewport-focus]").focus();
    await page.keyboard.press("Control+Alt+m");
    await expect(dialog).toBeVisible();
    // The defaults: the next "Map n", 64 × 64 cells of 16 × 16 px at first (SPEC §7.1).
    await expect(field(dialog, "name")).toHaveValue("Map 1");
    const width = number(dialog, "Map size", "Width");
    const height = number(dialog, "Map size", "Height");
    await expect(width).toHaveValue("64");
    await expect(height).toHaveValue("64");
    await expect(number(dialog, "Tile size", "Width")).toHaveValue("16");
    await expect(number(dialog, "Tile size", "Height")).toHaveValue("16");
    const presets = dialog.getByRole("radiogroup", { name: "Size presets" });
    expect(await presets.getByRole("radio").allTextContents()).toEqual([
        "32 × 32",
        "64 × 64",
        "128 × 128",
        "256 × 256",
        "1000 × 40",
    ]);
    await expect(presets.getByRole("radio", { name: "64 × 64" })).toHaveAttribute(
        "aria-checked",
        "true",
    );

    for (const [label, w, h] of [
        ["128 × 128", 128, 128],
        ["1000 × 40", 1000, 40],
        ["32 × 32", 32, 32],
    ] as const) {
        await presets.getByRole("radio", { name: label }).click();
        await expect(width).toHaveValue(String(w));
        await expect(height).toHaveValue(String(h));
        await expect(presets.getByRole("radio", { name: label })).toHaveAttribute(
            "aria-checked",
            "true",
        );
    }
    // A size no preset has: none is checked.
    await setNumber(width, 33);
    await expect(presets.getByRole("radio", { checked: true })).toHaveCount(0);

    // Out of range: the message shows and Create is disabled.
    const create = dialog.locator("[data-new-map-create]");
    await setNumber(width, 0);
    await expect(problems(dialog)).toHaveText([
        "The width is a whole number of cells from 1 to 4096.",
    ]);
    await expect(create).toBeDisabled();
    await setNumber(width, 2048);
    await setNumber(height, 1024);
    await expect(problems(dialog)).toHaveText(["A map has at most 1,048,576 cells."]);
    await setNumber(height, 512);
    await setNumber(number(dialog, "Tile size", "Width"), 257);
    await expect(problems(dialog)).toHaveText([
        "The tile width is a whole number of pixels from 1 to 256.",
    ]);
    await field(dialog, "name").fill(" ");
    await expect(problems(dialog)).toHaveCount(2);
    await expect(create).toBeDisabled();

    // Cancel adds nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await snapshot(page)).undo).toBe(0);
});

test("New Map adds the map at the end and opens it; the next one starts from its sizes", async ({
    page,
}) => {
    const [overworld] = await load(page);
    await openMenu(page, "File");
    await menuItem(page, "file.newMap").click();
    const dialog = newMapDialog(page);
    await field(dialog, "name").fill("Island");
    await dialog.getByRole("radio", { name: "1000 × 40" }).click();
    await setNumber(number(dialog, "Tile size", "Width"), 32);
    await setNumber(number(dialog, "Tile size", "Height"), 8);
    await dialog.locator("[data-new-map-create]").click();
    await expect(dialog).toHaveCount(0);

    let state = await snapshot(page);
    const island = state.maps[3]!;
    expect(island).toMatchObject({
        name: "Island",
        exportName: "island",
        width: 1000,
        height: 40,
        tileWidth: 32,
        tileHeight: 8,
        backgroundColor: null,
    });
    expect(state).toMatchObject({ active: island.id, undo: 1, undoLabel: "New Map" });
    expect(state.open).toEqual([overworld, island.id]);
    await expect(page.locator(`[data-map-tab="${island.id}"]`)).toHaveAttribute(
        "aria-selected",
        "true",
    );

    // The next New Map starts from the last one's sizes, with the next free name.
    await page.locator("[data-viewport-focus]").focus();
    await page.keyboard.press("Control+Alt+m");
    await expect(field(dialog, "name")).toHaveValue("Map 1");
    await expect(number(dialog, "Map size", "Width")).toHaveValue("1000");
    await expect(number(dialog, "Map size", "Height")).toHaveValue("40");
    await expect(number(dialog, "Tile size", "Width")).toHaveValue("32");
    await expect(number(dialog, "Tile size", "Height")).toHaveValue("8");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Undo removes the map and shows the one before.
    await undo(page);
    state = await snapshot(page);
    expect(state.maps.map((map) => map.name)).toEqual(["Overworld", "Cave", "Dungeon"]);
    expect(state.active).toBe(overworld);
});

test("each Map Properties change is one entry, and undo restores it", async ({ page }) => {
    const [overworld] = await load(page);
    const start = (await snapshot(page)).maps[0]!;
    expect(start).toMatchObject({
        name: "Overworld",
        exportName: "overworld",
        class: "",
        tileWidth: 16,
        tileHeight: 16,
        backgroundColor: null,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
    });

    const edits: {
        label: string;
        edit(dialog: Locator): Promise<void>;
        changed: Record<string, unknown>;
    }[] = [
        {
            label: "Rename Map",
            edit: (dialog) => field(dialog, "name").fill("World"),
            changed: { name: "World" },
        },
        {
            label: "Change Map Export Name",
            edit: (dialog) => field(dialog, "export-name").fill("world-1"),
            changed: { exportName: "world-1" },
        },
        {
            label: "Change Map Class",
            edit: (dialog) => field(dialog, "class").fill("Level"),
            changed: { class: "Level" },
        },
        {
            label: "Change Tile Size",
            async edit(dialog) {
                await setNumber(number(dialog, "Tile size", "Width"), 32);
                await setNumber(number(dialog, "Tile size", "Height"), 24);
            },
            changed: { tileWidth: 32, tileHeight: 24, width: 40, height: 30 },
        },
        {
            label: "Change Background Colour",
            async edit(dialog) {
                await dialog.locator("[data-map-background]").click();
                const hex = page.locator(".map-form__picker");
                await hex.getByRole("textbox", { name: "Hex" }).fill("#336699");
                await hex.getByRole("textbox", { name: "Hex" }).press("Enter");
                await page.keyboard.press("Escape");
                await expect(dialog.locator("[data-map-background]")).toHaveAttribute(
                    "data-map-background",
                    "#336699FF",
                );
            },
            changed: { backgroundColor: 0x336699ff },
        },
        {
            label: "Change Parallax Origin",
            async edit(dialog) {
                await setNumber(number(dialog, "Parallax origin", "X"), -12.5);
                await setNumber(number(dialog, "Parallax origin", "Y"), 300);
            },
            changed: { parallaxOriginX: -12.5, parallaxOriginY: 300 },
        },
    ];

    let undoCount = 0;
    for (const { label, edit, changed } of edits) {
        const dialog = await openProperties(page);
        await edit(dialog);
        await ok(dialog);
        undoCount += 1;
        const state = await snapshot(page);
        expect(state, label).toMatchObject({ undo: undoCount, undoLabel: label });
        expect(state.maps[0], label).toMatchObject({ id: overworld, ...changed });
        // Undo restores the field, redo applies it again.
        await undo(page);
        expect((await snapshot(page)).maps[0], `undo ${label}`).toEqual(start);
        await page.keyboard.press("Control+y");
        expect((await snapshot(page)).maps[0], `redo ${label}`).toMatchObject(changed);
        await undo(page);
        undoCount -= 1;
    }

    // Several fields in one OK: one entry, "Map Properties".
    let dialog = await openProperties(page);
    await field(dialog, "name").fill("World");
    await field(dialog, "class").fill("Level");
    await ok(dialog);
    expect(await snapshot(page)).toMatchObject({ undo: 1, undoLabel: "Map Properties" });
    await undo(page);
    expect((await snapshot(page)).maps[0]).toEqual(start);

    // Cancel and an unchanged OK add nothing.
    dialog = await openProperties(page);
    await field(dialog, "name").fill("Nothing");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    dialog = await openProperties(page);
    await ok(dialog);
    expect((await snapshot(page)).maps[0]).toEqual(start);
    expect((await snapshot(page)).undo).toBe(0);
});

test("a duplicate export name is refused, from another map or a tileset", async ({ page }) => {
    await load(page);
    const dialog = await openProperties(page);
    const ok = dialog.locator("[data-map-properties-ok]");
    for (const taken of ["cave", "tiles"]) {
        await field(dialog, "export-name").fill(taken);
        await expect(problems(dialog)).toHaveText([`The export name “${taken}” is taken.`]);
        await expect(field(dialog, "export-name")).toHaveAttribute("aria-invalid", "true");
        await expect(ok).toBeDisabled();
    }
    // Enter in a field does not apply a refused value either.
    await field(dialog, "export-name").press("Enter");
    await expect(dialog).toBeVisible();
    await field(dialog, "export-name").fill("Not A Slug");
    await expect(problems(dialog)).toHaveCount(1);
    await expect(ok).toBeDisabled();
    // Its own export name is free.
    await field(dialog, "export-name").fill("overworld");
    await expect(problems(dialog)).toHaveCount(0);
    await expect(ok).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await snapshot(page)).maps.map((map) => map.exportName)).toEqual([
        "overworld",
        "cave",
        "dungeon",
    ]);
});

test("the background colour shows in the viewport, and None removes it", async ({ page }) => {
    await load(page);
    // No background: the checkerboard shows (both of its colours among the samples).
    let read = await readBackground(page);
    expect(read.background).toBe(null);
    expectSamples(read.samples);
    expect(new Set(read.samples.map((sample) => sample.expected.join())).size).toBe(2);

    // An opaque colour picked in the popover's picker covers the checkerboard.
    let dialog = await openProperties(page);
    await dialog.locator("[data-map-background]").click();
    const picker = page.locator(".map-form__picker");
    await expect(picker.locator("[data-colour-panel]")).toBeVisible();
    await picker.getByRole("textbox", { name: "Hex" }).fill("#203040");
    await picker.getByRole("textbox", { name: "Hex" }).press("Enter");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await ok(dialog);
    read = await readBackground(page);
    expect(read.background).toBe(0x203040ff);
    expectSamples(read.samples);
    for (const sample of read.samples) expect(sample.expected).toEqual([0x20, 0x30, 0x40]);

    // Half alpha: the colour over the checkerboard.
    dialog = await openProperties(page);
    await dialog.locator("[data-map-background]").click();
    await picker.getByRole("textbox", { name: "Hex" }).fill("#20304080");
    await picker.getByRole("textbox", { name: "Hex" }).press("Enter");
    await page.keyboard.press("Escape");
    await ok(dialog);
    read = await readBackground(page);
    expect(read.background).toBe(0x20304080);
    expectSamples(read.samples);

    // Opaque black, the colour the picker starts from, can be chosen from None too.
    dialog = await openProperties(page);
    await dialog.locator("[data-map-background]").click();
    await picker.locator("[data-map-background-none]").click();
    await dialog.locator("[data-map-background]").click();
    // The field shows "#000000" already: typed as "#000", the same colour.
    await picker.getByRole("textbox", { name: "Hex" }).fill("#000");
    await picker.getByRole("textbox", { name: "Hex" }).press("Enter");
    await expect(dialog.locator("[data-map-background]")).toHaveAttribute(
        "data-map-background",
        "#000000FF",
    );
    await page.keyboard.press("Escape");
    await ok(dialog);
    read = await readBackground(page);
    expect(read.background).toBe(0x000000ff);
    expectSamples(read.samples);
    await undo(page);
    expect((await readBackground(page)).background).toBe(0x20304080);

    // None removes it: the checkerboard again.
    dialog = await openProperties(page);
    await dialog.locator("[data-map-background]").click();
    await picker.locator("[data-map-background-none]").click();
    await expect(picker).toHaveCount(0);
    await expect(dialog.locator("[data-map-background]")).toHaveAttribute(
        "data-map-background",
        "none",
    );
    await ok(dialog);
    read = await readBackground(page);
    expect(read.background).toBe(null);
    expectSamples(read.samples);
    expect(await snapshot(page)).toMatchObject({ undoLabel: "Change Background Colour" });

    // Undo brings the colour back into the viewport.
    await undo(page);
    read = await readBackground(page);
    expect(read.background).toBe(0x20304080);
    expectSamples(read.samples);
});
