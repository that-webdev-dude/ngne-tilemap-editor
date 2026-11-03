import { test } from "@playwright/test";
import { createProject } from "../../src/core/model";
import { importSprite, readSpriteOutline, spriteGridDefaults } from "../../src/core/tileset";
import {
    confirmButton,
    dropFiles,
    expect,
    field,
    fixture,
    gridPng,
    importDialog,
    importFiles,
    openEditor,
    problems,
    setField,
    spriteFile,
    squareSprite,
    summary,
    tilesets,
    warnings,
} from "./te-024-support";

// TE-024: Import Tileset with a sprite project (SPEC §6.1, DESIGN §9). The form opens with the
// sprite's grid; the counts "n frames, m tiles, k animations" and the warnings come from the
// import the worker makes for the grid, the one Import adds. Without a default grid of at most
// 256 px, and whenever a tile size above 256 is entered, Import is disabled. A `.ngsprite`
// dropped anywhere in the window opens the dialog for it.

const TILES = new Uint8Array(fixture("tiles.ngsprite"));

/** What the import core makes of the fixture with its default grid: the expected counts. */
async function expected() {
    const outline = readSpriteOutline(TILES);
    const grid = spriteGridDefaults(outline)!;
    const { tileset, warnings } = await importSprite(createProject(), TILES, {
        fileName: "tiles.ngsprite",
        ...grid,
    });
    return {
        grid,
        frames: outline.frames.length,
        tiles: tileset.tiles.length,
        animated: tileset.tiles.filter((tile) => tile.animation.length > 0).length,
        warnings: warnings.map((warning) => warning.message),
    };
}

test("the sprite's grid is the default; counts and warnings are shown; Import adds them", async ({
    page,
}) => {
    const want = await expected();
    // The fixture: an 8 × 8 grid on a 16 × 16 canvas, five frames, a tag repeated twice.
    expect(want.grid).toEqual({ tileWidth: 8, tileHeight: 8, margin: 0, spacing: 0 });
    expect(want.warnings).toHaveLength(1);

    await openEditor(page);
    const dialog = await importFiles(page, [spriteFile("tiles.ngsprite", TILES)]);
    await expect(field(dialog, "Tile width")).toHaveValue("8");
    await expect(field(dialog, "Tile height")).toHaveValue("8");
    await expect(field(dialog, "Margin")).toHaveValue("0");
    await expect(field(dialog, "Spacing")).toHaveValue("0");
    await expect(summary(dialog)).toHaveText(
        `${want.frames} frames, ${want.tiles} tiles, ${want.animated} animations`,
    );
    await expect(warnings(dialog)).toHaveText(want.warnings);
    // The composited frame under the frame select, with the grid's four tiles over it.
    await expect(dialog.locator("[data-import-source]")).toBeVisible();
    await expect(dialog.locator("[data-import-cell]")).toHaveCount(4);
    await expect(dialog.getByRole("combobox", { name: "Frame" })).toContainText("1 of 5");

    // One tile per frame: the whole canvas.
    await setField(dialog, "Tile width", 16);
    await setField(dialog, "Tile height", 16);
    await expect(summary(dialog)).toHaveText(/^5 frames, \d+ tiles, \d+ animations$/);
    await expect(dialog.locator("[data-import-cell]")).toHaveCount(1);
    await setField(dialog, "Tile width", 8);
    await setField(dialog, "Tile height", 8);
    await expect(summary(dialog)).toHaveText(
        `${want.frames} frames, ${want.tiles} tiles, ${want.animated} animations`,
    );

    await expect(confirmButton(dialog)).toBeEnabled();
    await confirmButton(dialog).click();
    await expect(importDialog(page)).toHaveCount(0);
    expect(await tilesets(page)).toEqual([
        {
            name: "tiles",
            exportName: "tiles",
            tiles: want.tiles,
            animated: want.animated,
            tileWidth: 8,
            tileHeight: 8,
        },
    ]);
    await page.evaluate(() => window.__ngneTest!.assertInvariants());
});

test("Import stays disabled while the tile size is above 256", async ({ page }) => {
    await openEditor(page);
    // A 300 × 300 sprite whose grid cell is the canvas: no default of at most 256 px.
    const dialog = await importFiles(page, [spriteFile("big.ngsprite", squareSprite(300))]);
    await expect(field(dialog, "Tile width")).toHaveValue("300");
    await expect(field(dialog, "Tile height")).toHaveValue("300");
    await expect(problems(dialog)).toContainText("A tile is 1 to 256 px a side, got 300 × 300.");
    await expect(confirmButton(dialog)).toBeDisabled();

    await setField(dialog, "Tile width", 100);
    await expect(confirmButton(dialog)).toBeDisabled();
    await setField(dialog, "Tile height", 100);
    await expect(summary(dialog)).toHaveText("1 frame, 9 tiles, 0 animations");
    await expect(problems(dialog)).toHaveCount(0);
    await expect(confirmButton(dialog)).toBeEnabled();

    await setField(dialog, "Tile width", 257);
    await expect(problems(dialog)).toContainText("got 257 × 100");
    await expect(confirmButton(dialog)).toBeDisabled();
    // 256 is the largest tile: one column of three tiles.
    await setField(dialog, "Tile width", 256);
    await expect(summary(dialog)).toHaveText("1 frame, 3 tiles, 0 animations");
    await expect(confirmButton(dialog)).toBeEnabled();
    await setField(dialog, "Tile width", 150);
    await expect(summary(dialog)).toHaveText("1 frame, 6 tiles, 0 animations");
    await expect(confirmButton(dialog)).toBeEnabled();
});

test("a .ngsprite dropped on the window opens the dialog for it", async ({ page }) => {
    await openEditor(page);
    await dropFiles(page, [spriteFile("tiles.ngsprite", TILES)]);
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-import-file]")).toHaveText("tiles.ngsprite · 16 × 16");
    await expect(field(dialog, "Tile width")).toHaveValue("8");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(importDialog(page)).toHaveCount(0);
    expect(await tilesets(page)).toEqual([]);

    // A PNG dropped alone is not taken: only a sprite project is. Had it started an import,
    // the sprite dropped next would be ignored (one import at a time) or the dialog would
    // name the PNG; the dialog that opens is the sprite's.
    await dropFiles(page, [gridPng("terrain.png", 32, 32)]);
    await dropFiles(page, [spriteFile("tiles.ngsprite", TILES)]);
    await expect(dialog.locator("[data-import-file]")).toHaveText("tiles.ngsprite · 16 × 16");
    await expect(page.getByRole("dialog")).toHaveCount(1);
});
