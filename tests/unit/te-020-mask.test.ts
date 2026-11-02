import { describe, expect, it } from "vitest";
import { History } from "../../src/core/history";
import { createProject, createProjectSession } from "../../src/core/model";
import type { Region } from "../../src/core/model";
import {
    combineSelection,
    createMask,
    intersectMask,
    invertSelection,
    invertSelectionCommand,
    maskBounds,
    maskHas,
    maskSize,
    maskSpans,
    masksEqual,
    rectMask,
    selectAll,
    selectAllCommand,
    selectCommand,
    selectNoneCommand,
    selectionBoundary,
    selectionOf,
    selectionsEqual,
    spansMask,
    subtractMask,
    tileSelectionOf,
    unionMask,
} from "../../src/core/selection";
import type { SelectionMode } from "../../src/core/selection";

// TE-020: `core/selection` (SPEC §3, §4.3, §4.4), the sprite editor's mask operations adapted to
// cell masks: a selection is the model's `Region`, a rectangle of cells cut to its selected
// cells with one byte per cell. Replace, add, subtract, intersect and invert are checked against
// golden masks drawn on an 8 × 6 map: `#` a selected cell, `.` not.

const W = 8;
const H = 6;

/** The mask of a picture of the whole map; null when no cell is drawn. */
function picture(rows: readonly string[]): Region | null {
    const mask = createMask({ x: 0, y: 0, width: W, height: H });
    rows.forEach((row, y) => {
        [...row].forEach((char, x) => {
            if (char === "#") mask.mask[y * W + x] = 1;
        });
    });
    return selectionOf(mask);
}

/** The picture of `selection` over the map. */
function draw(selection: Region | null): string[] {
    const rows: string[] = [];
    for (let y = 0; y < H; y++) {
        let row = "";
        for (let x = 0; x < W; x++) row += selection && maskHas(selection, x, y) ? "#" : ".";
        rows.push(row);
    }
    return rows;
}

const CURRENT = picture(["........", ".####...", ".####...", ".####...", "........", "........"])!;

const SHAPE = picture(["........", "........", "...####.", "...####.", "...####.", "........"])!;

const GOLDEN: Record<SelectionMode, string[]> = {
    replace: ["........", "........", "...####.", "...####.", "...####.", "........"],
    add: ["........", ".####...", ".######.", ".######.", "...####.", "........"],
    subtract: ["........", ".####...", ".##.....", ".##.....", "........", "........"],
    intersect: ["........", "........", "...##...", "...##...", "........", "........"],
};

describe("cell masks", () => {
    it("cuts a selection to the bounding box of its cells, keeping a tight mask itself", () => {
        const loose = createMask({ x: -2, y: 1, width: 10, height: 4 });
        loose.mask[1 * 10 + 5] = 1; // cell (3, 2)
        loose.mask[2 * 10 + 7] = 1; // cell (5, 3)
        const tight = selectionOf(loose)!;
        expect([tight.x, tight.y, tight.width, tight.height]).toEqual([3, 2, 3, 2]);
        expect([...tight.mask]).toEqual([1, 0, 0, 0, 0, 1]);
        expect(selectionOf(tight)).toBe(tight);
        expect(selectionOf(createMask({ x: 0, y: 0, width: 3, height: 3 }))).toBeNull();
        expect(maskBounds(loose)).toEqual({ x: 3, y: 2, width: 3, height: 2 });
        expect(maskSize(loose)).toBe(2);
        expect(masksEqual(loose, tight)).toBe(true);
        expect(selectionsEqual(null, null)).toBe(true);
        expect(selectionsEqual(tight, null)).toBe(false);
    });

    it("converts to and from the row spans of core/fill", () => {
        const spans = [
            { y: 1, start: 2, end: 4 },
            { y: 1, start: 6, end: 7 },
            { y: 3, start: 0, end: 3 },
        ];
        const mask = spansMask(spans);
        expect([mask.x, mask.y, mask.width, mask.height]).toEqual([0, 1, 7, 3]);
        expect(maskSpans(mask)).toEqual(spans);
        expect(maskSize(mask)).toBe(6);
        expect(maskSpans(spansMask([]))).toEqual([]);
    });

    it("never changes the masks it is given", () => {
        const before = [...CURRENT.mask];
        const shapeBefore = [...SHAPE.mask];
        unionMask(CURRENT, SHAPE);
        subtractMask(CURRENT, SHAPE);
        intersectMask(CURRENT, SHAPE);
        invertSelection(CURRENT, W, H);
        expect([...CURRENT.mask]).toEqual(before);
        expect([...SHAPE.mask]).toEqual(shapeBefore);
    });
});

