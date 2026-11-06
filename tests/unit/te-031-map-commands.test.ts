import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { createSessionStore } from "../../src/app/state/session";
import { followSession } from "../../src/app/tabs/tabs";
import type { MapTabsState } from "../../src/app/tabs/tabs";
import { openMapIds } from "../../src/app/viewport/mapTilesets";
import { bindViewport } from "../../src/app/viewport/viewportBinding";
import type { Viewport } from "../../src/engine/viewport";
import {
    MAP_LABELS,
    MapEditError,
    deleteMapCommand,
    duplicateMapCommand,
    moveMapCommand,
    newMapCommand,
    nextMapName,
    renameMapCommand,
} from "../../src/core/maps";
import type { NewMapValues } from "../../src/core/maps";
import type { History } from "../../src/core/history";
import {
    MAX_MAPS,
    assertInvariants,
    createGroupLayer,
    createMap,
    createMarkerLayer,
    createProjectSession,
    exportNames,
    sequentialIds,
} from "../../src/core/model";
import type { GroupLayer, MarkerLayer, ProjectMap, TileLayer } from "../../src/core/model";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { MAP, setup, tile } from "./te-006-support";

// TE-031: the map commands of SPEC §7.1. Each passes the TE-006 symmetry harness; deleting the
// last map is refused with the project unchanged. New Map, Duplicate and Delete also set the
// active map as SPEC §3 asks (undo shows the map a step changed); the map tabs follow the
// session (app/tabs/tabs.ts). The project of `setup` has one 8 × 8 map "id2" ("Map 1") with one
// tile layer and tileset "ts" in slot 1.

const VALUES: NewMapValues = { name: "Cave", width: 20, height: 10, tileWidth: 8, tileHeight: 8 };

/** IDs for maps the tests add: "m1", "m2", … */
function mapIds() {
    let n = 0;
    return () => `m${++n}`;
}

