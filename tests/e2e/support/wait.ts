import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Shared E2E wait helpers (SUITE §8): wait for a state the page reports, never for a time.
// Adapted from the sprite editor's se-006, se-012 and se-022 support files.

export interface Size {
    width: number;
    height: number;
}

/**
 * Opens `path` (the app by default) and waits until the app has started: `<html
 * data-app-ready>`, which the app sets once React has committed its root (src/main.tsx).
 */
export async function openApp(page: Page, path = "/"): Promise<void> {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-app-ready", "");
}

/** Waits until the page has had `count` more animation frames. */
export function afterFrames(page: Page, count: number): Promise<void> {
    return page.evaluate(
        (count) =>
            new Promise<void>((resolve) => {
                let left = count;
                const next = () => (--left <= 0 ? resolve() : requestAnimationFrame(next));
                requestAnimationFrame(next);
            }),
        count,
    );
}

/**
 * Reads, in the page, how many frames a renderer has submitted so far: a function of the
 * page's globals only (a test hook), as `page.evaluate` takes it. It is sent as source, so it
 * must not close over anything of the test.
 */
export type FrameCounter = () => number;

/**
 * Waits until the page has submitted `count` more frames than when it is called, as `counter`
 * counts them; returns the count reached.
 */
export async function framesSubmitted(
    page: Page,
    counter: FrameCounter,
    count = 1,
): Promise<number> {
    const target = (await page.evaluate(counter)) + count;
    const condition = `(${counter.toString()})() >= ${target}`;
    const reached = await page.waitForFunction(condition, undefined, { polling: "raf" });
    await reached.dispose();
    return page.evaluate(counter);
}

/**
 * Waits until `locator`'s element keeps one CSS size for `frames` animation frames in a row
 * (a layout that has settled after a resize, a splitter drag or a panel opening); returns it.
 */
export function stableSize(locator: Locator, frames = 3): Promise<Size> {
    return locator.evaluate(
        (element, frames) =>
            new Promise<Size>((resolve) => {
                let last: Size | null = null;
                let same = 0;
                const check = () => {
                    const { width, height } = element.getBoundingClientRect();
                    const kept = last?.width === width && last.height === height;
                    same = kept ? same + 1 : 0;
                    last = { width, height };
                    if (same >= frames) resolve(last);
                    else requestAnimationFrame(check);
                };
                requestAnimationFrame(check);
            }),
        frames,
    );
}
