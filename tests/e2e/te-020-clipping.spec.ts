import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { CellSpec, Rect } from "./te-020-support";
import {
    LAYERS,
    call,
    cells,
    clickAt,
    drag,
    expect,
    history,
    holding,
    listed,
    openEditor,
    put,
    rectEntries,
    setSelection,
    setSelectionRows,
    setStamp,
    undo,
} from "./te-020-support";

// TE-020: the tile selection clips painting (SPEC §4.1, Tiled's `TilePainter::paintableRegion`):
// the stamp brush, the eraser (its rectangle and all-layers modes too), the bucket fill and the
// shape fill change only selected cells of the active tile layer. The bucket floods over the
// map and fills the selected cells of its region (Tiled's `computePaintableFillRegion`);
// Shift (or Whole selection) fills exactly the selection, and only from a cell inside it
// (Tiled's `BucketFillTool`).

/** The selection: block A (5..7, 5..7) and block B (20..21, 20..21), apart. */
const A = { x: 5, y: 5, width: 3, height: 3 };
const B = { x: 20, y: 20, width: 2, height: 2 };

async function selectAandB(page: Page): Promise<void> {
    const rows = Array.from({ length: 17 }, (_, v) =>
        Array.from({ length: 17 }, (_, u) => {
            const x = 5 + u;
            const y = 5 + v;
            const inside = (rect: Rect) =>
                x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
            return inside(A) || inside(B) ? "#" : ".";
        }).join(""),
    );
    await setSelectionRows(page, 5, 5, rows);
}

const selectTool = (page: Page, id: string) => call<boolean>(page, "selectTool", id);

const ONE: CellSpec = [1, 0];
const TWO: CellSpec = [2, 0];
const MAP = { x: 0, y: 0, width: 40, height: 30 };
const inRect = (rect: Rect) => (entry: [number, number, CellSpec]) =>
    entry[0] >= rect.x &&
    entry[1] >= rect.y &&
    entry[0] < rect.x + rect.width &&
    entry[1] < rect.y + rect.height;

test("the stamp brush paints only selected cells", async ({ page }) => {
    await openEditor(page, "stamp");
    await setSelection(page, A);
    await setStamp(page, 1, 1, [ONE]);
    await drag(page, [2, 6], [[12, 6]]);
    expect(await cells(page)).toEqual(
        listed(rectEntries({ x: 5, y: 6, width: 3, height: 1 }, ONE)),
    );
    expect(await history(page)).toEqual({ undo: "Stamp Brush", redo: null });

    // A 3 × 3 stamp centred on a corner cell of the selection: only its selected part lands.
    expect(await undo(page)).toBe(true);
    await setStamp(page, 3, 3, Array<CellSpec>(9).fill(TWO));
    await clickAt(page, 5, 5);
    expect(await cells(page)).toEqual(
        listed(rectEntries({ x: 5, y: 5, width: 2, height: 2 }, TWO)),
    );

    // Outside the selection: nothing, and no history entry.
    expect(await undo(page)).toBe(true);
    await clickAt(page, 15, 15);
    expect(await cells(page)).toEqual([]);
    expect(await history(page)).toEqual({ undo: null, redo: "Stamp Brush" });
});

test("the eraser erases only selected cells, in each of its modes", async ({ page }) => {
    await openEditor(page, "eraser");
    const ground = rectEntries({ x: 0, y: 0, width: 12, height: 12 }, ONE);
    const top = rectEntries({ x: 0, y: 0, width: 12, height: 12 }, TWO);
    await put(page, ground);
    await put(page, top, LAYERS.top);
    await setSelection(page, A);

    await drag(page, [2, 6], [[11, 6]]);
    const row = { x: 5, y: 6, width: 3, height: 1 };
    expect(await cells(page)).toEqual(listed(ground.filter((entry) => !inRect(row)(entry))));
    expect(await undo(page)).toBe(true);

    // Right drag: a rectangle, over the selection and beyond it.
    await drag(page, [2, 2], [[10, 10]], "right");
    expect(await cells(page)).toEqual(listed(ground.filter((entry) => !inRect(A)(entry))));
    expect(await cells(page, LAYERS.top)).toEqual(listed(top));
    expect(await undo(page)).toBe(true);

    // Shift: every unlocked visible tile layer, still in the selection only.
    await holding(page, ["Shift"], () => drag(page, [2, 6], [[11, 6]]));
    expect(await cells(page)).toEqual(listed(ground.filter((entry) => !inRect(row)(entry))));
    expect(await cells(page, LAYERS.top)).toEqual(
        listed(top.filter((entry) => !inRect(row)(entry))),
    );
    expect(await history(page)).toEqual({ undo: "Eraser", redo: null });
});

