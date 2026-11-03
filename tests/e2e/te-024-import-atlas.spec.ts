import { test } from "@playwright/test";
import {
    atlasFile,
    confirmButton,
    expect,
    fixture,
    fixtureAtlas,
    importDialog,
    importFiles,
    openEditor,
    problems,
    summary,
    tilesets,
    warnings,
} from "./te-024-support";

// TE-024: Import Tileset with an atlas (SPEC §6.1, DESIGN §9): the `.atlas.json` and its PNG
// picked together. The dialog lists the frames with their source sizes and the animations,
// and the warnings of the import; frames of different sizes are refused with the frames named.

const PNG = { name: "tiles.png", mimeType: "image/png", buffer: fixture("tiles.png") };

test("the frames with their sizes, the animations and the warnings are listed; Import adds the tileset", async ({
    page,
}) => {
    await openEditor(page);
    const dialog = await importFiles(page, [atlasFile("tiles.atlas.json", fixtureAtlas()), PNG]);

    const frames = dialog.locator("[data-import-frames] li");
    await expect(frames).toHaveText([
        "tiles-016 × 16",
        "tiles-116 × 16",
        "tiles-216 × 16",
        "tiles-316 × 16",
        "tiles-416 × 16",
    ]);
    await expect(dialog.locator("[data-import-animations] li")).toHaveText([
        "walk6 frames",
        "blink4 frames, once",
        "back2 frames",
    ]);
    await expect(warnings(dialog)).toHaveText([
        'The animation "blink" plays once in the atlas; it loops here.',
    ]);
    await expect(summary(dialog)).toHaveText("5 tiles");
    // An atlas has no grid to set.
    await expect(dialog.getByRole("spinbutton")).toHaveCount(0);

    await confirmButton(dialog).click();
    await expect(importDialog(page)).toHaveCount(0);
    expect(await tilesets(page)).toEqual([
        {
            name: "tiles",
            exportName: "tiles",
            tiles: 5,
            animated: 3,
            tileWidth: 16,
            tileHeight: 16,
        },
    ]);
    await page.evaluate(() => window.__ngneTest!.assertInvariants());
});

test("frames of mixed sizes are refused with the frames named", async ({ page }) => {
    const atlas = fixtureAtlas();
    // tiles-1 keeps its 16 × 16 rectangle in a 17 × 17 source frame.
    atlas.frames["tiles-1"] = { ...atlas.frames["tiles-1"], sourceW: 17, sourceH: 17 };
    await openEditor(page);
    const dialog = await importFiles(page, [atlasFile("tiles.atlas.json", atlas), PNG]);

    await expect(dialog.locator('[data-import-frame="tiles-1"]')).toHaveText("tiles-117 × 17");
    await expect(problems(dialog)).toHaveText(
        "The tiles of a tileset share one size, but the frames differ (16 × 16 px: " +
            '"tiles-0", "tiles-2", "tiles-3", "tiles-4"; 17 × 17 px: "tiles-1").',
    );
    await expect(summary(dialog)).toHaveText("");
    await expect(confirmButton(dialog)).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await tilesets(page)).toEqual([]);
});

test("an atlas picked without its PNG is refused naming the PNG", async ({ page }) => {
    await openEditor(page);
    const dialog = await importFiles(page, [atlasFile("tiles.atlas.json", fixtureAtlas())]);
    await expect(problems(dialog)).toHaveText(
        'An atlas is imported with its PNG: pick "tiles.atlas.json" and "tiles.png" together.',
    );
    await expect(confirmButton(dialog)).toBeDisabled();
});
