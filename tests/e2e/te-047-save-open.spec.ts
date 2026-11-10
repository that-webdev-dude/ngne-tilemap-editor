import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports this module from the dev server; here it is needed for its types.
import type * as ClipboardModule from "../../src/app/clipboard/clipboard";
import type * as ModelModule from "../../src/core/model";
import type * as ReferenceModule from "../support/referenceProject";
import { collectErrors, region } from "./te-003-support";
import { menuItem, openMenu } from "./te-007-support";
import {
    addLayer,
    arrangePickers,
    discardDialog,
    emptyState,
    errorToast,
    infoToast,
    newProject,
    openEmpty,
    opfsFile,
    pickerStub,
    projectName,
    projectState,
    recentButtons,
    removeFileSystemAccess,
    saveDialog,
    stubPickers,
    unsavedMarker,
} from "./te-047-support";

// TE-047: the project file workflows of SPEC §10.1 in the app. The app starts on the empty
// state; New Project, Save, Save As, Open, Revert and Close Project on one project per window;
// Save / Discard / Cancel before an unsaved project goes; the download fallback without File
// System Access; recent files; a dropped `.ngtilemap`; the clipboard emptied on another project.

/** Runs File → `id` from the menu bar. */
async function fileMenu(page: Page, id: string): Promise<void> {
    await openMenu(page, "File");
    await menuItem(page, id).click();
}

/** Saves with Ctrl+S to `name` (the picker's answer when the project has no file yet). */
async function saveAs(page: Page, name: string, keys = "Control+Shift+KeyS"): Promise<void> {
    await arrangePickers(page, { nextSave: [name] });
    await page.keyboard.press(keys);
    await expect(infoToast(page, `Saved ${name}`)).toBeVisible();
}

/** Opens `name` with Ctrl+O. */
async function open(page: Page, name: string): Promise<void> {
    await arrangePickers(page, { nextOpen: [name] });
    await page.keyboard.press("Control+KeyO");
}

/** Whether the app's clipboard holds anything (app/clipboard). */
function clipboardFull(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const path = "/src/app/clipboard/clipboard.ts";
        const { clipboardStore } = (await import(
            /* @vite-ignore */ path
        )) as typeof ClipboardModule;
        const { content, markers } = clipboardStore.getState();
        return content !== null || markers !== null;
    });
}

test("new project, edit, save, reload and open give the same project; the marker follows the history", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubPickers(page);
    await openEmpty(page);
    const empty = emptyState(page);
    await expect(empty.getByRole("button", { name: "New Project" })).toBeEnabled();
    await expect(empty.getByRole("button", { name: "Open" })).toBeEnabled();
    await expect(empty.getByRole("button", { name: "Import Tiled Map" })).toBeDisabled();
    // Nothing of a project shows, and its commands are disabled.
    await expect(region(page, "menu-bar").locator("[data-map-tabs]")).toHaveCount(0);
    await expect(region(page, "dock")).not.toContainText("Layers");
    await openMenu(page, "File");
    await expect(menuItem(page, "file.save")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "file.newMap")).toHaveAttribute("aria-disabled", "true");
    await expect(menuItem(page, "file.newProject")).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");

    await newProject(page, "Overworld", { width: 20, height: 15 });
    expect(await projectState(page)).toMatchObject({
        open: true,
        name: "Overworld",
        maps: [{ name: "Map 1", width: 20, height: 15, layers: ["tile:Tile Layer 1"] }],
        dirty: false,
        undo: 0,
    });
    await expect(unsavedMarker(page)).toHaveCount(0);

    // The marker follows the history: a change, its undo, its redo.
    await addLayer(page);
    await expect(unsavedMarker(page)).toBeVisible();
    await page.keyboard.press("Control+KeyZ");
    await expect(unsavedMarker(page)).toHaveCount(0);
    await page.keyboard.press("Control+KeyY");
    await expect(unsavedMarker(page)).toBeVisible();

    // Save: the picker suggests the project's name; the project is clean.
    await saveAs(page, "overworld.ngtilemap", "Control+KeyS");
    expect((await pickerStub(page)).suggestions).toEqual(["Overworld.ngtilemap"]);
    await expect(unsavedMarker(page)).toHaveCount(0);
    // Undo past the save makes it dirty again; redo back to it, clean.
    await page.keyboard.press("Control+KeyZ");
    await expect(unsavedMarker(page)).toBeVisible();
    await page.keyboard.press("Control+KeyY");
    await expect(unsavedMarker(page)).toHaveCount(0);
    const saved = await projectState(page);

    await page.reload();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    await expect(emptyState(page)).toBeVisible();
    await open(page, "overworld.ngtilemap");
    await expect(infoToast(page, "Opened overworld.ngtilemap")).toBeVisible();
    await expect(projectName(page)).toHaveText("Overworld");
    expect(await projectState(page)).toEqual({ ...saved, undo: 0 });
    // The viewport shows the opened map.
    await page.waitForFunction(() => window.__ngneTest?.viewport?.status === "ready");
    expect(errors).toEqual([]);
});

