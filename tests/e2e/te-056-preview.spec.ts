import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
// Declares `window.__ngneTest` and the preview hooks of the app.
import type {} from "../../src/app/testing/testHooks";
import type {} from "../../src/app/preview/mountPreview";
import type { FrameReport } from "./harness/te-056-page";
import { openEditor } from "./te-013-support";
import { afterFrames } from "./support/wait";

// TE-056: the game preview (SPEC §12, ENGINE §5) in the app. The page module (harness/
// te-056-page.ts) opens the TE-055 reference export project on its layers map and reads the
// preview's frames back; each frame is compared with the `core/compositor` reference of the
// same view, the conformance reference of SPEC §10.3.

const PAGE_MODULE = "/tests/e2e/harness/te-056-page.ts";

/** Calls an export of the page module with JSON arguments; resolves with its JSON result. */
function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

/** At this height the Preview section starts expanded (DESIGN §2). */
const WINDOW = { width: 1600, height: 900 };

const section = (page: Page) => page.locator('[data-dock-panel="preview"]');

async function choose(page: Page, select: string, option: string): Promise<void> {
    await section(page).getByRole("combobox", { name: select }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
}

/** Waits until the preview runs the current content's textures. */
async function settled(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        const preview = window.__ngneTest?.preview;
        return preview?.settled === true && preview.mountedKey !== null;
    });
}

const pageStats = (page: Page) =>
    page.evaluate(() => {
        const stats = window.__ngneTest!.previewPage!;
        return { frames: stats.frames, liveGames: stats.liveGames, scenes: stats.scenesStarted };
    });

function expectMatch(report: FrameReport, label: string): void {
    expect.soft(report.examples, label).toEqual([]);
    expect.soft(report.wrong, label).toBe(0);
    expect.soft(report.drawn, label).toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WINDOW);
    await openEditor(page);
    await pageCall(page, "openProject");
    await expect(section(page).locator("canvas")).toHaveCount(1);
    await settled(page);
    // Animations still at their first frame, which the compositor draws.
    await page.getByRole("button", { name: "Pause preview" }).click();
    await page.evaluate(() => window.__ngneTest!.preview!.seek(0));
});

test("the readback equals the conformance reference at the chosen resolution and scale", async ({
    page,
}) => {
    for (const [resolution, width, height] of [
        ["320 × 180", 320, 180],
        ["640 × 360", 640, 360],
    ] as const) {
        await choose(page, "Preview resolution", resolution);
        await choose(page, "Preview scale", "2×");
        await settled(page);
        const probe = await page.evaluate(() => {
            const preview = window.__ngneTest!.preview!;
            return { canvas: preview.canvasSize, display: preview.displaySize };
        });
        // The game's logical size is the resolution; the canvas shows 2 device pixels a pixel.
        expect(probe.canvas).toEqual({ width, height });
        const ratio = await page.evaluate(() => devicePixelRatio);
        expect(probe.display).toEqual({ width: (2 * width) / ratio, height: (2 * height) / ratio });
        const box = await section(page).locator("canvas").boundingBox();
        expect(box?.width).toBeCloseTo((2 * width) / ratio, 0);

        for (const centre of [
            [96, 64],
            [131, 47],
        ] as const) {
            await pageCall(page, "setViewCentre", ...centre);
            const report = await pageCall<FrameReport>(page, "compareNextFrame");
            expect(report.width).toBe(width);
            expectMatch(report, `${resolution} centred on ${centre.join(", ")}`);
        }
    }
});

test("a painted cell appears in the next preview frame", async ({ page }) => {
    const report = await pageCall<FrameReport & { changed: boolean }>(
        page,
        "paintAndCompare",
        3,
        2,
        2,
    );
    expect(report.changed).toBe(true);
    expectMatch(report, "after the paint");
});

test("a tileset update restarts the scene with the new pixels", async ({ page }) => {
    const before = await pageStats(page);
    const key = await page.evaluate(() => window.__ngneTest!.preview!.mountedKey);
    await pageCall(page, "updateEvenTileset");
    await page.waitForFunction((old) => {
        const preview = window.__ngneTest?.preview;
        return preview?.settled === true && preview.mountedKey !== old;
    }, key);
    const after = await pageStats(page);
    // The same game, a new map scene.
    expect(after.scenes).toBe(before.scenes + 1);
    expect(after.liveGames).toBe(1);
    expectMatch(await pageCall<FrameReport>(page, "compareNextFrame"), "after the update");
    expect(
        await page.evaluate(() => window.__ngneTest!.previewState!.getState().diagnostics),
    ).toEqual([]);
});

