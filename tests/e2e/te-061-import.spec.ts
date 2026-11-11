import { test } from "@playwright/test";
import { emptyState, openEmpty } from "./te-047-support";
import { menuItem, openMenu } from "./te-007-support";
import { dropFiles, openEditor, recordWorkerTasks, workerTasks } from "./te-024-support";
import {
    expect,
    expectReport,
    fileStatuses,
    fixtureMaps,
    folderFiles,
    golden,
    importButton,
    mapWithFiles,
    pickFiles,
    projectContents,
    removeFolderPicker,
    stubFolderPicker,
    tmjDialog,
    tmjFile,
    writeFolder,
} from "./te-061-support";

// TE-061: File → Import Tiled Map… (SPEC §13, DESIGN §9). Every TMJ fixture goes through the
// dialog: its files are listed as found, the report equals its golden (or the refusal shows its
// message) and Import adds the map and its tilesets in one history entry, which undo removes. A
// missing tileset is listed and Add files… completes it; Cancel leaves the project as it was.
// Files are picked in one multi-select (File System Access's folder picker taken away), in a
// folder (a picker over the origin private file system), or dropped on the window. Reading the
// files a map needs and converting it run in the worker.

const maps = fixtureMaps();

test.describe("every fixture through the dialog", () => {
    for (const map of maps) {
        test(`${map}: imports with its golden report, or is refused with its message`, async ({
            page,
        }) => {
            const expected = golden(map);
            await recordWorkerTasks(page);
            await removeFolderPicker(page);
            await openEditor(page);
            const before = await projectContents(page);
            const dialog = await pickFiles(page, mapWithFiles(map));
            await expect(dialog.locator("[data-tmj-map]")).toHaveText(map);
            await expectReport(dialog, expected);
            expect(await fileStatuses(dialog)).toEqual(
                expected.files.map((file) => `${file.path} found`),
            );
            // Read for its files, then converted, in the worker; refusals come from the conversion.
            const tasks = await workerTasks(page);
            expect(tasks).toContain("tmj.files");
            expect(tasks).toContain("tmj.import");
            if ("refused" in expected) {
                await dialog.getByRole("button", { name: "Cancel" }).click();
                await expect(dialog).toHaveCount(0);
                expect(await projectContents(page)).toEqual(before);
                return;
            }
            await importButton(dialog).click();
            await expect(dialog).toHaveCount(0);
            const after = await projectContents(page);
            const { summary } = expected;
            expect(after.maps).toEqual([
                ...before.maps,
                `${summary.name} ${summary.width}x${summary.height}`,
            ]);
            expect(after.activeMap).toBe(summary.name);
            expect(after.tilesets).toEqual(
                summary.tilesets.map((tileset) => `${tileset.name} ${tileset.tiles}`),
            );
            expect(after.images).toHaveLength(summary.images);
            expect(after.undo).toBe(before.undo + 1);
            expect(after.undoLabel).toBe("Import Tiled Map");
            await page.evaluate(() => window.__ngneTest!.assertInvariants());
        });
    }
});

test("a missing tileset is listed; Add files… completes it, and undo removes the import", async ({
    page,
}) => {
    await removeFolderPicker(page);
    await openEditor(page);
    const before = await projectContents(page);
    // The map and the tileset's image, without the tileset.
    const dialog = await pickFiles(page, [tmjFile("tileset-tsj.tmj"), tmjFile("tiles.png")]);
    await expect.poll(() => fileStatuses(dialog)).toEqual(["tiles.tsj missing"]);
    await expect(dialog.locator('[data-tmj-phase="missing"]')).toHaveText(
        "1 file is missing: add it with Add files…",
    );
    await expect(importButton(dialog)).toBeDisabled();

    const chooser = page.waitForEvent("filechooser");
    await dialog.locator("[data-tmj-add-files]").click();
    await (await chooser).setFiles([tmjFile("tiles.tsj")]);
    await expect.poll(() => fileStatuses(dialog)).toEqual(["tiles.tsj found", "tiles.png found"]);
    await expectReport(dialog, golden("tileset-tsj.tmj"));
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect((await projectContents(page)).tilesets).toEqual(["tiles 32"]);

    // Undo, through the menu, removes the map and its tileset; redo puts them back.
    await openMenu(page, "Edit");
    await menuItem(page, "edit.undo").click();
    const undone = await projectContents(page);
    expect(undone).toEqual({ ...before, dirty: undone.dirty });
    await openMenu(page, "Edit");
    await menuItem(page, "edit.redo").click();
    expect((await projectContents(page)).maps).toEqual([...before.maps, "tileset-tsj 6x4"]);
});

