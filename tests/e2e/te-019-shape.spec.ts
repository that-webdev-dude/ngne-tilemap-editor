import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { CellSpec, Rect } from "./te-019-support";
import {
    activeTool,
    cells,
    drag,
    expect,
    expectPreview,
    history,
    holding,
    ink,
    listed,
    moveTo,
    openEditor,
    overlayIdle,
    pressAt,
    rectEntries,
    setStamp,
    stamp,
    undo,
} from "./te-019-support";

// TE-019: the shape fill (SPEC §4.3, Tiled's `ShapeFillTool` in its Tile mode), variants
// Rectangle and Ellipse of one rail slot (U, Shift+U; DESIGN §6, §7, §10.3): a drag previews the
// shape and the release fills it with the stamp tiled from the shape's top-left, one history
// entry; Shift makes a square or circle, Alt centres it on the press; a right click or Escape
// during the drag cancels it. Ground starts empty.

const FILL: CellSpec = [1, 0];

/**
 * The cells of a picture (`#` filled, `.` not) laid over `rect`: the ellipses here are Tiled's
 * `ellipseRegion` of their rectangle (SPEC §4.3).
 */
function pictureEntries(rect: Rect, rows: string[], cell: CellSpec): [number, number, CellSpec][] {
    return rectEntries(rect, cell).filter(([x, y]) => rows[y - rect.y]![x - rect.x] === "#");
}

/** A left drag from `a` to `b`, the modifiers held from before the press to after the release. */
const dragWith = (page: Page, keys: string[], a: [number, number], b: [number, number]) =>
    holding(page, keys, () => drag(page, a, [b]));

test.beforeEach(async ({ page }) => {
    await openEditor(page, "shapeFill");
    await setStamp(page, 1, 1, [FILL]);
});

test("a rectangle: previewed while dragged, filled at the release; undo", async ({ page }) => {
    await pressAt(page, 3, 3);
    await moveTo(page, 6, 5);
    await overlayIdle(page);
    await expectPreview(page, 3, 3, 1);
    await expectPreview(page, 6, 5, 1);
    await expectPreview(page, 7, 5, null);
    // Nothing is written before the release.
    expect(await cells(page)).toEqual([]);
    await page.mouse.up();
    expect(await cells(page)).toEqual(
        listed(rectEntries({ x: 3, y: 3, width: 4, height: 3 }, FILL)),
    );
    expect(await history(page)).toEqual({ undo: "Rectangle Fill", redo: null });
    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual([]);

    // Dragged up and left, the stamp is still tiled from the shape's top-left.
    await setStamp(page, 2, 1, [
        [0, 0],
        [2, 3],
    ]);
    await drag(page, [6, 5], [[3, 3]]);
    const tiled = rectEntries({ x: 3, y: 3, width: 4, height: 3 }, null).map(
        ([x, y]): [number, number, CellSpec] => [x, y, (x - 3) % 2 === 0 ? [0, 0] : [2, 3]],
    );
    expect(await cells(page)).toEqual(listed(tiled));
});

test("an ellipse: U switches the variant, and so does the context bar", async ({ page }) => {
    await page.keyboard.press("U");
    expect(await activeTool(page)).toBe("shapeFillEllipse");
    const choice = page.locator('[data-tool-variant-choice="shapeFill"]');
    await expect(choice.getByRole("radio", { name: "Ellipse" })).toBeChecked();

    const area = { x: 2, y: 2, width: 9, height: 5 };
    await pressAt(page, 2, 2);
    await moveTo(page, 10, 6);
    await overlayIdle(page);
    // The corners of the box are outside the ellipse; its middle row is not.
    await expectPreview(page, 2, 2, null);
    await expectPreview(page, 2, 4, 1);
    await page.mouse.up();
    const ellipse = ["..#####..", ".#######.", "#########", ".#######.", "..#####.."];
    const expected = listed(pictureEntries(area, ellipse, FILL));
    expect(expected).toHaveLength(33);
    expect(await cells(page)).toEqual(expected);
    expect(await history(page)).toEqual({ undo: "Ellipse Fill", redo: null });

    await page.keyboard.press("U");
    expect(await activeTool(page)).toBe("shapeFill");
    await page.keyboard.press("Shift+U");
    expect(await activeTool(page)).toBe("shapeFillEllipse");
    await choice.getByRole("radio", { name: "Rectangle" }).click();
    expect(await activeTool(page)).toBe("shapeFill");
});

test("Shift fills a square, or a circle", async ({ page }) => {
    await dragWith(page, ["Shift"], [3, 3], [9, 5]);
    expect(await cells(page)).toEqual(
        listed(rectEntries({ x: 3, y: 3, width: 3, height: 3 }, FILL)),
    );
    expect(await undo(page)).toBe(true);

    await page.keyboard.press("Shift+U");
    // Up and left: the square grows towards the pointer.
    await dragWith(page, ["Shift"], [20, 20], [11, 13]);
    const circle = { x: 13, y: 13, width: 8, height: 8 };
    const round = [
        "..####..",
        ".######.",
        "########",
        "########",
        "########",
        "########",
        ".######.",
        "..####..",
    ];
    expect(await cells(page)).toEqual(listed(pictureEntries(circle, round, FILL)));
});

test("Alt centres the shape on the pressed cell, with Shift too", async ({ page }) => {
    await dragWith(page, ["Alt"], [10, 10], [12, 11]);
    expect(await cells(page)).toEqual(
        listed(rectEntries({ x: 8, y: 9, width: 5, height: 3 }, FILL)),
    );
    expect(await undo(page)).toBe(true);

    await dragWith(page, ["Alt", "Shift"], [10, 10], [6, 12]);
    expect(await cells(page)).toEqual(
        listed(rectEntries({ x: 8, y: 8, width: 5, height: 5 }, FILL)),
    );
});

test("a shape reaching off the map fills its part in the map", async ({ page }) => {
    await drag(page, [37, 27], [[44, 33]]);
    expect(await cells(page)).toEqual(
        listed(rectEntries({ x: 37, y: 27, width: 3, height: 3 }, FILL)),
    );
});

test("a right click during the drag cancels it, and captures nothing", async ({ page }) => {
    await pressAt(page, 3, 3);
    await moveTo(page, 6, 6);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await overlayIdle(page);
    // The preview is gone; the release fills nothing.
    await expectPreview(page, 4, 4, null);
    await page.mouse.up();
    expect(await cells(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: null, redo: null });
    expect(await stamp(page)).toEqual({ width: 1, height: 1, cells: [FILL] });
});

test("Escape during the drag cancels it", async ({ page }) => {
    await pressAt(page, 3, 3);
    await moveTo(page, 6, 6);
    await page.keyboard.press("Escape");
    await overlayIdle(page);
    await expectPreview(page, 4, 4, null);
    await page.mouse.up();
    expect(await cells(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: null, redo: null });

    // Hovering shows the cell under the pointer only; off the map nothing.
    await moveTo(page, 8, 8);
    await overlayIdle(page);
    expect(await ink(page)).toBeGreaterThan(0);
    await expectPreview(page, 8, 8, null);
    await moveTo(page, -3, 8);
    await overlayIdle(page);
    expect(await ink(page)).toBe(0);
});
