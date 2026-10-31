import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import type { Lines, Loaded, ViewState } from "./harness/te-014-page";
import { MAP } from "./harness/te-014-map";
import { openEditor as openViewportEditor } from "./te-013-support";

// Shared helpers of the TE-014 specs. The page module (harness/te-014-page.ts) is imported into
// the running editor, so it shares the app's stores; the specs call it by name.

export { MAP };
export type { Lines, Loaded, ViewState };

const PAGE_MODULE = "/tests/e2e/harness/te-014-page.ts";

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** Opens the editor and waits until its viewport has a renderer and the overlay a size. */
export async function openEditor(page: Page): Promise<void> {
    await openViewportEditor(page);
    await page.waitForFunction(() => {
        const size = window.__ngneTest?.overlay?.canvasSize;
        return size !== undefined && size.width > 0 && size.height > 0;
    });
}

export const view = (page: Page) => pageCall<ViewState>(page, "view");

/** The viewport element's box in CSS pixels. */
export async function hostBox(page: Page) {
    const box = await page.locator("[data-viewport]").boundingBox();
    if (!box) throw new Error("the viewport has no box");
    return box;
}

/** The client position of a device position of the viewport, as the app maps it back. */
export async function clientOf(page: Page, device: { x: number; y: number }) {
    const box = await hostBox(page);
    const { dpr } = await view(page);
    return {
        x: (Math.round(box.x * dpr) + device.x) / dpr,
        y: (Math.round(box.y * dpr) + device.y) / dpr,
    };
}

/** The map pixel under a client position, from the view as the state holds it. */
export async function mapAt(page: Page, client: { x: number; y: number }) {
    const box = await hostBox(page);
    const state = await view(page);
    const x = client.x * state.dpr - Math.round(box.x * state.dpr);
    const y = client.y * state.dpr - Math.round(box.y * state.dpr);
    return {
        x: state.centreX + (x - state.width / 2) / state.scale,
        y: state.centreY + (y - state.height / 2) / state.scale,
    };
}

/** The device position of the map's top-left corner. */
export function originOf(state: ViewState) {
    return {
        x: state.width / 2 - state.centreX * state.scale,
        y: state.height / 2 - state.centreY * state.scale,
    };
}

/** Clicks the middle of the viewport, which focuses it (a pointer down on the overlay). */
export async function focusViewport(page: Page): Promise<void> {
    const box = await hostBox(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("[data-viewport]")).toBeFocused();
}

/** Waits until the overlay has drawn what was asked of it. */
export async function overlayIdle(page: Page): Promise<void> {
    await page.waitForFunction(() => window.__ngneTest!.overlay!.pending === false);
    // The redraw that is scheduled after a store change is asked for in the same task.
    await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await page.waitForFunction(() => window.__ngneTest!.overlay!.pending === false);
}

/** The device pixels per map pixel of the active map's view. */
export async function scaleOf(page: Page): Promise<number> {
    return (await view(page)).scale;
}

export { expect };