/** Adds a second map "Second" ("s2") to the project of `history`, after the first. */
function addSecond(history: History): ProjectMap {
    const { project } = history.session;
    const map = createMap({
        newId: () => "s2",
        name: "Second",
        takenExportNames: exportNames(project),
    });
    project.maps.push(map);
    assertInvariants(project);
    return map;
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

/** The first map's tile layer with cells (1, 1) and (7, 7) painted, a group and a marker layer. */
function furnish(history: History): void {
    const map = history.session.project.maps[0]!;
    const layer = map.layers[0] as TileLayer;
    layer.cells.set(1, 1, tile(0));
    layer.cells.set(7, 7, tile(1));
    const group = createGroupLayer(2, "Group");
    const markers = createMarkerLayer(3, "Markers");
    markers.markers.push({
        shape: "point",
        x: 4,
        y: 5,
        id: 1,
        name: "Spawn",
        class: "",
        properties: [{ name: "team", type: "int", value: 2 }],
    });
    group.layers.push(markers);
    map.layers.push(group);
    map.nextLayerId = 4;
    map.nextMarkerId = 2;
    assertInvariants(history.session.project);
}

describe("every map command passes the symmetry harness", () => {
    it("new map", () => {
        const history = setup();
        const command = expectSymmetric(history, (session) =>
            newMapCommand(session.project, VALUES, mapIds()),
        );
        expect(command.label).toBe(MAP_LABELS.new);
        const added = history.session.project.maps[1]!;
        expect(added).toMatchObject({ id: "m1", name: "Cave", exportName: "cave", width: 20 });
        expect(added).toMatchObject({ height: 10, tileWidth: 8, tileHeight: 8 });
        expect(added.layers.map((layer) => layer.type)).toEqual(["tile"]);
        expect(command.touched).toMatchObject({ mapId: "m1", structure: true });
    });

    it("duplicate", () => {
        const history = setup();
        furnish(history);
        const command = expectSymmetric(history, (session) =>
            duplicateMapCommand(session.project, MAP, mapIds()),
        );
        expect(command.label).toBe(MAP_LABELS.duplicate);
        expect(command.projectBytes).toBeGreaterThan(0);
    });

    it("rename", () => {
        const history = setup();
        const command = expectSymmetric(history, renameMapCommand(MAP, "Overworld"));
        expect(command.label).toBe(MAP_LABELS.rename);
        expect(command.touched).toMatchObject({ mapId: MAP, structure: false });
        expect(history.session.project.maps[0]!.name).toBe("Overworld");
        // The export name stays (FORMAT §2.4).
        expect(history.session.project.maps[0]!.exportName).toBe("map-1");
    });

    it("delete, of the active map and of another", () => {
        const history = setup();
        addSecond(history);
        furnish(history);
        const { project } = history.session;
        project.maps.push(createMap({ newId: () => "t3", takenExportNames: exportNames(project) }));
        // Deleting the active map "id2" makes "s2" active; then "t3", not the active one, goes.
        expectSymmetric(history, (session) => deleteMapCommand(session.project, MAP));
        expect(history.session.activeMapId).toBe("s2");
        expectSymmetric(history, (session) => deleteMapCommand(session.project, "t3"));
        expect(history.session.activeMapId).toBe("s2");
    });

    it("move up and down", () => {
        const history = setup();
        addSecond(history);
        const down = expectSymmetric(history, moveMapCommand(MAP, 1));
        expect(down.label).toBe(MAP_LABELS.moveDown);
        expect(history.session.project.maps.map((map) => map.id)).toEqual(["s2", MAP]);
        const up = expectSymmetric(history, moveMapCommand(MAP, -1));
        expect(up.label).toBe(MAP_LABELS.moveUp);
        expect(history.session.project.maps.map((map) => map.id)).toEqual([MAP, "s2"]);
        // The map list is the project's: the entry names no map (SPEC §3).
        expect(up.touched.mapId).toBeNull();
    });
});

describe("refusals leave the project unchanged", () => {
    it("deleting the last map is refused", () => {
        const history = setup();
        const { project } = history.session;
        expectRefused(history, () => history.execute(deleteMapCommand(project, MAP)), "last");
        expect(history.session.activeMapId).toBe(MAP);
    });

    it("moving past either end is refused", () => {
        const history = setup();
        addSecond(history);
        expectRefused(history, () => history.execute(moveMapCommand(MAP, -1)), "move");
        expectRefused(history, () => history.execute(moveMapCommand("s2", 1)), "move");
    });

    it("values out of range are refused before a command exists", () => {
        const history = setup();
        const { project } = history.session;
        const bad: Partial<NewMapValues>[] = [
            { name: "  " },
            { width: 0 },
            { height: 4097 },
            { width: 2048, height: 1024 },
            { tileWidth: 257 },
            { tileHeight: 1.5 },
        ];
        for (const values of bad) {
            expectRefused(
                history,
                () => newMapCommand(project, { ...VALUES, ...values }),
                "values",
            );
        }
        expectRefused(history, () => history.execute(renameMapCommand(MAP, "")), "values");
    });

    it("a project holds at most MAX_MAPS maps", () => {
        const history = setup();
        const { project } = history.session;
        const ids = sequentialIds("x");
        while (project.maps.length < MAX_MAPS) {
            project.maps.push(createMap({ newId: ids, takenExportNames: exportNames(project) }));
        }
        const command = newMapCommand(project, VALUES, mapIds());
        expectRefused(history, () => history.execute(command), "count");
    });
});

describe("the active map and the map sessions", () => {
    it("New Map shows the map it adds; undo shows the map that was active", () => {
        const history = setup();
        const { session } = history;
        history.execute(newMapCommand(session.project, VALUES, mapIds()));
        expect(session.activeMapId).toBe("m1");
        const added = session.perMap.get("m1")!;
        added.view = { centreX: 3, centreY: 4, zoom: 2 };
        history.undo();
        expect(session.activeMapId).toBe(MAP);
        expect(session.perMap.has("m1")).toBe(false);
        // A redo brings the map back with the session it was left with.
        history.redo();
        expect(session.activeMapId).toBe("m1");
        expect(session.perMap.get("m1")!.view).toEqual({ centreX: 3, centreY: 4, zoom: 2 });
    });

    it("Duplicate copies every layer, cell and marker into a map of its own", () => {
        const history = setup();
        furnish(history);
        const { session } = history;
        const source = session.project.maps[0]!;
        addSecond(history);
        history.execute(duplicateMapCommand(session.project, MAP, mapIds()));
        const copy = session.project.maps[1]!;
        expect(session.project.maps.map((map) => map.id)).toEqual([MAP, "m1", "s2"]);
        expect(session.activeMapId).toBe("m1");
        expect(copy.name).toBe("Map 1 Copy");
        expect(copy.exportName).toBe("map-1-copy");
        const copyLayer = copy.layers[0] as TileLayer;
        const sourceLayer = source.layers[0] as TileLayer;
        expect([copyLayer.cells.get(1, 1), copyLayer.cells.get(7, 7)]).toEqual([tile(0), tile(1)]);
        expect(copyLayer.cells.count).toBe(2);
        const markers = (copy.layers[1] as GroupLayer).layers[0] as MarkerLayer;
        expect(markers.markers[0]).toMatchObject({ id: 1, name: "Spawn", x: 4, y: 5 });
        expect([copy.nextLayerId, copy.nextMarkerId]).toEqual([4, 2]);
        // Nothing is shared with the source.
        copyLayer.cells.set(1, 1, 0);
        markers.markers[0]!.properties[0]!.value = 9;
        expect(sourceLayer.cells.get(1, 1)).toBe(tile(0));
        const sourceMarkers = (source.layers[1] as GroupLayer).layers[0] as MarkerLayer;
        expect(sourceMarkers.markers[0]!.properties[0]!.value).toBe(2);
    });

    it("Delete of the active map shows the map it is given, and undo shows the deleted one", () => {
        const history = setup();
        const second = addSecond(history);
        const { session } = history;
        session.project.maps.push(
            createMap({ newId: () => "t3", takenExportNames: exportNames(session.project) }),
        );
        history.execute(deleteMapCommand(session.project, MAP, "t3"));
        expect(session.activeMapId).toBe("t3");
        history.undo();
        expect(session.activeMapId).toBe(MAP);
        expect(session.project.maps.map((map) => map.id)).toEqual([MAP, second.id, "t3"]);
        history.redo();
        expect(session.activeMapId).toBe("t3");
    });

    it("Delete without a named map shows its neighbour in the list", () => {
        const history = setup();
        addSecond(history);
        const { session } = history;
        history.execute(deleteMapCommand(session.project, MAP));
        expect(session.activeMapId).toBe("s2");
    });

    it("Delete of another map keeps the active one; its redo after undo too", () => {
        const history = setup();
        addSecond(history);
        const { session } = history;
        history.execute(deleteMapCommand(session.project, "s2"));
        expect(session.activeMapId).toBe(MAP);
        history.undo();
        // Undo shows the map it brings back.
        expect(session.activeMapId).toBe("s2");
        history.redo();
        expect(session.activeMapId).toBe(MAP);
    });

    it("new maps are named Map N, one above the highest number in use", () => {
        const history = setup();
        const { project } = history.session;
        expect(nextMapName(project)).toBe("Map 2");
        project.maps[0]!.name = "Overworld";
        expect(nextMapName(project)).toBe("Map 1");
        project.maps[0]!.name = "Map 7 (old)";
        expect(nextMapName(project)).toBe("Map 8");
    });
});

describe("map tabs follow the session", () => {
    function tabsOf() {
        const sessions = createSessionStore(setup().session);
        const tabs = createStore<MapTabsState>(() => ({ open: [] }));
        followSession(sessions, tabs);
        return { sessions, tabs, session: sessions.getState().session };
    }

    it("a project opens its active map; a map that becomes active gets a tab", () => {
        const { sessions, tabs, session } = tabsOf();
        expect(tabs.getState().open).toEqual([MAP]);
        sessions.getState().history.execute(newMapCommand(session.project, VALUES, mapIds()));
        expect(tabs.getState().open).toEqual([MAP, "m1"]);
    });

    it("a deleted map loses its tab and gets it back in place when undo restores it", () => {
        const { sessions, tabs, session } = tabsOf();
        const { history } = sessions.getState();
        history.execute(newMapCommand(session.project, VALUES, mapIds()));
        history.execute(newMapCommand(session.project, { ...VALUES, name: "B" }, () => "m2"));
        expect(tabs.getState().open).toEqual([MAP, "m1", "m2"]);
        history.execute(deleteMapCommand(session.project, "m1"));
        expect(tabs.getState().open).toEqual([MAP, "m2"]);
        history.undo();
        expect(tabs.getState().open).toEqual([MAP, "m1", "m2"]);
        expect(session.activeMapId).toBe("m1");
    });

    it("a new history opens the new project's active map alone", () => {
        const { sessions, tabs } = tabsOf();
        const other = createProjectSession(setup().session.project);
        sessions.getState().replace(other);
        expect(tabs.getState().open).toEqual([other.activeMapId]);
    });

    it("textures are kept for the maps of the open tabs and the active map", () => {
        const { session } = tabsOf();
        session.project.maps.push(createMap({ newId: () => "s2", name: "Second" }));
        expect(openMapIds(session, ["s2", "gone"])).toEqual(["s2", MAP]);
        expect(openMapIds({ ...session, activeMapId: "s2" }, ["s2"])).toEqual(["s2"]);
    });
});

describe("the viewport's tileset textures follow the open tabs (ENGINE §3)", () => {
    it("a map reopened after its cells were erased brings back no texture", () => {
        const sessions = createSessionStore(setup().session);
        const tabs = createStore<MapTabsState>(() => ({ open: [] }));
        followSession(sessions, tabs);
        const { session, history } = sessions.getState();
        const used: string[][] = [];
        const viewport = {
            useTilesets: (tilesets: readonly { id: string }[]) =>
                used.push(tilesets.map((tileset) => tileset.id)),
            invalidateTilesets() {},
            noteTouched() {},
            requestRedraw() {},
        } as unknown as Viewport;
        const unbind = bindViewport(viewport, sessions, tabs);

        // Cave has a cell of "ts"; the first map has none.
        history.execute(newMapCommand(session.project, VALUES, mapIds()));
        const paint = (value: number) => {
            const stroke = history.begin({ mapId: "m1", layerId: 1 });
            stroke.set(2, 2, value);
            stroke.commit("Paint");
        };
        paint(tile(0));
        expect(used.at(-1)).toEqual(["ts"]);
        // Erasing keeps the texture while the map is open (the set does not shrink on erase).
        paint(0);
        expect(used.at(-1)).toEqual(["ts"]);
        // Closing the tab releases it; reopening the map, which has no cell of "ts", keeps
        // it released.
        session.activeMapId = MAP;
        tabs.setState({ open: [MAP] });
        expect(used.at(-1)).toEqual([]);
        session.activeMapId = "m1";
        sessions.getState().touch();
        expect(tabs.getState().open).toEqual([MAP, "m1"]);
        expect(used.at(-1)).toEqual([]);
        unbind();
    });
});
