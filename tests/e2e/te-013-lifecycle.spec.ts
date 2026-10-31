import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectErrors } from "./te-003-support";
import { installDeviceToolkit } from "./te-013-devices";
import {
    canvasSizes,
    compare,
    framesOf,
    loadScene,
    openEditor,
    pageCall,
    texturesReady,
} from "./te-013-support";

// TE-013: the renderer lifecycle of ENGINE §2 in Chrome: recovery from a lost device, a failed
// renderer's notice, one renderer across window resizes, redraw on demand, and the release of
// tileset textures. The scene and the comparison are those of the readback specs.

const BACKGROUND = 0x203040ff;
const VIEW = { zoom: 1, background: BACKGROUND, originX: 37, originY: 23 };

test.beforeEach(async ({ page }) => {
    await page.addInitScript(installDeviceToolkit);
});

const status = (page: Page) => page.evaluate(() => window.__ngneTest!.viewport!.status);
const created = (page: Page) => page.evaluate(() => window.__te013Devices.created());
const renderers = (page: Page) =>
    page.evaluate(() => window.__ngneTest!.viewport!.rendererCreations());

test("a lost device recovers and the viewport redraws without input", async ({ page }) => {
    await openEditor(page);
    const geometry = await loadScene(page, VIEW);
    expect((await compare(page, geometry, 2)).mismatches).toBe(0);

    const before = await framesOf(page);
    const devices = await created(page);
    const renderersBefore = await renderers(page);
    await page.evaluate(() => window.__te013Devices.loseDevice());
    // No input from here on: the lifecycle observer asks for the frame.
    await page.waitForFunction(
        (frames) => window.__ngneTest!.viewport!.stats.frames > frames,
        before,
    );
    await page.waitForFunction(() => window.__ngneTest!.viewport!.status === "ready");
    expect(await created(page)).toBe(devices + 1);
    // Recovery keeps the renderer: no second one is created.
    expect(await renderers(page)).toBe(renderersBefore);

    // The new device shows the same image: textures were recovered from the document's atlases.
    await texturesReady(page, 3);
    const after = await compare(page, geometry, 2);
    expect(after.first).toEqual([]);
    expect(after.mismatches).toBe(0);
});

test("a renderer that cannot recover shows the failure notice with Reload", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
        window.__te013Devices.refuseDevices(8);
        window.__te013Devices.loseDevice();
    });
    const notice = page.locator("[data-viewport-failure]");
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("button", { name: "Reload" })).toBeEnabled();
    expect(await status(page)).toBe("failed");

    // Reload creates a renderer again.
    await notice.getByRole("button", { name: "Reload" }).click();
    await page.waitForFunction(() => window.__ngneTest?.viewport?.status === "ready");
    await expect(page.locator("[data-viewport-failure]")).toHaveCount(0);
});

test("ten window resizes create one renderer only", async ({ page }) => {
    await openEditor(page);
    const geometry = await loadScene(page, VIEW);
    const renderersBefore = await renderers(page);
    const devicesBefore = await created(page);
    const textures = await page.evaluate(() => window.__ngneTest!.viewport!.textureIds());

    for (let step = 1; step <= 10; step += 1) {
        const size = { width: 1280 + step * 12, height: 720 + (step % 2 === 0 ? 40 : 0) };
        await page.setViewportSize(size);
        await page.waitForFunction(() => {
            const probe = window.__ngneTest!.viewport!;
            const host = document.querySelector<HTMLElement>("[data-viewport]")!;
            const box = host.getBoundingClientRect();
            return (
                Math.abs(probe.canvas.width - box.width * devicePixelRatio) < 1 &&
                Math.abs(probe.canvas.height - box.height * devicePixelRatio) < 1
            );
        });
    }

    expect(await renderers(page)).toBe(renderersBefore);
    expect(await created(page)).toBe(devicesBefore);
    expect(await page.evaluate(() => window.__ngneTest!.viewport!.textureIds())).toEqual(textures);
    const sizes = await canvasSizes(page);
    expect(sizes.canvases).toBe(1);

    // The canvas was resized in place and still draws the scene on the new size.
    const moved = await loadScene(page, VIEW);
    expect(moved.width).toBe(geometry.width + 120);
    const result = await compare(page, moved, 2);
    expect(result.first).toEqual([]);
    expect(result.mismatches).toBe(0);
});

test("an idle editor submits no frames over 2 s @alone", async ({ page }) => {
    await openEditor(page);
    await loadScene(page, VIEW);
    // Let the work that follows the scene settle: uploads, then the frame that shows them.
    let last = -1;
    await expect
        .poll(async () => {
            const now = await framesOf(page);
            const stable = now === last;
            last = now;
            return stable;
        })
        .toBe(true);
    const before = await framesOf(page);
    await page.waitForTimeout(2000);
    expect(await framesOf(page)).toBe(before);

    // And a change does draw: the check is not blind.
    await page.evaluate(() => window.__ngneTest!.session.getState().touch());
    await page.waitForFunction(
        (frames) => window.__ngneTest!.viewport!.stats.frames > frames,
        before,
    );
});

test("a tileset texture is released when the last open map using it closes", async ({ page }) => {
    await openEditor(page);
    await loadScene(page, VIEW);
    const ids = await pageCall<string[]>(page, "tilesetIds");
    const textureOf = (id: string) => `ed:ts:${id}`;
    const tilesetTextures = () =>
        page.evaluate(() =>
            window
                .__ngneTest!.viewport!.textureIds()
                .filter((id) => id.startsWith("ed:ts:"))
                .sort(),
        );
    expect(await tilesetTextures()).toEqual(ids.map(textureOf).sort());

    const maps = await pageCall<{ partial: string; empty: string; first: string }>(page, "addMaps");

    // A map with cells of one tileset keeps that texture and releases the others.
    await pageCall(page, "showMap", maps.partial);
    await expect.poll(tilesetTextures).toEqual([textureOf(ids[0]!)]);

    // A map without tiles keeps none.
    await pageCall(page, "showMap", maps.empty);
    await expect.poll(tilesetTextures).toEqual([]);

    // Back on the first map the textures are uploaded again, and the scene draws.
    await pageCall(page, "showMap", maps.first);
    await texturesReady(page, 3);
    await expect.poll(tilesetTextures).toEqual(ids.map(textureOf).sort());
});

test("a window too small to show the shell leaves the renderer alone and it draws again after", async ({
    page,
}) => {
    const errors = collectErrors(page);
    await openEditor(page);
    const geometry = await loadScene(page, VIEW);
    const renderersBefore = await renderers(page);

    // The shell is hidden: its viewport measures 0 × 0.
    await page.setViewportSize({ width: 800, height: 600 });
    await expect(page.locator("[data-notice='window-too-small']")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator("[data-notice='window-too-small']")).toHaveCount(0);
    await page.waitForFunction(() => {
        const probe = window.__ngneTest!.viewport!;
        const box = document.querySelector<HTMLElement>("[data-viewport]")!.getBoundingClientRect();
        return Math.abs(probe.canvas.width - box.width * devicePixelRatio) < 1;
    });

    expect(errors).toEqual([]);
    expect(await status(page)).toBe("ready");
    expect(await renderers(page)).toBe(renderersBefore);
    const result = await compare(page, geometry, 2);
    expect(result.mismatches).toBe(0);
});
