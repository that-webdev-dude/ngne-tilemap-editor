import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports these modules from the dev server; here they are needed for their types.
import type * as CoreExportModule from "../../src/core/export";
import type * as ModelModule from "../../src/core/model";
import type * as ProjectModule from "../support/exportProject";
import type * as DialogModule from "../../src/ui/export/ExportDialog";
import { collectErrors } from "./te-003-support";
import {
    arrangePickers,
    errorToast,
    infoToast,
    openEmpty,
    opfsFile,
    projectState,
    stubPickers,
    unsavedMarker,
} from "./te-047-support";

// TE-054: the Export dialog (DESIGN §9), Export Again and Export on Save (SPEC §10.2) in the app,
// with the worker. The directory picker is replaced by one that hands out a folder of the
// origin private file system (OPFS), as in TE-053, and every write into it is logged by name;
// the save picker is TE-047's stub over OPFS files. The project is TE-053's (two maps, two
// tilesets, an image; tests/support/exportProject.ts).

/** The state of the picker stub, on `window.__te054`. */
interface FolderStub {
    /** The names written into the export folder, in order. */
    writes: string[];
    /** A file of the export folder whose write fails, or null. */
    failOn: string | null;
    /** How often the directory picker was shown. */
    picks: number;
}

declare global {
    interface Window {
        __te054?: FolderStub;
    }
}

const FOLDER = "game";

/** Replaces the directory picker before the app loads, and logs every write into its folder. */
async function stubFolder(page: Page): Promise<void> {
    await page.addInitScript((folder) => {
        const stub: FolderStub = { writes: [], failOn: null, picks: 0 };
        window.__te054 = stub;
        const exportFolder = async () => {
            const root = await navigator.storage.getDirectory();
            return root.getDirectoryHandle(folder, { create: true });
        };
        Object.assign(window, {
            async showDirectoryPicker() {
                stub.picks += 1;
                return exportFolder();
            },
        });
        const proto = FileSystemFileHandle.prototype;
        const original = proto.createWritable;
        proto.createWritable = async function (this: FileSystemFileHandle, ...args) {
            const dir = await exportFolder();
            const inFolder = await dir
                .getFileHandle(this.name)
                .then((handle) => handle.isSameEntry(this))
                .catch(() => false);
            if (inFolder) {
                if (stub.failOn === this.name) {
                    throw new DOMException("The disk is full.", "QuotaExceededError");
                }
                stub.writes.push(this.name);
            }
            return original.apply(this, args);
        };
    }, FOLDER);
}

/** Opens the app with the TE-053 project, clean. */
async function openProject(page: Page): Promise<void> {
    await openEmpty(page);
    await page.evaluate(async () => {
        const modelPath = "/src/core/model/index.ts";
        const model = (await import(/* @vite-ignore */ modelPath)) as typeof ModelModule;
        const supportPath = "/tests/support/exportProject.ts";
        const support = (await import(/* @vite-ignore */ supportPath)) as typeof ProjectModule;
        window
            .__ngneTest!.session.getState()
            .replace(model.createProjectSession(support.createExportProject()));
    });
    await expect(unsavedMarker(page)).toHaveCount(0);
}

/** The plan of the window's project as the dialog should list it: name, group and size text. */
function plan(page: Page): Promise<{ name: string; group: string; size: string }[]> {
    return page.evaluate(async () => {
        const corePath = "/src/core/export/index.ts";
        const core = (await import(/* @vite-ignore */ corePath)) as typeof CoreExportModule;
        const dialogPath = "/src/ui/export/ExportDialog.tsx";
        const dialog = (await import(/* @vite-ignore */ dialogPath)) as typeof DialogModule;
        const project = window.__ngneTest!.session.getState().session.project;
        return core.exportFiles(project).map((file) => ({
            name: file.name,
            group: core.exportFileGroup(file.kind),
            size: dialog.formatSize(file.bytes.length),
        }));
    });
}

/** The size of each tileset's packed image, by export name. */
function atlasSizes(page: Page): Promise<Record<string, [number, number]>> {
    return page.evaluate(async () => {
        const corePath = "/src/core/export/index.ts";
        const core = (await import(/* @vite-ignore */ corePath)) as typeof CoreExportModule;
        const project = window.__ngneTest!.session.getState().session.project;
        const { atlases } = core.exportPreview(project);
        return Object.fromEntries(
            atlases.map((atlas) => [atlas.name, [atlas.width, atlas.height]]),
        );
    });
}

