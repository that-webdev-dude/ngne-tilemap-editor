import { readFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { pointsOnLine } from "../../src/core/raster/line";
import { TERRAIN_STROKES } from "../unit/support/terrainFixtures";
import type { TerrainStep } from "../unit/support/terrainFixtures";
import { expect, openEditor } from "./te-014-support";

// TE-044: the terrain brush (SPEC §5.3) on the TE-042 fixtures, loaded through the page module
// harness/te-044-page.ts: 8 × 8 maps of 24 px cells at 2×. Every brush and full-tile stroke of
// the fixtures, clicked with the real pointer (full tile with Ctrl held), gives its golden cell
// for cell with one history entry per click; a drag is one entry; Shift draws a line from the
// last painted point, Alt adds the 180° symmetric index, right click picks the terrain into the
// context bar. On an incomplete set the cells the filler cannot resolve are drawn with a 35%
// `--danger` fill on the overlay (read back) and stay unchanged.

const PAGE_MODULE = "/tests/e2e/harness/te-044-page.ts";
const FIXTURES = new URL("../fixtures/terrain/", import.meta.url);
const GRASS = 1;
const SAND = 2;
const WATER = 3;
const SIZE = 8;

function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const history = (page: Page) => call<{ undo: number; label: string | null }>(page, "history");
const gids = (page: Page) => call<number[]>(page, "gids");
const vertices = (page: Page) => call<number[]>(page, "vertices");
const edges = (page: Page) => call<Record<string, number>>(page, "edges");
const swatch = (page: Page, terrain: number) =>
    page.locator(`[data-context-content="terrain-brush"] [data-terrain-swatch="${terrain}"]`);

const golden = (file: string): number[] =>
    JSON.parse(readFileSync(new URL(file, FIXTURES), "utf8")).layers[0].data;

async function open(page: Page, fixture: string, map = `${fixture}.tmj`): Promise<void> {
    await openEditor(page);
    await call(page, "load", fixture, map);
    await expect(page.locator('[data-context-content="terrain-brush"]')).toBeVisible();
}

/** Clicks the swatch of `terrain` (0: Erase) in the context bar. */
async function choose(page: Page, terrain: number): Promise<void> {
    await swatch(page, terrain).click();
    await expect(swatch(page, terrain)).toHaveAttribute("aria-pressed", "true");
}

type Modifier = "Shift" | "Control" | "Alt";

/** Moves the pointer to map point `(cx, cy)` (cells, with fraction) in one event. */
async function moveTo(page: Page, cx: number, cy: number): Promise<void> {
    const at = await call<{ x: number; y: number }>(page, "client", cx, cy);
    await page.mouse.move(at.x, at.y, { steps: 1 });
}

/** Clicks map point `(cx, cy)` with `modifiers` held. */
async function clickAt(
    page: Page,
    cx: number,
    cy: number,
    modifiers: Modifier[] = [],
    button: "left" | "right" = "left",
): Promise<void> {
    await moveTo(page, cx, cy);
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.down({ button });
    await page.mouse.up({ button });
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key);
}

/** A vertex is clicked a quarter cell inside the cell it is the top-left corner of. */
const vertex = (x: number, y: number): [number, number] => [x + 0.25, y + 0.25];

/** Where a step of a stroke is clicked. */
function stepPoint(step: Exclude<TerrainStep, { kind: "fill" }>): [number, number] {
    if (step.kind === "corner") return vertex(step.x, step.y);
    if (step.kind === "tile") return [step.x + 0.5, step.y + 0.5];
    const along = { top: [0.5, 0.1], right: [0.9, 0.5], bottom: [0.5, 0.9], left: [0.1, 0.5] };
    const [fx, fy] = along[step.side];
    return [step.x + fx!, step.y + fy!];
}

/** Whether the overlay holds `--accent` at map point `(cx, cy)` moved by `(dx, dy)` device px. */
async function accentAt(page: Page, cx: number, cy: number, dx = 0, dy = 0): Promise<boolean> {
    const colour = await call<number[]>(page, "token", "--accent");
    const [r, g, b, a] = await call<number[]>(page, "overlayAt", cx, cy, dx, dy);
    return (
        Math.abs(r! - colour[0]!) <= 3 &&
        Math.abs(g! - colour[1]!) <= 3 &&
        Math.abs(b! - colour[2]!) <= 3 &&
        a === 255
    );
}

