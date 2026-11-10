import { unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// The page imports these modules from the dev server; here they are needed for their types.
import type * as ExportModule from "../../src/app/export/exportProject";
import type * as CellsModule from "../../src/core/cells";
import type * as CoreExportModule from "../../src/core/export";
import type * as ModelModule from "../../src/core/model";
import type * as ProjectModule from "../support/exportProject";
import { collectErrors } from "./te-003-support";
import { errorToast, infoToast, openEmpty } from "./te-047-support";

// TE-053: the export pipeline of SPEC §10.2 in the app, with the worker. The directory picker
// is replaced by one that hands out a folder of the origin private file system (OPFS), and
// every write into it is logged by name. The project is TE-053's (two maps, two tilesets, an
// image; tests/support/exportProject.ts). The Export dialog and its commands are TE-054's, so
// the export is started through the pipeline module.

/** The state of the picker stub, on `window.__te053`. */
interface FolderStub {
    /** The names written, in order (each `createWritable`). */
    writes: string[];
    /** A file whose write fails, or null. */
    failOn: string | null;
    /** How often the directory picker was shown. */
    picks: number;
}

declare global {
    interface Window {
        __te053?: FolderStub;
    }
}

const FOLDER = "game";

/** Replaces the directory picker before the app loads, and logs every file write. */
async function stubFolder(page: Page): Promise<void> {
    await page.addInitScript((folder) => {
        const stub: FolderStub = { writes: [], failOn: null, picks: 0 };
        window.__te053 = stub;
        Object.assign(window, {
            async showDirectoryPicker() {
                stub.picks += 1;
                const root = await navigator.storage.getDirectory();
                return root.getDirectoryHandle(folder, { create: true });
            },
        });
        const proto = FileSystemFileHandle.prototype;
        const original = proto.createWritable;
        proto.createWritable = function (this: FileSystemFileHandle, ...args) {
            if (stub.failOn === this.name) {
                return Promise.reject(new DOMException("The disk is full.", "QuotaExceededError"));
            }
            stub.writes.push(this.name);
            return original.apply(this, args);
        };
    }, FOLDER);
}

/** Opens the app with the TE-053 project. */
async function openProject(page: Page): Promise<void> {
    await openEmpty(page);
    await page.evaluate(async () => {
        const modelPath = "/src/core/model/index.ts";
        const model = (await import(/* @vite-ignore */ modelPath)) as typeof ModelModule;
        const supportPath = "/tests/support/exportProject.ts";
        const support = (await import(/* @vite-ignore */ supportPath)) as typeof ProjectModule;
        const project = support.createExportProject();
        window.__ngneTest!.session.getState().replace(model.createProjectSession(project));
    });
}

/** Starts an export of the window's project; resolves when it ends, with its result. */
function exportProject(page: Page): Promise<boolean> {
    return page.evaluate(async () => {
        const path = "/src/app/export/exportProject.ts";
        const { exportPipeline } = (await import(/* @vite-ignore */ path)) as typeof ExportModule;
        return exportPipeline.exportProject();
    });
}

/** The names the folder stub logged, then clears the log. */
function takeWrites(page: Page): Promise<string[]> {
    return page.evaluate(() => window.__te053!.writes.splice(0));
}

/** The export's file names in write order (`core/export`). */
function exportNames(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
        const corePath = "/src/core/export/index.ts";
        const core = (await import(/* @vite-ignore */ corePath)) as typeof CoreExportModule;
        return core.exportFileNames(window.__ngneTest!.session.getState().session.project);
    });
}

/** Every file of the OPFS folder, as numbers, by name. */
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

/** Writes a file into the OPFS folder outside the export. */
function putFile(page: Page, name: string, text: string): Promise<void> {
    return page.evaluate(
        async ({ folder, name, text }) => {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle(folder, { create: true });
            const writable = await (
                await dir.getFileHandle(name, { create: true })
            ).createWritable();
            await writable.write(new TextEncoder().encode(text));
            await writable.close();
        },
        { folder: FOLDER, name, text },
    );
}

/** One cell of map "Level 2" painted, as one history step. */
function paintOneCell(page: Page): Promise<void> {
    return page.evaluate(async () => {
        const cellsPath = "/src/core/cells/index.ts";
        const cells = (await import(/* @vite-ignore */ cellsPath)) as typeof CellsModule;
        const { history, session } = window.__ngneTest!.session.getState();
        const map = session.project.maps[1]!;
        const transaction = history.begin({ mapId: map.id, layerId: map.layers[0]!.id });
        // Tile 0 of Rocks (slot 2) where the cell was empty.
        transaction.set(1, 0, cells.cellValue(2, 0, 0));
        transaction.commit("Paint");
    });
}

const replaceDialog = (page: Page) => page.getByRole("dialog", { name: "Replace files?" });

