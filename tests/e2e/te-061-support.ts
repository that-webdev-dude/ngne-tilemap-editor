import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import type { TmjImportReport, TmjRequiredFile } from "../../src/core/tmj";
import { summaryLines } from "../../src/app/tmj/reportText";
import { menuItem, openMenu } from "./te-007-support";
import type { FilePayload } from "./te-024-support";

// Shared by the TE-061 specs: the TMJ fixtures (tests/fixtures/tmj) and their golden reports
// (tests/fixtures/tmj-reports) as files the page is given, through the multi-select picker
// (File System Access taken away), a folder picker over the origin private file system, or a
// drop; and the parts of the Import Tiled Map dialog.

const FIXTURES = new URL("../fixtures/tmj/", import.meta.url);
const GOLDENS = new URL("../fixtures/tmj-reports/", import.meta.url);

export type Golden = {
    fixture: string;
    files: TmjRequiredFile[];
} & ({ refused: { code: string; message: string } } | TmjImportReport);

/** Every fixture map, by file name. */
export function fixtureMaps(): string[] {
    return readdirSync(FIXTURES)
        .filter((name) => name.endsWith(".tmj"))
        .sort();
}

export function golden(map: string): Golden {
    const name = map.replace(/\.tmj$/, ".report.json");
    return JSON.parse(readFileSync(new URL(name, GOLDENS), "utf8")) as Golden;
}

const TYPES: Record<string, string> = {
    png: "image/png",
    tmj: "application/json",
    tsj: "application/json",
    tj: "application/json",
    tsx: "application/xml",
};

/** A fixture file, by its path in the fixture folder, as the picker takes it (its base name). */
export function tmjFile(path: string): FilePayload {
    const name = path.split("/").pop()!;
    return {
        name,
        mimeType: TYPES[name.split(".").pop()!] ?? "application/octet-stream",
        buffer: readFileSync(new URL(path, FIXTURES)),
    };
}

/** A map and the files its golden says it needs. */
export function mapWithFiles(map: string): FilePayload[] {
    return [tmjFile(map), ...golden(map).files.map((file) => tmjFile(file.path))];
}

/** Every file of the fixture folder, by path (`build.ts` and Tiled's session left out). */
export function folderFiles(): { path: string; bytes: number[] }[] {
    const root = fileURLToPath(FIXTURES);
    const out: { path: string; bytes: number[] }[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else if (!/\.(ts|md|tiled-session|tiled-project)$/.test(name)) {
                out.push({
                    path: relative(root, path).split(sep).join("/"),
                    bytes: [...readFileSync(path)],
                });
            }
        }
    };
    walk(root);
    return out;
}

/** Takes File System Access's folder picker away before the app loads: files are picked. */
export async function removeFolderPicker(page: Page): Promise<void> {
    await page.addInitScript(() => {
        for (const owner of [window, Window.prototype] as unknown as Record<string, unknown>[]) {
            delete owner.showDirectoryPicker;
        }
    });
}

/**
 * Replaces `showDirectoryPicker` before the app loads with one that returns the OPFS folder
 * `tmj` (written by `writeFolder`), or is cancelled once `window.__te061Cancel` is set.
 */
export async function stubFolderPicker(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Object.assign(window, {
            async showDirectoryPicker() {
                if ((window as unknown as { __te061Cancel?: boolean }).__te061Cancel) {
                    throw new DOMException("The user aborted a request.", "AbortError");
                }
                const root = await navigator.storage.getDirectory();
                return root.getDirectoryHandle("tmj");
            },
        });
    });
}

/** Writes `files` into the OPFS folder `tmj`, folders made as their paths say. */
export async function writeFolder(
    page: Page,
    files: { path: string; bytes: number[] }[],
): Promise<void> {
    await page.evaluate(async (files) => {
        const root = await navigator.storage.getDirectory();
        const folder = await root.getDirectoryHandle("tmj", { create: true });
        for (const file of files) {
            const parts = file.path.split("/");
            let dir = folder;
            for (const part of parts.slice(0, -1)) {
                dir = await dir.getDirectoryHandle(part, { create: true });
            }
            const handle = await dir.getFileHandle(parts.at(-1)!, { create: true });
            const writable = await handle.createWritable();
            await writable.write(new Uint8Array(file.bytes));
            await writable.close();
        }
    }, files);
}

export function tmjDialog(page: Page): Locator {
    return page.getByRole("dialog", { name: "Import Tiled Map" });
}

/** File → Import Tiled Map…, then `files` picked in the file chooser; returns the dialog. */
export async function pickFiles(page: Page, files: FilePayload[]): Promise<Locator> {
    await openMenu(page, "File");
    const chooser = page.waitForEvent("filechooser");
    await menuItem(page, "file.importTiledMap").click();
    await (await chooser).setFiles(files);
    const dialog = tmjDialog(page);
    await expect(dialog).toBeVisible();
    return dialog;
}

export const importButton = (dialog: Locator) =>
    dialog.getByRole("button", { name: "Import", exact: true });

export const fileRows = (dialog: Locator) => dialog.locator("[data-tmj-file]");

/** The files list as `path status` lines. */
export function fileStatuses(dialog: Locator): Promise<string[]> {
    return fileRows(dialog).evaluateAll((rows) =>
        rows.map(
            (row) => `${row.getAttribute("data-tmj-file")} ${row.getAttribute("data-tmj-status")}`,
        ),
    );
}

/**
 * Expects the dialog to show what `expected` holds: the refusal's message, or the summary and
 * each group's title and count with its entries.
 */
export async function expectReport(dialog: Locator, expected: Golden): Promise<void> {
    if ("refused" in expected) {
        await expect(dialog.locator("[data-tmj-refusal]")).toHaveText(expected.refused.message);
        await expect(importButton(dialog)).toBeDisabled();
        return;
    }
    await expect(dialog.locator("[data-tmj-summary] li")).toHaveText(summaryLines(expected));
    const groups = dialog.locator("[data-tmj-group]");
    await expect(groups).toHaveCount(expected.groups.length);
    for (const [index, group] of expected.groups.entries()) {
        const section = groups.nth(index);
        await expect(section).toHaveAttribute("data-tmj-group", group.row);
        await expect(section.locator("h4")).toHaveText(`${group.title}${group.count}`);
        await expect(section.locator("li")).toHaveCount(group.entries.length);
        for (const [at, entry] of group.entries.entries()) {
            const item = section.locator("li").nth(at);
            await expect(item).toContainText(entry.detail);
            await expect(item).toContainText(entry.where);
        }
    }
    await expect(importButton(dialog)).toBeEnabled();
}

/** What the page's project holds, as the specs compare it. */
export function projectContents(page: Page) {
    return page.evaluate(() => {
        const { open, session, history } = window.__ngneTest!.session.getState();
        const { project } = session;
        return {
            open,
            name: project.name,
            maps: project.maps.map((map) => `${map.name} ${map.width}x${map.height}`),
            tilesets: project.tilesets.map((tileset) => `${tileset.name} ${tileset.tiles.length}`),
            images: project.images.map((image) => image.name),
            activeMap: project.maps.find((map) => map.id === session.activeMapId)?.name ?? null,
            undo: history.undoCount,
            undoLabel: history.undoLabel,
            dirty: history.dirty,
        };
    });
}

export { expect };
