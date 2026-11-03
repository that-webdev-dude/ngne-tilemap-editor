import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { FLIP_H } from "../../src/core/cells";
import { encodePng } from "../../src/core/codec";
import type { TilesetView } from "./harness/te-028-page";
import { menuItem, openMenu } from "./te-007-support";
import { dropFilesOn, expect, openEditor, tileColour } from "./te-025-support";
import type { FilePayload } from "./te-025-support";

// TE-028: Update Tileset from Source (SPEC §6.3, DESIGN §9) on the TE-025 project
// (harness/te-025-map.ts): "Terrain", 12 solid tiles of 16 px on 4 columns, imported from
// "Terrain.png" with keys [column, row]. The edited sources are PNGs made here. A source with
// moved and changed tiles applies at once; one with a duplicate and removed tiles opens the
// dialog, whose choices give the cells TE-027 specifies. Cancel changes nothing; undo restores
// pixels, cells and the viewport, read back from the canvas.

const PAGE_MODULE = "/tests/e2e/harness/te-028-page.ts";
const SIZE = 16;
const CHANGED: [number, number, number] = [250, 250, 10];

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const tileset = (page: Page) => call<TilesetView>(page, "tileset", 0);
const cells = (page: Page) => call<string[]>(page, "cells");
const history = (page: Page) => call<{ undo: number; label: string | null }>(page, "history");
const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Update Tileset from Source" });

/** A grid PNG of solid 16 px tiles, `colour(column, row)` each. */
function sourcePng(
    columns: number,
    rows: number,
    colour: (column: number, row: number) => readonly number[],
): FilePayload {
    const width = columns * SIZE;
    const data = new Uint8ClampedArray(width * rows * SIZE * 4);
    for (let y = 0; y < rows * SIZE; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b] = colour(Math.floor(x / SIZE), Math.floor(y / SIZE));
            data.set([r!, g!, b!, 255], (y * width + x) * 4);
        }
    }
    const buffer = Buffer.from(encodePng({ width, height: rows * SIZE, data }));
    return { name: "Terrain.png", mimeType: "image/png", buffer };
}

/** The colour of Terrain's tile at `(column, row)` of its source. */
const original = (column: number, row: number) => tileColour(0, row * 4 + column);

function differs(actual: number[], expected: readonly number[]): boolean {
    return actual.some((value, index) => Math.abs(value - expected[index]!) > 8);
}

/** Polls the viewport until each of `cells` shows its colour. */
async function expectViewport(
    page: Page,
    expected: [x: number, y: number, colour: readonly number[]][],
): Promise<void> {
    const points: [number, number][] = [];
    for (const [x, y] of expected) points.push(await call(page, "cellCentre", x, y));
    await expect
        .poll(async () => {
            const read = await call<number[][]>(page, "readMap", points);
            return expected.every(([, , colour], k) => !differs(read[k]!, colour));
        })
        .toBe(true);
}

/** Polls the viewport until `(x, y)` no longer shows `colour`. */
async function expectNotShown(page: Page, x: number, y: number, colour: readonly number[]) {
    const point = await call<[number, number]>(page, "cellCentre", x, y);
    await expect
        .poll(async () => differs((await call<number[][]>(page, "readMap", [point]))[0]!, colour))
        .toBe(true);
}

/** Tileset → Update Tileset from Source…, then `files` picked in the file chooser. */
async function updateFromMenu(page: Page, files: FilePayload[]): Promise<void> {
    await openMenu(page, "Tileset");
    const chooser = page.waitForEvent("filechooser");
    await menuItem(page, "tileset.updateFromSource").click();
    await (await chooser).setFiles(files);
}

/** `files` dropped on the tab of tileset `id`; returns the dialog. */
async function dropOnTab(page: Page, id: string, files: FilePayload[]): Promise<Locator> {
    await dropFilesOn(page, `[data-tileset-tab="${id}"]`, files);
    await expect(dialog(page)).toBeVisible();
    return dialog(page);
}

