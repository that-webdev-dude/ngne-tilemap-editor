import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import { LAYERS, MAP } from "./harness/te-016-map";
import { openEditor as openViewportEditor } from "./te-014-support";

// Shared helpers of the TE-016 specs. The page module (harness/te-016-page.ts) is imported into
// the running editor, so it shares the app's stores and tool registry; the specs call it by name.

export { LAYERS, MAP, expect };

const PAGE_MODULE = "/tests/e2e/harness/te-016-page.ts";

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** Opens the editor on the test map, its tile layer active, with the probe tool registered. */
export async function openEditor(page: Page): Promise<void> {
    await openViewportEditor(page);
    await pageCall(page, "load");
}

export const cellClient = (page: Page, x: number, y: number) =>
    pageCall<{ x: number; y: number }>(page, "cellClient", x, y);

export const painted = (page: Page, layer?: number) => pageCall<string[]>(page, "painted", layer);

export const view = (page: Page) =>
    pageCall<{ centreX: number; centreY: number; zoom: number }>(page, "view");

/** The id of the active tool. */
export const activeTool = (page: Page) => page.evaluate(() => window.__ngneTest!.tools!.active);

/** Presses the left button at the centre of cell `(x, y)`. */
export async function pressAt(page: Page, x: number, y: number): Promise<void> {
    const at = await cellClient(page, x, y);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
}

/** Moves the pointer to the centre of cell `(x, y)` in one event. */
export async function moveTo(page: Page, x: number, y: number): Promise<void> {
    const at = await cellClient(page, x, y);
    await page.mouse.move(at.x, at.y, { steps: 1 });
}

/** The status bar's message: the tool hint or feedback. */
export const statusMessage = (page: Page) => page.locator('[data-status="message"]');
