import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LayerState, Step } from "./harness/te-034-page";
import * as live from "./te-013-support";
import * as chunk from "./te-015-support";

// TE-034: the layer commands change the viewport as the compositor reference does, in both
// tiers (SPEC §7.2, §15). Each step runs through the app's layer functions on its history; the
// canvas is then read back and compared with `core/compositor` by the TE-013 (live tier) and
// TE-015 (chunk tier) page modules, which apply groups' values (FORMAT §2.5) and, when it is on,
// Highlight Current Layer. A hash of the canvas shows that each step changed the picture.
//
// The live scene (tests/support/viewportScene.ts) has Base (1), Faint (2, opacity 128) and Far
// (3, parallax 0.5, offset 3, −2); its parallax origin lies 8 and 6 map pixels from the view
// centre, so parallax factors of 0, 0.5, 1, 2 and 4 shift layers by whole map pixels. The chunk
// scene (harness/te-015-page.ts) has the same three layers over 256 × 128 cells.

const PAGE_MODULE = "/tests/e2e/harness/te-034-page.ts";
const TOLERANCE = 2;
/**
 * With Highlight Current Layer every layer but the current one is translucent, so up to three
 * translucent tiles meet at a pixel (Base's own tiles overlap where a tileset with a tile offset
 * reaches into the row above, then Faint). The compositor's blend (Aseprite's, blend.ts)
 * truncates towards the backdrop at each of them; the GPU rounds. Measured: 8 of 245,760 pixels
 * differ by 3, none by more.
 */
const HIGHLIGHT_TOLERANCE = 3;
const ORIGIN = { originX: 37, originY: 23 };
const OPAQUE_BACKGROUND = 0x203040ff;

function pageCall<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
    const module = JSON.stringify(PAGE_MODULE);
    return page.evaluate<T>(
        `import(${module}).then((m) => m[${JSON.stringify(name)}](...${JSON.stringify(args)}))`,
    );
}

const act = (page: Page, step: Step) => pageCall<LayerState>(page, "act", step);
const canvasHash = (page: Page) => pageCall<string>(page, "canvasHash");

/** A step, the tree it leaves and whether the picture changes. */
interface Case {
    step: Step;
    tree: string;
    changes: boolean;
}

/** Steps of the live scene: hiding, opacity, offset, parallax and group nesting. */
const LIVE_CASES: Case[] = [
    {
        step: { kind: "set", ids: [1], values: { visible: false } },
        tree: "Base(hidden),Faint,Far",
        changes: true,
    },
    {
        step: { kind: "set", ids: [1], values: { visible: true } },
        tree: "Base,Faint,Far",
        changes: true,
    },
    {
        step: { kind: "set", ids: [3], values: { opacity: 96 } },
        tree: "Base,Faint,Far",
        changes: true,
    },
    {
        step: { kind: "set", ids: [2], values: { offsetX: 5, offsetY: 7 } },
        tree: "Base,Faint,Far",
        changes: true,
    },
    {
        step: { kind: "set", ids: [2], values: { parallaxX: 0, parallaxY: 0 } },
        tree: "Base,Faint,Far",
        changes: true,
    },
    // A new group is neutral: nothing moves.
    { step: { kind: "group", ids: [2, 3] }, tree: "Base,Group 1[Faint,Far]", changes: false },
    {
        step: { kind: "set", ids: [4], values: { opacity: 128 } },
        tree: "Base,Group 1[Faint,Far]",
        changes: true,
    },
    {
        step: { kind: "set", ids: [4], values: { offsetX: -4, offsetY: 2 } },
        tree: "Base,Group 1[Faint,Far]",
        changes: true,
    },
    {
        step: { kind: "set", ids: [4], values: { parallaxX: 2, parallaxY: 2 } },
        tree: "Base,Group 1[Faint,Far]",
        changes: true,
    },
    {
        step: { kind: "set", ids: [4], values: { visible: false } },
        // The group's children keep their own visibility; the group hides them.
        tree: "Base,Group 1[Faint,Far]",
        changes: true,
    },
    {
        step: { kind: "set", ids: [4], values: { visible: true } },
        tree: "Base,Group 1[Faint,Far]",
        changes: true,
    },
    // Far moves up out of the group, above it, and loses the group's values; down again, it
    // enters the group at its top (Tiled's MoveLayer).
    { step: { kind: "move", id: 3, step: 1 }, tree: "Base,Group 1[Faint],Far", changes: true },
    { step: { kind: "move", id: 3, step: -1 }, tree: "Base,Group 1[Faint,Far]", changes: true },
    // Ungrouped, the children keep their own values only.
    { step: { kind: "ungroup", ids: [4] }, tree: "Base,Faint,Far", changes: true },
];