test("a scene restart cut short by hiding the window completes when it shows again", async ({
    page,
}) => {
    const key = await page.evaluate(() => window.__ngneTest!.preview!.mountedKey);
    await pageCall(page, "updateWhileHiding");
    await page.waitForFunction((old) => {
        const preview = window.__ngneTest?.preview;
        return (
            preview?.settled === true && preview.mountedKey !== null && preview.mountedKey !== old
        );
    }, key);
    expectMatch(await pageCall<FrameReport>(page, "compareNextFrame"), "after the restart");
});

test("the layer filter draws the active layer and the visible layers under it", async ({
    page,
}) => {
    await pageCall(page, "setActiveLayer", "Far");
    expectMatch(await pageCall<FrameReport>(page, "compareNextFrame"), "all visible");
    await choose(page, "Preview layers", "This layer and below");
    expectMatch(
        await pageCall<FrameReport>(page, "compareNextFrame", ["Ground", "Sky", "Far"]),
        "Far and below",
    );
    await pageCall(page, "setActiveLayer", "Ground");
    expectMatch(
        await pageCall<FrameReport>(page, "compareNextFrame", ["Ground"]),
        "Ground and below",
    );
    await choose(page, "Preview layers", "All visible");
    expectMatch(await pageCall<FrameReport>(page, "compareNextFrame"), "all visible again");
});

test("animation advances only while playing", async ({ page }) => {
    // Paused: the clock stands still and no frame is submitted.
    const paused = await page.evaluate(() => window.__ngneTest!.preview!.elapsedMs);
    const framesPaused = (await pageStats(page)).frames;
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__ngneTest!.preview!.elapsedMs)).toBe(paused);
    expect((await pageStats(page)).frames).toBe(framesPaused);

    // Playing: frames come as the animated tile changes, and it shows both of its frames.
    await page.getByRole("button", { name: "Play preview" }).click();
    const hashes = await pageCall<string[]>(page, "frameHashes", 4);
    expect(new Set(hashes).size).toBeGreaterThan(1);
    const playing = await page.evaluate(() => window.__ngneTest!.preview!.elapsedMs);
    expect(playing).toBeGreaterThan(paused + 150);

    await page.getByRole("button", { name: "Pause preview" }).click();
    const stopped = await page.evaluate(() => window.__ngneTest!.preview!.elapsedMs);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__ngneTest!.preview!.elapsedMs)).toBe(stopped);
});

test("collapsing the section or hiding the window stops frame submission", async ({ page }) => {
    await page.getByRole("button", { name: "Play preview" }).click();
    // Running: the animated tile keeps frames coming.
    const running = (await pageStats(page)).frames;
    await page.waitForTimeout(500);
    expect((await pageStats(page)).frames).toBeGreaterThan(running);

    // Hidden: the game stops; a paint submits nothing.
    await pageCall(page, "setPageHidden", true);
    await page.waitForFunction(() => window.__ngneTest?.preview?.lifecycle === "Stopped");
    const hidden = (await pageStats(page)).frames;
    await pageCall(page, "setViewCentre", 100, 70);
    await page.waitForTimeout(500);
    expect((await pageStats(page)).frames).toBe(hidden);

    // Visible again: frames resume.
    await pageCall(page, "setPageHidden", false);
    await page.waitForFunction(
        (count) => (window.__ngneTest?.previewPage?.frames ?? 0) > count,
        hidden,
    );

    // Collapsed: the game is disposed and nothing is submitted.
    await section(page).getByRole("button", { name: "Preview · NGNE" }).click();
    await page.waitForFunction(() => window.__ngneTest?.previewPage?.liveGames === 0);
    expect(await page.evaluate(() => window.__ngneTest!.preview)).toBeUndefined();
    const collapsed = (await pageStats(page)).frames;
    await pageCall(page, "setViewCentre", 90, 60);
    await afterFrames(page, 10);
    await page.waitForTimeout(500);
    expect((await pageStats(page)).frames).toBe(collapsed);

    // Expanded: a new game draws again.
    await section(page).getByRole("button", { name: "Preview · NGNE" }).click();
    await page.waitForFunction(
        (count) => (window.__ngneTest?.previewPage?.frames ?? 0) > count,
        collapsed,
    );
});
