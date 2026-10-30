import { describe, expect, it } from "vitest";
import { cellValue } from "../../src/core/cells";
import {
    BYTES_PER_PATCHED_CELL,
    CELL_PATCH_OVERHEAD_BYTES,
    TransactionError,
    cellPatchCommand,
} from "../../src/core/history";
import type { HistoryChange } from "../../src/core/history";
import { createMarkerLayer } from "../../src/core/model";
import { snapshotProject } from "./support/symmetry";
import {
    LAYER,
    MAP,
    cellsOf,
    commit,
    execute,
    paintRect,
    redo,
    rename,
    setup,
    tile,
    tileLayer,
    undo,
} from "./te-006-support";

// Stroke transactions of SPEC §3: `begin` snapshots nothing, writes record a cell's value at
// `begin` on its first change, `commit` makes one command of 12 bytes a cell plus a fixed
// overhead, `abort` restores every changed cell, a stroke that changes nothing makes no entry.

describe("Transaction", () => {
    it("begins on a tile layer of a map and refuses any other target", () => {
        const history = setup();
        const map = history.session.project.maps[0]!;
        map.layers.push(createMarkerLayer(2, "Markers"));
        map.nextLayerId = 3;

        expect(() => history.begin({ mapId: "none", layerId: LAYER })).toThrow(TransactionError);
        expect(() => history.begin({ mapId: MAP, layerId: 9 })).toThrow(TransactionError);
        expect(() => history.begin({ mapId: MAP, layerId: 2 })).toThrow(TransactionError);
        expect(history.transaction).toBeNull();

        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        expect(history.transaction).toBe(stroke);
        expect(stroke.open).toBe(true);
        expect(stroke.dirty).toBeNull();
        expect(stroke.changedCount).toBe(0);
        expect(stroke.map).toBe(map);
        stroke.abort();
    });

    it("writes cells as the stroke goes and commits them as one entry", () => {
        const history = setup();
        const layer = tileLayer(history.session.project);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        paintRect(stroke, { x: 1, y: 2, width: 3, height: 2 }, tile(1));
        expect(layer.cells.get(1, 2)).toBe(tile(1));
        expect(stroke.get(3, 3)).toBe(tile(1));
        expect(stroke.dirty).toEqual({ x: 1, y: 2, width: 3, height: 2 });
        expect(stroke.changedCount).toBe(6);
        const command = commit(history, "Stamp Brush");

        expect(command).not.toBeNull();
        expect(command!.label).toBe("Stamp Brush");
        expect(command!.bytes).toBe(6 * BYTES_PER_PATCHED_CELL + CELL_PATCH_OVERHEAD_BYTES);
        expect(command!.touched).toEqual({
            mapId: MAP,
            layerIds: [LAYER],
            cellRects: [{ x: 1, y: 2, width: 3, height: 2 }],
            tilesetIds: [],
            structure: false,
        });
        expect(stroke.open).toBe(false);
        expect(history.transaction).toBeNull();
        expect(history.undoCount).toBe(1);
        expect(history.undoLabel).toBe("Stamp Brush");
        expect(history.bytes).toBe(command!.bytes);
        expect(changes).toEqual([{ kind: "do", label: "Stamp Brush", touched: command!.touched }]);

        undo(history);
        expect(layer.cells.count).toBe(0);
        redo(history);
        expect(cellsOf(layer, 8, 8)).toHaveLength(6);
        expect(layer.cells.get(3, 3)).toBe(tile(1));
    });

    it("records a cell's value at begin on its first write only", () => {
        const history = setup();
        const layer = tileLayer(history.session.project);
        layer.cells.set(0, 0, tile(0));
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });

        stroke.set(0, 0, tile(1));
        stroke.set(0, 0, 0);
        stroke.set(0, 0, cellValue(1, 1, 5));
        stroke.set(1, 0, tile(1));
        stroke.set(1, 0, tile(0));
        const command = commit(history, "Stamp Brush");

        expect(command!.bytes).toBe(2 * BYTES_PER_PATCHED_CELL + CELL_PATCH_OVERHEAD_BYTES);
        undo(history);
        expect(layer.cells.get(0, 0)).toBe(tile(0));
        expect(layer.cells.get(1, 0)).toBe(0);
        redo(history);
        expect(layer.cells.get(0, 0)).toBe(cellValue(1, 1, 5));
        expect(layer.cells.get(1, 0)).toBe(tile(0));
    });

    it("stores 12 bytes per changed cell: cells written back to their value at begin cost nothing", () => {
        const history = setup();
        const layer = tileLayer(history.session.project);
        layer.cells.set(2, 2, tile(0));
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });

        paintRect(stroke, { x: 0, y: 0, width: 4, height: 4 }, tile(1));
        stroke.set(2, 2, tile(0));
        stroke.set(3, 3, 0);
        expect(stroke.changedCount).toBe(14);
        const command = commit(history, "Stamp Brush");

        expect(command!.bytes).toBe(14 * BYTES_PER_PATCHED_CELL + CELL_PATCH_OVERHEAD_BYTES);
        expect(command!.touched.cellRects).toEqual([{ x: 0, y: 0, width: 4, height: 4 }]);
        undo(history);
        expect(cellsOf(layer, 8, 8)).toEqual([[2, 2, tile(0)]]);
    });

    it("abort restores every changed cell, including emptied ones, and adds no entry", () => {
        const history = setup();
        const layer = tileLayer(history.session.project);
        layer.cells.set(0, 0, tile(0));
        layer.cells.set(7, 7, tile(1));
        execute(history, rename("a"));
        const before = snapshotProject(history.session.project);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        paintRect(stroke, { x: 0, y: 0, width: 8, height: 8 }, tile(1));
        stroke.set(7, 7, 0);
        expect(layer.cells.count).toBe(63);
        stroke.abort();

        expect(stroke.open).toBe(false);
        expect(history.transaction).toBeNull();
        expect(snapshotProject(history.session.project)).toStrictEqual(before);
        expect(cellsOf(layer, 8, 8)).toEqual([
            [0, 0, tile(0)],
            [7, 7, tile(1)],
        ]);
        expect(history.undoCount).toBe(1);
        expect(changes).toEqual([]);
    });

    it("a stroke that changes nothing makes no entry", () => {
        const history = setup();
        const layer = tileLayer(history.session.project);
        layer.cells.set(1, 1, tile(0));
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));
        const before = snapshotProject(history.session.project);

        const empty = history.begin({ mapId: MAP, layerId: LAYER });
        expect(commit(history, "Stamp Brush")).toBeNull();
        expect(empty.open).toBe(false);

        const undone = history.begin({ mapId: MAP, layerId: LAYER });
        undone.set(1, 1, tile(1));
        undone.set(1, 1, tile(0));
        undone.set(3, 3, tile(1));
        undone.set(3, 3, 0);
        expect(undone.changedCount).toBe(0);
        expect(commit(history, "Stamp Brush")).toBeNull();

        expect(snapshotProject(history.session.project)).toStrictEqual(before);
        expect(history.undoCount).toBe(0);
        expect(history.bytes).toBe(0);
        expect(changes).toEqual([]);
        expect(history.transaction).toBeNull();
    });

    it("refuses a cell outside the map or a value that is no cell value, leaving the layer as it was", () => {
        const history = setup();
        const layer = tileLayer(history.session.project);
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });

        expect(() => stroke.set(8, 0, tile(1))).toThrow(RangeError);
        expect(() => stroke.set(0, -1, tile(1))).toThrow(RangeError);
        expect(() => stroke.set(1.5, 0, tile(1))).toThrow(RangeError);
        expect(() => stroke.set(0, 0, 0x10000000)).toThrow(RangeError);

        expect(layer.cells.count).toBe(0);
        expect(stroke.dirty).toBeNull();
        expect(commit(history, "Stamp Brush")).toBeNull();
    });

    it("rejects every call once closed", () => {
        const history = setup();
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.abort();

        expect(() => stroke.set(0, 0, tile(1))).toThrow(TransactionError);
        expect(() => stroke.commit("x")).toThrow(TransactionError);
        expect(() => stroke.abort()).toThrow(TransactionError);
    });

    it("commits an extra command with the cells, after them, and alone when no cell changed", () => {
        const history = setup();
        const layer = tileLayer(history.session.project);

        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.set(0, 0, tile(1));
        const extra = rename("moved");
        extra.do(history.session);
        const both = commit(history, "Move", extra);
        expect(both!.bytes).toBe(BYTES_PER_PATCHED_CELL + CELL_PATCH_OVERHEAD_BYTES);
        expect(both!.touched.mapId).toBe(MAP);
        undo(history);
        expect(history.session.project.name).toBe("Untitled");
        expect(layer.cells.count).toBe(0);
        redo(history);
        expect(history.session.project.name).toBe("moved");
        expect(layer.cells.get(0, 0)).toBe(tile(1));

        const nothing = history.begin({ mapId: MAP, layerId: LAYER });
        const only = rename("again");
        only.do(history.session);
        expect(nothing.open).toBe(true);
        expect(commit(history, "Move", only)).toBe(only);
        expect(history.undoCount).toBe(2);
        undo(history);
        expect(history.session.project.name).toBe("moved");
    });

    it("reverses a commit whose cells break an invariant and keeps no entry", () => {
        const history = setup();
        const layer = tileLayer(history.session.project);
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.set(0, 0, cellValue(2, 0));

        expect(() => stroke.commit("Stamp Brush")).toThrow(/cell-tile-exists/);

        expect(layer.cells.count).toBe(0);
        expect(history.undoCount).toBe(0);
        expect(history.transaction).toBeNull();
    });
});

