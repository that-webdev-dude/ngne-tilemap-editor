import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { region } from "./te-003-support";
import { openEmptyApp } from "./support/wait";

// Shared helpers of the TE-047 specs (adapted from the sprite editor's se-041 and se-047
// support files): a File System Access stub whose pickers hand out real file handles of the
// origin private file system (OPFS), so IndexedDB keeps them across a reload as it keeps files
// of the disk (recent files) and every permission is granted; File System Access taken away;
// and what the page's project holds.

/** The state of the picker stub, on `window.__te047Fs`. */
export interface PickerStub {
    /** The names the next save pickers return, first to last; empty: the picker is cancelled. */
    nextSave: string[];
    /** The names the next open pickers return, first to last; empty: the picker is cancelled. */
    nextOpen: string[];
    /** The suggested name of every save picker shown. */
    suggestions: string[];
}

declare global {
    interface Window {
        __te047Fs?: PickerStub;
    }
}

/**
 * Replaces `showSaveFilePicker` and `showOpenFilePicker` before the app loads with pickers
 * over OPFS files.
 */
export async function stubPickers(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const stub: PickerStub = { nextSave: [], nextOpen: [], suggestions: [] };
        window.__te047Fs = stub;
        const cancelled = () => new DOMException("The user aborted a request.", "AbortError");
        Object.assign(window, {
            async showSaveFilePicker(options?: { suggestedName?: string }) {
                stub.suggestions.push(options?.suggestedName ?? "");
                const name = stub.nextSave.shift();
                if (name === undefined) throw cancelled();
                const root = await navigator.storage.getDirectory();
                return root.getFileHandle(name, { create: true });
            },
            async showOpenFilePicker() {
                const name = stub.nextOpen.shift();
                if (name === undefined) throw cancelled();
                const root = await navigator.storage.getDirectory();
                return [await root.getFileHandle(name)];
            },
        });
    });
}

/** Takes the File System Access pickers away before the app loads. */
export async function removeFileSystemAccess(page: Page): Promise<void> {
    await page.addInitScript(() => {
        for (const owner of [window, Window.prototype] as unknown as Record<string, unknown>[]) {
            delete owner.showOpenFilePicker;
            delete owner.showSaveFilePicker;
        }
    });
}

/** Sets what the next pickers return. */
export function arrangePickers(
    page: Page,
    arrangement: { nextSave?: string[]; nextOpen?: string[] },
): Promise<void> {
    return page.evaluate((arrangement) => {
        const stub = window.__te047Fs!;
        stub.nextSave.push(...(arrangement.nextSave ?? []));
        stub.nextOpen.push(...(arrangement.nextOpen ?? []));
    }, arrangement);
}

export function pickerStub(page: Page): Promise<PickerStub> {
    return page.evaluate(() => structuredClone(window.__te047Fs!));
}

/** The bytes of an OPFS file, as numbers. */
export function opfsFile(page: Page, name: string): Promise<number[]> {
    return page.evaluate(async (name) => {
        const root = await navigator.storage.getDirectory();
        const file = await (await root.getFileHandle(name)).getFile();
        return Array.from(new Uint8Array(await file.arrayBuffer()));
    }, name);
}

/** Opens the app on its empty state (each test has a browser context, and so an OPFS, of its own). */
export async function openEmpty(page: Page): Promise<void> {
    await openEmptyApp(page);
    await page.waitForFunction(() => window.__ngneTest !== undefined);
    await expect(emptyState(page)).toBeVisible();
}

/** The first map's size New Project gives by default. */
const NEW_MAP_SIZE = { width: 20, height: 15 } as const;

/** Creates a project with New Project: its name and its first map's size. */
export async function newProject(
    page: Page,
    name: string,
    size: { width: number; height: number } = NEW_MAP_SIZE,
): Promise<void> {
    await page.keyboard.press("Control+Alt+KeyN");
    const dialog = page.getByRole("dialog", { name: "New Project" });
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-project-field=name]").fill(name);
    const mapSize = dialog.getByRole("group", { name: "Map size", exact: true });
    for (const [label, value] of [
        ["Width", size.width],
        ["Height", size.height],
    ] as const) {
        const input = mapSize.getByRole("spinbutton", { name: label, exact: true });
        await input.fill(String(value));
        await input.press("Tab");
    }
    await dialog.locator("[data-new-project-create]").click();
    await expect(dialog).toHaveCount(0);
    await expect(projectName(page)).toHaveText(name);
}

/** Adds a tile layer through its command: one undoable change of the project. */
export async function addLayer(page: Page): Promise<void> {
    const before = await layerCount(page);
    await page.evaluate(() => window.__ngneTest!.commands.get("layer.newTile")!.run());
    await expect.poll(() => layerCount(page)).toBe(before + 1);
}

function layerCount(page: Page): Promise<number> {
    return page.evaluate(() => {
        const { session } = window.__ngneTest!.session.getState();
        return session.project.maps.find((map) => map.id === session.activeMapId)!.layers.length;
    });
}

/** What a spec compares of the open project: everything but the cells, and the cells. */
export interface ProjectState {
    open: boolean;
    id: string;
    name: string;
    maps: { name: string; width: number; height: number; layers: string[] }[];
    dirty: boolean;
    undo: number;
}

export function projectState(page: Page): Promise<ProjectState> {
    return page.evaluate(() => {
        const { open, session, history } = window.__ngneTest!.session.getState();
        const { project } = session;
        return {
            open,
            id: project.id,
            name: project.name,
            maps: project.maps.map((map) => ({
                name: map.name,
                width: map.width,
                height: map.height,
                layers: map.layers.map((layer) => `${layer.type}:${layer.name}`),
            })),
            dirty: history.dirty,
            undo: history.undoCount,
        };
    });
}

export const emptyState = (page: Page): Locator =>
    region(page, "viewport").locator("[data-empty-state]");
export const projectName = (page: Page): Locator =>
    region(page, "menu-bar").locator(".map-tabs__project-name");
export const unsavedMarker = (page: Page): Locator =>
    region(page, "menu-bar").locator("[data-unsaved-marker]");
export const recentButtons = (page: Page): Locator =>
    emptyState(page).locator("[data-recent-file]");
export const saveDialog = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Save changes?" });
export const discardDialog = (page: Page): Locator =>
    page.getByRole("dialog", { name: "Discard unsaved changes?" });
export const infoToast = (page: Page, text: string): Locator =>
    page.locator(".ui-toast:not(.ui-toast--error)", { hasText: text });
export const errorToast = (page: Page): Locator => page.locator(".ui-toast--error");
