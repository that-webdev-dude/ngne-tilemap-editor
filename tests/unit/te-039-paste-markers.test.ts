import { beforeEach, describe, expect, it } from "vitest";
import {
    clipboardContent,
    clipboardMarkers,
    clipboardStore,
    copyCellsToClipboard,
    copyMarkersToClipboard,
} from "../../src/app/clipboard/clipboard";
import { nudgedPoints } from "../../src/app/markers/points/markerVertex";
import type { History } from "../../src/core/history";
import { MARKER_LABELS, MarkerEditError, pasteMarkersCommand } from "../../src/core/markers";
import type { NewMarker } from "../../src/core/markers";
import {
    MAX_MARKERS,
    MAX_MARKER_ID,
    assertInvariants,
    createMarkerLayer,
} from "../../src/core/model";
import type { Marker, MarkerLayer, ProjectMap } from "../../src/core/model";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { MAP, setup } from "./te-006-support";

// TE-039: paste of markers (SPEC §8) as one entry that keeps each marker's geometry, name, class
// and properties and gives it a new ID from `nextMarkerId`, passing the TE-006 symmetry harness;
// FORMAT's limits refused with nothing changed; the clipboard holds cells or markers, the last
// copy wins; a nudged point.
//
// The map of `setup` is 8 × 8 with one tile layer (ID 1); `furnish` adds marker layer 2 with
// markers 1 and 2, nextMarkerId 3.

const ZONE: Marker = {
    shape: "polygon",
    x: 10,
    y: 10,
    points: [
        [0, 0],
        [8, 0],
        [8, 8],
    ],
    id: 1,
    name: "Zone",
    class: "area",
    properties: [{ name: "depth", type: "int", value: 3 }],
};
const DOOR: Marker = {
    shape: "rectangle",
    x: 0,
    y: 16,
    width: 16,
    height: 8,
    id: 2,
    name: "Door",
    class: "",
    properties: [],
};

function furnish(history: History): ProjectMap {
    const map = history.session.project.maps[0]!;
    const layer = createMarkerLayer(2, "Markers");
    layer.markers.push(structuredClone(ZONE), structuredClone(DOOR));
    map.layers.push(layer);
    map.nextLayerId = 3;
    map.nextMarkerId = 3;
    assertInvariants(history.session.project);
    return map;
}

const layerOf = (map: ProjectMap) => map.layers.find((each) => each.id === 2) as MarkerLayer;
const withoutId = (marker: Marker): NewMarker => {
    const copy: Partial<Marker> = structuredClone(marker);
    delete copy.id;
    return copy as NewMarker;
};
const copied = (): NewMarker[] => [ZONE, DOOR].map((marker) => withoutId(structuredClone(marker)));

