import { describe, expect, it, vi } from "vitest";
import { captureStamp, withCapture } from "../../src/app/tools/stamp/capture";
import { currentStamp, setCurrentStamp } from "../../src/app/tools/stamp/currentStamp";
import type { ToolContext, ToolModifiers, ToolPointer } from "../../src/app/tools/types";
import { CellStore, cellValue } from "../../src/core/cells";
import { createProject, createProjectSession, sequentialIds } from "../../src/core/model";
import type { TileLayer } from "../../src/core/model";

// TE-018: the stamp a capture makes from a rectangle of cells (SPEC §4.2): cut to the
// bounding box of the non-empty cells as Tiled's `normalizeTileLayerPositionsAndMapSize` does,
// empty cells inside it kept, orientation flags kept; none when every cell is empty. And
// `withCapture` on a tool other than the stamp brush (TE-019's fill tools): a right press and
// release capture and leave that tool active (Tiled's `MapEditor::setStamp`: a tool that uses
// the stamp stays), a left one reaches the tool.

const v = (tile: number, orientation: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 = 0) =>
    cellValue(1, tile, orientation);

function store(entries: [number, number, number][]): CellStore {
    const cells = new CellStore();
    for (const [x, y, value] of entries) cells.set(x, y, value);
    return cells;
}

describe("captureStamp", () => {
    it("keeps the rectangle when its border holds cells, empty cells included", () => {
        const cells = store([
            [2, 2, v(1, 5)],
            [4, 3, v(2, 3)],
        ]);
        expect(captureStamp(cells, { x: 2, y: 2, width: 3, height: 2 })).toEqual({
            width: 3,
            height: 2,
            cells: Uint32Array.from([v(1, 5), 0, 0, 0, 0, v(2, 3)]),
        });
    });

    it("cuts empty rows and columns on the border", () => {
        const cells = store([
            [5, 6, v(0)],
            [6, 7, v(3, 7)],
        ]);
        expect(captureStamp(cells, { x: 0, y: 0, width: 10, height: 10 })).toEqual({
            width: 2,
            height: 2,
            cells: Uint32Array.from([v(0), 0, 0, v(3, 7)]),
        });
    });

    it("reads only the rectangle", () => {
        const cells = store([
            [0, 0, v(1)],
            [3, 3, v(2)],
        ]);
        expect(captureStamp(cells, { x: 2, y: 2, width: 2, height: 2 })).toEqual({
            width: 1,
            height: 1,
            cells: Uint32Array.from([v(2)]),
        });
    });

    it("makes no stamp of empty cells", () => {
        expect(captureStamp(store([[9, 9, v(1)]]), { x: 0, y: 0, width: 4, height: 4 })).toBeNull();
    });
});

describe("withCapture", () => {
    const project = createProject({
        newId: sequentialIds(),
        map: { width: 8, height: 8, tileWidth: 16, tileHeight: 16 },
    });
    const map = project.maps[0]!;
    const layer = map.layers[0] as TileLayer;
    layer.cells.set(2, 3, v(1, 6));

    function context(button: ToolContext["button"]): ToolContext {
        return {
            session: createProjectSession(project),
            history: null as never,
            map,
            layerId: layer.id,
            button,
            options: {},
            paint: null,
            feedback: () => {},
            openGesture: () => {},
            closeGesture: () => {},
        };
    }

    function pointer(
        x: number,
        y: number,
        button: ToolPointer["button"],
        modifiers: Partial<ToolModifiers> = {},
    ): ToolPointer {
        return {
            client: { x: 0, y: 0 },
            device: { x: 0, y: 0 },
            position: { x: x * 16, y: y * 16 },
            cell: { x, y },
            cells: [{ x, y }],
            inside: true,
            button,
            modifiers: { shift: false, ctrl: false, alt: false, meta: false, ...modifiers },
            time: 0,
        };
    }

    const own = { onDown: vi.fn(), onUp: vi.fn() };
    const fill = withCapture({ id: "fill", label: "Fill", paints: true, ...own });

    it("paints on the left button only", () => {
        const paints = fill.paints as (button: "primary" | "secondary") => boolean;
        expect(paints("primary")).toBe(true);
        expect(paints("secondary")).toBe(false);
    });

    it("captures on a right press and release, the tool's own handlers left alone", () => {
        setCurrentStamp(null);
        const right = context("secondary");
        fill.onDown!(right, pointer(1, 1, "secondary"));
        fill.onUp!(right, pointer(3, 4, "secondary"));
        expect(currentStamp()).toEqual({ width: 1, height: 1, cells: Uint32Array.from([v(1, 6)]) });
        expect(own.onDown).not.toHaveBeenCalled();
        expect(own.onUp).not.toHaveBeenCalled();
    });

    it("leaves a left press to the tool, and a Ctrl+right press uncaptured", () => {
        setCurrentStamp(null);
        const left = context("primary");
        fill.onDown!(left, pointer(2, 3, "primary"));
        fill.onUp!(left, pointer(2, 3, "primary"));
        expect(own.onDown).toHaveBeenCalledTimes(1);
        expect(own.onUp).toHaveBeenCalledTimes(1);

        const right = context("secondary");
        fill.onDown!(right, pointer(2, 3, "secondary", { ctrl: true }));
        fill.onUp!(right, pointer(2, 3, "secondary", { ctrl: true }));
        expect(currentStamp()).toBeNull();
    });
});