test.describe("live tier", () => {
    test("hiding, opacity, offset, parallax and group nesting equal the compositor", async ({
        page,
    }) => {
        await live.openEditor(page);
        const geometry = await live.loadScene(page, {
            zoom: 2,
            background: OPAQUE_BACKGROUND,
            ...ORIGIN,
        });
        let before = await canvasHash(page);
        for (const { step, tree, changes } of LIVE_CASES) {
            const after = await act(page, step);
            expect(after.tree, JSON.stringify(step)).toBe(tree);
            const result = await live.compare(page, geometry, TOLERANCE);
            expect(result.first, JSON.stringify(step)).toEqual([]);
            expect(result.mismatches).toBe(0);
            expect(result.compared).toBeGreaterThan(0);
            expect(await page.evaluate(() => window.__ngneTest!.viewport!.stats.tier)).toBe("live");
            const hash = await canvasHash(page);
            expect(hash !== before, JSON.stringify(step)).toBe(changes);
            before = hash;
        }
    });

    test("Highlight Current Layer draws the other layers at 25%", async ({ page }) => {
        await live.openEditor(page);
        const geometry = await live.loadScene(page, {
            zoom: 2,
            background: OPAQUE_BACKGROUND,
            ...ORIGIN,
        });
        const plain = await canvasHash(page);
        await act(page, { kind: "select", id: 2 });
        // Shift+H with the viewport focused (DESIGN §10.3).
        await page.locator("[data-viewport]").focus();
        await page.keyboard.press("Shift+H");
        const state = await pageCall<LayerState>(page, "state");
        expect(state.highlight).toEqual({ layerId: 2, factor: 0.25 });
        const highlighted = await live.compare(page, geometry, HIGHLIGHT_TOLERANCE);
        expect(highlighted.first).toEqual([]);
        expect(highlighted.mismatches).toBe(0);
        expect(await canvasHash(page)).not.toBe(plain);
        // The current layer inside a group: the group's other children are dimmed, the group's
        // own current layer not; a current group keeps all its children.
        await act(page, { kind: "group", ids: [2, 3] });
        for (const id of [3, 4]) {
            await act(page, { kind: "select", id });
            const result = await live.compare(page, geometry, HIGHLIGHT_TOLERANCE);
            expect(result.first, `active ${id}`).toEqual([]);
            expect(result.mismatches).toBe(0);
        }
        await page.keyboard.press("Shift+H");
        expect((await pageCall<LayerState>(page, "state")).highlight).toBeNull();
    });

    test("the highlight setting survives a reload", async ({ page }) => {
        await live.openEditor(page);
        await page.locator("[data-viewport]").focus();
        await page.keyboard.press("Shift+H");
        await page.reload();
        await live.openEditor(page);
        const geometry = await live.loadScene(page, {
            zoom: 2,
            background: OPAQUE_BACKGROUND,
            ...ORIGIN,
        });
        // The scene's active layer is Base: Faint and Far are drawn at 25%.
        const state = await pageCall<LayerState>(page, "state");
        expect(state.highlight).toEqual({ layerId: 1, factor: 0.25 });
        const result = await live.compare(page, geometry, HIGHLIGHT_TOLERANCE);
        expect(result.first).toEqual([]);
        expect(result.mismatches).toBe(0);
        const highlighted = await canvasHash(page);
        await act(page, { kind: "highlight", on: false });
        expect(await canvasHash(page)).not.toBe(highlighted);
    });
});

/** Steps of the chunk scene. A copy of Base keeps the view above the live tier's limit. */
const CHUNK_CASES: Case[] = [
    // The copy draws over Base: its translucent pixels show twice.
    { step: { kind: "duplicate", ids: [1] }, tree: "Base,Base,Faint,Far", changes: true },
    {
        step: { kind: "set", ids: [1], values: { visible: false } },
        tree: "Base(hidden),Base,Faint,Far",
        changes: true,
    },
    {
        step: { kind: "set", ids: [1], values: { visible: true } },
        tree: "Base,Base,Faint,Far",
        changes: true,
    },
    {
        step: { kind: "set", ids: [4], values: { opacity: 160 } },
        tree: "Base,Base,Faint,Far",
        changes: true,
    },
    {
        step: { kind: "set", ids: [2], values: { offsetX: 8, offsetY: -3 } },
        tree: "Base,Base,Faint,Far",
        changes: true,
    },
    {
        step: { kind: "set", ids: [2], values: { parallaxX: 2, parallaxY: 2 } },
        tree: "Base,Base,Faint,Far",
        changes: true,
    },
    { step: { kind: "group", ids: [2, 3] }, tree: "Base,Base,Group 1[Faint,Far]", changes: false },
    {
        step: { kind: "set", ids: [5], values: { opacity: 200, offsetX: 4, offsetY: -2 } },
        tree: "Base,Base,Group 1[Faint,Far]",
        changes: true,
    },
    {
        step: { kind: "set", ids: [5], values: { parallaxX: 2, parallaxY: 2 } },
        tree: "Base,Base,Group 1[Faint,Far]",
        changes: true,
    },
    // The copy of Base moves up into the group and takes its values.
    { step: { kind: "move", id: 4, step: 1 }, tree: "Base,Group 1[Base,Faint,Far]", changes: true },
    // Highlight Current Layer, current layer Base (1): the group's layers at 25%.
    { step: { kind: "highlight", on: true }, tree: "Base,Group 1[Base,Faint,Far]", changes: true },
    { step: { kind: "select", id: 5 }, tree: "Base,Group 1[Base,Faint,Far]", changes: true },
    { step: { kind: "highlight", on: false }, tree: "Base,Group 1[Base,Faint,Far]", changes: true },
];

