import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { overlayIdle } from "./te-014-support";
import { TILE_COLOURS, expect, moveTo, openEditor, pageCall, setStamp } from "./te-017-support";

// TE-017: the overlay composites the stamp's picture in chunks of at most 256 × 256 texels, made
// when first in view (SPEC §4.2). The test map is shown at 50%, 8 device pixels per cell, so a
// texel per device pixel and 32 × 32 cells per chunk: a stamp 36 cells wide is two chunks side
// by side. Its preview shows every cell's tile at 60% on both sides of the seam, from the stamp
// brush and from the bucket fill, which tiles it over the empty layer from cell (0, 0).

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

const WIDE = 36;

/** Tile `(x + y) % 4` at stamp cell `(x, y)`: neighbours differ across the seam. */
const tileAt = (x: number, y: number) => (x + y) % 4;

/** The pixel at the centre of cell `(x, y)`. */
async function centreOf(page: Page, x: number, y: number): Promise<number[]> {
    const rect = await pageCall<Rect>(page, "cellDevice", x, y);
    const centre = [rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2)];
    return pageCall<number[]>(page, "overlayPixel", ...centre);
}

/** Expects cell `(x, y)` to show `tile` at 60%, each channel within 2 (premultiplied storage). */
async function expectTile(page: Page, x: number, y: number, tile: number): Promise<void> {
    const colour = TILE_COLOURS[tile]!;
    const expected = [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255, 153];
    const actual = await centreOf(page, x, y);
    actual.forEach((channel, n) => {
        const off = Math.abs(channel - expected[n]!);
        expect(off, `cell ${x},${y} channel ${n}`).toBeLessThanOrEqual(2);
    });
}

async function setWideStamp(page: Page): Promise<void> {
    const tiles: number[] = [];
    for (let y = 0; y < 2; y++) for (let x = 0; x < WIDE; x++) tiles.push(tileAt(x, y));
    await setStamp(page, WIDE, 2, tiles);
}

test("the stamp brush previews a stamp of two chunks across their seam", async ({ page }) => {
    await openEditor(page, "stamp");
    await setWideStamp(page);
    // Anchor (18, 1): the stamp's top-left cell lies on (2, 9); the seam between its columns
    // 31 and 32 on the map's columns 33 and 34.
    await moveTo(page, 20, 10);
    await overlayIdle(page);
    for (const x of [0, 1, 30, 31, 32, 33, 35]) {
        for (const y of [0, 1]) await expectTile(page, 2 + x, 9 + y, tileAt(x, y));
    }
    expect((await centreOf(page, 1, 9))[3]).toBe(0);
    expect((await centreOf(page, 2, 11))[3]).toBe(0);
});

test("the bucket fill tiles a stamp of two chunks over its region", async ({ page }) => {
    await openEditor(page, "bucket");
    await setWideStamp(page);
    // The layer is empty: the region is the whole map, the stamp laid from (0, 0) and again
    // from (36, 0) and every second row.
    await moveTo(page, 5, 5);
    await overlayIdle(page);
    for (const [x, y] of [
        [0, 0],
        [31, 0],
        [32, 1],
        [35, 2],
        [36, 3],
        [39, 29],
    ] as const) {
        await expectTile(page, x, y, tileAt(x % WIDE, y % 2));
    }
});
