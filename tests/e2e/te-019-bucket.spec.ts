import { test } from "@playwright/test";
import type { CellSpec } from "./te-019-support";
import {
    LAYERS,
    activeTool,
    cellDevice,
    cells,
    clickAt,
    drag,
    expect,
    expectColour,
    expectPreview,
    history,
    holding,
    ink,
    listed,
    moveTo,
    openEditor,
    overlayIdle,
    pixel,
    pressAt,
    put,
    rectEntries,
    redo,
    ringEntries,
    setStamp,
    stamp,
    statusMessage,
    token,
    undo,
} from "./te-019-support";

// TE-019: the bucket fill (SPEC §4.3, Tiled's `BucketFillTool` in its Tile mode): a press fills
// the 4-connected region of cells equal to the pressed one with the stamp tiled from the
// region's bounding box top-left, one history entry; Shift or Whole selection fills the whole
// layer; hover previews the region. Ground holds a ring of tile 3 around (5..10, 5..9), so the
// empty cells inside it, (6..9, 6..8), are one region and the empty cells outside another.

const RING = { x: 5, y: 5, width: 6, height: 5 };
const INSIDE = { x: 6, y: 6, width: 4, height: 3 };
const WALL: CellSpec = [3, 0];
const ringCells = ringEntries(RING, WALL);

test.beforeEach(async ({ page }) => {
    await openEditor(page, "bucket");
    await put(page, ringCells);
});

test("fills the region of the pressed cell; undo and redo", async ({ page }) => {
    await setStamp(page, 1, 1, [[1, 0]]);
    await clickAt(page, 7, 7);
    const filled = listed([...ringCells, ...rectEntries(INSIDE, [1, 0])]);
    expect(await cells(page)).toEqual(filled);
    expect(await history(page)).toEqual({ undo: "Bucket Fill", redo: null });

    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual(listed(ringCells));
    expect(await history(page)).toEqual({ undo: null, redo: "Bucket Fill" });
    expect(await redo(page)).toBe(true);
    expect(await cells(page)).toEqual(filled);

    // The ring is a region of its own: tile 3, flags included, 4-connected.
    await setStamp(page, 1, 1, [[2, 0]]);
    await clickAt(page, 5, 5);
    expect(await cells(page)).toEqual(
        listed([...ringEntries(RING, [2, 0]), ...rectEntries(INSIDE, [1, 0])]),
    );
    // The same tile with other flags is another region.
    await put(page, [[20, 20, [2, 4]]]);
    await setStamp(page, 1, 1, [[0, 0]]);
    await clickAt(page, 5, 5);
    expect(await cells(page)).toContain("20,20:2/4");
});

test("tiles the stamp from the region's bounding box top-left, not the pressed cell", async ({
    page,
}) => {
    // Walls on the inside's top row and left column, and on (7, 7): the empty region is
    // (8..9, 7) and (7..9, 8), its box starts at (7, 7), a cell it does not hold, at odd
    // coordinates (a stamp tiled from the map's origin would differ).
    const walls: [number, number, CellSpec][] = [
        ...rectEntries({ x: 6, y: 6, width: 4, height: 1 }, WALL),
        ...rectEntries({ x: 6, y: 7, width: 1, height: 2 }, WALL),
        [7, 7, WALL],
    ];
    await put(page, walls);
    // 2 × 2: tiles 0 1 over 2 and an empty cell, each with its own orientation.
    const STAMP: CellSpec[] = [[0, 2], [1, 5], [2, 7], null];
    await setStamp(page, 2, 2, STAMP);
    const tiled = (origin: number, x: number, y: number): CellSpec =>
        STAMP[((y - origin) % 2) * 2 + ((x - origin) % 2)]!;
    await clickAt(page, 9, 8);
    const region: [number, number, CellSpec][] = [
        [8, 7, tiled(7, 8, 7)],
        [9, 7, tiled(7, 9, 7)],
        [7, 8, tiled(7, 7, 8)],
        // The stamp's empty cell: (8, 8) stays empty.
        [8, 8, tiled(7, 8, 8)],
        [9, 8, tiled(7, 9, 8)],
    ];
    expect(region.map(([, , cell]) => cell)).toEqual([[1, 5], [0, 2], [2, 7], null, [2, 7]]);
    expect(await cells(page)).toEqual(listed([...ringCells, ...walls, ...region]));

    // The walls and the ring are one region of tile 3, its box from (5, 5): where the stamp
    // is empty the wall stays.
    expect(await undo(page)).toBe(true);
    await clickAt(page, 5, 5);
    const refilled = [...ringCells, ...walls].map(([x, y]): [number, number, CellSpec] => [
        x,
        y,
        tiled(5, x, y) ?? WALL,
    ]);
    expect(refilled.filter(([, , cell]) => cell === WALL).length).toBeGreaterThan(0);
    expect(await cells(page)).toEqual(listed(refilled));
});

