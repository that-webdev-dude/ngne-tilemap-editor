import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { overlayIdle } from "./te-014-support";
import {
    TILE_COLOURS,
    clickAt,
    expect,
    moveTo,
    openEditor,
    pageCall,
    pressAt,
} from "./te-017-support";

// TE-017: the stamp and erase previews on the overlay (DESIGN §4), read back from the overlay
// canvas: the stamp's tiles at 60% over the cells it would paint with a 1 px `--accent`
// outline, the erase area with a 1 px `--danger` outline, at the cursor, and nothing when the
// cursor is off the map. The test map hides the grid, so the overlay holds the preview only.

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

const cellDevice = (page: Page, x: number, y: number) => pageCall<Rect>(page, "cellDevice", x, y);
const pixel = (page: Page, x: number, y: number) => pageCall<number[]>(page, "overlayPixel", x, y);
const ink = (page: Page) => pageCall<number>(page, "overlayInk");
const token = (page: Page, name: string) => pageCall<number>(page, "token", name);

const rgb = (colour: number) => [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];

/** The pixel at the centre of cell `(x, y)`. */
async function centreOf(page: Page, x: number, y: number): Promise<number[]> {
    const rect = await cellDevice(page, x, y);
    return pixel(page, rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2));
}

/** Expects `actual` to be `colour` at `alpha`, each channel within 2 (premultiplied storage). */
function expectColour(actual: number[], colour: number, alpha: number): void {
    const expected = [...rgb(colour), alpha];
    actual.forEach((channel, n) => expect(Math.abs(channel - expected[n]!)).toBeLessThanOrEqual(2));
}

/** 60% of 255 (DESIGN §4). */
const PREVIEW_ALPHA = Math.round(0.6 * 255);

test.describe("stamp preview", () => {
    test.beforeEach(async ({ page }) => {
        await openEditor(page, "stamp");
    });

    test("is drawn at the cursor: tiles at 60% and an accent outline", async ({ page }) => {
        await pageCall(page, "setStamp", 2, 2, [0, 1, 2, 3]);
        await moveTo(page, 10, 8);
        await overlayIdle(page);
        // Anchor (1, 1): the stamp covers cells 9..10, 7..8.
        expectColour(await centreOf(page, 9, 7), TILE_COLOURS[0], PREVIEW_ALPHA);
        expectColour(await centreOf(page, 10, 7), TILE_COLOURS[1], PREVIEW_ALPHA);
        expectColour(await centreOf(page, 9, 8), TILE_COLOURS[2], PREVIEW_ALPHA);
        expectColour(await centreOf(page, 10, 8), TILE_COLOURS[3], PREVIEW_ALPHA);
        // The outline is the stamp's rectangle, 1 device pixel inside it, opaque accent.
        const accent = await token(page, "--accent");
        const corner = await cellDevice(page, 9, 7);
        const far = await cellDevice(page, 10, 8);
        const middle = corner.y + corner.height;
        expectColour(await pixel(page, corner.x, middle), accent, 255);
        expectColour(await pixel(page, far.x + far.width - 1, middle), accent, 255);
        expectColour(await pixel(page, corner.x + corner.width, corner.y), accent, 255);
        // Nothing beside it.
        expect((await pixel(page, corner.x - 1, middle))[3]).toBe(0);
        expect((await centreOf(page, 12, 8))[3]).toBe(0);

        // It follows the cursor.
        await moveTo(page, 20, 15);
        await overlayIdle(page);
        expect((await centreOf(page, 9, 7))[3]).toBe(0);
        expectColour(await centreOf(page, 19, 14), TILE_COLOURS[0], PREVIEW_ALPHA);
    });

    test("is absent off the map, and cut at its edge", async ({ page }) => {
        await pageCall(page, "setStamp", 3, 3, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
        await moveTo(page, 10, 8);
        await overlayIdle(page);
        expect(await ink(page)).toBeGreaterThan(0);
        await moveTo(page, -3, 5);
        await overlayIdle(page);
        expect(await ink(page)).toBe(0);
        await moveTo(page, 12, 31);
        await overlayIdle(page);
        expect(await ink(page)).toBe(0);
        // The pointer off the viewport.
        await page.mouse.move(1, 1);
        await overlayIdle(page);
        expect(await ink(page)).toBe(0);

        // On the corner cell the stamp reaches out of the map: only the map's part is drawn.
        await moveTo(page, 0, 0);
        await overlayIdle(page);
        const corner = await cellDevice(page, 0, 0);
        expectColour(await centreOf(page, 0, 0), TILE_COLOURS[0], PREVIEW_ALPHA);
        expect((await pixel(page, corner.x - 2, corner.y + 4))[3]).toBe(0);
        expect((await pixel(page, corner.x + 4, corner.y - 2))[3]).toBe(0);
    });

    test("with Shift held, shows the line it would paint", async ({ page }) => {
        await pageCall(page, "setStamp", 1, 1, [2]);
        await clickAt(page, 3, 3);
        await page.keyboard.down("Shift");
        await moveTo(page, 8, 3);
        await overlayIdle(page);
        for (let x = 4; x <= 8; x++) {
            expectColour(await centreOf(page, x, 3), TILE_COLOURS[2], PREVIEW_ALPHA);
        }
        expect((await centreOf(page, 9, 3))[3]).toBe(0);
        await page.keyboard.up("Shift");
        await overlayIdle(page);
        expect((await centreOf(page, 5, 3))[3]).toBe(0);
        expectColour(await centreOf(page, 8, 3), TILE_COLOURS[2], PREVIEW_ALPHA);
    });
});

test.describe("erase preview", () => {
    test.beforeEach(async ({ page }) => {
        await openEditor(page, "eraser");
    });

    test("outlines the cell at the cursor in --danger, nothing off the map", async ({ page }) => {
        const danger = await token(page, "--danger");
        await moveTo(page, 6, 6);
        await overlayIdle(page);
        const cell = await cellDevice(page, 6, 6);
        expectColour(await pixel(page, cell.x, cell.y + 3), danger, 255);
        expectColour(await pixel(page, cell.x + cell.width - 1, cell.y + 3), danger, 255);
        expect((await centreOf(page, 6, 6))[3]).toBe(0);
        expect((await pixel(page, cell.x - 1, cell.y + 3))[3]).toBe(0);
        await moveTo(page, 45, 6);
        await overlayIdle(page);
        expect(await ink(page)).toBe(0);
    });

    test("outlines the rectangle of a right drag", async ({ page }) => {
        const danger = await token(page, "--danger");
        await pressAt(page, 3, 3, "right");
        await moveTo(page, 7, 5);
        await overlayIdle(page);
        const start = await cellDevice(page, 3, 4);
        const end = await cellDevice(page, 7, 4);
        expectColour(await pixel(page, start.x, start.y + 2), danger, 255);
        expectColour(await pixel(page, end.x + end.width - 1, end.y + 2), danger, 255);
        expect((await centreOf(page, 5, 4))[3]).toBe(0);
        await page.mouse.up({ button: "right" });
        await overlayIdle(page);
        // Back to the cell at the cursor.
        expect((await pixel(page, start.x, start.y + 2))[3]).toBe(0);
    });
});
