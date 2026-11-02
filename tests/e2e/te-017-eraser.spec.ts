import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { pointsOnLine } from "../../src/core/raster/line";
import {
    LAYERS,
    cells,
    drag,
    expect,
    history,
    openEditor,
    pageCall,
    rectCells,
    statusMessage,
    undo,
} from "./te-017-support";

// TE-017: the eraser (SPEC §4.3) on the editor's own viewport, pointer pipeline and history:
// a drag, a right-drag rectangle and the all-layers mode (Shift or the context bar's toggle),
// each one history entry; locked and hidden layers are never touched.

/** The area every test fills on every tile layer before it erases. */
const AREA = { x: 2, y: 2, width: 20, height: 14 };

const fill = (page: Page, layer: number, tile: number) =>
    pageCall<void>(page, "fill", layer, AREA, tile);

test.beforeEach(async ({ page }) => {
    await openEditor(page, "eraser");
    await fill(page, LAYERS.ground, 0);
    await fill(page, LAYERS.top, 1);
    await fill(page, LAYERS.locked, 2);
    await fill(page, LAYERS.hidden, 3);
});

/** The area's cells of tile `tile` without those of `removed` ("x,y"). */
function without(tile: number, removed: readonly string[]): string[] {
    const gone = new Set(removed);
    return rectCells(AREA, tile).filter((cell) => !gone.has(cell.split(":")[0]!));
}

const lineKeys = (a: [number, number], b: [number, number]) =>
    pointsOnLine({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }).map((p) => `${p.x},${p.y}`);

/** The rectangle's cells from `a` to `b`, both included, as "x,y". */
function spanKeys(a: [number, number], b: [number, number]): string[] {
    const keys: string[] = [];
    for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) {
        for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) keys.push(`${x},${y}`);
    }
    return keys;
}

/** Every layer but those named holds its fill. */
async function untouched(page: Page, ...except: number[]): Promise<void> {
    const fills: [number, number][] = [
        [LAYERS.ground, 0],
        [LAYERS.top, 1],
        [LAYERS.locked, 2],
        [LAYERS.hidden, 3],
    ];
    for (const [layer, tile] of fills) {
        if (!except.includes(layer))
            expect(await cells(page, layer)).toEqual(rectCells(AREA, tile));
    }
}

test("a drag erases every crossed cell of the active layer, one entry", async ({ page }) => {
    // One pointer event 15 cells away: the cells between are joined.
    await drag(page, [3, 4], [[18, 11]]);
    const erased = lineKeys([3, 4], [18, 11]);
    expect(await cells(page)).toEqual(without(0, erased));
    await untouched(page, LAYERS.ground);
    expect(await history(page)).toEqual({ undo: "Eraser", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual(rectCells(AREA, 0));
    expect(await history(page)).toEqual({ undo: null, redo: "Eraser" });
});

test("a right drag erases the rectangle from the pressed cell to the released one", async ({
    page,
}) => {
    await drag(
        page,
        [12, 9],
        [
            [9, 11],
            [5, 4],
        ],
        "right",
    );
    expect(await cells(page)).toEqual(without(0, spanKeys([12, 9], [5, 4])));
    await untouched(page, LAYERS.ground);
    // No context menu came up over the viewport.
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(await history(page)).toEqual({ undo: "Eraser", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual(rectCells(AREA, 0));
});

test("Shift erases on every unlocked visible tile layer, one entry", async ({ page }) => {
    await page.keyboard.down("Shift");
    await drag(page, [4, 3], [[15, 3]]);
    await page.keyboard.up("Shift");
    const erased = lineKeys([4, 3], [15, 3]);
    expect(await cells(page, LAYERS.ground)).toEqual(without(0, erased));
    expect(await cells(page, LAYERS.top)).toEqual(without(1, erased));
    // The locked layer and the layer of the hidden group keep their cells.
    await untouched(page, LAYERS.ground, LAYERS.top);
    expect(await history(page)).toEqual({ undo: "Eraser", redo: null });
    expect(await undo(page)).toBe(true);
    await untouched(page);
    expect(await history(page)).toEqual({ undo: null, redo: "Eraser" });
});

test("Shift at the release of a right drag erases the rectangle on all layers", async ({
    page,
}) => {
    await page.keyboard.down("Shift");
    await drag(page, [6, 6], [[10, 8]], "right");
    await page.keyboard.up("Shift");
    const erased = spanKeys([6, 6], [10, 8]);
    expect(await cells(page, LAYERS.ground)).toEqual(without(0, erased));
    expect(await cells(page, LAYERS.top)).toEqual(without(1, erased));
    await untouched(page, LAYERS.ground, LAYERS.top);
    expect(await undo(page)).toBe(true);
    await untouched(page);
});

test("the context bar's All layers erases on all layers without Shift", async ({ page }) => {
    const toggle = page.locator('[data-tool-option="allLayers"]');
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await drag(page, [8, 12], [[8, 5]]);
    const erased = lineKeys([8, 12], [8, 5]);
    expect(await cells(page, LAYERS.ground)).toEqual(without(0, erased));
    expect(await cells(page, LAYERS.top)).toEqual(without(1, erased));
    await untouched(page, LAYERS.ground, LAYERS.top);
    expect(await undo(page)).toBe(true);
    await untouched(page);
});

test("with the locked layer active the eraser refuses, even with Shift", async ({ page }) => {
    await pageCall(page, "setActiveLayer", LAYERS.locked);
    await page.keyboard.down("Shift");
    await drag(page, [4, 4], [[10, 4]]);
    await page.keyboard.up("Shift");
    await expect(statusMessage(page)).toHaveText("Layer is locked");
    await untouched(page);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("the status bar shows the eraser's modifier hint", async ({ page }) => {
    await expect(statusMessage(page)).toHaveText("Shift: all layers · Right drag: rectangle");
});