test("Shift fills the whole layer, as does Whole selection", async ({ page }) => {
    await setStamp(page, 1, 1, [[2, 0]]);
    await holding(page, ["Shift"], () => clickAt(page, 7, 7));
    const whole = listed(rectEntries({ x: 0, y: 0, width: 40, height: 30 }, [2, 0]));
    expect(await cells(page)).toEqual(whole);
    expect(await history(page)).toEqual({ undo: "Bucket Fill", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual(listed(ringCells));

    // The context bar's toggle stands for Shift.
    const toggle = page.locator('[data-tool-option="wholeSelection"]');
    await expect(toggle).toHaveAccessibleName("Whole selection");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await clickAt(page, 30, 20);
    expect(await cells(page)).toEqual(whole);
});

test("hover previews the region the press would fill", async ({ page }) => {
    await setStamp(page, 2, 1, [
        [0, 0],
        [1, 0],
    ]);
    await moveTo(page, 8, 7);
    await overlayIdle(page);
    // The stamp tiled from (6, 6) at 60% over the inside, nothing over the ring or outside.
    for (let x = 6; x <= 9; x++) await expectPreview(page, x, 7, (x - 6) % 2);
    await expectPreview(page, 5, 7, null);
    await expectPreview(page, 12, 7, null);
    // The region's box is outlined 1 px in --accent.
    const accent = await token(page, "--accent");
    const corner = await cellDevice(page, 6, 6);
    expectColour(await pixel(page, corner.x, corner.y + 2), accent, 255);
    expect((await pixel(page, corner.x - 1, corner.y + 2))[3]).toBe(0);
    // Nothing is written by the hover.
    expect(await cells(page)).toEqual(listed(ringCells));

    // Outside the ring: the outside region, around the ring.
    await moveTo(page, 20, 20);
    await overlayIdle(page);
    await expectPreview(page, 6, 7, null);
    await expectPreview(page, 5, 7, null);
    await expectPreview(page, 0, 0, 0);
    await expectPreview(page, 3, 7, 1);

    // Shift: the whole layer, the ring included.
    await holding(page, ["Shift"], async () => {
        await moveTo(page, 21, 20);
        await overlayIdle(page);
        await expectPreview(page, 5, 7, 1);
        await expectPreview(page, 6, 7, 0);
    });

    // Off the map: nothing.
    await moveTo(page, -4, 7);
    await overlayIdle(page);
    expect(await ink(page)).toBe(0);
});

test("a 1 × 1 stamp equal to the pressed cell fills and previews nothing", async ({ page }) => {
    await setStamp(page, 1, 1, [WALL]);
    await moveTo(page, 5, 5);
    await overlayIdle(page);
    expect(await ink(page)).toBe(0);
    await clickAt(page, 5, 5);
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("without a stamp, on a locked layer, or cancelled by a right click: no change", async ({
    page,
}) => {
    await clickAt(page, 7, 7);
    await expect(statusMessage(page)).toHaveText("No stamp");
    expect(await history(page)).toEqual({ undo: null, redo: null });

    await setStamp(page, 1, 1, [[1, 0]]);
    await pressAt(page, 7, 7);
    // The press filled the region; a right click before the release puts it back.
    expect(await cells(page)).toContain("7,7:1/0");
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.mouse.up();
    expect(await cells(page)).toEqual(listed(ringCells));
    expect(await history(page)).toEqual({ undo: null, redo: null });

    await page.evaluate(
        `import("/tests/e2e/harness/te-018-page.ts").then((m) => m.setActiveLayer(${LAYERS.locked}))`,
    );
    await clickAt(page, 7, 7);
    await expect(statusMessage(page)).toHaveText("Layer is locked");
    expect(await history(page)).toEqual({ undo: null, redo: null });
});

test("a right drag captures a stamp and the bucket stays", async ({ page }) => {
    await setStamp(page, 1, 1, [[1, 0]]);
    await drag(page, [5, 5], [[6, 5]], "right");
    expect(await stamp(page)).toEqual({ width: 2, height: 1, cells: [WALL, WALL] });
    expect(await activeTool(page)).toBe("bucket");
    expect(await history(page)).toEqual({ undo: null, redo: null });
});
