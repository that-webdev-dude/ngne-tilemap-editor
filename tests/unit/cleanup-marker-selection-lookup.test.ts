import { describe, expect, it } from "vitest";
import { selectedMarkerIds, selectedMarkers } from "../../src/app/markers/markerSelection";
import { createGroupLayer, createMarkerLayer } from "../../src/core/model";
import type { Marker, ProjectMap } from "../../src/core/model";
import { MAP, setup } from "./te-006-support";

// M4 review, finding 3: the selection lookup takes one index of the map's markers per call
// instead of a search of every marker per selected ID. These tests pin what the lookup returns:
// selection order, IDs of removed markers left out, markers inside groups found, and an empty
// selection. The cost is measured by tests/perf/cleanup-pan-selection.perf.ts.

const point = (id: number, x: number): Marker => ({
    shape: "point",
    x,
    y: 0,
    id,
    name: `M${id}`,
    class: "",
    properties: [],
});

/** Marker layer 2 (markers 1–3) on top of the tile layer, group 3 holding marker layer 4 (5). */
function furnished() {
    const history = setup();
    const map: ProjectMap = history.session.project.maps[0]!;
    const top = createMarkerLayer(2, "Top");
    top.markers.push(point(1, 0), point(2, 8), point(3, 16));
    const group = createGroupLayer(3, "Group");
    const inner = createMarkerLayer(4, "Inner");
    inner.markers.push(point(5, 24));
    group.layers.push(inner);
    map.layers.push(top, group);
    map.nextLayerId = 5;
    map.nextMarkerId = 6;
    const select = (ids: number[]) => {
        history.session.perMap.get(MAP)!.markerSelection = ids;
    };
    return { session: history.session, map, select };
}

describe("selection lookup", () => {
    it("returns the selected markers in selection order, including those in groups", () => {
        const { session, map, select } = furnished();
        select([5, 3, 1]);
        expect(selectedMarkerIds(session, map)).toEqual([5, 3, 1]);
        expect(selectedMarkers(session, map).map((marker) => marker.name)).toEqual([
            "M5",
            "M3",
            "M1",
        ]);
    });

    it("leaves out IDs of markers the map no longer has", () => {
        const { session, map, select } = furnished();
        select([2, 9, 5, 4]);
        expect(selectedMarkerIds(session, map)).toEqual([2, 5]);
        expect(selectedMarkers(session, map).map((marker) => marker.id)).toEqual([2, 5]);
    });

    it("returns the markers themselves, not copies", () => {
        const { session, map, select } = furnished();
        select([2]);
        const top = map.layers.find((layer) => layer.id === 2)!;
        expect(top.type === "marker" && selectedMarkers(session, map)[0] === top.markers[1]).toBe(
            true,
        );
    });

    it("is empty for an empty selection", () => {
        const { session, map, select } = furnished();
        select([]);
        expect(selectedMarkerIds(session, map)).toEqual([]);
        expect(selectedMarkers(session, map)).toEqual([]);
    });
});
