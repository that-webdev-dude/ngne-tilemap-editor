import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { KEY_ZOOMS, ZOOM_STEPS } from "../../src/app/view/zoom";
import {
    MAP,
    clientOf,
    expect,
    focusViewport,
    hostBox,
    mapAt,
    openEditor,
    originOf,
    overlayIdle,
    pageCall,
    view,
} from "./te-014-support";
import type { Lines, Loaded } from "./te-014-support";

// TE-014 cases that depend on the device pixel ratio, declared once per ratio: a ratio other than
// the configured one needs its own Chrome, so each ratio has its own spec file.

const MAP_WIDTH = MAP.width * MAP.tile;
const MAP_HEIGHT = MAP.height * MAP.tile;

/** The largest zoom step at which the map fits a viewport of `width` × `height` device pixels. */
function expectedFit(width: number, height: number): number {
    let fit = ZOOM_STEPS[0]!;
    for (const step of ZOOM_STEPS) {
        if (MAP_WIDTH * step > width || MAP_HEIGHT * step > height) break;
        fit = step;
    }
    return fit;
}

/** The lines the cell grid draws along a row and a column, in device pixels. */
async function gridLines(page: Page): Promise<Lines> {
    const state = await view(page);
    const origin = originOf(state);
    // A row and a column through the inside of the cell (20, 15), which the view centres: no
    // horizontal line is in that row and no vertical line in that column.
    const inside = Math.max(1, Math.floor((MAP.tile * state.scale) / 2));
    const row = Math.round(origin.y + (MAP_HEIGHT / 2) * state.scale) + inside;
    const column = Math.round(origin.x + (MAP_WIDTH / 2) * state.scale) + inside;
    return pageCall<Lines>(page, "readLines", row, column);
}

/** The device positions where a line must be: the first pixel of every cell on the canvas. */
function cellEdges(origin: number, scale: number, cells: number, canvas: number): number[] {
    const edges: number[] = [];
    for (let n = 0; n < cells; n += 1) {
        const at = Math.round(origin + n * MAP.tile * scale);
        if (at >= 0 && at < canvas) edges.push(at);
    }
    return [...new Set(edges)];
}