test("Save As, Revert and Close Project", async ({ page }) => {
    const errors = collectErrors(page);
    await stubPickers(page);
    await openEmpty(page);
    await newProject(page, "Cave");
    await saveAs(page, "cave.ngtilemap");
    const first = await projectState(page);

    // Save As to another file: that file becomes the project's, under a new ID.
    await addLayer(page);
    await saveAs(page, "cave-2.ngtilemap");
    const copy = await projectState(page);
    expect(copy.id).not.toBe(first.id);
    expect(copy.dirty).toBe(false);
    expect((await opfsFile(page, "cave.ngtilemap")).length).toBeGreaterThan(0);

    // Revert: Cancel keeps the change; Discard reads the file again.
    await addLayer(page);
    await fileMenu(page, "file.revert");
    await expect(discardDialog(page)).toContainText("“Cave” has unsaved changes.");
    await discardDialog(page).getByRole("button", { name: "Cancel" }).click();
    expect((await projectState(page)).maps[0]!.layers).toHaveLength(3);
    await fileMenu(page, "file.revert");
    await discardDialog(page).getByRole("button", { name: "Discard" }).click();
    await expect(infoToast(page, "Reverted to cave-2.ngtilemap")).toBeVisible();
    expect(await projectState(page)).toEqual({ ...copy, undo: 0 });

    // Close Project: a clean project closes at once; an unsaved one asks first.
    await fileMenu(page, "file.closeProject");
    await expect(emptyState(page)).toBeVisible();
    await open(page, "cave-2.ngtilemap");
    await expect(projectName(page)).toHaveText("Cave");
    await addLayer(page);
    await fileMenu(page, "file.closeProject");
    await expect(saveDialog(page)).toContainText("“Cave” has unsaved changes.");
    await saveDialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(projectName(page)).toHaveText("Cave");
    await fileMenu(page, "file.closeProject");
    await saveDialog(page).getByRole("button", { name: "Discard" }).click();
    await expect(emptyState(page)).toBeVisible();
    expect((await projectState(page)).open).toBe(false);
    expect(errors).toEqual([]);
});

test("Open while the project is dirty asks Save / Discard / Cancel, and each choice does as it says", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubPickers(page);
    await openEmpty(page);
    await newProject(page, "Alpha");
    await saveAs(page, "alpha.ngtilemap");
    // A clean project goes without a question.
    await newProject(page, "Gamma");
    await saveAs(page, "gamma.ngtilemap");
    await newProject(page, "Beta");
    await addLayer(page);
    const beta = await projectState(page);

    // Cancel: Beta stays, with its change.
    await open(page, "alpha.ngtilemap");
    await expect(saveDialog(page)).toContainText(
        "“Beta” has unsaved changes. “alpha.ngtilemap” takes its place.",
    );
    await saveDialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(saveDialog(page)).toHaveCount(0);
    expect(await projectState(page)).toEqual(beta);

    // Discard: Alpha opens, Beta's change is gone (it was never saved).
    await open(page, "alpha.ngtilemap");
    await saveDialog(page).getByRole("button", { name: "Discard" }).click();
    await expect(projectName(page)).toHaveText("Alpha");
    expect((await pickerStub(page)).nextSave).toEqual([]);

    // The project's own file is open already: nothing changes, nothing is asked.
    await open(page, "alpha.ngtilemap");
    await expect(infoToast(page, "alpha.ngtilemap is open already")).toBeVisible();

    // Save: Alpha's change is written to its file, then the other file opens.
    await addLayer(page);
    const changed = await projectState(page);
    await open(page, "gamma.ngtilemap");
    await saveDialog(page).getByRole("button", { name: "Save" }).click();
    await expect(infoToast(page, "Saved alpha.ngtilemap")).toBeVisible();
    await expect(projectName(page)).toHaveText("Gamma");
    // The saved file holds the change: opened again, it has it.
    await open(page, "alpha.ngtilemap");
    await expect(projectName(page)).toHaveText("Alpha");
    expect(await projectState(page)).toEqual({ ...changed, dirty: false, undo: 0 });
    expect(errors).toEqual([]);
});