/** A vertex picture: `terrain` at the listed vertices, `rest` at every other. */
function picture(terrain: number, at: [number, number][], rest = GRASS): number[] {
    const out = new Array<number>((SIZE + 1) * (SIZE + 1)).fill(rest);
    for (const [x, y] of at) out[y * (SIZE + 1) + x] = terrain;
    return out;
}

test.describe("TE-044 terrain brush", () => {
    for (const stroke of TERRAIN_STROKES.filter((each) => each.name !== "fill")) {
        test(`${stroke.fixture} ${stroke.name} gives its golden`, async ({ page }) => {
            await open(page, stroke.fixture, stroke.map);
            const before = await history(page);
            let entries = before.undo;
            for (const step of stroke.steps) {
                if (step.kind === "fill") throw new Error("not a brush step");
                await choose(page, step.terrain);
                const [cx, cy] = stepPoint(step);
                await clickAt(page, cx, cy, step.kind === "tile" ? ["Control"] : []);
                entries++;
                await expect
                    .poll(() => history(page))
                    .toEqual({ undo: entries, label: "Terrain Brush" });
            }
            expect(await gids(page)).toEqual(golden(stroke.golden));
        });
    }

    test("a drag paints continuously as one entry; undo restores the layer", async ({ page }) => {
        await open(page, "corner-complete");
        const original = await gids(page);
        await choose(page, SAND);
        await moveTo(page, ...vertex(1, 6));
        await page.mouse.down();
        await moveTo(page, ...vertex(2, 6));
        await moveTo(page, ...vertex(3, 6));
        // A jump of two vertices: the one between is painted too.
        await moveTo(page, ...vertex(5, 6));
        await page.mouse.up();
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        expect(await vertices(page)).toEqual(
            picture(SAND, [
                [1, 6],
                [2, 6],
                [3, 6],
                [4, 6],
                [5, 6],
            ]),
        );
        await call(page, "undo");
        expect(await gids(page)).toEqual(original);
    });

    test("an edge drag paints the edges it crosses", async ({ page }) => {
        await open(page, "edge-complete");
        await choose(page, SAND);
        // The left edge of cell (2,3), then across the cells to its right.
        await moveTo(page, 2.1, 3.5);
        await page.mouse.down();
        await moveTo(page, 3.5, 3.5);
        await moveTo(page, 5.5, 3.5);
        await page.mouse.up();
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        const found = await edges(page);
        const sand = Object.entries(found)
            .filter(([, terrain]) => terrain !== GRASS)
            .map(([edge, terrain]) => `${edge}=${terrain}`)
            .sort();
        expect(sand).toEqual(["1,3:right=2", "2,3:right=2", "3,3:right=2", "4,3:right=2"]);
    });

    test("Shift draws a line from the last painted point; the first only sets it", async ({
        page,
    }) => {
        await open(page, "corner-complete");
        await choose(page, SAND);
        // A point painted, then the tool selected again: Tiled forgets the start.
        await clickAt(page, ...vertex(6, 6));
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        await call(page, "undo");
        expect(await call(page, "selectTool", "stamp")).toBe(true);
        expect(await call(page, "selectTool", "terrain")).toBe(true);
        await expect(swatch(page, SAND)).toHaveAttribute("aria-pressed", "true");
        // No point painted since the tool was selected: this Shift+click sets the start.
        await clickAt(page, ...vertex(1, 1), ["Shift"]);
        await page.mouse.move(0, 0);
        expect(await history(page)).toEqual({ undo: 0, label: null });
        await clickAt(page, ...vertex(3, 1), ["Shift"]);
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        expect(await vertices(page)).toEqual(
            picture(SAND, [
                [1, 1],
                [2, 1],
                [3, 1],
            ]),
        );
        // From the end of that line, without diagonal steps (Tiled's thin line).
        await clickAt(page, ...vertex(5, 2), ["Shift"]);
        await expect.poll(() => history(page)).toEqual({ undo: 2, label: "Terrain Brush" });
        const line = pointsOnLine({ x: 3, y: 1 }, { x: 5, y: 2 }, true);
        expect(line).toHaveLength(4);
        expect(await vertices(page)).toEqual(
            picture(SAND, [[1, 1], [2, 1], ...line.map(({ x, y }): [number, number] => [x, y])]),
        );
    });

    test("Alt paints the 180° symmetric index too, in one entry", async ({ page }) => {
        await open(page, "corner-complete");
        await choose(page, SAND);
        await clickAt(page, ...vertex(2, 3), ["Alt"]);
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        // Vertex (2,3) is the top-left corner of cell (2,3); its turn is the bottom-right
        // corner of cell (8 − 2 − 1, 8 − 3 − 1) = (5,4): vertex (6,5).
        expect(await vertices(page)).toEqual(
            picture(SAND, [
                [2, 3],
                [6, 5],
            ]),
        );
    });

    test("Full tile paints whole cells and Ctrl inverts it while held", async ({ page }) => {
        await open(page, "corner-complete");
        await choose(page, SAND);
        await page
            .locator('[data-context-content="terrain-brush"] [data-tool-option="fullTile"]')
            .click();
        await clickAt(page, 2.5, 5.5);
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        expect(await vertices(page)).toEqual(
            picture(SAND, [
                [2, 5],
                [3, 5],
                [2, 6],
                [3, 6],
            ]),
        );
        // With Ctrl, one corner again.
        await clickAt(page, ...vertex(6, 1), ["Control"]);
        await expect.poll(() => history(page)).toEqual({ undo: 2, label: "Terrain Brush" });
        expect(await vertices(page)).toEqual(
            picture(SAND, [
                [2, 5],
                [3, 5],
                [2, 6],
                [3, 6],
                [6, 1],
            ]),
        );
    });

    test("right click picks the terrain under the pointer into the context bar", async ({
        page,
    }) => {
        await open(page, "corner-incomplete", "corner-incomplete-brush.golden.tmj");
        await choose(page, GRASS);
        // The golden has Water at vertices (4,4) and (5,4), Sand around them.
        await clickAt(page, ...vertex(4, 4), [], "right");
        await expect(swatch(page, WATER)).toHaveAttribute("aria-pressed", "true");
        await clickAt(page, ...vertex(4, 3), [], "right");
        await expect(swatch(page, SAND)).toHaveAttribute("aria-pressed", "true");
        await clickAt(page, ...vertex(1, 1), [], "right");
        await expect(swatch(page, GRASS)).toHaveAttribute("aria-pressed", "true");
        expect(await history(page)).toEqual({ undo: 0, label: null });
    });

    test("right click on an empty cell picks Erase", async ({ page }) => {
        await open(page, "corner-incomplete", "corner-incomplete-fill.tmj");
        await choose(page, SAND);
        // Row 4 holds the fill fixture's empty cells.
        await clickAt(page, ...vertex(3, 4), [], "right");
        await expect(swatch(page, 0)).toHaveAttribute("aria-pressed", "true");
    });

    test("the tile selection does not clip the brush", async ({ page }) => {
        await open(page, "corner-complete");
        await call(page, "selectRect", { x: 0, y: 0, width: 2, height: 2 });
        await choose(page, SAND);
        await clickAt(page, ...vertex(4, 4));
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        expect(await vertices(page)).toEqual(picture(SAND, [[4, 4]]));
    });

    test("cells that cannot be resolved are drawn red and left unchanged", async ({ page }) => {
        // Water beside the empty strip of row 4 on the incomplete corner set: the empty cells'
        // corners want no terrain, which no terrain of the set reaches.
        await open(page, "corner-incomplete", "corner-incomplete-fill.tmj");
        const before = await gids(page);
        await choose(page, WATER);
        const danger = await call<number[]>(page, "token", "--danger");
        const red = async (x: number, y: number) => {
            const [r, g, b, a] = await call<number[]>(page, "overlayCell", x, y);
            return (
                Math.abs(r! - danger[0]!) <= 3 &&
                Math.abs(g! - danger[1]!) <= 3 &&
                Math.abs(b! - danger[2]!) <= 3 &&
                Math.abs(a! - Math.round(0.35 * 255)) <= 2
            );
        };
        const invalid: [number, number][] = [
            [1, 4],
            [2, 4],
            [3, 4],
        ];
        // The preview shows them before the press, as Tiled's brush does.
        await moveTo(page, ...vertex(3, 4));
        for (const [x, y] of invalid) await expect.poll(() => red(x, y)).toBe(true);
        expect(await call<number[]>(page, "overlayCell", 6, 1)).toEqual([0, 0, 0, 0]);
        expect(await call<number[]>(page, "overlayCell", 5, 4)).toEqual([0, 0, 0, 0]);

        // The press's own step leaves them invalid: drawn while the button is held.
        await page.mouse.down();
        for (const [x, y] of invalid) await expect.poll(() => red(x, y)).toBe(true);
        await page.mouse.up();
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        const after = await gids(page);
        for (const [x, y] of invalid) expect(after[y * SIZE + x]).toBe(before[y * SIZE + x]);
        // The cells around the vertex above the strip took Water.
        expect(after[3 * SIZE + 2]).not.toBe(before[3 * SIZE + 2]);
        expect(after[3 * SIZE + 3]).not.toBe(before[3 * SIZE + 3]);
    });
    test("the overlay marks the corner, edge or cell painted, and the symmetric one", async ({
        page,
    }) => {
        const accent = (cx: number, cy: number, dx = 0, dy = 0) => accentAt(page, cx, cy, dx, dy);
        await open(page, "corner-complete");
        await choose(page, SAND);
        // A 6 px square centred on vertex (3,3).
        await moveTo(page, ...vertex(3, 3));
        await expect.poll(() => accent(3, 3, 2, 2)).toBe(true);
        expect(await accent(3, 3, -3, -3)).toBe(true);
        expect(await accent(3, 3, 4, 4)).toBe(false);
        expect(await accent(5, 5, 1, 1)).toBe(false);
        // With Alt, the turned vertex (8 − 3, 8 − 3) = (5,5) too.
        await page.keyboard.down("Alt");
        await expect.poll(() => accent(5, 5, 1, 1)).toBe(true);
        await page.keyboard.up("Alt");
        // With Ctrl, full tile mode: the cell's 1 px outline, and the toggle shows it.
        const toggle = page.locator(
            '[data-context-content="terrain-brush"] [data-tool-option="fullTile"]',
        );
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await page.keyboard.down("Control");
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect.poll(() => accent(3.5, 3, 0, 0)).toBe(true);
        expect(await accent(3.5, 3, 0, 2)).toBe(false);
        await page.keyboard.up("Control");
        await expect(toggle).toHaveAttribute("aria-pressed", "false");

        // An edge: a 2 px bar along the top edge of cell (2,3).
        await open(page, "edge-complete");
        await moveTo(page, 2.5, 3.1);
        await expect.poll(() => accent(2.5, 3, 0, 1)).toBe(true);
        expect(await accent(2.5, 3, 0, 2)).toBe(false);
    });

    test("Shift pressed during a drag ends its painting", async ({ page }) => {
        await open(page, "corner-complete");
        await choose(page, SAND);
        await moveTo(page, ...vertex(1, 6));
        await page.mouse.down();
        await moveTo(page, ...vertex(2, 6));
        await page.keyboard.down("Shift");
        await moveTo(page, ...vertex(4, 6));
        await page.keyboard.up("Shift");
        await moveTo(page, ...vertex(6, 6));
        await page.mouse.up();
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        expect(await vertices(page)).toEqual(
            picture(SAND, [
                [1, 6],
                [2, 6],
            ]),
        );
    });

    test("Ctrl let go during an edge drag goes on with the edge under the pointer", async ({
        page,
    }) => {
        await open(page, "edge-complete");
        await choose(page, SAND);
        // Hovered on the top edge of cell (2,3), pressed in full tile mode, Ctrl let go.
        await moveTo(page, 2.5, 3.1);
        await page.keyboard.down("Control");
        await page.mouse.down();
        await page.keyboard.up("Control");
        // The drag's target is that edge again: its 2 px bar, not the cell's 1 px outline.
        await expect.poll(() => accentAt(page, 2.5, 3, 0, 1)).toBe(true);
        await page.mouse.up();
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        expect((await edges(page))["2,2:bottom"]).toBe(SAND);
    });

    test("Escape cancels a stroke and keeps the line start it had", async ({ page }) => {
        await open(page, "corner-complete");
        await choose(page, SAND);
        await clickAt(page, ...vertex(1, 1));
        await expect.poll(() => history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        await moveTo(page, ...vertex(5, 5));
        await page.mouse.down();
        await page.keyboard.press("Escape");
        await page.mouse.up();
        expect(await history(page)).toEqual({ undo: 1, label: "Terrain Brush" });
        await clickAt(page, ...vertex(3, 1), ["Shift"]);
        await expect.poll(() => history(page)).toEqual({ undo: 2, label: "Terrain Brush" });
        expect(await vertices(page)).toEqual(
            picture(SAND, [
                [1, 1],
                [2, 1],
                [3, 1],
            ]),
        );
    });
});