export function navigationTests(ratio: number): void {
    test.describe(`navigation at device pixel ratio ${ratio}`, () => {
        test.beforeEach(async ({ page }) => {
            await openEditor(page);
            expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
            await pageCall<Loaded>(page, "load");
        });

        test("wheel zoom keeps the map pixel under the cursor, in and out", async ({ page }) => {
            const box = await hostBox(page);
            // A point inside the map at the start (the view centres it).
            const point = { x: box.x + box.width / 2 + 37.5, y: box.y + box.height / 2 - 21.25 };
            await page.mouse.move(point.x, point.y);
            const start = await mapAt(page, point);
            const scales: number[] = [(await view(page)).scale];
            for (const delta of [-100, -100, -100, -100, 100, 100, 100, 100, 100, 100]) {
                const before = await mapAt(page, point);
                await page.mouse.wheel(0, delta);
                await expect
                    .poll(async () => (await view(page)).scale)
                    .not.toBe(scales[scales.length - 1]);
                const state = await view(page);
                scales.push(state.scale);
                const after = await mapAt(page, point);
                // The same map pixel is under the cursor, unless the pan limit moved the map.
                if (state.scale >= 1 && scales[scales.length - 2]! >= 1) {
                    expect(Math.floor(after.x)).toBe(Math.floor(before.x));
                    expect(Math.floor(after.y)).toBe(Math.floor(before.y));
                } else {
                    expect(after.x).toBeCloseTo(before.x, 4);
                    expect(after.y).toBeCloseTo(before.y, 4);
                }
            }
            // A map opens at one CSS pixel per map pixel (`ratio` device pixels). In: the next
            // steps up; out: back down through 1 to the overview steps.
            expect(scales.map((scale) => Number(scale.toFixed(4)))).toEqual([
                ratio,
                2,
                3,
                4,
                5,
                4,
                3,
                2,
                1,
                0.5,
                0.25,
            ]);
            expect(start.x).toBeGreaterThan(0);
        });

        test("keys 1 to 6 and 0 set the zoom", async ({ page }) => {
            await focusViewport(page);
            for (const [index, zoom] of KEY_ZOOMS.entries()) {
                await page.keyboard.press(String(index + 1));
                await expect.poll(async () => (await view(page)).scale).toBeCloseTo(zoom, 6);
            }
            await page.keyboard.press("0");
            const state = await view(page);
            const fit = expectedFit(state.width, state.height);
            await expect.poll(async () => (await view(page)).scale).toBeCloseTo(fit, 6);
            // Fit centres the map, to a whole device pixel from the steps of 1 up.
            const fitted = await view(page);
            expect(Math.abs(fitted.centreX - MAP_WIDTH / 2) * fitted.scale).toBeLessThanOrEqual(
                0.5,
            );
            expect(Math.abs(fitted.centreY - MAP_HEIGHT / 2) * fitted.scale).toBeLessThanOrEqual(
                0.5,
            );
            // Key 1 is 100%; the View menu's Fit does the same as 0.
            await page.keyboard.press("1");
            await expect.poll(async () => (await view(page)).scale).toBeCloseTo(1, 6);
            await page.getByRole("button", { name: "Fit" }).click();
            await expect.poll(async () => (await view(page)).scale).toBeCloseTo(fit, 6);
        });

        test("Space-drag and middle drag pan; a drag without either does not", async ({ page }) => {
            await focusViewport(page);
            await page.keyboard.press("1");
            const box = await hostBox(page);
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;
            const start = await view(page);

            // Space held: the primary button pans.
            await page.keyboard.down("Space");
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x + 60, y + 36, { steps: 6 });
            await page.mouse.up();
            await page.keyboard.up("Space");
            const spaced = await view(page);
            expect(spaced.centreX).toBeCloseTo(start.centreX - (60 * ratio) / spaced.scale, 3);
            expect(spaced.centreY).toBeCloseTo(start.centreY - (36 * ratio) / spaced.scale, 3);
            expect(spaced.zoom).toBe(start.zoom);

            // Middle button.
            await page.mouse.move(x, y);
            await page.mouse.down({ button: "middle" });
            await page.mouse.move(x - 40, y - 24, { steps: 4 });
            await page.mouse.up({ button: "middle" });
            const middle = await view(page);
            expect(middle.centreX).toBeCloseTo(spaced.centreX + (40 * ratio) / middle.scale, 3);
            expect(middle.centreY).toBeCloseTo(spaced.centreY + (24 * ratio) / middle.scale, 3);

            // The primary button alone pans nothing (the Hand tool is TE-016's).
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x + 50, y + 50, { steps: 4 });
            await page.mouse.up();
            const plain = await view(page);
            expect(plain.centreX).toBe(middle.centreX);
            expect(plain.centreY).toBe(middle.centreY);
        });

        test("shift+wheel pans sideways and the pan stops at the limit", async ({ page }) => {
            await focusViewport(page);
            const box = await hostBox(page);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            const start = await view(page);
            await page.keyboard.down("Shift");
            await page.mouse.wheel(0, 100);
            await page.keyboard.up("Shift");
            const moved = await view(page);
            // As a scroll would: wheel down moves the view right, the map left.
            expect(moved.centreX).toBeGreaterThan(start.centreX);
            expect(moved.centreY).toBe(start.centreY);

            // Far to the right: at least 32 device pixels of the map stay in the viewport.
            await page.keyboard.down("Shift");
            for (let notch = 0; notch < 60; notch += 1) await page.mouse.wheel(0, 400);
            await page.keyboard.up("Shift");
            await expect
                .poll(async () => {
                    const state = await view(page);
                    return originOf(state).x + MAP_WIDTH * state.scale;
                })
                .toBe(32);
        });

        test("zoom and centre are kept per map", async ({ page }) => {
            const { maps } = await pageCall<Loaded>(page, "load", { maps: 2 });
            await focusViewport(page);
            const box = await hostBox(page);
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;

            await page.keyboard.press("3");
            await expect.poll(async () => (await view(page)).scale).toBeCloseTo(4, 6);
            await page.keyboard.down("Space");
            await page.mouse.move(x, y);
            await page.mouse.down();
            await page.mouse.move(x - 80, y + 40, { steps: 5 });
            await page.mouse.up();
            await page.keyboard.up("Space");
            const first = await view(page);
            expect(first.mapId).toBe(maps[0]);

            await pageCall(page, "activate", maps[1]);
            const second = await view(page);
            expect(second.mapId).toBe(maps[1]);
            // A map that was not open has the view it opens with.
            expect(second.scale).toBeCloseTo(ratio, 6);
            await focusViewport(page);
            await page.keyboard.press("5");
            await expect.poll(async () => (await view(page)).scale).toBeCloseTo(16, 6);
            const secondZoomed = await view(page);

            await pageCall(page, "activate", maps[0]);
            const back = await view(page);
            expect(back.mapId).toBe(maps[0]);
            expect(back.scale).toBeCloseTo(first.scale, 9);
            expect(back.centreX).toBeCloseTo(first.centreX, 9);
            expect(back.centreY).toBeCloseTo(first.centreY, 9);

            await pageCall(page, "activate", maps[1]);
            const again = await view(page);
            expect(again.scale).toBeCloseTo(secondZoomed.scale, 9);
            expect(again.centreX).toBeCloseTo(secondZoomed.centreX, 9);
            expect(again.centreY).toBeCloseTo(secondZoomed.centreY, 9);
        });
    });
}