describe("cellPatchCommand", () => {
    it("writes after on do and before on undo, by index of the map's width", () => {
        const history = setup();
        const layer = tileLayer(history.session.project);
        layer.cells.set(3, 1, tile(0));
        const words = Uint32Array.from([3 + 1 * 8, tile(0), tile(1), 0 + 2 * 8, 0, tile(1)]);
        const command = cellPatchCommand({
            label: "Patch",
            mapId: MAP,
            layerId: LAYER,
            width: 8,
            words,
            cellRect: { x: 0, y: 1, width: 4, height: 2 },
        });
        expect(command.bytes).toBe(2 * BYTES_PER_PATCHED_CELL + CELL_PATCH_OVERHEAD_BYTES);

        execute(history, command);
        expect(cellsOf(layer, 8, 8)).toEqual([
            [3, 1, tile(1)],
            [0, 2, tile(1)],
        ]);
        undo(history);
        expect(cellsOf(layer, 8, 8)).toEqual([[3, 1, tile(0)]]);
    });

    it("throws naming a missing map or layer", () => {
        const history = setup();
        const patch = {
            label: "Patch",
            width: 8,
            words: new Uint32Array(0),
            cellRect: { x: 0, y: 0, width: 1, height: 1 },
        };
        expect(() =>
            history.execute(cellPatchCommand({ ...patch, mapId: "none", layerId: LAYER })),
        ).toThrow('no map "none"');
        expect(() =>
            history.execute(cellPatchCommand({ ...patch, mapId: MAP, layerId: 7 })),
        ).toThrow("no layer 7");
    });
});
