import { expect } from "@playwright/test";
import type { Browser, BrowserType, LaunchOptions, Page } from "@playwright/test";
// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../src/app/testing/testHooks";
import type { Comparison, Geometry, Sample, SceneRequest } from "./harness/te-015-page";
import { openEditor, texturesReady } from "./te-013-support";

// Shared helpers of the TE-015 specs. The page module (harness/te-015-page.ts) is imported into
// the running editor, so it shares the app's stores; the specs call it by name.

export type { Comparison, Geometry, Sample };

const PAGE_MODULE = "/tests/e2e/harness/te-015-page.ts";

/**
 * A window large enough that the whole chunk scene fits the viewport at the scales the specs
 * use, so the view holds more cells than the live tier's limit.
 */
export const WINDOW = { width: 1600, height: 900 };

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
export function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/**
 * Starts Chrome at device pixel ratio `ratio` with the configured launch arguments (the scale
 * factor replaced), opens the editor and waits for its renderer. `devicePixelContentBoxSize`,
 * which sizes the canvas, follows the browser's own scale factor, so a ratio needs its own
 * browser (as in te-013-readback-dpr125.spec.ts).
 */
export async function openAtRatio(
    browserType: BrowserType,
    launchOptions: LaunchOptions,
    baseURL: string | undefined,
    ratio: number,
): Promise<{ page: Page; browser: Browser }> {
    const kept = (launchOptions.args ?? []).filter(
        (argument) => !argument.startsWith("--force-device-scale-factor"),
    );
    const browser = await browserType.launch({
        channel: "chrome",
        ...launchOptions,
        args: [...kept, `--force-device-scale-factor=${ratio}`],
    });
    const context = await browser.newContext({
        baseURL,
        viewport: WINDOW,
        deviceScaleFactor: ratio,
    });
    const page = await context.newPage();
    await openEditor(page);
    expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
    return { page, browser };
}

/** Loads the chunk scene and waits until its tilesets are uploaded and its chunk tier is built. */
export async function loadScene(page: Page, request: SceneRequest): Promise<Geometry> {
    const geometry = await pageCall<Geometry>(page, "loadScene", request);
    await texturesReady(page, 3);
    // The build starts with the first frame of the map.
    await page.evaluate(() => window.__ngneTest!.viewport!.renderNow());
    await chunksReady(page);
    return geometry;
}

/** Waits until the chunk tier is built and no patch is pending. */
export async function chunksReady(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        const stats = window.__ngneTest?.viewport?.chunkStats();
        return stats !== undefined && stats.ready && stats.pending === 0;
    });
}

export function chunkStats(page: Page) {
    return page.evaluate(() => window.__ngneTest!.viewport!.chunkStats());
}

export function compare(page: Page, geometry: Geometry, tolerance: number): Promise<Comparison> {
    return pageCall<Comparison>(page, "compare", geometry, tolerance);
}

export { expect };
