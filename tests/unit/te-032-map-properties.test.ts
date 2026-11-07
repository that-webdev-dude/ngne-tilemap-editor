import { describe, expect, it } from "vitest";
import {
    MAP_FIELD_LABELS,
    MAP_LABELS,
    MapEditError,
    mapFieldProblems,
    mapFields,
    mapPropertiesCommand,
    reorderMapCommand,
    setMapFieldsCommand,
} from "../../src/core/maps";
import type { History } from "../../src/core/history";
import {
    MAX_PARALLAX_ORIGIN,
    assertInvariants,
    createMap,
    createMarkerLayer,
    exportNames,
} from "../../src/core/model";
import type { ProjectMap, TileLayer } from "../../src/core/model";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { MAP, setup, tile } from "./te-006-support";

// TE-032: Map Properties (SPEC §7.1, DESIGN §9) and the reorder of the Maps panel's drag
// (DESIGN §8.1), in `core/maps`. Each passes the TE-006 symmetry harness. The project of
// `setup` has one 8 × 8 map "id2" of 16 px tiles and a tileset whose export name is "tiles-1".

/** Adds maps named `names` after the first, with IDs "a", "b", …; returns them. */
function addMaps(history: History, ...names: string[]): ProjectMap[] {
    const { project } = history.session;
    const maps = names.map((name, index) => {
        const map = createMap({
            newId: () => String.fromCharCode(97 + index),
            name,
            takenExportNames: exportNames(project),
        });
        project.maps.push(map);
        return map;
    });
    assertInvariants(project);
    return maps;
}

/** Expects `run` to throw a `MapEditError` with `code` and to leave the project unchanged. */
function expectRefused(history: History, run: () => void, code: string): void {
    const before = snapshotProject(history.session.project);
    const undoCount = history.undoCount;
    let caught: unknown = null;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(MapEditError);
    expect((caught as MapEditError).code).toBe(code);
    expect(snapshotProject(history.session.project)).toStrictEqual(before);
    expect(history.undoCount).toBe(undoCount);
}

const map = (history: History) => history.session.project.maps[0]!;

describe("Map Properties: each field is one symmetric entry", () => {
    const cases = [
        ["name", { name: "Overworld" }, MAP_FIELD_LABELS.rename],
        ["export name", { exportName: "overworld" }, MAP_FIELD_LABELS.exportName],
        ["class", { class: "Level" }, MAP_FIELD_LABELS.class],
        ["tile size", { tileWidth: 32, tileHeight: 8 }, MAP_FIELD_LABELS.tileSize],
        ["background", { backgroundColor: 0x203040ff }, MAP_FIELD_LABELS.background],
        [
            "parallax origin",
            { parallaxOriginX: -12.5, parallaxOriginY: 40 },
            "Change Parallax Origin",
        ],
    ] as const;
    for (const [what, values, label] of cases) {
        it(what, () => {
            const history = setup();
            const command = expectSymmetric(history, (session) =>
                mapPropertiesCommand(session.project, MAP, values)!,
            );
            expect(command.label).toBe(label);
            expect(map(history)).toMatchObject(values);
            expect(command.touched.mapId).toBe(MAP);
        });
    }

    it("several fields at once are one entry, Map Properties", () => {
        const history = setup();
        const command = expectSymmetric(history, (session) =>
            mapPropertiesCommand(session.project, MAP, {
                ...mapFields(session.project.maps[0]!),
                name: "Cave",
                backgroundColor: 0x112233ff,
            })!,
        );
        expect(command.label).toBe(MAP_FIELD_LABELS.properties);
        expect(history.undoCount).toBe(1);
    });

    it("no change is no command", () => {
        const history = setup();
        expect(mapPropertiesCommand(history.session.project, MAP, mapFields(map(history)))).toBe(
            null,
        );
    });

    it("None removes the background colour, and undo puts it back", () => {
        const history = setup();
        history.execute(
            mapPropertiesCommand(history.session.project, MAP, { backgroundColor: 0x40ff })!,
        );
        const command = expectSymmetric(history, (session) =>
            mapPropertiesCommand(session.project, MAP, { backgroundColor: null })!,
        );
        expect(command.label).toBe(MAP_FIELD_LABELS.background);
        expect(map(history).backgroundColor).toBe(null);
        history.undo();
        expect(map(history).backgroundColor).toBe(0x40ff);
    });
});

