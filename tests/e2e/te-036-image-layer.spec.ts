import { test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { Comparison, Geometry, Region, Tier } from "./harness/te-036-page";
import { openEditor, texturesReady } from "./te-013-support";
import { openAtRatio } from "./te-015-support";
import { menuItem, openMenu } from "./te-007-support";
import { expect, png, pngHeader, recordWorkerTasks, workerTasks } from "./te-024-support";
import type { FilePayload } from "./te-024-support";

// TE-036: image layers (SPEC §7.2; ENGINE §4). Layer → New Image Layer… imports a PNG (decoded
// in the worker) and adds the layer above the active one; the layer properties popover sets
// Repeat X, Repeat Y and parallax. After each step the canvas, read back in the page, matches the
// reference of `core/compositor` (harness/te-036-page.ts) in the live tier and in the chunk tier,
// where the image layer draws between two chunk sets. A PNG above 8192 px a side is refused
// before it is decoded.
//
// The image has opaque, translucent and clear pixels and is smaller than the view, so repeat
// shows copies beyond the map, over the workspace. GPU blending rounds each layer to 8 bits: the
// tolerance is 2 per channel, as TE-015's.

const TOLERANCE = 2;
const PAGE_MODULE = "/tests/e2e/harness/te-036-page.ts";

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

interface ImageState {
    images: { name: string; exportName: string; width: number; height: number }[];
    order: string[];
    imageLayers: {
        id: number;
        name: string;
        imageId: string;
        repeatX: boolean;
        repeatY: boolean;
        parallaxX: number;
        parallaxY: number;
    }[];
    activeLayerId: number;
    undoLabel: string | null;
}

const imageState = (page: Page) => call<ImageState>(page, "imageState");

/** A 40 × 24 PNG: a gradient, a translucent band, a clear corner. */
function hillsPng(): FilePayload {
    const width = 40;
    const height = 24;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const alpha = x < 6 && y < 6 ? 0 : y >= 16 && y < 20 ? 120 : 255;
            data.set(
                [(x * 6) & 255, (y * 10 + 40) & 255, (x * y) & 255, alpha],
                (y * width + x) * 4,
            );
        }
    }
    return png("Far Hills.png", { width, height, data });
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "New Image Layer" });
const popover = (page: Page) => page.locator("[data-layer-properties]");

/** Layer → New Image Layer…; returns the dialog. */
async function openNewImageLayer(page: Page): Promise<Locator> {
    await openMenu(page, "Layer");
    await menuItem(page, "layer.newImage").click();
    await expect(dialog(page)).toBeVisible();
    return dialog(page);
}

/** Import PNG… in `within`, with `file` picked. */
async function importPng(page: Page, within: Locator, file: FilePayload): Promise<void> {
    const chooser = page.waitForEvent("filechooser");
    await within.locator("[data-image-import]").click();
    await (await chooser).setFiles(file);
}

/** Layer → Layer Properties… on the active layer; returns the popover. */
async function openProperties(page: Page): Promise<Locator> {
    await openMenu(page, "Layer");
    await menuItem(page, "layer.properties").click();
    await expect(popover(page)).toBeVisible();
    return popover(page);
}

async function waitShown(page: Page, tier: Tier): Promise<void> {
    if (tier === "chunk") await expect.poll(() => call<boolean>(page, "chunksReady")).toBe(true);
    await expect.poll(() => call<boolean>(page, "imageShown")).toBe(true);
}

async function expectMatch(
    page: Page,
    geometry: Geometry,
    region: Region | undefined,
    step: string,
): Promise<Comparison> {
    const result = await call<Comparison>(page, "compare", geometry, TOLERANCE, region);
    test.info().annotations.push({
        type: "readback",
        description: JSON.stringify({ step, ...result, first: undefined }),
    });
    expect(result.tier, step).toBe(geometry.tier);
    expect(result.imageQuads, step).toBeGreaterThan(0);
    if (geometry.tier === "chunk") {
        expect(result.chunkQuads, step).toBeGreaterThan(0);
        expect(result.tileQuads, step).toBe(0);
    }
    const area = region ? region.width * region.height : geometry.width * geometry.height;
    expect(result.compared + result.ties, step).toBe(area);
    expect(result.compared, step).toBeGreaterThan(0.95 * area);
    expect(result.first, step).toEqual([]);
    expect(result.mismatches, step).toBe(0);
    return result;
}

async function coverage(page: Page, geometry: Geometry, region?: Region): Promise<number> {
    return call<number>(page, "imageCoverage", geometry, region);
}

