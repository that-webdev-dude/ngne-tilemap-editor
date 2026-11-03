import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { MAP, TILESETS, tileColour } from "./harness/te-025-map";
import { openEditor as openViewportEditor } from "./te-014-support";

// Shared helpers of the TE-025 specs. The page module (harness/te-025-page.ts) is imported into
// the running editor, so it shares the app's stores; the specs call it by name. Grid geometry
// is DESIGN §8.5's: tiles `zoom` times their size with a 1 px gap round each.

export { MAP, TILESETS, expect, tileColour };

const PAGE_MODULE = "/tests/e2e/harness/te-025-page.ts";

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** Opens the editor on the test project; resolves with the tileset ids. */
export async function openEditor(page: Page): Promise<string[]> {
    await openViewportEditor(page);
    const ids = await pageCall<string[]>(page, "load");
    await expect(tileGrid(page)).toHaveAttribute("data-tile-grid", ids[0]!);
    return ids;
}

export const panel = (page: Page) => page.locator("[data-tilesets-panel]");
export const tileGrid = (page: Page) => page.locator("[data-tile-grid]");
export const tileCanvas = (page: Page) => page.locator("[data-tile-canvas]");
export const tilesetTab = (page: Page, name: string) =>
    panel(page).getByRole("tablist", { name: "Tilesets" }).getByRole("tab", { name });

export interface StampState {
    width: number;
    height: number;
    cells: string[];
}

export const stamp = (page: Page) => pageCall<StampState | null>(page, "stamp");
export const cells = (page: Page) => pageCall<string[]>(page, "cells");
export const panelState = (page: Page) =>
    pageCall<{ active: string | null; zoom: number; filter: string }>(page, "panel");

/** The left and top of tile `(column, row)` in the grid's CSS pixels at `zoom`. */
export function tileOrigin(size: number, zoom: number, column: number, row: number) {
    const pitch = size * zoom + 1;
    return { x: 1 + column * pitch, y: 1 + row * pitch };
}

/** The client position of the centre of tile `(column, row)` of a `size` px tileset. */
export async function tileClient(
    page: Page,
    column: number,
    row: number,
    size = 16,
    zoom = 2,
): Promise<{ x: number; y: number }> {
    const box = await tileCanvas(page).boundingBox();
    if (!box) throw new Error("the tile canvas has no box");
    const origin = tileOrigin(size, zoom, column, row);
    return { x: box.x + origin.x + (size * zoom) / 2, y: box.y + origin.y + (size * zoom) / 2 };
}

/** Drags over the panel's grid from tile `from` to tile `to` (column, row). */
export async function dragTiles(
    page: Page,
    from: [number, number],
    to: [number, number],
): Promise<void> {
    const start = await tileClient(page, from[0], from[1]);
    const end = await tileClient(page, to[0], to[1]);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 2 });
    await page.mouse.move(end.x, end.y, { steps: 2 });
    await page.mouse.up();
}

/** Clicks the centre of map cell `(x, y)`. */
export async function clickCell(page: Page, x: number, y: number): Promise<void> {
    const at = await pageCall<{ x: number; y: number }>(page, "cellClient", x, y);
    await page.mouse.click(at.x, at.y);
}

/** The panel canvas's pixel at CSS `(x, y)` of the grid (the specs run at DPR 1, unscrolled). */
export const pixel = (page: Page, x: number, y: number) =>
    pageCall<number[]>(page, "canvasPixel", x, y);

export const token = (page: Page, name: string) => pageCall<number[]>(page, "token", name);

/** The status bar's field `id`. */
export const statusField = (page: Page, id: string): Locator =>
    page.locator(`[data-status="${id}"]`);

/** A file as Playwright and the drop helper take it. */
export interface FilePayload {
    name: string;
    mimeType: string;
    buffer: Buffer;
}

/** Drops `files` on `selector`, as a drop from the system's file manager does. */
export async function dropFilesOn(
    page: Page,
    selector: string,
    files: FilePayload[],
): Promise<void> {
    const payload = files.map((file) => ({
        name: file.name,
        type: file.mimeType,
        bytes: [...file.buffer],
    }));
    const transfer = await page.evaluateHandle((files) => {
        const transfer = new DataTransfer();
        for (const file of files) {
            transfer.items.add(
                new File([new Uint8Array(file.bytes)], file.name, { type: file.type }),
            );
        }
        return transfer;
    }, payload);
    await page.dispatchEvent(selector, "dragover", { dataTransfer: transfer });
    await page.dispatchEvent(selector, "drop", { dataTransfer: transfer });
    await transfer.dispose();
}
