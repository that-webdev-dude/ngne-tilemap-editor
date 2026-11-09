import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { floodRegion, regionBounds } from "../../src/core/fill";
import { TERRAIN_STROKES } from "../unit/support/terrainFixtures";
import { expect, openEditor } from "./te-014-support";

// TE-045: the Terrain fill mode of the bucket and the shape fill (SPEC §5.4) on the TE-042
// fixtures, loaded through the TE-044 page module (8 × 8 maps of 24 px cells at 2×). Every
// fill stroke of the fixtures, clicked with the bucket and dragged with the rectangle fill over
// the same region, gives its golden cell for cell with one history entry per step, and undo
// restores the map. The fill mode is kept per tool across tool switches; the shape fill's
// Rectangle and Ellipse share it (Tiled's one `ShapeFillTool`).

const PAGE_MODULE = "/tests/e2e/harness/te-044-page.ts";
const FIXTURES = new URL("../fixtures/terrain/", import.meta.url);
const FILL_STROKES = TERRAIN_STROKES.filter((stroke) => stroke.name === "fill");

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const history = (page: Page) => call<{ undo: number; label: string | null }>(page, "history");
const gids = (page: Page) => call<number[]>(page, "gids");

const tmj = (file: string): { width: number; height: number; data: number[] } => {
    const map = JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8"));
    return { width: map.width, height: map.height, data: map.layers[0].data };
};

const fillBar = (page: Page) => page.locator('[data-context-content="fill"]');
const fillMode = (page: Page, mode: "Tile" | "Terrain") =>
    fillBar(page).locator('[data-tool-option="fillMode"]').getByRole("radio", { name: mode });

async function open(page: Page, fixture: string, map: string): Promise<void> {
    await openEditor(page);
    await call(page, "load", fixture, map);
    await expect(page.locator('[data-context-content="terrain-brush"]')).toBeVisible();
}

/** Selects tool `id` and sets its fill mode to `mode` in the context bar. */
async function fillWith(page: Page, id: string, mode: "Tile" | "Terrain"): Promise<void> {
    expect(await call(page, "selectTool", id)).toBe(true);
    await fillMode(page, mode).click();
    await expect(fillMode(page, mode)).toBeChecked();
}

/** Moves the pointer to the middle of cell `(x, y)`. */
async function moveToCell(page: Page, x: number, y: number): Promise<void> {
    const at = await call<{ x: number; y: number }>(page, "client", x + 0.5, y + 0.5);
    await page.mouse.move(at.x, at.y, { steps: 1 });
}

/**
 * The rectangle a step fills: the cells 4-connected to `(x, y)` that are like it, which the
 * fixtures keep rectangular (one-cell-high strips and single cells).
 */
function stepRect(cells: number[], width: number, height: number, x: number, y: number) {
    const region = floodRegion(
        (cx, cy) => cells[cy * width + cx]!,
        { x, y },
        {
            x: 0,
            y: 0,
            width,
            height,
        },
    );
    const bounds = regionBounds(region)!;
    const area = region.reduce((sum, span) => sum + span.end - span.start, 0);
    expect(area).toBe(bounds.width * bounds.height);
    return bounds;
}