test("Cancel leaves the project unchanged, the report shown or not", async ({ page }) => {
    await removeFolderPicker(page);
    await openEditor(page);
    const before = await projectContents(page);
    let dialog = await pickFiles(page, mapWithFiles("dungeon.tmj"));
    await expectReport(dialog, golden("dungeon.tmj"));
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await projectContents(page)).toEqual(before);
    // With a file missing; Escape cancels too.
    dialog = await pickFiles(page, [tmjFile("templates.tmj")]);
    await expect(importButton(dialog)).toBeDisabled();
    // The tileset's image is known once the tileset is there.
    await expect
        .poll(() => fileStatuses(dialog))
        .toEqual([
            "tiles.tsj missing",
            "templates/door.tj missing",
            "templates/coin.tj missing",
            "templates/zone.tj missing",
        ]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await projectContents(page)).toEqual(before);
});

test("a folder: relative paths resolve, the map is chosen among several, and with no project open Import makes one", async ({
    page,
}) => {
    await stubFolderPicker(page);
    await openEmpty(page);
    await writeFolder(page, folderFiles());
    await emptyState(page).getByRole("button", { name: "Import Tiled Map" }).click();
    const dialog = tmjDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-tmj-source]")).toHaveText("Folder “tmj”");
    // The first map, in path order, is chosen; it is refused (mixed collection sizes).
    await expectReport(dialog, golden("collection-mixed.tmj"));
    // Templates are found by their path from the map (templates/door.tj …).
    await dialog.getByRole("combobox", { name: "Map" }).click();
    await page.getByRole("option", { name: "templates.tmj", exact: true }).click();
    await expect
        .poll(() => fileStatuses(dialog))
        .toEqual(golden("templates.tmj").files.map((file) => `${file.path} found`));
    await expectReport(dialog, golden("templates.tmj"));
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect(await projectContents(page)).toEqual({
        open: true,
        name: "templates",
        maps: ["templates 12x8"],
        tilesets: ["tiles 32"],
        images: [],
        activeMap: "templates",
        undo: 0,
        undoLabel: null,
        // Unsaved until saved: closing the tab or the project asks first.
        dirty: true,
    });
    await page.evaluate(() => window.__ngneTest!.assertInvariants());
});

test("a map dropped on the window with its files opens the dialog", async ({ page }) => {
    await openEditor(page);
    await dropFiles(page, mapWithFiles("collection-uniform.tmj"));
    const dialog = tmjDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-tmj-source]")).toHaveText("7 files");
    await expectReport(dialog, golden("collection-uniform.tmj"));
    await importButton(dialog).click();
    await expect(dialog).toHaveCount(0);
    expect((await projectContents(page)).tilesets).toEqual(["props 3", "tiles 32"]);
});

test("a Tiled map saved as .json, dropped with its files, opens the dialog", async ({ page }) => {
    await openEditor(page);
    const map = { ...tmjFile("flips.tmj"), name: "flips.json" };
    await dropFiles(page, [map, tmjFile("tiles.tsj"), tmjFile("tiles.png")]);
    const dialog = tmjDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-tmj-map]")).toHaveText("flips.json");
    await expect(dialog.locator("[data-tmj-summary] li").first()).toHaveText(
        "Map “flips”: 8 × 2 cells of 16 × 16 px",
    );
});