describe("selection operations against golden masks", () => {
    for (const mode of ["replace", "add", "subtract", "intersect"] as const) {
        it(mode, () => {
            const result = combineSelection(CURRENT, SHAPE, mode);
            expect(draw(result)).toEqual(GOLDEN[mode]);
            // A result is always cut to its cells.
            expect(result && selectionOf(result)).toBe(result);
        });
    }

    it("replace keeps a shape's own mask when it is tight", () => {
        expect(combineSelection(CURRENT, SHAPE, "replace")).toBe(SHAPE);
    });

    it("without a selection: add is replace, subtract and intersect select nothing", () => {
        expect(draw(combineSelection(null, SHAPE, "add"))).toEqual(GOLDEN.replace);
        expect(combineSelection(null, SHAPE, "subtract")).toBeNull();
        expect(combineSelection(null, SHAPE, "intersect")).toBeNull();
    });

    it("a subtract or intersect that leaves nothing is no selection", () => {
        expect(combineSelection(SHAPE, SHAPE, "subtract")).toBeNull();
        const apart = rectMask({ x: 6, y: 0, width: 2, height: 1 });
        expect(combineSelection(CURRENT, apart, "intersect")).toBeNull();
        expect(
            combineSelection(CURRENT, createMask({ x: 0, y: 0, width: 0, height: 0 }), "replace"),
        ).toBeNull();
    });

    it("invert", () => {
        const holed = picture([
            "########",
            "#......#",
            "#.####.#",
            "#......#",
            "########",
            "........",
        ]);
        expect(draw(invertSelection(holed, W, H))).toEqual([
            "........",
            ".######.",
            ".#....#.",
            ".######.",
            "........",
            "########",
        ]);
        expect(draw(invertSelection(null, W, H))).toEqual(Array(H).fill("########"));
        expect(invertSelection(selectAll(W, H), W, H)).toBeNull();
        expect(selectionsEqual(invertSelection(invertSelection(holed, W, H), W, H), holed)).toBe(
            true,
        );
    });
});

describe("selection boundary", () => {
    it("runs along the cell edges of an L shape, with its outer corners", () => {
        const shape = picture([
            "........",
            ".##.....",
            ".###....",
            "........",
            "........",
            "........",
        ])!;
        const boundary = selectionBoundary(shape);
        expect(boundary.horizontal).toEqual([
            { y: 1, x0: 1, x1: 3, inside: "below" },
            { y: 2, x0: 3, x1: 4, inside: "below" },
            { y: 3, x0: 1, x1: 4, inside: "above" },
        ]);
        expect(boundary.vertical).toEqual([
            { x: 1, y0: 1, y1: 3, inside: "right" },
            { x: 3, y0: 1, y1: 2, inside: "left" },
            { x: 4, y0: 2, y1: 3, inside: "left" },
        ]);
        expect(boundary.corners).toEqual([
            { x: 1, y: 1, selected: "bottom-right" },
            { x: 3, y: 1, selected: "bottom-left" },
            { x: 4, y: 2, selected: "bottom-left" },
            { x: 1, y: 3, selected: "top-right" },
            { x: 4, y: 3, selected: "top-left" },
        ]);
        expect(selectionBoundary(createMask({ x: 0, y: 0, width: 2, height: 2 }))).toEqual({
            horizontal: [],
            vertical: [],
            corners: [],
        });
    });
});

describe("selection commands", () => {
    it("change the map's selection as undoable steps, and record nothing for no change", () => {
        const session = createProjectSession(
            createProject({ map: { width: W, height: H, tileWidth: 16, tileHeight: 16 } }),
        );
        const history = new History(session);
        const mapId = session.activeMapId;
        const run = (command: ReturnType<typeof selectAllCommand>) => {
            expect(command).not.toBeNull();
            history.execute(command!);
        };

        run(selectCommand(session, mapId, CURRENT, "replace", "Rectangle Select"));
        expect(draw(tileSelectionOf(session, mapId))).toEqual(draw(CURRENT));
        expect(selectCommand(session, mapId, CURRENT, "add", "Rectangle Select")).toBeNull();
        expect(history.undoMapId).toBe(mapId);

        run(selectCommand(session, mapId, SHAPE, "intersect", "Magic Wand"));
        expect(draw(tileSelectionOf(session, mapId))).toEqual(GOLDEN.intersect);
        run(invertSelectionCommand(session, mapId));
        run(selectNoneCommand(session, mapId));
        expect(tileSelectionOf(session, mapId)).toBeNull();
        expect(selectNoneCommand(session, mapId)).toBeNull();
        run(selectAllCommand(session, mapId));
        expect(selectAllCommand(session, mapId)).toBeNull();
        expect(history.undoLabel).toBe("Select All");

        history.undo();
        expect(tileSelectionOf(session, mapId)).toBeNull();
        history.undo();
        history.undo();
        expect(draw(tileSelectionOf(session, mapId))).toEqual(GOLDEN.intersect);
        history.undo();
        expect(draw(tileSelectionOf(session, mapId))).toEqual(draw(CURRENT));
        history.redo();
        expect(draw(tileSelectionOf(session, mapId))).toEqual(GOLDEN.intersect);
    });
});
