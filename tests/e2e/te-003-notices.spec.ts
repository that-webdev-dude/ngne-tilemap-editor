import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors, openShell, region, REGIONS } from "./te-003-support";
import { openApp } from "./support/wait";

// TE-003: the two full-window notices (SUITE §3, `se-design` §2 and §7).

const webGpuNotice = (page: Page) => page.locator('[data-notice="webgpu-required"]');
const tooSmallNotice = (page: Page) => page.locator('[data-notice="window-too-small"]');

/** The notice of `se-design` §7 for `reason`, named for this editor, over the whole window. */
async function expectWebGpuNotice(page: Page, reason: "no-api" | "no-adapter") {
    const notice = webGpuNotice(page);
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("heading", { name: "WebGPU required" })).toBeVisible();
    await expect(notice).toContainText(
        "NGNE Tilemap Editor draws with the NGNE engine, which runs on WebGPU only",
    );
    await expect(notice).not.toContainText("Sprite");
    // What is missing, supported browsers, how to enable acceleration.
    await expect(notice.getByRole("heading", { name: "What is missing" })).toBeVisible();
    await expect(notice.locator("[data-notice-reason]")).toHaveAttribute(
        "data-notice-reason",
        reason,
    );
    await expect(notice.getByRole("heading", { name: "Supported browsers" })).toBeVisible();
    await expect(notice).toContainText("Desktop Chrome or Edge");
    await expect(notice.getByRole("heading", { name: "How to enable acceleration" })).toBeVisible();
    await expect(notice.getByRole("listitem")).toHaveCount(3);
    // Full window, and the editor is not there at all.
    expect(await notice.boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize() });
    await expect(page.locator("[data-region]")).toHaveCount(0);
}

test("with navigator.gpu absent the WebGPU-required notice names NGNE Tilemap Editor", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
        delete (Navigator.prototype as { gpu?: unknown }).gpu;
    });
    await openApp(page);
    expect(await page.evaluate(() => "gpu" in navigator)).toBe(false);
    await expectWebGpuNotice(page, "no-api");
    await expect(webGpuNotice(page)).toContainText("navigator.gpu is missing");
    expect(errors).toEqual([]);
});

test("when no adapter can be acquired the WebGPU-required notice says so", async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "gpu", {
            configurable: true,
            get: () => ({ requestAdapter: () => Promise.resolve(null) }),
        });
    });
    await openApp(page);
    await expectWebGpuNotice(page, "no-adapter");
    await expect(webGpuNotice(page)).toContainText("no graphics adapter is available");
    expect(errors).toEqual([]);
});

test("when adapter acquisition fails the WebGPU-required notice shows the browser's error", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "gpu", {
            configurable: true,
            get: () => ({
                requestAdapter: () => Promise.reject(new Error("adapter request blocked")),
            }),
        });
    });
    await openApp(page);
    await expectWebGpuNotice(page, "no-adapter");
    await expect(webGpuNotice(page)).toContainText("adapter request blocked");
    expect(errors).toEqual([]);
});

test("with WebGPU available the shell renders without a notice or an error", async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page);
    for (const id of REGIONS) await expect(region(page, id)).toBeVisible();
    await expect(webGpuNotice(page)).toHaveCount(0);
    await expect(tooSmallNotice(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test("below 1280×720 the window-too-small notice replaces the layout", async ({ page }) => {
    const errors = collectErrors(page);
    await openShell(page, { width: 1280, height: 720 });
    await expect(tooSmallNotice(page)).toHaveCount(0);
    await expect(webGpuNotice(page)).toHaveCount(0);

    for (const size of [
        { width: 1279, height: 720 },
        { width: 1280, height: 719 },
        { width: 800, height: 600 },
    ]) {
        await page.setViewportSize(size);
        const notice = tooSmallNotice(page);
        await expect(notice).toBeVisible();
        await expect(notice.getByRole("heading", { name: "Window too small" })).toBeVisible();
        await expect(notice).toContainText("at least 1280 × 720");
        await expect(notice).toContainText(`this one is ${size.width} × ${size.height}`);
        expect(await notice.boundingBox()).toEqual({ x: 0, y: 0, ...size });
        for (const id of REGIONS) await expect(region(page, id)).toBeHidden();
        // One main landmark at a time: the notice, not the hidden viewport.
        await expect(page.getByRole("main")).toHaveAttribute("data-notice", "window-too-small");
    }

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(tooSmallNotice(page)).toHaveCount(0);
    for (const id of REGIONS) await expect(region(page, id)).toBeVisible();
    expect(errors).toEqual([]);
});

test("the shell keeps its state while the window is too small", async ({ page }) => {
    await openShell(page, { width: 1280, height: 720 });
    const maps = region(page, "dock").getByRole("button", { name: "Maps" });
    await maps.click();
    await expect(maps).toHaveAttribute("aria-expanded", "false");

    await page.setViewportSize({ width: 1000, height: 700 });
    await expect(tooSmallNotice(page)).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(maps).toHaveAttribute("aria-expanded", "false");
});