/** The bytes of every file of the plan, as numbers, by name. */
function planBytes(page: Page): Promise<Record<string, number[]>> {
    return page.evaluate(async () => {
        const corePath = "/src/core/export/index.ts";
        const core = (await import(/* @vite-ignore */ corePath)) as typeof CoreExportModule;
        const project = window.__ngneTest!.session.getState().session.project;
        return Object.fromEntries(
            core.exportFiles(project).map((file) => [file.name, Array.from(file.bytes)]),
        );
    });
}

/** Every file of the OPFS export folder, as numbers, by name. */
function folderFiles(page: Page): Promise<Record<string, number[]>> {
    return page.evaluate(async (folder) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(folder, { create: true });
        const files: Record<string, number[]> = {};
        for await (const [name, handle] of (
            dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
        ).entries()) {
            if (handle.kind !== "file") continue;
            const file = await (handle as FileSystemFileHandle).getFile();
            files[name] = Array.from(new Uint8Array(await file.arrayBuffer()));
        }
        return files;
    }, FOLDER);
}

function takeWrites(page: Page): Promise<string[]> {
    return page.evaluate(() => window.__te054!.writes.splice(0));
}

function picks(page: Page): Promise<number> {
    return page.evaluate(() => window.__te054!.picks);
}

const exportDialog = (page: Page) => page.getByRole("dialog", { name: "Export" });

/** Opens the Export dialog with Ctrl+E and waits for its file list. */
async function openDialog(page: Page) {
    await page.keyboard.press("Control+KeyE");
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-export-files]")).toBeVisible();
    return dialog;
}