test("without File System Access Save downloads and Open reads a file input", async ({
    page,
}, testInfo) => {
    const errors = collectErrors(page);
    await removeFileSystemAccess(page);
    await openEmpty(page);
    await newProject(page, "Plain: Map");
    await addLayer(page);
    const downloading = page.waitForEvent("download");
    await page.keyboard.press("Control+KeyS");
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("Plain_ Map.ngtilemap");
    await expect(infoToast(page, "Saved Plain_ Map.ngtilemap")).toBeVisible();
    await expect(unsavedMarker(page)).toHaveCount(0);
    const saved = await projectState(page);
    const path = testInfo.outputPath("plain.ngtilemap");
    await download.saveAs(path);

    await page.reload();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    await expect(emptyState(page)).toBeVisible();
    // Without File System Access nothing is listed in the recent files.
    await expect(recentButtons(page)).toHaveCount(0);
    const choosing = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+KeyO");
    await (await choosing).setFiles(path);
    await expect(infoToast(page, "Opened plain.ngtilemap")).toBeVisible();
    expect(await projectState(page)).toEqual({ ...saved, undo: 0 });
    expect(errors).toEqual([]);
});

test("recent files list the last 10 projects newest first and reopen them", async ({ page }) => {
    // Eleven saves and a reload.
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await stubPickers(page);
    await openEmpty(page);
    await newProject(page, "Recent");
    for (let index = 1; index <= 11; index++) await saveAs(page, `r${index}.ngtilemap`);
    await fileMenu(page, "file.closeProject");
    const listed = Array.from({ length: 10 }, (_, index) => `r${11 - index}.ngtilemap`);
    await expect(recentButtons(page)).toHaveText(listed);

    // Kept across a reload, in File → Open Recent as well.
    await page.reload();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    await expect(recentButtons(page)).toHaveText(listed);
    await expect(emptyState(page).getByText("Recent projects")).toBeVisible();
    const file = await openMenu(page, "File");
    await file.locator('[data-submenu="Open Recent"]').hover();
    const submenu = page.getByRole("menu", { name: "Open Recent", exact: true });
    await expect(submenu.getByRole("menuitem")).toHaveText([...listed, "Clear Recent Files"]);
    await submenu.getByRole("menuitem", { name: "r4.ngtilemap" }).click();
    await expect(infoToast(page, "Opened r4.ngtilemap")).toBeVisible();
    await expect(projectName(page)).toHaveText("Recent");

    // From the empty state: the reopened file moved to the top.
    await fileMenu(page, "file.closeProject");
    await expect(recentButtons(page).first()).toHaveText("r4.ngtilemap");
    await recentButtons(page).nth(1).click();
    await expect(infoToast(page, "Opened r11.ngtilemap")).toBeVisible();
    expect(errors).toEqual([]);
});