test.describe("chunk tier", () => {
    test("hiding, opacity, offset, parallax, group nesting and the highlight equal the chunk reference", async ({
        playwright,
        launchOptions,
        baseURL,
    }) => {
        test.setTimeout(180_000);
        const { page, browser } = await chunk.openAtRatio(
            playwright.chromium,
            launchOptions,
            baseURL,
            1,
        );
        try {
            const geometry = await chunk.loadScene(page, {
                scale: 0.25,
                background: OPAQUE_BACKGROUND,
                ...ORIGIN,
            });
            await act(page, { kind: "select", id: 1 });
            let before = await canvasHash(page);
            for (const { step, tree, changes } of CHUNK_CASES) {
                const after = await act(page, step);
                expect(after.tree, JSON.stringify(step)).toBe(tree);
                // The change plans the chunk sets again; the first frame starts the build.
                await page.evaluate(() => window.__ngneTest!.viewport!.renderNow());
                await chunk.chunksReady(page);
                const tolerance = after.highlight ? HIGHLIGHT_TOLERANCE : TOLERANCE;
                const result = await chunk.compare(page, geometry, tolerance);
                expect(result.tier, JSON.stringify(step)).toBe("chunk");
                expect(result.chunkQuads).toBeGreaterThan(0);
                expect(result.first, JSON.stringify(step)).toEqual([]);
                expect(result.mismatches).toBe(0);
                expect(
                    result.compared,
                    JSON.stringify({ step, ...result, first: undefined }),
                ).toBeGreaterThan(0.6 * geometry.width * geometry.height);
                const hash = await canvasHash(page);
                expect(hash !== before, JSON.stringify(step)).toBe(changes);
                before = hash;
            }
        } finally {
            await browser.close();
        }
    });
});

test.describe("keys and the envelope warning", () => {
    test("Shift+N, ↑/↓, Ctrl+Shift+↑/↓ and Ctrl+Shift+D act on the active layer", async ({
        page,
    }) => {
        await live.openEditor(page);
        await page.locator("[data-viewport]").focus();
        const state = () => pageCall<LayerState>(page, "state");
        expect(await state()).toMatchObject({ tree: "Tile Layer 1", active: 1 });
        await page.keyboard.press("Shift+N");
        expect(await state()).toMatchObject({ tree: "Tile Layer 1,Tile Layer 2", active: 2 });
        await page.keyboard.press("ArrowDown");
        expect((await state()).active).toBe(1);
        await page.keyboard.press("ArrowUp");
        expect((await state()).active).toBe(2);
        await page.keyboard.press("Control+Shift+ArrowDown");
        expect(await state()).toMatchObject({ tree: "Tile Layer 2,Tile Layer 1", active: 2 });
        await page.keyboard.press("Control+Shift+D");
        expect(await state()).toMatchObject({
            tree: "Tile Layer 2,Tile Layer 2,Tile Layer 1",
            active: 3,
        });
        await page.keyboard.press("Control+Z");
        expect(await state()).toMatchObject({ tree: "Tile Layer 2,Tile Layer 1", active: 2 });
    });

    test("the envelope warning appears once per map", async ({ page }) => {
        await live.openEditor(page);
        await pageCall(page, "collectNotices");
        await page.locator("[data-viewport]").focus();
        // The new project's map has one layer; 16 more take it past 16 layers (BRIEF D1).
        for (let n = 0; n < 15; n += 1) await page.keyboard.press("Shift+N");
        expect(await pageCall<string[]>(page, "collected")).toEqual([]);
        await page.keyboard.press("Shift+N");
        const warning = "This map is beyond the editor's tested envelope: more than 16 layers.";
        await expect(page.getByRole("status").filter({ hasText: warning })).toBeVisible();
        expect(await pageCall<string[]>(page, "collected")).toEqual([warning]);
        // More layers, undo and redo: no second warning for this map.
        await page.keyboard.press("Shift+N");
        await page.keyboard.press("Control+Z");
        await page.keyboard.press("Control+Z");
        await page.keyboard.press("Control+Y");
        expect(await pageCall<string[]>(page, "collected")).toEqual([warning]);
    });
});
