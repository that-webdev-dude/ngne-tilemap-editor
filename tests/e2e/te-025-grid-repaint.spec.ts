import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Shape } from "../../src/core/model";
import { focusViewport, hostBox, view } from "./te-014-support";
import { expect, openEditor, tileClient, tileGrid } from "./te-025-support";

// The Tilesets panel's grid repaints when what it shows changes (history step, panel zoom,
// filter, selection, scrolling, theme) and not when the map is panned or zoomed, a tile is
// hovered, or anything else re-renders its component. A repaint is a `setTransform` on the
// grid's canvas (`paintTileGrid`); its colours are read with `getComputedStyle` on it.

declare global {
    interface Window {
        __gridPaints: number;
        __gridStyleReads: number;
    }
}

const PAGE_MODULE = JSON.stringify("/tests/e2e/harness/te-029-page.ts");
const PANEL_MODULE = JSON.stringify("/src/app/tilesets/panel/tilesetPanel.ts");

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        window.__gridPaints = 0;
        window.__gridStyleReads = 0;
        const isGrid = (target: unknown) =>
            target instanceof HTMLCanvasElement && target.hasAttribute("data-tile-canvas");
        const setTransform = CanvasRenderingContext2D.prototype.setTransform;
        CanvasRenderingContext2D.prototype.setTransform = function (
            this: CanvasRenderingContext2D,
            ...args: never[]
        ) {
            if (isGrid(this.canvas)) window.__gridPaints++;
            return (setTransform as (...values: never[]) => void).apply(this, args);
        } as typeof setTransform;
        const read = window.getComputedStyle;
        window.getComputedStyle = function (element: Element, pseudo?: string | null) {
            if (isGrid(element)) window.__gridStyleReads++;
            return read.call(window, element, pseudo);
        };
    });
});

const counts = (page: Page) =>
    page.evaluate(() => ({ paints: window.__gridPaints, reads: window.__gridStyleReads }));

/** Waits for two frames, so a repaint caused by what was just done has happened. */
const settle = (page: Page) =>
    page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
    );

const SHAPE: Shape = { shape: "rectangle", x: 0, y: 0, width: 8, height: 8 };

/** Opens the editor and waits until the grid has painted; resolves with the baseline counts. */
async function baseline(page: Page) {
    await openEditor(page);
    await settle(page);
    const before = await counts(page);
    expect(before.paints).toBeGreaterThan(0);
    return before;
}

test("hovering tiles does not repaint the grid", async ({ page }) => {
    const before = await baseline(page);
    for (const [column, row] of [
        [0, 0],
        [1, 0],
        [2, 1],
        [3, 2],
        [0, 2],
    ] as const) {
        const at = await tileClient(page, column, row);
        await page.mouse.move(at.x, at.y, { steps: 2 });
    }
    await settle(page);
    expect(await counts(page)).toEqual(before);
});

test("panning the map does not repaint the grid", async ({ page }) => {
    const before = await baseline(page);
    const start = await view(page);
    await focusViewport(page);
    const box = await hostBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Shift");
    for (let step = 0; step < 4; step++) await page.mouse.wheel(0, 40);
    await page.keyboard.up("Shift");
    await settle(page);
    const end = await view(page);
    expect(end.centreX).not.toBe(start.centreX);
    expect(await counts(page)).toEqual(before);
});

test("zooming the map does not repaint the grid", async ({ page }) => {
    const before = await baseline(page);
    const start = await view(page);
    const box = await hostBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < 3; step++) await page.mouse.wheel(0, -120);
    await settle(page);
    const end = await view(page);
    expect(end.scale).not.toBe(start.scale);
    expect(await counts(page)).toEqual(before);
});

test("a history step repaints the grid, and so does its undo", async ({ page }) => {
    await openEditor(page);
    await settle(page);
    let last = (await counts(page)).paints;

    await page.evaluate(
        `import(${PAGE_MODULE}).then((m) => m.setCollision([1], ${JSON.stringify([SHAPE])}))`,
    );
    await expect.poll(async () => (await counts(page)).paints).toBeGreaterThan(last);
    await settle(page);
    last = (await counts(page)).paints;

    await page.evaluate(() => window.__ngneTest!.session.getState().history.undo());
    await expect.poll(async () => (await counts(page)).paints).toBeGreaterThan(last);
});

test("changing the panel zoom or scrolling the grid still repaints it", async ({ page }) => {
    await openEditor(page);
    await settle(page);
    let last = (await counts(page)).paints;

    await page.evaluate(`import(${PANEL_MODULE}).then((m) => m.tilesetPanel.setZoom(4))`);
    await expect.poll(async () => (await counts(page)).paints).toBeGreaterThan(last);
    await settle(page);
    last = (await counts(page)).paints;

    const scrolled = await tileGrid(page).evaluate((element) => {
        element.scrollTo(0, 0);
        const room = element.scrollHeight - element.clientHeight;
        element.scrollTop = room;
        return element.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    await expect.poll(async () => (await counts(page)).paints).toBeGreaterThan(last);
});
