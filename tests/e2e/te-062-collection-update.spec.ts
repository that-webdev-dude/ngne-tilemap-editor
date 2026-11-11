import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { encodePng } from "../../src/core/codec";
import type { TilesetView } from "./harness/te-062-page";
import { menuItem, openEditor, openMenu } from "./te-007-support";
import { recordWorkerTasks, workerTasks } from "./te-024-support";
import type { FilePayload } from "./te-024-support";
import { dropFilesOn } from "./te-025-support";
import {
    expect,
    fileStatuses,
    folderFiles,
    golden,
    importButton,
    mapWithFiles,
    pickFiles,
    removeFolderPicker,
    stubFolderPicker,
    tmjDialog,
    tmjFile,
    writeFolder,
} from "./te-061-support";

// TE-062: Update Tileset from Source… on a `"collection"` tileset (SPEC §6.3, FORMAT §2.4). The
// collection "props" (props.tsj: crate, barrel and bush, tiles 0–2, each twice on the map) is
// imported with TE-061's dialog from the TMJ fixture collection-uniform.tmj. Its edited copy has
// crate.png changed, barrel.png renamed cask.png and bush removed: crate changes in place (same
// key), barrel is matched by its fingerprint under its new key, bush is listed as missing. The
// source is picked as Import Tiled Map picks files: in one multi-select, in a folder, or dropped
// on the tileset's tab. Apply makes one history entry and undo restores it, as TE-028.

const PAGE_MODULE = "/tests/e2e/harness/te-062-page.ts";
const MAP = "collection-uniform.tmj";
const SIZE = 16;

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const tileset = (page: Page) => call<TilesetView>(page, "tileset", "props");
const cells = (page: Page) => call<string[]>(page, "cells", "props");
const history = (page: Page) => call<{ undo: number; label: string | null }>(page, "history");
const toasts = (page: Page) => page.getByRole("region", { name: "Notifications" });
const updateDialog = (page: Page) =>
    page.getByRole("dialog", { name: "Update Tileset from Source" });

/** A solid 16 px PNG named `name`. */
function solidPng(name: string, rgb: readonly [number, number, number]): FilePayload {
    const data = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let k = 0; k < SIZE * SIZE; k++) data.set([...rgb, 255], k * 4);
    return {
        name,
        mimeType: "image/png",
        buffer: Buffer.from(encodePng({ width: SIZE, height: SIZE, data })),
    };
}

/** props.tsj as Tiled writes it, listing `images` (paths from its folder) as tiles 0.. */
function propsTsj(images: string[]): FilePayload {
    const json = JSON.parse(
        readFileSync(new URL("../fixtures/tmj/props.tsj", import.meta.url), "utf8"),
    ) as Record<string, unknown>;
    json.tilecount = images.length;
    json.tiles = images.map((image, id) => ({
        id,
        image,
        imageheight: SIZE,
        imagewidth: SIZE,
    }));
    return {
        name: "props.tsj",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(json, null, 1)),
    };
}

/** The edited copy: crate changed, barrel renamed cask, bush removed. */
function editedCopy(): FilePayload[] {
    return [
        propsTsj(["images/crate.png", "images/cask.png"]),
        solidPng("crate.png", [250, 250, 10]),
        { ...tmjFile("images/barrel.png"), name: "cask.png" },
    ];
}

/** Imports collection-uniform.tmj with its files through Import Tiled Map; shows "props". */
async function importFixture(page: Page): Promise<void> {
    const dialog = await pickFiles(page, mapWithFiles(MAP));
    await expect(importButton(dialog)).toBeEnabled();
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    await showProps(page);
}

async function showProps(page: Page): Promise<void> {
    const { id } = await tileset(page);
    await page.locator(`[data-tileset-tab="${id}"]`).click();
}

/** Tileset → Update Tileset from Source…, then `files` picked in the file chooser. */
async function updateFromMenu(page: Page, files: FilePayload[]): Promise<void> {
    await openMenu(page, "Tileset");
    const chooser = page.waitForEvent("filechooser");
    await menuItem(page, "tileset.updateFromSource").click();
    await (await chooser).setFiles(files);
}

