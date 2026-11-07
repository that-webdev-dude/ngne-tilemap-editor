import { describe, expect, it } from "vitest";
import type { History } from "../../src/core/history";
import {
    MARKER_LABELS,
    MarkerEditError,
    addMarkerCommand,
    deleteMarkersCommand,
    findMarker,
    markerLayerColorCommand,
    moveMarkersCommand,
    renameMarkersCommand,
    resizeMarkerCommand,
    setMarkerClassCommand,
    setMarkerPointsCommand,
} from "../../src/core/markers";
import type { NewMarker } from "../../src/core/markers";
import {
    MAX_MARKERS,
    MAX_MARKER_COORD,
    MAX_MARKER_ID,
    MAX_MARKER_POINTS,
    MAX_SHAPE_POINTS,
    MAX_TEXT_LENGTH,
    assertInvariants,
    createGroupLayer,
    createMarkerLayer,
} from "../../src/core/model";
import type { Marker, MarkerLayer, ProjectMap, ShapePoint } from "../../src/core/model";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { MAP, setup } from "./te-006-support";

// TE-037: the marker commands of SPEC §8 (add, delete, move, resize, set points, rename, class)
// and the marker layer colour. Every command passes the TE-006 symmetry harness; marker IDs come
// from `nextMarkerId` and are never given twice, undo included; the limits of FORMAT §1.5 and
// §2.8 are refused with the project and history unchanged.
//
// The map of `setup` is 8 × 8 with one tile layer (ID 1); `furnish` adds
//
//     Markers (2, marker layer): 1 point "Spawn", 2 polygon "Zone", 3 rectangle      top
//     Group (3)
//       Paths (4, marker layer): 4 polyline "Road", 5 ellipse
//     Tile Layer 1 (1)                                                            bottom

const SPAWN: Marker = {
    shape: "point",
    x: 4,
    y: 5,
    id: 1,
    name: "Spawn",
    class: "",
    properties: [],
};

function furnish(history: History): ProjectMap {
    const map = history.session.project.maps[0]!;
    const markers = createMarkerLayer(2, "Markers");
    markers.markers.push(
        structuredClone(SPAWN),
        {
            shape: "polygon",
            x: 10,
            y: 10,
            points: [
                [0, 0],
                [8, 0],
                [8, 8],
            ],
            id: 2,
            name: "Zone",
            class: "area",
            properties: [{ name: "depth", type: "int", value: 3 }],
        },
        {
            shape: "rectangle",
            x: 0,
            y: 0,
            width: 16,
            height: 8,
            id: 3,
            name: "",
            class: "",
            properties: [],
        },
    );
    const group = createGroupLayer(3, "Group");
    const paths = createMarkerLayer(4, "Paths");
    paths.markers.push(
        {
            shape: "polyline",
            x: 0,
            y: 32,
            points: [
                [0, 0],
                [32, 0],
            ],
            id: 4,
            name: "Road",
            class: "",
            properties: [],
        },
        {
            shape: "ellipse",
            x: 20,
            y: 20,
            width: 12,
            height: 6,
            id: 5,
            name: "",
            class: "",
            properties: [],
        },
    );
    group.layers.push(paths);
    map.layers.push(group, markers);
    map.nextLayerId = 5;
    map.nextMarkerId = 6;
    assertInvariants(history.session.project);
    return map;
}

function markerLayer(map: ProjectMap, id: number): MarkerLayer {
    const layer =
        map.layers.find((each) => each.id === id) ??
        map.layers
            .flatMap((each) => (each.type === "group" ? each.layers : []))
            .find((each) => each.id === id);
    if (layer?.type !== "marker") throw new Error(`no marker layer ${id}`);
    return layer;
}

function marker(map: ProjectMap, id: number): Marker {
    const place = findMarker(map, id);
    if (!place) throw new Error(`no marker ${id}`);
    return place.marker;
}

function selection(history: History): number[] {
    return history.session.perMap.get(MAP)!.markerSelection;
}

/** Expects `run` to throw a `MarkerEditError` with `code`, project, session and history unchanged. */
function expectRefused(history: History, run: () => void, code: string): void {
    const before = snapshotProject(history.session.project);
    const selected = [...selection(history)];
    const undoCount = history.undoCount;
    let caught: unknown = null;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(MarkerEditError);
    expect((caught as MarkerEditError).code).toBe(code);
    expect(snapshotProject(history.session.project)).toStrictEqual(before);
    expect(selection(history)).toEqual(selected);
    expect(history.undoCount).toBe(undoCount);
}