describe("pasteMarkersCommand", () => {
    it("adds the markers on top with new IDs, geometry and fields kept; symmetric", () => {
        const history = setup();
        const map = furnish(history);
        history.session.perMap.get(MAP)!.markerSelection = [2];
        const command = pasteMarkersCommand(MAP, 2, copied());
        expect(command.markerIds).toEqual([]);
        expectSymmetric(history, command);
        expect(command.label).toBe(MARKER_LABELS.paste);
        expect(command.markerIds).toEqual([3, 4]);
        expect(layerOf(map).markers).toEqual([ZONE, DOOR, { ...ZONE, id: 3 }, { ...DOOR, id: 4 }]);
        expect(map.nextMarkerId).toBe(5);
        // The selection is the caller's: kept by the command, put back by undo.
        expect(history.session.perMap.get(MAP)!.markerSelection).toEqual([2]);
        assertInvariants(history.session.project);
    });

    it("undo leaves nextMarkerId raised; redo puts back the same IDs; a new paste takes new ones", () => {
        const history = setup();
        const map = furnish(history);
        const first = pasteMarkersCommand(MAP, 2, copied());
        history.execute(first);
        history.session.perMap.get(MAP)!.markerSelection = [...first.markerIds];
        history.undo();
        expect(layerOf(map).markers.map((each) => each.id)).toEqual([1, 2]);
        expect(history.session.perMap.get(MAP)!.markerSelection).toEqual([]);
        expect(map.nextMarkerId).toBe(5);
        history.redo();
        expect(layerOf(map).markers.map((each) => each.id)).toEqual([1, 2, 3, 4]);
        history.undo();
        const second = pasteMarkersCommand(MAP, 2, copied());
        history.execute(second);
        expect(second.markerIds).toEqual([5, 6]);
    });

    it("keeps no reference to the markers it was given", () => {
        const history = setup();
        const map = furnish(history);
        const input = copied();
        history.execute(pasteMarkersCommand(MAP, 2, input));
        (input[0] as Extract<NewMarker, { points: unknown }>).points[1]![0] = 99;
        input[1]!.name = "Changed";
        expect(layerOf(map).markers[2]).toEqual({ ...ZONE, id: 3 });
        expect(layerOf(map).markers[3]!.name).toBe("Door");
    });

    it("refuses no marker, a layer of another kind, too many markers and used-up IDs", () => {
        const history = setup();
        const map = furnish(history);
        const before = snapshotProject(history.session.project);
        const refused = (run: () => void, code: string) => {
            let caught: unknown = null;
            try {
                run();
            } catch (error) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(MarkerEditError);
            expect((caught as MarkerEditError).code).toBe(code);
            expect(snapshotProject(history.session.project)).toStrictEqual(before);
            expect(history.undoCount).toBe(0);
        };
        refused(() => pasteMarkersCommand(MAP, 2, []), "missing");
        refused(() => history.execute(pasteMarkersCommand(MAP, 1, copied())), "kind");
        refused(
            () => pasteMarkersCommand(MAP, 2, [{ shape: "point", x: 2_000_000, y: 0 }]),
            "values",
        );
        map.nextMarkerId = MAX_MARKER_ID - 1;
        const ids = snapshotProject(history.session.project);
        let caught: unknown = null;
        try {
            history.execute(pasteMarkersCommand(MAP, 2, copied()));
        } catch (error) {
            caught = error;
        }
        expect((caught as MarkerEditError).code).toBe("limit");
        expect(snapshotProject(history.session.project)).toStrictEqual(ids);
        map.nextMarkerId = 3;

        const layer = layerOf(map);
        let id = 3;
        while (layer.markers.length < MAX_MARKERS - 1) {
            layer.markers.push({
                shape: "point",
                x: 0,
                y: 0,
                id: id++,
                name: "",
                class: "",
                properties: [],
            });
        }
        map.nextMarkerId = id;
        const full = snapshotProject(history.session.project);
        caught = null;
        try {
            history.execute(pasteMarkersCommand(MAP, 2, copied()));
        } catch (error) {
            caught = error;
        }
        expect((caught as MarkerEditError).code).toBe("limit");
        expect(snapshotProject(history.session.project)).toStrictEqual(full);
        // One marker still fits.
        history.execute(pasteMarkersCommand(MAP, 2, copied().slice(1)));
        expect(layer.markers.length).toBe(MAX_MARKERS);
    });
});

describe("the clipboard holds cells or markers, the last copy wins", () => {
    beforeEach(() => clipboardStore.setState({ content: null, markers: null }));

    it("copies markers without IDs, unlinked from the map", () => {
        const zone = structuredClone(ZONE);
        copyMarkersToClipboard([zone, DOOR]);
        expect(clipboardMarkers()).toEqual(copied());
        zone.points[0]![0] = 50;
        zone.name = "Changed";
        expect(clipboardMarkers()![0]).toEqual(withoutId(ZONE));
    });

    it("a cell copy replaces markers, and a marker copy replaces cells", () => {
        copyMarkersToClipboard([DOOR]);
        copyCellsToClipboard({ width: 1, height: 1, cells: Uint32Array.of(5) });
        expect(clipboardMarkers()).toBeNull();
        expect(clipboardContent()?.stamp.cells).toEqual(Uint32Array.of(5));
        copyMarkersToClipboard([DOOR]);
        expect(clipboardContent()).toBeNull();
        expect(clipboardMarkers()).toEqual([withoutId(DOOR)]);
    });
});

describe("nudgedPoints", () => {
    it("moves one point relative to the position and leaves the others", () => {
        expect(nudgedPoints(ZONE as Extract<Marker, { points: unknown }>, 1, -1, 16)).toEqual([
            [0, 0],
            [7, 16],
            [8, 8],
        ]);
        expect(ZONE.points[1]).toEqual([8, 0]);
    });
});