test("the bucket fills its flood region over the map, cut to the selection", async ({ page }) => {
    await openEditor(page, "bucket");
    await selectAandB(page);
    await setStamp(page, 1, 1, [ONE]);
    // The empty layer is one region: both selected parts fill, though no selected cell joins
    // them (Tiled's `computePaintableFillRegion` on a fixed-size map).
    const both = listed([...rectEntries(A, ONE), ...rectEntries(B, ONE)]);
    await clickAt(page, 6, 6);
    expect(await cells(page)).toEqual(both);
    expect(await history(page)).toEqual({ undo: "Bucket Fill", redo: null });
    expect(await undo(page)).toBe(true);

    // A press outside the selection fills the selected cells of its region, as in Tiled.
    await clickAt(page, 12, 12);
    expect(await cells(page)).toEqual(both);
    expect(await undo(page)).toBe(true);

    // A ring of tile 2 around B: the flood from A cannot reach B's cells.
    const ring = rectEntries({ x: 19, y: 19, width: 4, height: 4 }, TWO).filter(
        ([x, y]) => x === 19 || y === 19 || x === 22 || y === 22,
    );
    await put(page, ring);
    await clickAt(page, 6, 6);
    expect(await cells(page)).toEqual(listed([...rectEntries(A, ONE), ...ring]));
    expect(await undo(page)).toBe(true);
    // Pressed inside the ring: B only.
    await clickAt(page, 20, 20);
    expect(await cells(page)).toEqual(listed([...rectEntries(B, ONE), ...ring]));
});

test("Shift bucket fills exactly the selection, as Whole selection does", async ({ page }) => {
    await openEditor(page, "bucket");
    // A wall in A that a flood would stop at; Shift fills it too.
    const wall = rectEntries({ x: 6, y: 5, width: 1, height: 3 }, TWO);
    await put(page, wall);
    await selectAandB(page);
    await setStamp(page, 1, 1, [ONE]);
    const exactly = listed([...rectEntries(A, ONE), ...rectEntries(B, ONE)]);

    await holding(page, ["Shift"], () => clickAt(page, 21, 21));
    expect(await cells(page)).toEqual(exactly);
    expect(await undo(page)).toBe(true);
    expect(await cells(page)).toEqual(listed(wall));

    // From a cell outside the selection: nothing (Tiled's "the mouse needs to be in the region").
    await holding(page, ["Shift"], () => clickAt(page, 12, 12));
    expect(await cells(page)).toEqual(listed(wall));

    const toggle = page.locator('[data-tool-option="wholeSelection"]');
    await toggle.click();
    await clickAt(page, 5, 5);
    expect(await cells(page)).toEqual(exactly);

    // Without a selection Shift fills the whole layer, as before (TE-019).
    expect(await undo(page)).toBe(true);
    await call(page, "setSelectionRows", 0, 0, ["."]);
    await clickAt(page, 12, 12);
    expect(await cells(page)).toEqual(listed(rectEntries(MAP, ONE)));
});

test("the shape fill fills only selected cells, the stamp tiled from the shape", async ({
    page,
}) => {
    await openEditor(page, "shapeFill");
    await selectAandB(page);
    await setStamp(page, 2, 1, [[0, 0], ONE]);
    await drag(page, [3, 3], [[10, 10]]);
    // The stamp is tiled from the shape's top-left (3, 3), not the selection's.
    const tiled = rectEntries(A, ONE).map(([x, y]): [number, number, CellSpec] => [
        x,
        y,
        (x - 3) % 2 === 0 ? [0, 0] : ONE,
    ]);
    expect(await cells(page)).toEqual(listed(tiled));
    expect(await history(page)).toEqual({ undo: "Rectangle Fill", redo: null });

    // The ellipse too: none of it outside the selection.
    expect(await undo(page)).toBe(true);
    await selectTool(page, "shapeFillEllipse");
    await drag(page, [0, 0], [[30, 25]]);
    const painted = await cells(page);
    expect(painted.length).toBeGreaterThan(0);
    for (const entry of painted) {
        const [x, y] = entry.split(":")[0]!.split(",").map(Number) as [number, number];
        expect(inRect(A)([x, y, null]) || inRect(B)([x, y, null]), entry).toBe(true);
    }
});
