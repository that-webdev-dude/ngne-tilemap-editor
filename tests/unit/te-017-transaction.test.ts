import { describe, expect, it } from "vitest";
import {
    AllocationError,
    BYTES_PER_PATCHED_CELL,
    CELL_PATCH_OVERHEAD_BYTES,
    TransactionError,
} from "../../src/core/history";
import type { HistoryChange } from "../../src/core/history";
import { createMarkerLayer, createTileLayer } from "../../src/core/model";
import type { TileLayer } from "../../src/core/model";
import { LAYER, MAP, commit, redo, setup, tile, undo } from "./te-006-support";

// TE-017: a stroke transaction writes other tile layers of its map when a tool names them (the
// eraser's all layers, SPEC §4.3): SPEC §3 records `(layer, index, before, after)`, so the
// cells of every layer are one entry, undone and redone together, aborted together.

const TOP = 2;
const MARKERS = 3;

function setupTwoLayers() {
    const history = setup();
    const map = history.session.project.maps[0]!;
    map.layers.push(createTileLayer(TOP, "Top"), createMarkerLayer(MARKERS, "Markers"));
    map.nextLayerId = 4;
    const layer = (id: number) => map.layers.find((each) => each.id === id) as TileLayer;
    layer(LAYER).cells.set(1, 1, tile(0));
    layer(TOP).cells.set(1, 1, tile(1));
    layer(TOP).cells.set(2, 3, tile(1));
    return { history, ground: layer(LAYER), top: layer(TOP) };
}

describe("Transaction on several layers", () => {
    it("commits the cells of every layer written as one entry", () => {
        const { history, ground, top } = setupTwoLayers();
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.set(1, 1, 0);
        stroke.set(1, 1, 0, TOP);
        stroke.set(2, 3, 0, TOP);
        expect(stroke.get(2, 3, TOP)).toBe(0);
        expect(stroke.layerIds).toEqual([LAYER, TOP]);
        expect(stroke.changedCount).toBe(3);
        expect(stroke.dirty).toEqual({ x: 1, y: 1, width: 2, height: 3 });

        const command = commit(history, "Eraser");
        expect(command).not.toBeNull();
        // 12 bytes a cell, plus the overhead of each layer's patch.
        expect(command!.bytes).toBe(3 * BYTES_PER_PATCHED_CELL + 2 * CELL_PATCH_OVERHEAD_BYTES);
        expect(changes).toHaveLength(1);
        expect(changes[0]!.label).toBe("Eraser");
        expect(changes[0]!.touched.layerIds.sort()).toEqual([LAYER, TOP]);

        undo(history);
        expect(ground.cells.get(1, 1)).toBe(tile(0));
        expect(top.cells.get(1, 1)).toBe(tile(1));
        expect(top.cells.get(2, 3)).toBe(tile(1));
        expect(history.canUndo).toBe(false);
        redo(history);
        expect(ground.cells.get(1, 1)).toBe(0);
        expect(top.cells.get(1, 1)).toBe(0);
        expect(top.cells.get(2, 3)).toBe(0);
    });

    it("aborts the cells of every layer", () => {
        const { history, ground, top } = setupTwoLayers();
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.set(1, 1, 0, TOP);
        stroke.set(1, 1, tile(1));
        stroke.abort();
        expect(ground.cells.get(1, 1)).toBe(tile(0));
        expect(top.cells.get(1, 1)).toBe(tile(1));
        expect(history.canUndo).toBe(false);
    });

    it("makes one patch when only another layer changed, and none when nothing did", () => {
        const { history, top } = setupTwoLayers();
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        // The own layer is written back to its value: only the other layer changed.
        stroke.set(0, 0, tile(1));
        stroke.set(0, 0, 0);
        stroke.set(2, 3, 0, TOP);
        const command = commit(history, "Eraser");
        expect(command!.bytes).toBe(BYTES_PER_PATCHED_CELL + CELL_PATCH_OVERHEAD_BYTES);
        expect(command!.touched.layerIds).toEqual([TOP]);
        undo(history);
        expect(top.cells.get(2, 3)).toBe(tile(1));

        const idle = history.begin({ mapId: MAP, layerId: LAYER });
        idle.set(2, 3, 0, TOP);
        idle.set(2, 3, tile(1), TOP);
        expect(commit(history, "Eraser")).toBeNull();
        expect(history.canRedo).toBe(true);
    });

    it("refuses a layer that is not a tile layer of the map, leaving the stroke open", () => {
        const { history } = setupTwoLayers();
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        expect(() => stroke.set(0, 0, 0, MARKERS)).toThrow(TransactionError);
        expect(() => stroke.set(0, 0, 0, 99)).toThrow(TransactionError);
        expect(() => stroke.get(0, 0, 99)).toThrow(TransactionError);
        expect(stroke.open).toBe(true);
        expect(stroke.layerIds).toEqual([]);
        stroke.abort();
    });

    it("restores every layer when the entry cannot be allocated", () => {
        const history = setup({
            allocate: () => {
                throw new AllocationError(24);
            },
        });
        const map = history.session.project.maps[0]!;
        map.layers.push(createTileLayer(TOP, "Top"));
        map.nextLayerId = 3;
        const top = map.layers[1] as TileLayer;
        top.cells.set(4, 4, tile(1));
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.set(4, 4, tile(0));
        stroke.set(4, 4, 0, TOP);
        expect(() => stroke.commit("Eraser")).toThrow(AllocationError);
        expect((map.layers[0] as TileLayer).cells.get(4, 4)).toBe(0);
        expect(top.cells.get(4, 4)).toBe(tile(1));
        expect(history.canUndo).toBe(false);
    });
});