describe("every marker command passes the symmetry harness", () => {
    it("adds each kind of marker at the top of its layer with the next marker ID", () => {
        const history = setup();
        const map = furnish(history);
        const shapes: NewMarker[] = [
            { shape: "rectangle", x: 1, y: 2, width: 3, height: 4, name: "Door" },
            { shape: "ellipse", x: -5, y: 6.5, width: 0, height: 2 },
            { shape: "point", x: 0.25, y: 100, class: "spawn" },
            {
                shape: "polygon",
                x: 3,
                y: 3,
                points: [
                    [0, 0],
                    [4, 0],
                    [0, 4],
                ],
            },
            {
                shape: "polyline",
                x: 8,
                y: 8,
                points: [
                    [0, 0],
                    [2, 2],
                ],
                properties: [{ name: "speed", type: "float", value: 1.5 }],
            },
        ];
        shapes.forEach((shape, k) => {
            const command = addMarkerCommand(MAP, 4, shape);
            expect(command.markerId).toBeNull();
            expectSymmetric(history, command);
            expect(command.label).toBe(MARKER_LABELS.add);
            expect(command.markerId).toBe(6 + k);
            const layer = markerLayer(map, 4);
            const added = layer.markers.at(-1)!;
            expect(added.id).toBe(6 + k);
            expect(added).toMatchObject({ name: shape.name ?? "", class: shape.class ?? "" });
            expect(added.properties).toEqual(shape.properties ?? []);
        });
        expect(map.nextMarkerId).toBe(11);
    });

    it("keeps no reference to the marker it was given", () => {
        const history = setup();
        const map = furnish(history);
        const input: NewMarker = {
            shape: "polygon",
            x: 0,
            y: 0,
            points: [
                [0, 0],
                [1, 0],
                [1, 1],
            ],
        };
        history.execute(addMarkerCommand(MAP, 2, input));
        input.points[0]![0] = 99;
        input.x = 50;
        expect(marker(map, 6)).toMatchObject({
            x: 0,
            points: [
                [0, 0],
                [1, 0],
                [1, 1],
            ],
        });
    });

    it("deletes one marker, and several across layers, as one entry; selection follows", () => {
        const history = setup();
        const map = furnish(history);
        history.session.perMap.get(MAP)!.markerSelection = [2, 4, 5];
        const one = expectSymmetric(
            history,
            deleteMarkersCommand(history.session.project, MAP, [2]),
        );
        expect(one.label).toBe(MARKER_LABELS.delete);
        expect(markerLayer(map, 2).markers.map((each) => each.id)).toEqual([1, 3]);
        expect(selection(history)).toEqual([4, 5]);
        const many = expectSymmetric(
            history,
            deleteMarkersCommand(history.session.project, MAP, [5, 1, 4, 5]),
        );
        expect(many.label).toBe(MARKER_LABELS.deleteMany);
        expect(markerLayer(map, 2).markers.map((each) => each.id)).toEqual([3]);
        expect(markerLayer(map, 4).markers).toEqual([]);
        expect(selection(history)).toEqual([]);
        expect(many.touched).toEqual({
            mapId: MAP,
            layerIds: [2, 4],
            cellRects: [],
            tilesetIds: [],
            structure: false,
        });
        history.undo();
        expect(selection(history)).toEqual([4, 5]);
        expect(markerLayer(map, 2).markers.map((each) => each.id)).toEqual([1, 3]);
        expect(markerLayer(map, 4).markers.map((each) => each.id)).toEqual([4, 5]);
        history.undo();
        expect(selection(history)).toEqual([2, 4, 5]);
        expect(markerLayer(map, 2).markers.map((each) => each.id)).toEqual([1, 2, 3]);
    });

    it("moves markers of every kind by a fraction of a pixel or more", () => {
        const history = setup();
        const map = furnish(history);
        const before = [1, 2, 3, 4, 5].map((id) => structuredClone(marker(map, id)));
        const command = expectSymmetric(
            history,
            moveMarkersCommand(history.session.project, MAP, [1, 2, 3, 4, 5], 2.5, -3),
        );
        expect(command.label).toBe(MARKER_LABELS.moveMany);
        before.forEach((was) => {
            expect(marker(map, was.id)).toEqual({ ...was, x: was.x + 2.5, y: was.y - 3 });
        });
        expect(moveMarkersCommand(history.session.project, MAP, [3], 1, 1).label).toBe(
            MARKER_LABELS.move,
        );
    });

    it("resizes a rectangle, an ellipse, a polygon and a point to a box", () => {
        const history = setup();
        const map = furnish(history);
        const box = { x: 2, y: 4, width: 20, height: 10 };
        expectSymmetric(history, resizeMarkerCommand(history.session.project, MAP, 3, box));
        expect(marker(map, 3)).toMatchObject({ shape: "rectangle", ...box });
        expectSymmetric(history, resizeMarkerCommand(history.session.project, MAP, 5, box));
        expect(marker(map, 5)).toMatchObject({ shape: "ellipse", ...box });
        // The polygon's 8 × 8 box scales to 20 × 10.
        const command = expectSymmetric(
            history,
            resizeMarkerCommand(history.session.project, MAP, 2, box),
        );
        expect(command.label).toBe(MARKER_LABELS.resize);
        const zone = marker(map, 2);
        expect(zone).toMatchObject({ x: 2, y: 4, name: "Zone", class: "area" });
        expect("points" in zone && zone.points).toEqual([
            [0, 0],
            [20, 0],
            [20, 10],
        ]);
        expectSymmetric(history, resizeMarkerCommand(history.session.project, MAP, 1, box));
        expect(marker(map, 1)).toEqual({ ...SPAWN, x: 2, y: 4 });
    });

    it("sets the points of a polygon and a polyline, with and without a new position", () => {
        const history = setup();
        const map = furnish(history);
        const points: ShapePoint[] = [
            [0, 0],
            [8, 0],
            [8, 8],
            [0, 8],
        ];
        const command = expectSymmetric(
            history,
            setMarkerPointsCommand(history.session.project, MAP, 2, points),
        );
        expect(command.label).toBe(MARKER_LABELS.points);
        expect(marker(map, 2)).toMatchObject({ x: 10, y: 10, points });
        points[0]![0] = 50;
        expect(marker(map, 2)).toMatchObject({
            points: [
                [0, 0],
                [8, 0],
                [8, 8],
                [0, 8],
            ],
        });
        expectSymmetric(
            history,
            setMarkerPointsCommand(
                history.session.project,
                MAP,
                4,
                [
                    [0, 0],
                    [4, 4],
                    [8, 0],
                ],
                {
                    x: -2,
                    y: 30,
                },
            ),
        );
        expect(marker(map, 4)).toMatchObject({
            x: -2,
            y: 30,
            points: [
                [0, 0],
                [4, 4],
                [8, 0],
            ],
        });
    });

    it("renames and sets the class of one or several markers", () => {
        const history = setup();
        const map = furnish(history);
        const rename = expectSymmetric(
            history,
            renameMarkersCommand(history.session.project, MAP, [1, 4], "Gate"),
        );
        expect(rename.label).toBe(MARKER_LABELS.rename);
        expect([marker(map, 1).name, marker(map, 4).name, marker(map, 2).name]).toEqual([
            "Gate",
            "Gate",
            "Zone",
        ]);
        expectSymmetric(history, renameMarkersCommand(history.session.project, MAP, [2], ""));
        expect(marker(map, 2).name).toBe("");
        const cls = expectSymmetric(
            history,
            setMarkerClassCommand(history.session.project, MAP, [2, 5], "trigger"),
        );
        expect(cls.label).toBe(MARKER_LABELS.class);
        expect([marker(map, 2).class, marker(map, 5).class]).toEqual(["trigger", "trigger"]);
    });

    it("sets a marker layer's colour", () => {
        const history = setup();
        const map = furnish(history);
        const command = expectSymmetric(
            history,
            markerLayerColorCommand(history.session.project, MAP, 4, 0xff800080),
        );
        expect(command.label).toBe(MARKER_LABELS.color);
        expect(markerLayer(map, 4).color).toBe(0xff800080);
        expect(command.touched).toEqual({
            mapId: MAP,
            layerIds: [4],
            cellRects: [],
            tilesetIds: [],
            structure: false,
        });
    });
});

