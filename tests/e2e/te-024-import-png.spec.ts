import { test } from "@playwright/test";
import {
    confirmButton,
    expect,
    field,
    gridPng,
    importDialog,
    importFiles,
    openEditor,
    overlayCells,
    pngHeader,
    problems,
    recordWorkerTasks,
    setField,
    summary,
    tilesets,
    undoFromMenu,
    undoLabel,
    workerTasks,
} from "./te-024-support";

// TE-024: Import Tileset with a grid PNG (SPEC §6.1, DESIGN §9). The image shows the tiles of
// the form's grid (Tiled's: from the margin, stepping by tile size plus spacing, whole tiles
// only) and the form counts them; Import adds the tileset as one history entry that undo
// removes. A PNG above the pixel limits is refused before anything is decoded.

/** The worker tasks that decode or slice a source. */
const DECODING = ["png.decode", "tileset.import", "tileset.spriteFrame"];

test("the grid overlay follows the form, the count updates, Import adds the tileset and undo removes it", async ({
    page,
}) => {
    await openEditor(page);
    const dialog = await importFiles(page, [gridPng("terrain.png", 64, 48)]);

    // The active map's tile size (16 × 16 in a new project), margin and spacing 0.
    await expect(field(dialog, "Tile width")).toHaveValue("16");
    await expect(field(dialog, "Tile height")).toHaveValue("16");
    await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("terrain");
    await expect(dialog.getByRole("textbox", { name: "Export name" })).toHaveValue("terrain");
    await expect(summary(dialog)).toHaveText("12 tiles");
    await expect.poll(() => overlayCells(dialog)).toHaveLength(12);
    expect((await overlayCells(dialog)).slice(0, 2)).toEqual(["0,0,16,16", "16,0,16,16"]);

    // Margin 2, spacing 1: floor((64 − 2 + 1) / 17) = 3 columns, floor((48 − 2 + 1) / 17) = 2 rows.
    await setField(dialog, "Margin", 2);
    await setField(dialog, "Spacing", 1);
    await expect(summary(dialog)).toHaveText("6 tiles");
    await expect
        .poll(() => overlayCells(dialog))
        .toEqual([
            "2,2,16,16",
            "19,2,16,16",
            "36,2,16,16",
            "2,19,16,16",
            "19,19,16,16",
            "36,19,16,16",
        ]);

    // A tile wider than the image: no whole tile, nothing drawn, Import disabled.
    await setField(dialog, "Tile width", 80);
    await expect(summary(dialog)).toHaveText("");
    await expect(problems(dialog)).toContainText("No whole tile of 80 × 16 px");
    await expect.poll(() => overlayCells(dialog)).toEqual([]);
    await expect(confirmButton(dialog)).toBeDisabled();
    await setField(dialog, "Tile width", 16);
    await expect(summary(dialog)).toHaveText("6 tiles");

    expect(await tilesets(page)).toEqual([]);
    await expect(confirmButton(dialog)).toBeEnabled();
    await confirmButton(dialog).click();
    await expect(importDialog(page)).toHaveCount(0);
    expect(await tilesets(page)).toEqual([
        {
            name: "terrain",
            exportName: "terrain",
            tiles: 6,
            animated: 0,
            tileWidth: 16,
            tileHeight: 16,
        },
    ]);
    expect(await undoLabel(page)).toBe("Import Tileset");
    await page.evaluate(() => window.__ngneTest!.assertInvariants());

    await undoFromMenu(page);
    await expect.poll(() => tilesets(page)).toEqual([]);
});

test("a PNG above the pixel limits is refused before it is decoded", async ({ page }) => {
    await recordWorkerTasks(page);
    await openEditor(page);
    const dialog = await importFiles(page, [pngHeader("huge.png", 9000, 16)]);

    await expect(problems(dialog)).toContainText(
        "The image is 9000 × 16 px; a source image is at most 8192 px a side.",
    );
    await expect(dialog.locator("[data-import-no-preview]")).toBeVisible();
    await expect(confirmButton(dialog)).toBeDisabled();
    // A change of the form plans again and stays refused.
    await setField(dialog, "Tile width", 8);
    await expect(confirmButton(dialog)).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(importDialog(page)).toHaveCount(0);

    expect((await workerTasks(page)).filter((task) => DECODING.includes(task))).toEqual([]);
    expect(await tilesets(page)).toEqual([]);
});

test("a grid PNG within the limits is decoded in the worker", async ({ page }) => {
    await recordWorkerTasks(page);
    await openEditor(page);
    const dialog = await importFiles(page, [gridPng("small.png", 32, 32)]);
    await expect(dialog.locator("[data-import-source]")).toBeVisible();
    await confirmButton(dialog).click();
    await expect(importDialog(page)).toHaveCount(0);
    expect((await workerTasks(page)).filter((task) => DECODING.includes(task))).toEqual([
        "png.decode",
        "tileset.import",
    ]);
});
