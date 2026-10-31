import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import type { Comparison, Geometry, SceneRequest } from "./harness/te-013-page";
import { openApp } from "./support/wait";

// Shared helpers of the TE-013 specs. The page module (harness/te-013-page.ts) is imported
// into the running editor, so it shares the app's stores; the specs call it by name.

const PAGE_MODULE = "/tests/e2e/harness/te-013-page.ts";

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** Opens the editor and waits until its viewport has a renderer. */
export async function openEditor(page: Page): Promise<void> {
    await openApp(page);
    await page.waitForFunction(() => window.__ngneTest?.viewport?.status === "ready");
}

/** Frames the viewport has submitted so far. */
export function framesOf(page: Page): Promise<number> {
    return page.evaluate(() => window.__ngneTest!.viewport!.stats.frames);
}

/** Waits until the viewport holds the checkerboard and `tilesets` tileset textures. */
export async function texturesReady(page: Page, tilesets: number): Promise<void> {
    await page.waitForFunction((count) => {
        const ids = window.__ngneTest?.viewport?.textureIds() ?? [];
        return (
            ids.includes("ed:checker") &&
            ids.filter((id) => id.startsWith("ed:ts:")).length === count
        );
    }, tilesets);
}

export async function loadScene(page: Page, request: SceneRequest): Promise<Geometry> {
    const geometry = await pageCall<Geometry>(page, "loadScene", request);
    await texturesReady(page, 3);
    return geometry;
}

export function compare(
    page: Page,
    geometry: Geometry,
    tolerance: number,
    perturb = false,
): Promise<Comparison> {
    return pageCall<Comparison>(page, "compare", geometry, tolerance, perturb);
}

/** The canvas's backing size and the host element's size in device pixels. */
export function canvasSizes(page: Page) {
    return page.evaluate(() => {
        const probe = window.__ngneTest!.viewport!;
        const host = document.querySelector<HTMLElement>("[data-viewport]")!;
        const box = host.getBoundingClientRect();
        return {
            canvas: [probe.canvas.width, probe.canvas.height] as const,
            host: [box.width * devicePixelRatio, box.height * devicePixelRatio] as const,
            canvases: host.querySelectorAll("canvas").length,
        };
    });
}

export { expect };