test("the first export writes every file in order; after one cell edit only that map's JSON", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await stubFolder(page);
    await openProject(page);
    await putFile(page, "notes.txt", "kept");
    const names = await exportNames(page);
    expect(names).toEqual([
        "ngne-tilemap.export.json",
        "grass.png",
        "rocks.png",
        "sky.png",
        "grass.atlas.json",
        "rocks.atlas.json",
        "level-1.tilemap.json",
        "level-2.tilemap.json",
        "ngne-tilemap.ts",
    ]);
    // `putFile` wrote through `createWritable` too.
    await takeWrites(page);

    expect(await exportProject(page)).toBe(true);
    expect(await takeWrites(page)).toEqual(names);
    await expect(
        infoToast(page, "Exported “Export test” to “game”: 9 files written, 0 unchanged"),
    ).toBeVisible();
    const first = await folderFiles(page);
    expect(Object.keys(first).sort()).toEqual([...names, "notes.txt"].sort());
    const marker = JSON.parse(Buffer.from(first["ngne-tilemap.export.json"]!).toString("utf8"));
    expect(marker).toMatchObject({
        format: "ngne-tilemap-export",
        version: 1,
        projectId: "export-project",
        projectName: "Export test",
    });

    await paintOneCell(page);
    expect(await exportProject(page)).toBe(true);
    expect(await takeWrites(page)).toEqual(["level-2.tilemap.json"]);
    await expect(
        infoToast(page, "Exported “Export test” to “game”: 1 file written, 8 unchanged"),
    ).toBeVisible();
    const second = await folderFiles(page);
    for (const name of names) {
        if (name === "level-2.tilemap.json") expect(second[name]).not.toEqual(first[name]);
        else expect(second[name], name).toEqual(first[name]);
    }
    // Nothing is removed; the picker was shown once, the folder kept for the project.
    expect(second["notes.txt"]).toEqual(Array.from(Buffer.from("kept")));
    expect(await page.evaluate(() => window.__te053!.picks)).toBe(1);
    await expect(errorToast(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("another project's marker asks Replace / Cancel naming that project", async ({ page }) => {
    const errors = collectErrors(page);
    await stubFolder(page);
    await openProject(page);
    const other = {
        format: "ngne-tilemap-export",
        version: 1,
        generator: "ngne-tilemap-editor 1.0.0",
        projectId: "another-project",
        projectName: "Other game",
    };
    await putFile(page, "ngne-tilemap.export.json", `${JSON.stringify(other, null, 4)}\n`);
    await putFile(page, "level-1.tilemap.json", "{}\n");
    await takeWrites(page);

    // Cancel: nothing is written.
    const cancelled = exportProject(page);
    const dialog = replaceDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("The folder “game” holds the export of “Other game”.");
    await expect(dialog).toContainText("Exporting “Export test” replaces these 2 files:");
    await expect(dialog.locator("[data-overwrite-files] li")).toHaveText([
        "ngne-tilemap.export.json",
        "level-1.tilemap.json",
    ]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await cancelled).toBe(false);
    await expect(dialog).toHaveCount(0);
    expect(await takeWrites(page)).toEqual([]);
    await expect(errorToast(page)).toHaveCount(0);

    // Replace: every file is written, and the folder is this project's from then on.
    const replaced = exportProject(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Replace" }).click();
    expect(await replaced).toBe(true);
    expect(await takeWrites(page)).toEqual(await exportNames(page));
    expect(await exportProject(page)).toBe(true);
    await expect(dialog).toHaveCount(0);
    expect(await takeWrites(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test("files of the export's names without a marker ask Replace / Cancel naming no project", async ({
    page,
}) => {
    await stubFolder(page);
    await openProject(page);
    await putFile(page, "grass.png", "not a png");
    const cancelled = exportProject(page);
    const dialog = replaceDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("holds files of this export, and no project's marker.");
    await expect(dialog.locator("[data-overwrite-files] li")).toHaveText(["grass.png"]);
    await page.keyboard.press("Escape");
    expect(await cancelled).toBe(false);
});

test("a failing write stops the export with one toast naming the file and those before it", async ({
    page,
}) => {
    await stubFolder(page);
    await openProject(page);
    await page.evaluate(() => {
        window.__te053!.failOn = "grass.atlas.json";
    });
    expect(await exportProject(page)).toBe(false);
    expect(await takeWrites(page)).toEqual([
        "ngne-tilemap.export.json",
        "grass.png",
        "rocks.png",
        "sky.png",
    ]);
    const toast = errorToast(page);
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText(
        "Could not export “Export test”: writing “grass.atlas.json” to “game” failed:",
    );
    await expect(toast).toContainText(
        "Written before it: ngne-tilemap.export.json, grass.png, rocks.png, sky.png.",
    );
    // The files after it are not there; the failed one was created by its handle but holds
    // nothing.
    const files = await folderFiles(page);
    expect(Object.keys(files).sort()).toEqual(
        [
            "grass.atlas.json",
            "grass.png",
            "ngne-tilemap.export.json",
            "rocks.png",
            "sky.png",
        ].sort(),
    );
    expect(files["grass.atlas.json"]).toEqual([]);
});

test("without File System Access the folder downloads as <exportName>.zip with the same files", async ({
    page,
}, testInfo) => {
    const errors = collectErrors(page);
    await stubFolder(page);
    await openProject(page);
    expect(await exportProject(page)).toBe(true);
    const folder = await folderFiles(page);

    // The picker goes away: the next export downloads.
    await page.evaluate(() => {
        delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
    });
    const downloading = page.waitForEvent("download");
    const done = exportProject(page);
    const download = await downloading;
    expect(await done).toBe(true);
    expect(download.suggestedFilename()).toBe("export-test.zip");
    await expect(infoToast(page, "Exported 9 files to “export-test.zip”")).toBeVisible();
    const path = testInfo.outputPath("export-test.zip");
    await download.saveAs(path);
    const entries = unzipSync(new Uint8Array(readFileSync(path)));
    expect(Object.keys(entries)).toEqual(await exportNames(page));
    for (const [name, bytes] of Object.entries(entries)) {
        expect(Array.from(bytes), name).toEqual(folder[name]);
    }
    expect(errors).toEqual([]);
});