describe("marker IDs are never reused", () => {
    it("undo leaves nextMarkerId raised; redo puts back the same marker, a new add takes a new ID", () => {
        const history = setup();
        const map = furnish(history);
        const first = addMarkerCommand(MAP, 2, { shape: "point", x: 1, y: 1, name: "A" });
        history.execute(first);
        expect(first.markerId).toBe(6);
        history.undo();
        expect(findMarker(map, 6)).toBeUndefined();
        expect(map.nextMarkerId).toBe(7);
        history.redo();
        expect(marker(map, 6).name).toBe("A");
        history.undo();
        const second = addMarkerCommand(MAP, 2, { shape: "point", x: 1, y: 1, name: "B" });
        history.execute(second);
        expect(second.markerId).toBe(7);
        expect(map.nextMarkerId).toBe(8);
        assertInvariants(history.session.project);
    });

    it("a deleted marker's ID is not given again", () => {
        const history = setup();
        const map = furnish(history);
        history.execute(deleteMarkersCommand(history.session.project, MAP, [5]));
        const command = addMarkerCommand(MAP, 4, {
            shape: "rectangle",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        });
        history.execute(command);
        expect(command.markerId).toBe(6);
        history.undo();
        history.undo();
        expect(marker(map, 5).shape).toBe("ellipse");
        const again = addMarkerCommand(MAP, 4, { shape: "point", x: 0, y: 0 });
        history.execute(again);
        expect(again.markerId).toBe(7);
    });

    it("refuses a marker once the map's IDs are used up", () => {
        const history = setup();
        const map = furnish(history);
        map.nextMarkerId = MAX_MARKER_ID;
        expectRefused(
            history,
            () => history.execute(addMarkerCommand(MAP, 2, { shape: "point", x: 0, y: 0 })),
            "limit",
        );
    });
});