async function choose(page: Page, update: Locator, tile: number, option: string): Promise<void> {
    await update.getByRole("combobox", { name: `Tile ${tile}`, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
}

test("an edited source with moved and changed tiles applies at once; undo restores it", async ({
    page,
}) => {
    await openEditor(page);
    // Tiles 0, 3 and 7 on the map.
    await call(page, "paint", 1, [
        [0, 0, 0, 0],
        [1, 0, 3, 0],
        [2, 0, 7, 0],
    ]);
    const before = await tileset(page);
    const start = await history(page);
    await expectViewport(page, [
        [0, 0, original(0, 0)],
        [1, 0, original(3, 0)],
        [2, 0, original(3, 1)],
    ]);

    // Tiles 0 and 3 swap places; tile 7 changes in place.
    const edited = sourcePng(4, 3, (column, row) =>
        row === 0 && column === 0
            ? original(3, 0)
            : row === 0 && column === 3
              ? original(0, 0)
              : row === 1 && column === 3
                ? CHANGED
                : original(column, row),
    );
    await updateFromMenu(page, [edited]);
    await expect(toasts(page)).toContainText(
        "Updated tileset “Terrain”: 9 unchanged, 2 moved, 1 changed, 0 new, 0 ambiguous, 0 missing.",
    );
    await expect(dialog(page)).toHaveCount(0);
    expect(await history(page)).toEqual({
        undo: start.undo + 1,
        label: "Update Tileset from Source",
    });

    const after = await tileset(page);
    // IDs never change: tile 0 now sits at (3, 0) of the source, tile 3 at (0, 0).
    expect(after.tiles.map((tile) => tile.id)).toEqual(before.tiles.map((tile) => tile.id));
    expect(after.tiles[0]!.key).toEqual([3, 0]);
    expect(after.tiles[3]!.key).toEqual([0, 0]);
    expect(after.tiles[7]!.key).toEqual([3, 1]);
    expect(after.tiles[7]!.fingerprint).not.toBe(before.tiles[7]!.fingerprint);
    expect(after.tiles[0]!.fingerprint).toBe(before.tiles[0]!.fingerprint);
    expect(after.pixels).not.toBe(before.pixels);
    // Cells are untouched; the viewport shows tile 7's new pixels.
    expect(await cells(page)).toEqual(["0,0:1:0:0", "1,0:1:3:0", "2,0:1:7:0"]);
    await expectViewport(page, [
        [0, 0, original(0, 0)],
        [1, 0, original(3, 0)],
        [2, 0, CHANGED],
    ]);

    // Undo restores the keys, the pixels and the viewport.
    await call(page, "undo");
    expect(await tileset(page)).toEqual(before);
    await expectViewport(page, [
        [0, 0, original(0, 0)],
        [1, 0, original(3, 0)],
        [2, 0, original(3, 1)],
    ]);
});

/**
 * The source of the dialog test: 5 × 2 tiles. The first 4 columns hold tiles 0–7 as before;
 * column 4 holds tile 8's picture twice (a duplicate). Tile 8's key (0, 2) is gone, so it is
 * ambiguous between (4, 0) and (4, 1); tiles 9, 10 and 11 are missing.
 */
const duplicated = () =>
    sourcePng(5, 2, (column, row) => (column === 4 ? original(0, 2) : original(column, row)));

/** Tiles 8–11 on the map; tile 11 flipped horizontally, tile 8 twice. */
async function paintRemoved(page: Page): Promise<void> {
    await call(page, "paint", 1, [
        [0, 0, 8, 0],
        [1, 0, 9, 0],
        [2, 0, 10, 0],
        [3, 0, 11, FLIP_H],
        [4, 0, 8, 0],
    ]);
}

test("a source with a duplicate and removed tiles opens the dialog; Cancel changes nothing", async ({
    page,
}) => {
    const [terrain] = await openEditor(page);
    await paintRemoved(page);
    const before = { tileset: await tileset(page), cells: await cells(page) };
    const start = await history(page);
    const mapName = await call<string>(page, "mapName");

    const update = await dropOnTab(page, terrain!, [duplicated()]);
    await expect(update.locator("[data-update-summary]")).toHaveText(
        "Terrain: 8 unchanged, 0 moved, 0 changed, 2 new, 1 ambiguous, 3 missing",
    );
    const rows = update.locator("[data-update-row]");
    await expect(rows).toHaveCount(4);
    expect(await rows.evaluateAll((all) => all.map((row) => row.dataset.updateRow))).toEqual([
        "8",
        "9",
        "10",
        "11",
    ]);
    // Old picture, status and usage per map.
    const row8 = update.locator('[data-update-row="8"]');
    await expect(row8).toContainText("Ambiguous: 2 source tiles match");
    await expect(row8.locator("[data-update-usage]")).toHaveText(`${mapName}: 2 cells`);
    await expect(update.locator('[data-update-row="9"]')).toContainText("Missing from the source");
    await expect(update.locator('[data-update-row="10"] [data-update-usage]')).toHaveText(
        `${mapName}: 1 cell`,
    );
    // The first choices lose nothing: the first candidate, else Keep as is.
    await expect(update.getByRole("combobox", { name: "Tile 8", exact: true })).toHaveText(
        "Source tile (4, 0)",
    );
    for (const tile of [9, 10, 11]) {
        await expect(
            update.getByRole("combobox", { name: `Tile ${tile}`, exact: true }),
        ).toHaveText("Keep as is");
    }

    // Cancel after changing a choice: nothing changes.
    await choose(page, update, 10, "Delete");
    await update.getByRole("button", { name: "Cancel" }).click();
    await expect(update).toHaveCount(0);
    expect(await history(page)).toEqual(start);
    expect({ tileset: await tileset(page), cells: await cells(page) }).toEqual(before);
});

test("each choice of the dialog gives TE-027's cells; undo restores pixels, cells and viewport", async ({
    page,
}) => {
    const [terrain] = await openEditor(page);
    await paintRemoved(page);
    const before = { tileset: await tileset(page), cells: await cells(page) };
    const start = await history(page);
    await expectViewport(page, [
        [2, 0, original(2, 2)],
        [3, 0, original(3, 2)],
    ]);

    const update = await dropOnTab(page, terrain!, [duplicated()]);
    // Tile 8 takes the second candidate, 9 is kept, 10 deleted, 11 replaced with (4, 0).
    await choose(page, update, 8, "Source tile (4, 1)");
    await choose(page, update, 10, "Delete");
    await choose(page, update, 11, "Replace with…");
    const apply = update.locator("[data-update-apply]");
    // Replace with… waits for its tile.
    await expect(apply).toBeDisabled();
    await update.locator('[data-update-replace="11"]').click();
    const sheet = page.locator("[data-update-sheet]");
    await expect(sheet).toBeVisible();
    const pitchX = Number(await sheet.getAttribute("data-pitch-x"));
    const pitchY = Number(await sheet.getAttribute("data-pitch-y"));
    // Entry 4 of the source, (4, 0): column 4 of the first row.
    await sheet.locator("canvas").click({ position: { x: 1 + 4.5 * pitchX, y: 1 + pitchY / 2 } });
    await expect(update.locator('[data-update-replace="11"]')).toContainText("(4, 0)");
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(update).toHaveCount(0);
    await expect(toasts(page)).toContainText("Updated tileset “Terrain”.");
    expect(await history(page)).toEqual({
        undo: start.undo + 1,
        label: "Update Tileset from Source",
    });

    // SPEC §6.3 and TE-027: tile 8 keeps its ID at its chosen entry; 9 kept with no key;
    // 10 and 11 removed; the unmatched entry (4, 0) is new tile 12.
    const after = await tileset(page);
    expect(after.tiles.map((tile) => [tile.id, tile.key])).toEqual([
        [0, [0, 0]],
        [1, [1, 0]],
        [2, [2, 0]],
        [3, [3, 0]],
        [4, [0, 1]],
        [5, [1, 1]],
        [6, [2, 1]],
        [7, [3, 1]],
        [8, [4, 1]],
        [9, null],
        [12, [4, 0]],
    ]);
    expect(after.nextTileId).toBe(13);
    // Delete erased tile 10's cell; Replace rewrote tile 11's to tile 12, its flag kept.
    const flipped = (FLIP_H >>> 0).toString(16);
    expect(await cells(page)).toEqual([
        "0,0:1:8:0",
        "1,0:1:9:0",
        `3,0:1:12:${flipped}`,
        "4,0:1:8:0",
    ]);
    await expectViewport(page, [
        [0, 0, original(0, 2)],
        [1, 0, original(1, 2)],
        [3, 0, original(0, 2)],
    ]);
    await expectNotShown(page, 2, 0, original(2, 2));

    // Undo restores the tiles, the pixels, the cells and the viewport.
    await call(page, "undo");
    expect({ tileset: await tileset(page), cells: await cells(page) }).toEqual(before);
    await expectViewport(page, [
        [2, 0, original(2, 2)],
        [3, 0, original(3, 2)],
    ]);
});
