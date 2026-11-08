import { describe, expect, it } from "vitest";
import { dragBox } from "../../src/app/markers/create/markerCreate.tools";
import {
    alignOf,
    bandOf,
    editableMarkers,
    markerAt,
    markersInBand,
    selectionBox,
    snapCoord,
    snapPoint,
    snappedMove,
} from "../../src/app/markers/markerGeometry";
import {
    createGroupLayer,
    createMarkerLayer,
    createProject,
    sequentialIds,
} from "../../src/core/model";
import type { Marker, ProjectMap } from "../../src/core/model";

// TE-038: the geometry of the marker tools (SPEC §8): snapping to the map's tile grid, the move
// of a drag (Tiled's align position), what a press and a rubber band take, the selection's box.

const base = { name: "", class: "", properties: [] };

function testMap(): ProjectMap {
    const project = createProject({
        name: "P",
        newId: sequentialIds("p"),
        map: { name: "M", width: 20, height: 20, tileWidth: 16, tileHeight: 8 },
    });
    const map = project.maps[0]!;
    const low = createMarkerLayer(2, "Low");
    low.markers.push(
        { ...base, id: 1, shape: "rectangle", x: 10, y: 10, width: 40, height: 20 },
        { ...base, id: 2, shape: "ellipse", x: 100, y: 100, width: 40, height: 40 },
    );
    const high = createMarkerLayer(3, "High");
    high.markers.push(
        { ...base, id: 3, shape: "rectangle", x: 20, y: 15, width: 10, height: 10 },
        {
            ...base,
            id: 4,
            shape: "polygon",
            x: 200,
            y: 0,
            points: [
                [0, 0],
                [40, 0],
                [0, 40],
            ],
        },
        { ...base, id: 5, shape: "point", x: 300, y: 300 },
    );
    const locked = createMarkerLayer(4, "Locked");
    locked.locked = true;
    locked.markers.push({
        ...base,
        id: 6,
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 500,
        height: 500,
    });
    const group = createGroupLayer(5, "Hidden group");
    group.visible = false;
    const inner = createMarkerLayer(6, "Inner");
    inner.markers.push({ ...base, id: 7, shape: "rectangle", x: 0, y: 0, width: 500, height: 500 });
    group.layers.push(inner);
    map.layers.push(low, high, locked, group);
    return map;
}

const view = { centreX: 0, centreY: 0 };
const ids = (entries: { marker: Marker }[]) => entries.map(({ marker }) => marker.id);

describe("snapping (Snap to Grid: the map's tile size; off: whole pixels)", () => {
    it("places a coordinate on the nearest multiple of the step, or the nearest pixel", () => {
        expect(snapCoord(23.9, 16, true)).toBe(16);
        expect(snapCoord(24, 16, true)).toBe(32);
        expect(snapCoord(-7.9, 16, true)).toBe(0);
        expect(Object.is(snapCoord(-7.9, 16, true), -0)).toBe(false);
        expect(snapCoord(23.4, 16, false)).toBe(23);
        expect(snapCoord(5e7, 16, true)).toBe(1_048_576);
        expect(snapPoint({ x: 23, y: 13 }, { tileWidth: 16, tileHeight: 8 }, true)).toEqual({
            x: 16,
            y: 16,
        });
    });

    it("moves markers so their least position lands on the grid (Tiled's align position)", () => {
        const grid = { tileWidth: 16, tileHeight: 8 };
        expect(snappedMove({ x: 10, y: 10 }, 30, 1, grid, true)).toEqual({ x: 38, y: -2 });
        expect(snappedMove({ x: 10, y: 10 }, 30.6, 1.2, grid, false)).toEqual({ x: 31, y: 1 });
        expect(
            alignOf([
                { shape: "point", x: 5, y: 9 },
                { shape: "point", x: 7, y: 2 },
            ]),
        ).toEqual({
            x: 5,
            y: 2,
        });
    });

    it("spans a drag box; Shift makes it square with the longer side", () => {
        expect(dragBox({ x: 32, y: 16 }, { x: 0, y: 40 }, false)).toEqual({
            x: 0,
            y: 16,
            width: 32,
            height: 24,
        });
        expect(dragBox({ x: 32, y: 16 }, { x: 0, y: 40 }, true)).toEqual({
            x: 0,
            y: 16,
            width: 32,
            height: 32,
        });
    });
});

describe("what the select tool takes", () => {
    it("takes markers of visible, unlocked marker layers only", () => {
        expect(ids(editableMarkers(testMap(), view))).toEqual([1, 2, 3, 4, 5]);
        expect(ids(editableMarkers(testMap(), view, true))).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("hits the topmost marker, or one of the active layer with Highlight Current Layer", () => {
        const entries = editableMarkers(testMap(), view);
        expect(markerAt(entries, { x: 25, y: 20 }, 1, 1)?.marker.id).toBe(3);
        expect(markerAt(entries, { x: 25, y: 20 }, 1, 1, 2)?.marker.id).toBe(1);
        // Near the outline, within the reach.
        expect(markerAt(entries, { x: 52, y: 12 }, 3, 1)?.marker.id).toBe(1);
        expect(markerAt(entries, { x: 55, y: 12 }, 3, 1)).toBeNull();
        // Inside the ellipse's box but outside the ellipse.
        expect(markerAt(entries, { x: 102, y: 102 }, 1, 1)).toBeNull();
        // A point by its pin, which stands above it.
        expect(markerAt(entries, { x: 300, y: 290 }, 1, 1)?.marker.id).toBe(5);
        expect(markerAt(entries, { x: 300, y: 310 }, 1, 1)).toBeNull();
    });

    it("hits a marker where its layer's offset draws it", () => {
        const map = testMap();
        const high = map.layers.find((layer) => layer.id === 3)!;
        high.offsetX = 100;
        const entries = editableMarkers(map, view);
        expect(markerAt(entries, { x: 125, y: 20 }, 1, 1)?.marker.id).toBe(3);
        expect(markerAt(entries, { x: 25, y: 20 }, 1, 1)?.marker.id).toBe(1);
    });

    it("takes what a rubber band touches, or with Alt what it encloses", () => {
        const entries = editableMarkers(testMap(), view);
        expect(
            ids(markersInBand(entries, bandOf({ x: 0, y: 0 }, { x: 22, y: 18 }), false)),
        ).toEqual([1, 3]);
        expect(ids(markersInBand(entries, bandOf({ x: 0, y: 0 }, { x: 60, y: 40 }), true))).toEqual(
            [1, 3],
        );
        // The ellipse's box corner only: not touched.
        expect(
            ids(markersInBand(entries, bandOf({ x: 95, y: 95 }, { x: 103, y: 103 }), false)),
        ).toEqual([]);
        // Beyond the polygon's diagonal edge: not touched; on it: touched.
        expect(
            ids(markersInBand(entries, bandOf({ x: 230, y: 30 }, { x: 240, y: 40 }), false)),
        ).toEqual([]);
        expect(
            ids(markersInBand(entries, bandOf({ x: 215, y: 15 }, { x: 240, y: 40 }), false)),
        ).toEqual([4]);
    });

    it("boxes a selection round its markers' boxes", () => {
        const map = testMap();
        const entries = editableMarkers(map, view);
        expect(selectionBox(entries.slice(0, 2).map(({ marker }) => marker))).toEqual({
            x: 10,
            y: 10,
            width: 130,
            height: 130,
        });
        expect(selectionBox([])).toBeNull();
    });
});