async function choose(page: Page, update: Locator, tile: number, option: string): Promise<void> {
    await update.getByRole("combobox", { name: `Tile ${tile}`, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
}

test("an edited copy picked in one multi-select: changed in place, matched by fingerprint, missing listed; Apply and undo", async ({
    page,
}) => {
    await recordWorkerTasks(page);
    await removeFolderPicker(page);
    await openEditor(page);
    await importFixture(page);
    const before = { tileset: await tileset(page), cells: await cells(page) };
    expect(before.tileset.tiles.map((tile) => [tile.id, tile.key])).toEqual([
        [0, "crate.png"],
        [1, "barrel.png"],
        [2, "bush.png"],
    ]);
    // Bush (tile 2) is on the map twice.
    expect(before.cells.filter((cell) => cell.endsWith(":2:0"))).toHaveLength(2);
    const start = await history(page);
    const mapName = await call<string>(page, "mapName");

    // The menu item asks for the Tiled file and its images; the dialog lists bush as missing.
    await updateFromMenu(page, editedCopy());
    await expect(toasts(page)).toContainText(
        "Pick “props.tsj” and its images, the source of tileset “props”.",
    );
    const update = updateDialog(page);
    await expect(update).toBeVisible();
    await expect(update.locator("[data-update-summary]")).toHaveText(
        "props: 0 unchanged, 1 moved, 1 changed, 0 new, 0 ambiguous, 1 missing",
    );
    const rows = update.locator("[data-update-row]");
    await expect(rows).toHaveCount(1);
    const bush = update.locator('[data-update-row="2"]');
    await expect(bush).toContainText("Missing from the source");
    await expect(bush.locator("[data-update-usage]")).toHaveText(`${mapName}: 2 cells`);
    await expect(update.getByRole("combobox", { name: "Tile 2", exact: true })).toHaveText(
        "Keep as is",
    );
    // Read and matched in the worker.
    const tasks = await workerTasks(page);
    expect(tasks).toContain("tileset.collectionImages");
    expect(tasks).toContain("tileset.updateSource");

    // Cancel changes nothing.
    await update.getByRole("button", { name: "Cancel" }).click();
    await expect(update).toHaveCount(0);
    expect(await history(page)).toEqual(start);
    expect({ tileset: await tileset(page), cells: await cells(page) }).toEqual(before);

    // Again, deleting bush: one history entry.
    await updateFromMenu(page, editedCopy());
    await expect(update).toBeVisible();
    await choose(page, update, 2, "Delete");
    await update.locator("[data-update-apply]").click();
    await expect(update).toHaveCount(0);
    await expect(toasts(page)).toContainText("Updated tileset “props”.");
    expect(await history(page)).toEqual({
        undo: start.undo + 1,
        label: "Update Tileset from Source",
    });
    const after = await tileset(page);
    // Crate changed in place; barrel kept its ID under its new key with the same pixels.
    expect(after.tiles.map((tile) => [tile.id, tile.key])).toEqual([
        [0, "crate.png"],
        [1, "cask.png"],
    ]);
    expect(after.tiles[0]!.fingerprint).not.toBe(before.tileset.tiles[0]!.fingerprint);
    expect(after.tiles[1]!.fingerprint).toBe(before.tileset.tiles[1]!.fingerprint);
    expect(after.nextTileId).toBe(before.tileset.nextTileId);
    // Delete erased bush's cells; the others are untouched.
    expect(await cells(page)).toEqual(before.cells.filter((cell) => !cell.endsWith(":2:0")));

    // Undo restores the tiles, the pixels and the cells.
    await call(page, "undo");
    expect({ tileset: await tileset(page), cells: await cells(page) }).toEqual(before);
});

test("a folder: the Tiled file and images found by path; a changed image applies at once; undo restores it", async ({
    page,
}) => {
    await stubFolderPicker(page);
    await openEditor(page);
    await writeFolder(page, folderFiles());
    await openMenu(page, "File");
    await menuItem(page, "file.importTiledMap").click();
    const dialog = tmjDialog(page);
    await dialog.getByRole("combobox", { name: "Map" }).click();
    await page.getByRole("option", { name: MAP, exact: true }).click();
    await expect
        .poll(() => fileStatuses(dialog))
        .toEqual(golden(MAP).files.map((file) => `${file.path} found`));
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    await showProps(page);
    const before = { tileset: await tileset(page), cells: await cells(page) };
    const start = await history(page);

    // Only images/crate.png changes in the folder.
    const crate = solidPng("crate.png", [250, 250, 10]);
    await writeFolder(page, [{ path: "images/crate.png", bytes: [...crate.buffer] }]);
    await openMenu(page, "Tileset");
    await menuItem(page, "tileset.updateFromSource").click();
    await expect(toasts(page)).toContainText(
        "Updated tileset “props”: 2 unchanged, 0 moved, 1 changed, 0 new, 0 ambiguous, 0 missing.",
    );
    await expect(updateDialog(page)).toHaveCount(0);
    expect(await history(page)).toEqual({
        undo: start.undo + 1,
        label: "Update Tileset from Source",
    });
    const after = await tileset(page);
    expect(after.tiles.map((tile) => [tile.id, tile.key])).toEqual(
        before.tileset.tiles.map((tile) => [tile.id, tile.key]),
    );
    expect(after.tiles[0]!.fingerprint).not.toBe(before.tileset.tiles[0]!.fingerprint);
    expect(after.pixels).not.toBe(before.tileset.pixels);
    expect(await cells(page)).toEqual(before.cells);

    await call(page, "undo");
    expect({ tileset: await tileset(page), cells: await cells(page) }).toEqual(before);
});

test("dropped on the tileset's tab without an image the Tiled file names: refused, naming it", async ({
    page,
}) => {
    await removeFolderPicker(page);
    await openEditor(page);
    await importFixture(page);
    const before = { tileset: await tileset(page), cells: await cells(page) };
    const start = await history(page);

    const [tsj, crate] = editedCopy();
    await dropFilesOn(page, `[data-tileset-tab="${before.tileset.id}"]`, [tsj!, crate!]);
    await expect(toasts(page)).toContainText(
        "Could not update tileset “props”. The image images/cask.png is missing: pick it with the source.",
    );
    await expect(updateDialog(page)).toHaveCount(0);
    expect(await history(page)).toEqual(start);
    expect({ tileset: await tileset(page), cells: await cells(page) }).toEqual(before);
});