test("a dropped .ngtilemap opens, and opening another project empties the clipboard", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubPickers(page);
    await openEmpty(page);
    await newProject(page, "Dropped");
    await saveAs(page, "dropped.ngtilemap");
    await newProject(page, "Holder");

    // Something on the clipboard: cells of the project.
    await page.evaluate(async () => {
        const path = "/src/app/clipboard/clipboard.ts";
        const { copyCellsToClipboard } = (await import(
            /* @vite-ignore */ path
        )) as typeof ClipboardModule;
        copyCellsToClipboard({ width: 1, height: 1, cells: Uint32Array.of(0x0100_0001) });
    });
    expect(await clipboardFull(page)).toBe(true);

    // A drop of the file (and a text file) on the viewport opens the project file.
    const bytes = await opfsFile(page, "dropped.ngtilemap");
    await page.evaluate((bytes) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["notes"], "notes.txt"));
        transfer.items.add(new File([Uint8Array.from(bytes)], "dropped.ngtilemap"));
        const target = document.querySelector('[data-region="viewport"]')!;
        for (const type of ["dragover", "drop"]) {
            target.dispatchEvent(
                new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }),
            );
        }
    }, bytes);
    await expect(infoToast(page, "Opened dropped.ngtilemap")).toBeVisible();
    await expect(projectName(page)).toHaveText("Dropped");
    expect(await clipboardFull(page)).toBe(false);

    // Dropped on the Tilesets panel, whose own drop imports tilesets, it opens as the project too.
    await newProject(page, "Holder 2");
    await page.evaluate((bytes) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([Uint8Array.from(bytes)], "dropped.ngtilemap"));
        const target = document.querySelector("[data-tilesets-panel]")!;
        for (const type of ["dragover", "drop"]) {
            target.dispatchEvent(
                new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }),
            );
        }
    }, bytes);
    await expect(projectName(page)).toHaveText("Dropped");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openMenu(page, "Edit");
    await expect(menuItem(page, "edit.paste")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");

    // A drop without a project file is reported and changes nothing.
    await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["x"], "tiles.txt"));
        document
            .querySelector('[data-region="viewport"]')!
            .dispatchEvent(
                new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }),
            );
    });
    await expect(errorToast(page)).toHaveText("“tiles.txt” is not a tilemap project (.ngtilemap).");
    await expect(projectName(page)).toHaveText("Dropped");
    expect(errors).toEqual([]);
});

test("the reference project's cells and tileset pixels come back the same after save and open", async ({
    page,
}) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await stubPickers(page);
    await openEmpty(page);
    // ENGINE §6's reference project (two tilesets, 8 full layers of 256 × 256 cells) as the
    // window's project, through the worker's writer and reader.
    await page.evaluate(async () => {
        const referencePath = "/tests/support/referenceProject.ts";
        const modelPath = "/src/core/model/index.ts";
        const reference = (await import(
            /* @vite-ignore */ referencePath
        )) as typeof ReferenceModule;
        const model = (await import(/* @vite-ignore */ modelPath)) as typeof ModelModule;
        window
            .__ngneTest!.session.getState()
            .replace(model.createProjectSession(reference.createReferenceProject()));
    });
    const digest = () =>
        page.evaluate(() => {
            const { project } = window.__ngneTest!.session.getState().session;
            let hash = 0;
            const mix = (value: number) => {
                hash = (Math.imul(hash ^ value, 0x01000193) >>> 0) + 1;
            };
            for (const tileset of project.tilesets) {
                for (const byte of tileset.pixels.data) mix(byte);
            }
            let cells = 0;
            for (const layer of project.maps[0]!.layers) {
                if (layer.type !== "tile") continue;
                for (let y = 0; y < project.maps[0]!.height; y++) {
                    for (let x = 0; x < project.maps[0]!.width; x++) {
                        mix(layer.cells.get(x, y));
                    }
                }
                cells += layer.cells.count;
            }
            return { hash, cells, tilesets: project.tilesets.length };
        });
    const before = await digest();
    expect(before.cells).toBe(8 * 256 * 256);
    await saveAs(page, "reference.ngtilemap");
    await page.reload();
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    // The test hooks come before the keymap, which waits for the WebGPU check: Ctrl+O is
    // pressed once the empty state shows.
    await expect(emptyState(page)).toBeVisible();
    await open(page, "reference.ngtilemap");
    await expect(infoToast(page, "Opened reference.ngtilemap")).toBeVisible();
    expect(await digest()).toEqual(before);
    await page.waitForFunction(() => window.__ngneTest?.viewport?.status === "ready");
    expect(errors).toEqual([]);
});

test("an unsaved project keeps the unload guard, also while the window is too small", async ({
    page,
}) => {
    await openEmpty(page);
    await newProject(page, "Guarded");
    await addLayer(page);
    await page.setViewportSize({ width: 1000, height: 600 });
    await expect(page.locator("[data-notice=window-too-small]")).toBeVisible();
    const asked = page.waitForEvent("dialog");
    // A page with sticky activation may ask before it is left: a click gives it.
    await page.mouse.click(5, 5);
    await page.close({ runBeforeUnload: true });
    const dialog = await asked;
    expect(dialog.type()).toBe("beforeunload");
    // The dismissal settles before the test ends: a context closed while Chrome is still
    // cancelling the unload can take the browser down with it (headed Linux CI).
    await dialog.dismiss();
    await expect(projectName(page)).toHaveText("Guarded");
    expect(page.isClosed()).toBe(false);
    await page.close();
});