test("the dialog lists the plan's files and sizes by group, shows each packed tileset, and Export writes the folder", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFolder(page);
    await openProject(page);
    const expected = await plan(page);
    const dialog = await openDialog(page);

    for (const group of ["tilemaps", "tilesets", "images", "runtime"]) {
        const items = dialog.locator(`[data-export-group=${group}] li`);
        const rows = expected.filter((row) => row.group === group);
        await expect(items.locator("span:first-child")).toHaveText(rows.map((row) => row.name));
        await expect(items.locator("[data-export-size]")).toHaveText(rows.map((row) => row.size));
    }
    await expect(dialog.locator("[data-export-files]").getByRole("heading")).toHaveText([
        "Tilemaps (2)",
        "Tilesets (4)",
        "Images (1)",
        "Runtime (2)",
    ]);

    // One thumbnail per tileset, its canvas the packed image's size and drawn.
    const sizes = await atlasSizes(page);
    const thumbnails = dialog.locator("[data-export-atlas]");
    await expect(thumbnails).toHaveCount(2);
    for (const [name, [width, height]] of Object.entries(sizes)) {
        const canvas = dialog.locator(`[data-export-atlas="${name}"] canvas`);
        await expect(canvas).toHaveAttribute("width", String(width));
        await expect(canvas).toHaveAttribute("height", String(height));
        await expect(canvas).toHaveAccessibleName(`${name}.png, ${width} × ${height} px`);
        await expect
            .poll(() =>
                canvas.evaluate((element: HTMLCanvasElement) => {
                    const { data } = element
                        .getContext("2d")!
                        .getImageData(0, 0, element.width, element.height);
                    return data.some((value, index) => index % 4 === 3 && value > 0);
                }),
            )
            .toBe(true);
    }
    await expect(dialog.locator("[data-export-error]")).toHaveCount(0);

    // Destination: none yet; Choose folder… names it.
    await expect(dialog.locator("[data-export-folder]")).toHaveText("No folder chosen");
    await dialog.getByRole("button", { name: "Choose folder…" }).click();
    await expect(dialog.locator("[data-export-folder]")).toHaveText(FOLDER);

    await dialog.locator("[data-export-submit]").click();
    await expect(dialog).toHaveCount(0);
    await expect(
        infoToast(page, "Exported “Export test” to “game”: 9 files written, 0 unchanged"),
    ).toBeVisible();
    expect(await takeWrites(page)).toEqual(expected.map((row) => row.name));
    expect(await folderFiles(page)).toEqual(await planBytes(page));
    expect(await picks(page)).toBe(1);
    await expect(errorToast(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("a tileset that cannot pack shows its error in the dialog and Export is disabled", async ({
    page,
}) => {
    await stubFolder(page);
    await openProject(page);
    // The tiles of "Grass" made 8200 px wide: its atlas would exceed 8192 px a side.
    await page.evaluate(() => {
        const { session } = window.__ngneTest!.session.getState();
        const grass = session.project.tilesets[0]!;
        const width = 8200;
        const height = grass.tileHeight * grass.tiles.length;
        const data = new Uint8ClampedArray(width * height * 4);
        // Each tile's rows a colour of their own, so that no two tiles share a rectangle.
        for (let y = 0; y < height; y += 1) {
            const tile = Math.floor(y / grass.tileHeight);
            data.fill(tile + 1, y * width * 4, (y + 1) * width * 4);
        }
        grass.tileWidth = width;
        grass.columns = 1;
        grass.pixels = { width, height, data };
        window.__ngneTest!.session.getState().touch();
    });
    await page.keyboard.press("Control+KeyE");
    const dialog = exportDialog(page);
    const error = dialog.locator("[data-export-error]");
    await expect(error).toBeVisible();
    await expect(error).toContainText('Tileset "Grass" cannot be packed');
    await expect(error).toHaveCSS(
        "color",
        await page.evaluate(() => {
            const probe = document.createElement("span");
            probe.style.color = "var(--danger)";
            document.body.append(probe);
            const colour = getComputedStyle(probe).color;
            probe.remove();
            return colour;
        }),
    );
    await expect(dialog.locator("[data-export-submit]")).toBeDisabled();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
});

test("Export Again without a folder opens the dialog; with one it writes without a dialog", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFolder(page);
    await openProject(page);

    await page.keyboard.press("Control+Shift+KeyX");
    const dialog = exportDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Choose folder…" }).click();
    await expect(dialog.locator("[data-export-folder]")).toHaveText(FOLDER);
    await dialog.locator("[data-export-submit]").click();
    await expect(dialog).toHaveCount(0);
    await expect(infoToast(page, "9 files written, 0 unchanged")).toBeVisible();
    await takeWrites(page);

    // One file taken out of the folder: Export Again writes it back, and no dialog shows.
    await page.evaluate(async (folder) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(folder);
        await dir.removeEntry("level-1.tilemap.json");
    }, FOLDER);
    await page.keyboard.press("Control+Shift+KeyX");
    await expect(infoToast(page, "1 file written, 8 unchanged")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(await takeWrites(page)).toEqual(["level-1.tilemap.json"]);
    expect(await picks(page)).toBe(1);
    expect(errors).toEqual([]);
});

test("Export on save marks the project dirty without a history entry, and a save exports", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFolder(page);
    await stubPickers(page);
    await openProject(page);

    const dialog = await openDialog(page);
    await dialog.getByRole("button", { name: "Choose folder…" }).click();
    await expect(dialog.locator("[data-export-folder]")).toHaveText(FOLDER);
    const toggle = dialog.getByRole("button", { name: "Export on save" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(unsavedMarker(page)).toHaveCount(1);
    expect(await projectState(page)).toMatchObject({ dirty: true, undo: 0 });
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    // Close keeps the setting; nothing was exported.
    expect(await takeWrites(page)).toEqual([]);

    await arrangePickers(page, { nextSave: ["game.ngtilemap"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved game.ngtilemap")).toBeVisible();
    await expect(
        infoToast(page, "Exported “Export test” to “game”: 9 files written, 0 unchanged"),
    ).toBeVisible();
    await expect(unsavedMarker(page)).toHaveCount(0);
    expect(await folderFiles(page)).toEqual(await planBytes(page));
    expect((await opfsFile(page, "game.ngtilemap")).length).toBeGreaterThan(0);
    await expect(errorToast(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("a failed Export on Save is one error toast, and the file is saved", async ({ page }) => {
    const errors = collectErrors(page);
    await stubFolder(page);
    await stubPickers(page);
    await openProject(page);

    const dialog = await openDialog(page);
    await dialog.getByRole("button", { name: "Choose folder…" }).click();
    await expect(dialog.locator("[data-export-folder]")).toHaveText(FOLDER);
    await dialog.getByRole("button", { name: "Export on save" }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.evaluate(() => {
        window.__te054!.failOn = "grass.atlas.json";
    });

    await arrangePickers(page, { nextSave: ["game.ngtilemap"] });
    await page.keyboard.press("Control+KeyS");
    await expect(infoToast(page, "Saved game.ngtilemap")).toBeVisible();
    const toast = errorToast(page);
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText(
        "Could not export “Export test”: writing “grass.atlas.json” to “game” failed:",
    );
    // The save stands: the file holds the project with Export on save, and it is clean.
    await expect(unsavedMarker(page)).toHaveCount(0);
    expect(await projectState(page)).toMatchObject({ dirty: false });
    const saved = await opfsFile(page, "game.ngtilemap");
    const reopened = await page.evaluate(async (bytes) => {
        const path = "/src/core/project/index.ts";
        const codec = (await import(/* @vite-ignore */ path)) as {
            deserialize(bytes: Uint8Array): Promise<{ exportSettings: { exportOnSave: boolean } }>;
        };
        const project = await codec.deserialize(new Uint8Array(bytes));
        return project.exportSettings.exportOnSave;
    }, saved);
    expect(reopened).toBe(true);
    await expect(exportDialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});
