import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openEditor as openViewportEditor } from "./te-014-support";

// Shared helpers of the TE-039 specs. The page module (harness/te-039-page.ts) is imported into
// the running editor, so it shares the app's stores and tools; the specs call it by name.
// Positions are map pixels of the test maps (zoom 2: a map pixel is 2 CSS pixels).

export { expect };

const PAGE_MODULE = "/tests/e2e/harness/te-039-page.ts";

export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

export type Pt = [number, number];
export type MarkerValue = Record<string, unknown> & { id: number };

export const AREAS = 2;
export const GROUND = 1;

/** Opens the editor on the test maps (Field active) with `tool` selected. */
export async function openEditor(page: Page, tool: string): Promise<void> {
    await openViewportEditor(page);
    await pageCall(page, "load");
    expect(await pageCall(page, "selectTool", tool)).toBe(true);
}

export const markers = (page: Page) => pageCall<MarkerValue[]>(page, "markers");
export const selection = (page: Page) => pageCall<number[]>(page, "selection");
export const history = (page: Page) =>
    pageCall<{ undo: string | null; redo: string | null }>(page, "history");
export const undo = (page: Page) => pageCall<boolean>(page, "undo");
export const redo = (page: Page) => pageCall<boolean>(page, "redo");
export const feedback = (page: Page) => pageCall<string | null>(page, "feedback");
export const selectionField = (page: Page) => pageCall<string>(page, "selectionField");
export const undoCount = (page: Page) => pageCall<number>(page, "undoCount");

/** Moves the pointer to map point `p` in one event. */
export async function moveTo(page: Page, [x, y]: Pt): Promise<void> {
    const at = await pageCall<{ x: number; y: number }>(page, "mapClient", x, y);
    await page.mouse.move(at.x, at.y, { steps: 1 });
}

/** Clicks map point `p`. */
export async function clickAt(page: Page, p: Pt): Promise<void> {
    await moveTo(page, p);
    await page.mouse.down();
    await page.mouse.up();
}

/** Double clicks map point `p`. */
export async function doubleClickAt(page: Page, p: Pt): Promise<void> {
    const at = await pageCall<{ x: number; y: number }>(page, "mapClient", p[0], p[1]);
    await page.mouse.dblclick(at.x, at.y);
}

/** A left drag from `a` through `rest`, each in one event. */
export async function drag(page: Page, a: Pt, ...rest: Pt[]): Promise<void> {
    await moveTo(page, a);
    await page.mouse.down();
    for (const p of rest) await moveTo(page, p);
    await page.mouse.up();
}

/** Holds `keys` down around `action`. */
export async function holding<T>(page: Page, keys: string[], action: () => Promise<T>): Promise<T> {
    for (const key of keys) await page.keyboard.down(key);
    try {
        return await action();
    } finally {
        for (const key of [...keys].reverse()) await page.keyboard.up(key);
    }
}

/**
 * Expects the last entry to be `label` and to make `after` of `before`: undoes it, then redoes
 * it.
 */
export async function expectOneEntry(
    page: Page,
    label: string,
    before: unknown,
    after: unknown,
): Promise<void> {
    expect(await history(page)).toEqual({ undo: label, redo: null });
    expect(await markers(page)).toEqual(after);
    expect(await undo(page)).toBe(true);
    expect(await markers(page)).toEqual(before);
    expect(await redo(page)).toBe(true);
    expect(await markers(page)).toEqual(after);
}