export function gridTests(ratio: number): void {
    test.describe(`grid and status at device pixel ratio ${ratio}`, () => {
        test.beforeEach(async ({ page }) => {
            await openEditor(page);
            expect(await page.evaluate(() => devicePixelRatio)).toBe(ratio);
        });

        test("grid lines land on cell edges in a canvas readback", async ({ page }) => {
            await pageCall(page, "load");
            await focusViewport(page);
            for (const key of ["1", "2", "3"]) {
                await page.keyboard.press(key);
                await overlayIdle(page);
                const state = await view(page);
                const lines = await gridLines(page);
                const origin = originOf(state);
                expect(lines.alpha).toBeGreaterThan(0);
                // Every cell edge on the canvas has a line, and nothing else has ink.
                expect(lines.columns).toEqual(
                    cellEdges(origin.x, state.scale, MAP.width, state.width),
                );
                expect(lines.rows).toEqual(
                    cellEdges(origin.y, state.scale, MAP.height, state.height),
                );
            }
        });

        test("the grid draws at 25% in the theme's ink", async ({ page }) => {
            await pageCall(page, "load");
            await focusViewport(page);
            await page.keyboard.press("1");
            await overlayIdle(page);
            const lines = await gridLines(page);
            // 25% of 255, in the dark theme's white.
            expect(lines.alpha).toBeGreaterThanOrEqual(63);
            expect(lines.alpha).toBeLessThanOrEqual(65);
        });

        test("the grid appears only from 4 device pixels per cell", async ({ page }) => {
            await pageCall(page, "load");
            const canvasLines = async (scale: number) => {
                await pageCall(page, "setScale", scale);
                await overlayIdle(page);
                const state = await view(page);
                expect(state.scale).toBeCloseTo(scale, 6);
                return gridLines(page);
            };
            // 16 map pixels × 1/4 = 4 device pixels: drawn. × 1/8 = 2: not.
            const quarter = await canvasLines(1 / 4);
            const state = await view(page);
            expect(quarter.columns).toEqual(
                cellEdges(originOf(state).x, 1 / 4, MAP.width, state.width),
            );
            expect(quarter.columns.length).toBe(MAP.width);
            const eighth = await canvasLines(1 / 8);
            expect(eighth.any).toBe(false);
            expect(eighth.columns).toEqual([]);
            expect(eighth.rows).toEqual([]);
            const half = await canvasLines(1 / 2);
            expect(half.columns.length).toBe(MAP.width);
        });

        test("Ctrl+G toggles the grid and the setting survives a reload", async ({ page }) => {
            await pageCall(page, "load");
            await focusViewport(page);
            await page.keyboard.press("1");
            await overlayIdle(page);
            expect((await gridLines(page)).any).toBe(true);
            expect(
                await page.evaluate(() => window.__ngneTest!.viewPreferences.getState().grid),
            ).toBe(true);

            await page.keyboard.press("Control+G");
            await overlayIdle(page);
            expect(
                await page.evaluate(() => window.__ngneTest!.viewPreferences.getState().grid),
            ).toBe(false);
            expect((await gridLines(page)).any).toBe(false);

            // The project stays clean: no history entry for a view setting (SPEC §3).
            expect(
                await page.evaluate(() => window.__ngneTest!.session.getState().history.canUndo),
            ).toBe(false);

            await page.reload();
            await openEditor(page);
            await pageCall(page, "load");
            await focusViewport(page);
            await page.keyboard.press("1");
            await overlayIdle(page);
            expect(
                await page.evaluate(() => window.__ngneTest!.viewPreferences.getState().grid),
            ).toBe(false);
            expect((await gridLines(page)).any).toBe(false);

            await page.keyboard.press("Control+G");
            await overlayIdle(page);
            expect((await gridLines(page)).any).toBe(true);
            await page.reload();
            await openEditor(page);
            expect(
                await page.evaluate(() => window.__ngneTest!.viewPreferences.getState().grid),
            ).toBe(true);
        });

        test("status fields show the hovered cell and tile, and blank off the map", async ({
            page,
        }) => {
            await pageCall(page, "load", { tiles: true });
            await focusViewport(page);
            await page.keyboard.press("1");
            await overlayIdle(page);
            const state = await view(page);
            const origin = originOf(state);
            const status = (id: string) => page.locator(`[data-status="${id}"]`);

            // The middle of cell (20, 15), which holds tile 1 of "Terrain" (class "grass").
            const over = await clientOf(page, {
                x: origin.x + (20 * MAP.tile + MAP.tile / 2) * state.scale,
                y: origin.y + (15 * MAP.tile + MAP.tile / 2) * state.scale,
            });
            await page.mouse.move(over.x, over.y);
            await expect(status("cell")).toHaveText("20, 15");
            await expect(status("tile")).toHaveText("Terrain#1 (grass)");
            await expect(status("zoom")).toHaveText("1×");
            await expect(status("size")).toHaveText(`${MAP.width} × ${MAP.height} cells`);

            // An empty cell: the cell shows, the tile does not.
            const empty = await clientOf(page, {
                x: origin.x + (21 * MAP.tile + 2) * state.scale,
                y: origin.y + (15 * MAP.tile + 2) * state.scale,
            });
            await page.mouse.move(empty.x, empty.y);
            await expect(status("cell")).toHaveText("21, 15");
            await expect(status("tile")).toHaveCount(0);

            // Beside the map, inside the viewport.
            expect(origin.x).toBeGreaterThan(8);
            const beside = await clientOf(page, { x: origin.x - 6, y: state.height / 2 });
            await page.mouse.move(beside.x, beside.y);
            await expect(status("cell")).toHaveText("");
            await expect(status("tile")).toHaveCount(0);
            // The field keeps its width while it is blank.
            const blank = await status("cell").boundingBox();
            await page.mouse.move(over.x, over.y);
            await expect(status("cell")).toHaveText("20, 15");
            expect((await status("cell").boundingBox())?.width).toBe(blank?.width);

            // Off the viewport.
            await page.mouse.move(2, 2);
            await expect(status("cell")).toHaveText("");
        });
    });
}