test.describe("TE-045 terrain fill mode", () => {
    for (const stroke of FILL_STROKES) {
        test(`${stroke.fixture} fill with the bucket gives its golden; undo restores`, async ({
            page,
        }) => {
            await open(page, stroke.fixture, stroke.map);
            const original = await gids(page);
            expect(original).toEqual(tmj(stroke.map).data);
            await fillWith(page, "bucket", "Terrain");
            let entries = 0;
            for (const step of stroke.steps) {
                if (step.kind !== "fill") throw new Error("not a fill step");
                await moveToCell(page, step.x, step.y);
                await page.mouse.down();
                await page.mouse.up();
                entries++;
                await expect
                    .poll(() => history(page))
                    .toEqual({ undo: entries, label: "Bucket Fill" });
            }
            expect(await gids(page)).toEqual(tmj(stroke.golden).data);
            for (let i = 0; i < entries; i++) expect(await call(page, "undo")).toBe(true);
            expect(await gids(page)).toEqual(original);
        });

        test(`${stroke.fixture} fill with the shape fill gives its golden; undo restores`, async ({
            page,
        }) => {
            await open(page, stroke.fixture, stroke.map);
            const { width, height } = tmj(stroke.map);
            const original = await gids(page);
            await fillWith(page, "shapeFill", "Terrain");
            let entries = 0;
            for (const step of stroke.steps) {
                if (step.kind !== "fill") throw new Error("not a fill step");
                const rect = stepRect(await gids(page), width, height, step.x, step.y);
                await moveToCell(page, rect.x, rect.y);
                await page.mouse.down();
                await moveToCell(page, rect.x + rect.width - 1, rect.y + rect.height - 1);
                await page.mouse.up();
                entries++;
                await expect
                    .poll(() => history(page))
                    .toEqual({ undo: entries, label: "Rectangle Fill" });
            }
            expect(await gids(page)).toEqual(tmj(stroke.golden).data);
            for (let i = 0; i < entries; i++) expect(await call(page, "undo")).toBe(true);
            expect(await gids(page)).toEqual(original);
        });
    }

    test("the ellipse fill in Terrain mode gives the golden", async ({ page }) => {
        // Single-cell regions: the ellipse of a 1 × 1 drag is its cell.
        const stroke = FILL_STROKES.find((each) => each.fixture === "edge-complete")!;
        await open(page, stroke.fixture, stroke.map);
        await fillWith(page, "shapeFillEllipse", "Terrain");
        let entries = 0;
        for (const step of stroke.steps) {
            if (step.kind !== "fill") throw new Error("not a fill step");
            await moveToCell(page, step.x, step.y);
            await page.mouse.down();
            await page.mouse.up();
            entries++;
            await expect
                .poll(() => history(page))
                .toEqual({ undo: entries, label: "Ellipse Fill" });
        }
        expect(await gids(page)).toEqual(tmj(stroke.golden).data);
    });

    test("the tile selection clips what a terrain shape fill writes", async ({ page }) => {
        // corner-complete: the empty strip of row 3, cells 1–6; only cells 1–3 are selected.
        const stroke = FILL_STROKES.find((each) => each.fixture === "corner-complete")!;
        await open(page, stroke.fixture, stroke.map);
        const original = await gids(page);
        const golden = tmj(stroke.golden).data;
        await call(page, "selectRect", { x: 1, y: 3, width: 3, height: 1 });
        await fillWith(page, "shapeFill", "Terrain");
        await moveToCell(page, 1, 3);
        await page.mouse.down();
        await moveToCell(page, 6, 3);
        await page.mouse.up();
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Rectangle Fill" });
        const expected = original.map((gid, i) => {
            const x = i % 8;
            return Math.floor(i / 8) === 3 && x >= 1 && x <= 3 ? golden[i]! : gid;
        });
        expect(expected).not.toEqual(original);
        expect(await gids(page)).toEqual(expected);
    });

    test("the fill mode persists per tool across tool switches", async ({ page }) => {
        const [stroke] = FILL_STROKES;
        await open(page, stroke!.fixture, stroke!.map);

        // Tile by default; Terrain shows the terrain set and terrain pickers of the brush.
        expect(await call(page, "selectTool", "bucket")).toBe(true);
        await expect(fillMode(page, "Tile")).toBeChecked();
        await expect(fillBar(page).locator("[data-terrain-brush-set]")).toHaveCount(0);
        await fillWith(page, "bucket", "Terrain");
        await expect(fillBar(page).locator("[data-terrain-brush-set]")).toBeVisible();
        await expect(fillBar(page).locator("[data-terrain-swatch]").first()).toBeVisible();

        // The bucket keeps Terrain through another tool; the shape fill has its own mode.
        expect(await call(page, "selectTool", "stamp")).toBe(true);
        expect(await call(page, "selectTool", "bucket")).toBe(true);
        await expect(fillMode(page, "Terrain")).toBeChecked();
        expect(await call(page, "selectTool", "shapeFill")).toBe(true);
        await expect(fillMode(page, "Tile")).toBeChecked();

        // Rectangle and Ellipse are one tool to the fill mode.
        await fillWith(page, "shapeFill", "Terrain");
        const variants = fillBar(page).locator('[data-tool-variant-choice="shapeFill"]');
        await variants.getByRole("radio", { name: "Ellipse" }).click();
        await expect(page.locator('[data-context-tool="shapeFillEllipse"]')).toBeVisible();
        await expect(fillMode(page, "Terrain")).toBeChecked();
        await fillMode(page, "Tile").click();
        await variants.getByRole("radio", { name: "Rectangle" }).click();
        await expect(page.locator('[data-context-tool="shapeFill"]')).toBeVisible();
        await expect(fillMode(page, "Tile")).toBeChecked();

        // The terrain brush and back: the bucket is still in Terrain mode.
        expect(await call(page, "selectTool", "terrain")).toBe(true);
        expect(await call(page, "selectTool", "bucket")).toBe(true);
        await expect(fillMode(page, "Terrain")).toBeChecked();
    });
});
