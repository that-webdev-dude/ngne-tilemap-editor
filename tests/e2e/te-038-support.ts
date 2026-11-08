import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openEditor as openViewportEditor } from "./te-014-support";

// Shared helpers of the TE-038 specs. The page module (harness/te-038-page.ts) is imported into
// the running editor, so it shares the app's stores and tools; the specs call it by name.
// Positions are map pixels of the test map (zoom 2: a map pixel is 2 CSS pixels).

export { expect };

const PAGE_MODULE = "/tests/e2e/harness/te-038-page.ts";

export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

export type Pt = [number, number];
export type MarkerGeometry = Record<string, unknown>;

/** Opens the editor on the test map with `tool` selected; the select tool's markers with `withMarkers`. */
export async function openEditor(page: Page, tool: string, withMarkers = false): Promise<void> {
    await openViewportEditor(page);
    await pageCall(page, "load", withMarkers);
    expect(await pageCall(page, "selectTool", tool)).toBe(true);
}

export const markers = (page: Page) => pageCall<MarkerGeometry[]>(page, "markers");
export const selection = (page: Page) => pageCall<number[]>(page, "selection");
export const history = (page: Page) =>
    pageCall<{ undo: string | null; redo: string | null }>(page, "history");
export const undo = (page: Page) => pageCall<boolean>(page, "undo");
export const redo = (page: Page) => pageCall<boolean>(page, "redo");
export const activeTool = (page: Page) => pageCall<string>(page, "activeTool");

/** Moves the pointer to map point `p` in one event. */
export async function moveTo(page: Page, [x, y]: Pt): Promise<void> {
    const at = await pageCall<{ x: number; y: number }>(page, "mapClient", x, y);
    await page.mouse.move(at.x, at.y, { steps: 1 });
}

/** Clicks map point `p` with `button`. */
export async function clickAt(page: Page, p: Pt, button: "left" | "right" = "left"): Promise<void> {
    await moveTo(page, p);
    await page.mouse.down({ button });
    await page.mouse.up({ button });
}

/** A left drag from `a` through `rest`, each in one event, in steps of the pointer. */
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
 * Expects the last entry to be `label` and to make `after` of `before`: undoes it, then redoes it.
 * Redo puts back the selection as it was before the entry, as Tiled's does.
 */
export async function expectOneEntry(
    page: Page,
    label: string,
    before: MarkerGeometry[],
    after: MarkerGeometry[],
): Promise<void> {
    expect(await history(page)).toEqual({ undo: label, redo: null });
    expect(await markers(page)).toEqual(after);
    expect(await undo(page)).toBe(true);
    expect(await markers(page)).toEqual(before);
    expect(await redo(page)).toBe(true);
    expect(await markers(page)).toEqual(after);
}