/** The import, Repeat X, Repeat Y and parallax steps, each compared with the reference. */
async function runSteps(page: Page, geometry: Geometry, region?: Region): Promise<void> {
    const { tier } = geometry;
    // New Image Layer…: the PNG is read, shown in the dialog's list and added with the layer.
    const newLayer = await openNewImageLayer(page);
    await expect(newLayer.locator("[data-image-none]")).toBeVisible();
    await expect(newLayer.locator("[data-new-image-layer-create]")).toBeDisabled();
    await importPng(page, newLayer, hillsPng());
    await expect(newLayer.getByRole("combobox", { name: "Image" })).toContainText(
        "Far Hills (40 × 24), new",
    );
    await newLayer.locator("[data-new-image-layer-create]").click();
    await expect(dialog(page)).toHaveCount(0);
    let state = await imageState(page);
    expect(state.images).toEqual([
        { name: "Far Hills", exportName: "far-hills", width: 40, height: 24 },
    ]);
    // Above the bottom layer, which was active, and active itself.
    expect(state.order.slice(0, 2)).toEqual(["tile:Base", "image:Image Layer 1"]);
    const layer = state.imageLayers[0]!;
    expect(state.activeLayerId).toBe(layer.id);
    expect(state.undoLabel).toBe("New Image Layer");
    await waitShown(page, tier);
    await expectMatch(page, geometry, region, "import");
    const once = await coverage(page, geometry, region);
    expect(once).toBeGreaterThan(0);

    // Repeat X: copies along x, beyond the map.
    let properties = await openProperties(page);
    await properties.locator('[data-image-repeat="x"]').click();
    await page.keyboard.press("Escape");
    await expect(popover(page)).toBeHidden();
    state = await imageState(page);
    expect(state.imageLayers[0]).toMatchObject({ repeatX: true, repeatY: false });
    expect(state.undoLabel).toBe("Layer Repeat");
    await waitShown(page, tier);
    await expectMatch(page, geometry, region, "repeat x");
    const alongX = await coverage(page, geometry, region);
    expect(alongX).toBeGreaterThan(4 * once);

    // Repeat Y alone.
    properties = await openProperties(page);
    await properties.locator('[data-image-repeat="x"]').click();
    await properties.locator('[data-image-repeat="y"]').click();
    await page.keyboard.press("Escape");
    await expect(popover(page)).toBeHidden();
    state = await imageState(page);
    expect(state.imageLayers[0]).toMatchObject({ repeatX: false, repeatY: true });
    await waitShown(page, tier);
    await expectMatch(page, geometry, region, "repeat y");
    expect(await coverage(page, geometry, region)).toBeGreaterThan(4 * once);

    // Parallax 0.5 × 0.25 with both axes repeated: the layer moves 4 and 6 px with the view.
    properties = await openProperties(page);
    await properties.locator('[data-image-repeat="x"]').click();
    await properties.getByLabel("Parallax X", { exact: true }).fill("0.5");
    const parallaxY = properties.getByLabel("Parallax Y", { exact: true });
    await parallaxY.fill("0.25");
    await parallaxY.press("Enter");
    await expect(popover(page)).toBeHidden();
    state = await imageState(page);
    expect(state.imageLayers[0]).toMatchObject({
        repeatX: true,
        repeatY: true,
        parallaxX: 0.5,
        parallaxY: 0.25,
    });
    expect(state.undoLabel).toBe("Layer Properties");
    await waitShown(page, tier);
    await expectMatch(page, geometry, region, "parallax");
    await page.evaluate(() => window.__ngneTest!.assertInvariants());
}

test("live tier: import, Repeat X, Repeat Y and parallax match the compositor reference", async ({
    page,
}) => {
    await openEditor(page);
    const geometry = await call<Geometry>(page, "loadScene", "live");
    await texturesReady(page, 3);
    await runSteps(page, geometry);
});

test("chunk tier: import, Repeat X, Repeat Y and parallax match the compositor reference", async ({
    playwright,
    launchOptions,
    baseURL,
}) => {
    const { page, browser } = await openAtRatio(playwright.chromium, launchOptions, baseURL, 1);
    try {
        const geometry = await call<Geometry>(page, "loadScene", "chunk");
        await texturesReady(page, 2);
        await page.evaluate(() => window.__ngneTest!.viewport!.renderNow());
        await expect.poll(() => call<boolean>(page, "chunksReady")).toBe(true);
        // A quarter of the canvas from just above and left of the map's top-left corner, where
        // the image layer starts: the reference of a repeated image over the whole view would
        // composite tens of millions of map pixels.
        const corner = (centre: number, size: number) =>
            Math.max(0, Math.floor(size / 2 - centre * geometry.scale) - 32);
        const region: Region = {
            x: corner(geometry.centreX, geometry.width),
            y: corner(geometry.centreY, geometry.height),
            width: Math.round(geometry.width / 2),
            height: Math.round(geometry.height / 2),
        };
        await runSteps(page, geometry, region);
    } finally {
        await browser.close();
    }
});

test("a PNG above 8192 px a side is refused before it is decoded", async ({ page }) => {
    await recordWorkerTasks(page);
    await openEditor(page);
    const newLayer = await openNewImageLayer(page);
    await importPng(page, newLayer, pngHeader("huge.png", 9000, 16));
    await expect(newLayer.locator("[data-image-problem]")).toHaveText(
        "The image is 9000 × 16 px; an image is at most 8192 px a side.",
    );
    await expect(newLayer.locator("[data-new-image-layer-create]")).toBeDisabled();
    await newLayer.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await workerTasks(page)).filter((task) => task === "png.decode")).toEqual([]);
    const state = await imageState(page);
    expect(state.images).toEqual([]);
    expect(state.imageLayers).toEqual([]);

    // A PNG within the limits is decoded in the worker.
    const again = await openNewImageLayer(page);
    await importPng(page, again, hillsPng());
    await expect(again.locator("[data-new-image-layer-create]")).toBeEnabled();
    expect((await workerTasks(page)).filter((task) => task === "png.decode")).toEqual([
        "png.decode",
    ]);
});
