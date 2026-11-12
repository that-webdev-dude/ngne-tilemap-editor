import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest` and the minimap hook of the app.
import type {} from "../../src/app/testing/testHooks";
import type {} from "../../src/app/minimap/mountMinimap";
import type {
    BurstReport,
    EditReport,
    FrameReport,
    ImageReport,
    MainThreadRecord,
    ResizeReport,
} from "./harness/te-057-page";
import { openEditor } from "./te-013-support";
import { afterFrames } from "./support/wait";

// TE-057: the Minimap dock section (DESIGN §8.8). The page module (harness/te-057-page.ts) opens
// a project and reads the minimap back; its image is compared with `core/compositor`'s composite
// of the whole map at the minimap's size. The Preview section is collapsed, so no game runs
// beside the minimap.
//
// "An edit shows within 500 ms of settling": a step after a quiet half second reaches the canvas
// within 500 ms. "Throttled": during a burst of steps, redraws start at least 500 ms apart
// (DESIGN §8.8), so a step that lands just after a redraw starts shows with the next one: at
// most 500 ms plus that redraw's time after it.
//
// The 16 ms check uses TE-010's method: the long-task observer reports only tasks over 50 ms, so a
// message loop on the main thread also records the longest gap between its steps, which bounds
// the longest task from above; the minimap times its own slices too. A positive control (a
// deliberate 60 ms task) must show in the observer and the loop first. The checks are
// performance assertions (SPEC §15): enforced locally, reported only under CI. That test runs
// @alone (playwright.config.ts).

const PAGE_MODULE = "/tests/e2e/harness/te-057-page.ts";
const INTERVAL_MS = 500;
const TASK_BUDGET_MS = 16;
const CONTROL_MS = 60;
const ci = !!process.env.CI;

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** At this height the Minimap section starts expanded (DESIGN §2). */
const WINDOW = { width: 1600, height: 900 };

const toggle = (page: Page, id: string) =>
    page.locator(`[data-dock-panel="${id}"] .dock-section__toggle`);

async function setExpanded(page: Page, id: string, expanded: boolean): Promise<void> {
    const button = toggle(page, id);
    if ((await button.getAttribute("aria-expanded")) !== String(expanded)) await button.click();
    await expect(button).toHaveAttribute("aria-expanded", String(expanded));
}

async function idle(page: Page): Promise<void> {
    await page.waitForFunction(
        (module) => import(module).then((m: { idle(): boolean }) => m.idle()),
        PAGE_MODULE,
    );
}

function expectImage(report: ImageReport, label: string): void {
    expect.soft(report.wrong, label).toBe(0);
    expect.soft(report.colours, label).toBeGreaterThan(1);
}

const canvas = (page: Page) => page.locator('[data-dock-panel="minimap"] canvas');

test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WINDOW);
    await openEditor(page);
    await setExpanded(page, "preview", false);
    await setExpanded(page, "minimap", true);
});

test.describe("on the layers map", () => {
    test.beforeEach(async ({ page }) => {
        await pageCall(page, "openLayersMap");
        await idle(page);
    });

    test("the minimap image equals the compositor at its size, at the section's width", async ({
        page,
    }) => {
        expectImage(await pageCall<ImageReport>(page, "compareImage"), "layers map");
        // The longer side (the map is 192 × 128) takes the section's width in device pixels.
        const widths = await page.evaluate(() => {
            const box = document.querySelector<HTMLElement>(".minimap-panel")!;
            const size = window.__ngneTest!.minimap!.size;
            return {
                box: Math.round(box.getBoundingClientRect().width * devicePixelRatio),
                width: size.width,
                height: size.height,
            };
        });
        expect(widths.width).toBe(widths.box);
        expect(widths.height).toBe(Math.round((widths.box * 128) / 192));
        const shown = await canvas(page).boundingBox();
        const dpr = await page.evaluate(() => devicePixelRatio);
        expect(shown?.width).toBeCloseTo(widths.width / dpr, 1);
    });

    test("the rectangle tracks pan and zoom", async ({ page }) => {
        for (const [x, y, zoom] of [
            [96, 64, 1],
            [40, 30, 2],
            [150, 100, 4],
            [96, 64, 0.5],
            [96, 64, 16],
        ] as const) {
            await pageCall(page, "setView", x, y, zoom);
            const report = await pageCall<FrameReport>(page, "frameReport");
            const label = `centre ${x}, ${y} zoom ${zoom}`;
            expect(report.expected, label).not.toBeNull();
            const { frame, expected, box, dpr } = report;
            // Whole image pixels round the view's rectangle.
            expect.soft(Math.abs(frame!.x - expected!.x), label).toBeLessThanOrEqual(0.5);
            expect.soft(Math.abs(frame!.y - expected!.y), label).toBeLessThanOrEqual(0.5);
            const right = expected!.x + expected!.width;
            const bottom = expected!.y + expected!.height;
            expect.soft(Math.abs(frame!.x + frame!.width - right), label).toBeLessThanOrEqual(1);
            expect.soft(Math.abs(frame!.y + frame!.height - bottom), label).toBeLessThanOrEqual(1);
            // The outline is drawn there.
            expect.soft(box!.x, label).toBeCloseTo(frame!.x / dpr, 1);
            expect.soft(box!.y, label).toBeCloseTo(frame!.y / dpr, 1);
            expect.soft(box!.width, label).toBeCloseTo(frame!.width / dpr, 1);
            expect.soft(box!.height, label).toBeCloseTo(frame!.height / dpr, 1);
        }
        // Zooming in by 2 halves the rectangle (at zooms where the viewport shows less than the
        // map's width, so it is not clipped).
        await pageCall(page, "setView", 96, 64, 16);
        const one = await pageCall<FrameReport>(page, "frameReport");
        await pageCall(page, "setView", 96, 64, 32);
        const two = await pageCall<FrameReport>(page, "frameReport");
        expect(two.expected!.width).toBeCloseTo(one.expected!.width / 2, 5);
        // The outline is the 1 px `--accent` border.
        const style = await page.evaluate(() => {
            const element = document.querySelector<HTMLElement>(".minimap-panel__frame")!;
            const probe = document.createElement("div");
            probe.style.color = "var(--accent)";
            document.body.append(probe);
            const accent = getComputedStyle(probe).color;
            probe.remove();
            const css = getComputedStyle(element);
            return { width: css.borderTopWidth, colour: css.borderTopColor, accent };
        });
        expect(style.width).toBe("1px");
        expect(style.colour).toBe(style.accent);
    });

    test("drag pans the viewport", async ({ page }) => {
        // At zoom 16 the viewport shows a part of the 192 × 128 map round its centre.
        await pageCall(page, "setView", 96, 64, 16);
        await canvas(page).scrollIntoViewIfNeeded();
        const box = (await canvas(page).boundingBox())!;
        /** Map pixels per CSS pixel of the minimap. */
        const k = 192 / box.width;

        // A press outside the rectangle centres the view there.
        const press = { x: box.x + box.width * 0.15, y: box.y + box.height * 0.2 };
        const start = await pageCall<FrameReport>(page, "frameReport");
        expect((press.x - box.x) * start.dpr).toBeLessThan(start.frame!.x);
        await page.mouse.move(press.x, press.y);
        await page.mouse.down();
        let view = await pageCall<{ centreX: number; centreY: number }>(page, "view");
        expect(view.centreX).toBeCloseTo((press.x - box.x) * k, 0);
        expect(view.centreY).toBeCloseTo((press.y - box.y) * k, 0);

        // Moving it moves the view by as many map pixels as the minimap shows.
        await page.mouse.move(press.x + 30, press.y + 10, { steps: 3 });
        view = await pageCall(page, "view");
        expect(view.centreX).toBeCloseTo((press.x + 30 - box.x) * k, 0);
        expect(view.centreY).toBeCloseTo((press.y + 10 - box.y) * k, 0);
        await page.mouse.up();

        // A press inside the rectangle grabs it: no jump, then the drag moves it.
        const before = await pageCall<FrameReport>(page, "frameReport");
        const dpr = before.dpr;
        const inside = {
            x: box.x + (before.frame!.x + before.frame!.width / 4) / dpr,
            y: box.y + (before.frame!.y + before.frame!.height / 4) / dpr,
        };
        const centre = await pageCall<{ centreX: number; centreY: number }>(page, "view");
        await page.mouse.move(inside.x, inside.y);
        await page.mouse.down();
        view = await pageCall(page, "view");
        expect(view.centreX).toBeCloseTo(centre.centreX, 5);
        expect(view.centreY).toBeCloseTo(centre.centreY, 5);
        await page.mouse.move(inside.x - 12, inside.y + 8, { steps: 3 });
        await page.mouse.up();
        view = await pageCall(page, "view");
        expect(Math.abs(view.centreX - (centre.centreX - 12 * k))).toBeLessThanOrEqual(1);
        expect(Math.abs(view.centreY - (centre.centreY + 8 * k))).toBeLessThanOrEqual(1);
        // The rectangle followed.
        const after = await pageCall<FrameReport>(page, "frameReport");
        expect(after.frame!.x).toBeLessThan(before.frame!.x);
        expect(after.frame!.y).toBeGreaterThan(before.frame!.y);
    });

    test("an edit shows within 500 ms of settling, and redraws are throttled @alone", async ({
        page,
    }) => {
        const edit = await pageCall<EditReport>(page, "editAndTime", 2, 1, 3);
        expectImage(edit, "after the edit");
        expect(edit.redraws).toBe(1);
        expect(edit.ms).toBeLessThanOrEqual(INTERVAL_MS);

        // 12 steps 60 ms apart (about 0.7 s): redraws start at least 500 ms apart, and the last
        // one shows every step.
        const burst = await pageCall<BurstReport>(page, "editBurst", 12, 60);
        expectImage(burst, "after the burst");
        expect(burst.starts.length).toBeGreaterThanOrEqual(2);
        expect(burst.starts.length).toBeLessThanOrEqual(3);
        for (let i = 1; i < burst.starts.length; i += 1) {
            expect(burst.starts[i]! - burst.starts[i - 1]!).toBeGreaterThanOrEqual(INTERVAL_MS);
        }
        // The last step, whenever it fell, shows by the next start plus that redraw.
        expect(burst.lastShownMs).toBeLessThanOrEqual(INTERVAL_MS + burst.lastRedrawMs);
    });

    test("after a map resize the frame stays true to the image shown until the redraw", async ({
        page,
    }) => {
        await pageCall(page, "setView", 96, 64, 16);
        const report = await pageCall<ResizeReport>(page, "resizeAndReport");
        // Before the redraw the image still shows the old map: a frame drawn then is placed
        // as on that image, or none is drawn.
        if (report.staleFrame !== null) {
            expect(report.staleExpected).not.toBeNull();
            expect(Math.abs(report.staleFrame.x - report.staleExpected!.x)).toBeLessThanOrEqual(
                0.5,
            );
            expect(
                Math.abs(report.staleFrame.width - report.staleExpected!.width),
            ).toBeLessThanOrEqual(1);
        }
        // After it, image and frame show the resized map.
        expectImage(report.image, "after the resize");
        // The map is now 384 × 128 map pixels.
        expect(report.image.height).toBe(Math.round((report.image.width * 128) / 384));
        expect(Math.abs(report.frame!.x - report.expected!.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(report.frame!.width - report.expected!.width)).toBeLessThanOrEqual(1);
    });

    test("collapsing the section stops the minimap; expanding draws the map again", async ({
        page,
    }) => {
        await setExpanded(page, "minimap", false);
        expect(await page.evaluate(() => window.__ngneTest!.minimap)).toBeUndefined();
        await expect(canvas(page)).toHaveCount(0);
        await setExpanded(page, "minimap", true);
        await idle(page);
        expectImage(await pageCall<ImageReport>(page, "compareImage"), "expanded again");
    });
});

test("redrawing the reference map keeps every main-thread task within 16 ms @alone", async ({
    page,
}) => {
    test.setTimeout(ci ? 300_000 : 120_000);
    await pageCall(page, "openReferenceMap");
    await idle(page);
    // The viewport has built what it needs for the map.
    await page.waitForFunction(() => {
        const stats = window.__ngneTest?.viewport?.chunkStats();
        return (
            stats !== undefined && stats.pending === 0 && (stats.texelsPerCell === 0 || stats.ready)
        );
    });
    await afterFrames(page, 10);
    expectImage(await pageCall<ImageReport>(page, "compareImage"), "reference map");

    const control = await pageCall<MainThreadRecord>(page, "measureRedraw", CONTROL_MS);
    expect(control.maxGapMs).toBeGreaterThanOrEqual(CONTROL_MS);
    expect(control.longTasks.some((duration) => duration >= CONTROL_MS)).toBe(true);

    const redraw = await pageCall<MainThreadRecord>(page, "measureRedraw");
    expect(redraw.slices).toBeGreaterThan(1);
    const report =
        `redraw ${redraw.ms.toFixed(0)} ms in ${redraw.slices} slices, longest slice ` +
        `${redraw.maxSliceMs.toFixed(1)} ms, longest main-thread gap ` +
        `${redraw.maxGapMs.toFixed(1)} ms, long tasks [${redraw.longTasks.join(", ")}]`;
    test.info().annotations.push({ type: "main thread", description: report });
    console.log(`TE-057 ${report}`);
    if (!ci) {
        expect(redraw.longTasks).toEqual([]);
        expect(redraw.maxSliceMs).toBeLessThanOrEqual(TASK_BUDGET_MS);
        expect(redraw.maxGapMs).toBeLessThanOrEqual(TASK_BUDGET_MS);
    }
});
