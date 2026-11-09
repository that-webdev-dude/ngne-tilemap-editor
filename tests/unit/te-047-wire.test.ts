import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, CellStore } from "../../src/core/cells/store";
import {
    createGroupLayer,
    createProject,
    createTileLayer,
    sequentialIds,
} from "../../src/core/model";
import type { TileLayer } from "../../src/core/model";
import { projectFromWire, projectToWire, serialize, wireBuffers } from "../../src/core/project";

// TE-047: the plain form a project crosses to and from the background worker in (Save and
// Open run the codec there), and the cell store built from transferred chunks.

/** A project whose first map holds a tile layer with cells far apart and a group with one. */
function projectWithCells() {
    const project = createProject({
        newId: sequentialIds("w"),
        map: { width: 100, height: 70 },
    });
    const map = project.maps[0]!;
    const layer = map.layers[0] as TileLayer;
    // Values with a slot and no tileset are fine for the plain form; the writer is not run here.
    layer.cells.set(0, 0, 0x0100_0001);
    layer.cells.set(99, 69, 0x0100_0002);
    const child = createTileLayer(3, "Child");
    child.cells.set(40, 2, 0x0100_0003);
    const group = createGroupLayer(2, "Group");
    group.layers.push(child);
    map.layers.push(group);
    map.nextLayerId = 4;
    return project;
}

describe("te-047 project wire form", () => {
    it("survives structured cloning with every cell, and shares the chunk arrays it was given", () => {
        const project = projectWithCells();
        const wire = projectToWire(project);
        const copy = structuredClone(wire);
        const back = projectFromWire(copy);
        const layer = back.maps[0]!.layers[0] as TileLayer;
        expect(layer.cells).toBeInstanceOf(CellStore);
        expect(layer.cells.count).toBe(2);
        expect(layer.cells.get(99, 69)).toBe(0x0100_0002);
        const group = back.maps[0]!.layers[1]!;
        expect(group.type === "group" && (group.layers[0] as TileLayer).cells.get(40, 2)).toBe(
            0x0100_0003,
        );
        // The rebuilt store adopts the arrays of the wire form: nothing is copied on the page.
        const [first] =
            copy.maps[0]!.layers[0]!.type === "tile" ? copy.maps[0]!.layers[0]!.cells : [];
        expect([...layer.cells.allChunks()].some((chunk) => chunk.cells === first!.cells)).toBe(
            true,
        );
        // Every chunk buffer is listed for transfer, once.
        expect(wireBuffers(copy)).toHaveLength(3);
    });

    it("writes the same file before and after the round trip", () => {
        const project = createProject({ newId: sequentialIds("s"), map: { width: 9, height: 9 } });
        const back = projectFromWire(structuredClone(projectToWire(project)));
        expect(serialize(back)).toEqual(serialize(project));
    });
});

describe("te-047 CellStore.fromChunks", () => {
    const chunk = (cx: number, cy: number, values: [number, number][] = []) => {
        const cells = new Uint32Array(CHUNK_SIZE * CHUNK_SIZE);
        for (const [index, value] of values) cells[index] = value;
        return { cx, cy, cells };
    };

    it("counts the cells and leaves empty chunks out", () => {
        const store = CellStore.fromChunks([chunk(0, 0, [[5, 0x0100_0001]]), chunk(1, 0)]);
        expect(store.count).toBe(1);
        expect(store.chunkCount).toBe(1);
        expect(store.get(5, 0)).toBe(0x0100_0001);
        store.set(5, 0, 0);
        expect(store.count).toBe(0);
        expect(store.chunkCount).toBe(0);
    });

    it("refuses a wrong length, a chunk given twice and a value that is no cell", () => {
        expect(() => CellStore.fromChunks([{ cx: 0, cy: 0, cells: new Uint32Array(3) }])).toThrow(
            RangeError,
        );
        expect(() =>
            CellStore.fromChunks([
                chunk(2, 2, [[0, 0x0100_0001]]),
                chunk(2, 2, [[1, 0x0100_0001]]),
            ]),
        ).toThrow(RangeError);
        // Slot 0 with a tile: not an in-memory cell value.
        expect(() => CellStore.fromChunks([chunk(0, 0, [[0, 0x0000_0001]])])).toThrow(RangeError);
    });
});