describe("Map Properties: values", () => {
    it("changing the tile size keeps the cells, offsets and markers, and replans the viewport", () => {
        const history = setup();
        const layer = map(history).layers[0] as TileLayer;
        layer.cells.set(3, 4, tile(1));
        layer.offsetX = 5;
        const markers = createMarkerLayer(2, "Markers");
        markers.offsetY = -7;
        markers.markers.push({
            shape: "rectangle",
            x: 20,
            y: 36,
            width: 10,
            height: 6,
            id: 1,
            name: "Exit",
            class: "",
            properties: [],
        });
        map(history).layers.push(markers);
        map(history).nextLayerId = 3;
        map(history).nextMarkerId = 2;
        assertInvariants(history.session.project);
        const before = structuredClone(markers);
        const command = expectSymmetric(
            history,
            setMapFieldsCommand(MAP, { tileWidth: 4, tileHeight: 64 }),
        );
        expect(layer.cells.get(3, 4)).toBe(tile(1));
        expect(layer.offsetX).toBe(5);
        // Markers and offsets are in map pixels: unchanged.
        expect(map(history).layers[1]).toStrictEqual(before);
        expect(map(history)).toMatchObject({ width: 8, height: 8, tileWidth: 4, tileHeight: 64 });
        expect(command.touched.structure).toBe(true);
        // The background and the parallax origin are read at every frame: no replanning.
        expect(setMapFieldsCommand(MAP, { backgroundColor: 1 }).touched.structure).toBe(false);
        expect(setMapFieldsCommand(MAP, { parallaxOriginX: 1 }).touched.structure).toBe(false);
    });

    it("a duplicate export name is refused, by another map or a tileset", () => {
        const history = setup();
        const [other] = addMaps(history, "Cave");
        const { project } = history.session;
        expect(mapFieldProblems(project, MAP, { exportName: other!.exportName }).exportName).toBe(
            `The export name “${other!.exportName}” is taken.`,
        );
        expect(mapFieldProblems(project, MAP, { exportName: "tiles-1" }).exportName).toMatch(
            /taken/,
        );
        // Its own export name is not taken.
        expect(mapFieldProblems(project, MAP, { exportName: map(history).exportName })).toEqual({});
        expectRefused(
            history,
            () => history.execute(setMapFieldsCommand(MAP, { exportName: other!.exportName })),
            "values",
        );
    });

    it("refuses values out of range, each by its field", () => {
        const history = setup();
        const { project } = history.session;
        const problems = mapFieldProblems(project, MAP, {
            name: "  ",
            exportName: "Not a slug",
            class: "c".repeat(256),
            tileWidth: 0,
            tileHeight: 257,
            backgroundColor: -1,
            parallaxOriginX: MAX_PARALLAX_ORIGIN + 1,
            parallaxOriginY: Number.NaN,
        });
        expect(Object.keys(problems).sort()).toEqual(
            [
                "backgroundColor",
                "class",
                "exportName",
                "name",
                "parallaxOriginX",
                "parallaxOriginY",
                "tileHeight",
                "tileWidth",
            ].sort(),
        );
        expect(mapFieldProblems(project, MAP, { tileWidth: 1, tileHeight: 256 })).toEqual({});
        expect(mapFieldProblems(project, MAP, { exportName: "ngne-tilemap" }).exportName).toMatch(
            /export name/,
        );
        for (const values of [{ name: "" }, { tileWidth: 1.5 }, { parallaxOriginX: Infinity }]) {
            expectRefused(
                history,
                () => history.execute(setMapFieldsCommand(MAP, values)),
                "values",
            );
        }
    });

    it("an unknown map is refused", () => {
        const history = setup();
        expect(() => mapPropertiesCommand(history.session.project, "nope", { name: "X" })).toThrow(
            MapEditError,
        );
        expectRefused(
            history,
            () => history.execute(setMapFieldsCommand("nope", { name: "X" })),
            "missing",
        );
    });
});

describe("reorder (a drag in the Maps panel)", () => {
    it("moves a map any distance as one symmetric entry, labelled by its direction", () => {
        const history = setup();
        addMaps(history, "B", "C", "D");
        const names = () => history.session.project.maps.map((each) => each.name);
        const down = expectSymmetric(history, (session) =>
            reorderMapCommand(session.project, MAP, 3),
        );
        expect(names()).toEqual(["B", "C", "D", "Map 1"]);
        expect(down.label).toBe(MAP_LABELS.moveDown);
        expect(down.touched).toMatchObject({ mapId: null, structure: true });
        expect(history.undoCount).toBe(1);
        const up = expectSymmetric(history, (session) =>
            reorderMapCommand(session.project, "c", 0),
        );
        expect(names()).toEqual(["D", "B", "C", "Map 1"]);
        expect(up.label).toBe(MAP_LABELS.moveUp);
        // The active map does not change.
        expect(history.session.activeMapId).toBe(MAP);
    });

    it("refuses its own place and places outside the list", () => {
        const history = setup();
        addMaps(history, "B");
        for (const index of [0, -1, 2, 0.5]) {
            expectRefused(
                history,
                () => history.execute(reorderMapCommand(history.session.project, MAP, index)),
                "move",
            );
        }
    });
});
