import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { LAYERS, MAP, TILE_COLOURS } from "./harness/te-017-map";
import { openEditor as openViewportEditor } from "./te-014-support";

// Shared helpers of the TE-017 specs. The page module (harness/te-017-page.ts) is imported into
// the running editor, so it shares the app's stores and tools; the specs call it by name.

export { LAYERS, MAP, TILE_COLOURS, expect };

const PAGE_MODULE = "/tests/e2e/harness/te-017-page.ts";

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** Opens the editor on the test map with `tool` selected. */
export async function openEditor(page: Page, tool: string): Promise<void> {
    await openViewportEditor(page);
    await pageCall(page, "load");
    expect(await pageCall(page, "selectTool", tool)).toBe(true);
}

/** Sets the current stamp: tile ids of slot 1 row by row, null for an empty cell. */
export const setStamp = (page: Page, width: number, height: number, tiles: (number | null)[]) =>
    pageCall<void>(page, "setStamp", width, height, tiles);

export const cells = (page: Page, layer: number = LAYERS.ground) =>
    pageCall<string[]>(page, "cells", layer);

export const history = (page: Page) =>
    pageCall<{ undo: string | null; redo: string | null }>(page, "history");

export const undo = (page: Page) => pageCall<boolean>(page, "undo");
export const redo = (page: Page) => pageCall<boolean>(page, "redo");

export const cellClient = (page: Page, x: number, y: number) =>
    pageCall<{ x: number; y: number }>(page, "cellClient", x, y);

/** Moves the pointer to the centre of cell `(x, y)` in one event. */
export async function moveTo(page: Page, x: number, y: number): Promise<void> {
    const at = await cellClient(page, x, y);
    await page.mouse.move(at.x, at.y, { steps: 1 });
}

/** Presses `button` at the centre of cell `(x, y)`. */
export async function pressAt(
    page: Page,
    x: number,
    y: number,
    button: "left" | "right" = "left",
): Promise<void> {
    await moveTo(page, x, y);
    await page.mouse.down({ button });
}

/** Clicks cell `(x, y)` with `modifiers` held. */
export async function clickAt(
    page: Page,
    x: number,
    y: number,
    modifiers: ("Shift" | "Control")[] = [],
): Promise<void> {
    for (const key of modifiers) await page.keyboard.down(key);
    await pressAt(page, x, y);
    await page.mouse.up();
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
}

/** Drags from cell `a` through `rest`, each in one event, with `button`. */
export async function drag(
    page: Page,
    a: [number, number],
    rest: [number, number][],
    button: "left" | "right" = "left",
): Promise<void> {
    await pressAt(page, a[0], a[1], button);
    for (const [x, y] of rest) await moveTo(page, x, y);
    await page.mouse.up({ button });
}

/** The cells of `rect` as "x,y:tile", row by row. */
export function rectCells(
    rect: { x: number; y: number; width: number; height: number },
    tile: number,
): string[] {
    const found: string[] = [];
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) found.push(`${x},${y}:${tile}`);
    }
    return found;
}

/** Sorts "x,y:tile" entries row by row, as the page module lists cells. */
export function rowOrder(entries: readonly string[]): string[] {
    const key = (entry: string) => entry.split(":")[0]!.split(",").map(Number) as [number, number];
    return [...entries].sort((a, b) => {
        const [ax, ay] = key(a);
        const [bx, by] = key(b);
        return ay - by || ax - bx;
    });
}

/** The status bar's message: the tool hint or feedback. */
export const statusMessage = (page: Page) => page.locator('[data-status="message"]');