describe("limits are refused with nothing changed", () => {
    const polygonOf = (count: number): ShapePoint[] =>
        Array.from({ length: count }, (_, k): ShapePoint => [k, k % 2]);

    it("coordinates, sizes and point counts of FORMAT §1.5 and §2.5", () => {
        const history = setup();
        furnish(history);
        const project = history.session.project;
        const bad: NewMarker[] = [
            { shape: "point", x: MAX_MARKER_COORD + 1, y: 0 },
            { shape: "point", x: 0, y: Number.NaN },
            { shape: "rectangle", x: 0, y: 0, width: -1, height: 2 },
            { shape: "ellipse", x: 0, y: 0, width: 2, height: 2 * MAX_MARKER_COORD + 1 },
            { shape: "polygon", x: 0, y: 0, points: polygonOf(2) },
            { shape: "polyline", x: 0, y: 0, points: polygonOf(1) },
            { shape: "polygon", x: 0, y: 0, points: polygonOf(MAX_SHAPE_POINTS + 1) },
            {
                shape: "polyline",
                x: 0,
                y: 0,
                points: [
                    [0, 0],
                    [MAX_MARKER_COORD + 1, 0],
                ],
            },
            { shape: "point", x: 0, y: 0, name: "n".repeat(MAX_TEXT_LENGTH + 1) },
            { shape: "point", x: 0, y: 0, class: "c".repeat(MAX_TEXT_LENGTH + 1) },
        ];
        for (const shape of bad) {
            expectRefused(
                history,
                () => history.execute(addMarkerCommand(MAP, 2, shape)),
                "values",
            );
        }
        // The largest polygon and the farthest point are taken.
        history.execute(
            addMarkerCommand(MAP, 2, {
                shape: "polygon",
                x: 0,
                y: 0,
                points: polygonOf(MAX_SHAPE_POINTS),
            }),
        );
        history.execute(
            addMarkerCommand(MAP, 2, { shape: "point", x: -MAX_MARKER_COORD, y: MAX_MARKER_COORD }),
        );
        assertInvariants(project);

        expectRefused(
            history,
            () => history.execute(moveMarkersCommand(project, MAP, [1, 3], MAX_MARKER_COORD, 0)),
            "values",
        );
        expectRefused(
            history,
            () =>
                history.execute(
                    resizeMarkerCommand(project, MAP, 3, { x: 0, y: 0, width: -4, height: 4 }),
                ),
            "values",
        );
        expectRefused(
            history,
            () => history.execute(setMarkerPointsCommand(project, MAP, 2, polygonOf(2))),
            "values",
        );
        expectRefused(
            history,
            () =>
                history.execute(
                    setMarkerPointsCommand(project, MAP, 4, polygonOf(MAX_SHAPE_POINTS + 1)),
                ),
            "values",
        );
        expectRefused(
            history,
            () => moveMarkersCommand(project, MAP, [1], Number.POSITIVE_INFINITY, 0),
            "values",
        );
        expectRefused(
            history,
            () => renameMarkersCommand(project, MAP, [1], "n".repeat(256)),
            "values",
        );
        expectRefused(
            history,
            () => setMarkerClassCommand(project, MAP, [1], "c".repeat(256)),
            "values",
        );
        for (const color of [-1, 0x100000000, 1.5]) {
            expectRefused(history, () => markerLayerColorCommand(project, MAP, 2, color), "values");
        }
    });

    it("16,384 markers and 262,144 points in a map", () => {
        const history = setup();
        const map = furnish(history);
        const project = history.session.project;
        // 16,379 more markers: 16,384 in all, with the 5 of `furnish`.
        const layer = markerLayer(map, 2);
        let id = map.nextMarkerId;
        const big = polygonOf(MAX_SHAPE_POINTS);
        // Points of `furnish`: 3 + 2. 255 polygons of 1024 points bring the map to 261,125.
        for (let k = 0; k < 255; k++) {
            layer.markers.push({
                shape: "polygon",
                x: 0,
                y: 0,
                points: big.map(([x, y]) => [x, y]),
                id: id++,
                name: "",
                class: "",
                properties: [],
            });
        }
        while (layer.markers.length + 2 < MAX_MARKERS) {
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
        assertInvariants(project);
        expect(layer.markers.length + 2).toBe(MAX_MARKERS);
        expectRefused(
            history,
            () => history.execute(addMarkerCommand(MAP, 4, { shape: "point", x: 0, y: 0 })),
            "limit",
        );
        // Room for points: 262,144 − 261,125 = 1,019 more. The polyline "Road" (2 points) may
        // take 1,021 but not 1,022.
        const road = (count: number) => polygonOf(count);
        history.execute(setMarkerPointsCommand(project, MAP, 4, road(1021)));
        expect(MAX_MARKER_POINTS).toBe(262_144);
        assertInvariants(project);
        history.undo();
        expectRefused(
            history,
            () => history.execute(setMarkerPointsCommand(project, MAP, 4, road(1022))),
            "limit",
        );
        // A resize or move does not add points, so it is taken at the limit.
        history.execute(moveMarkersCommand(project, MAP, [4], 1, 1));
        assertInvariants(project);
    });

    it("an unknown map, layer or marker, and a layer or shape of another kind", () => {
        const history = setup();
        furnish(history);
        const project = history.session.project;
        expectRefused(
            history,
            () => history.execute(addMarkerCommand(MAP, 9, { shape: "point", x: 0, y: 0 })),
            "missing",
        );
        expectRefused(
            history,
            () => history.execute(addMarkerCommand(MAP, 1, { shape: "point", x: 0, y: 0 })),
            "kind",
        );
        expectRefused(
            history,
            () => history.execute(addMarkerCommand(MAP, 3, { shape: "point", x: 0, y: 0 })),
            "kind",
        );
        expectRefused(
            history,
            () => history.execute(addMarkerCommand("nope", 2, { shape: "point", x: 0, y: 0 })),
            "missing",
        );
        expectRefused(history, () => deleteMarkersCommand(project, MAP, [1, 99]), "missing");
        expectRefused(history, () => deleteMarkersCommand(project, MAP, []), "missing");
        expectRefused(history, () => moveMarkersCommand(project, MAP, [99], 1, 1), "missing");
        expectRefused(
            history,
            () =>
                setMarkerPointsCommand(project, MAP, 3, [
                    [0, 0],
                    [1, 1],
                    [2, 0],
                ]),
            "kind",
        );
        expectRefused(history, () => markerLayerColorCommand(project, MAP, 1, 0xffffffff), "kind");
        // A marker deleted after its command was made: refused at `do`.
        const rename = renameMarkersCommand(project, MAP, [5], "Pond");
        history.execute(deleteMarkersCommand(project, MAP, [5]));
        expectRefused(history, () => history.execute(rename), "missing");
    });
});
