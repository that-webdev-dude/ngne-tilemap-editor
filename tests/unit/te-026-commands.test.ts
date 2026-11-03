import { beforeEach, describe, expect, it } from "vitest";
import { clipboardContent, copyCellsToClipboard } from "../../src/app/clipboard/clipboard";
import { sessionStore } from "../../src/app/state/session";
import { moveCurrentTileset } from "../../src/app/tilesets/edit/tilesetEdit";
import { shownTileset, tilesetPanelStore } from "../../src/app/tilesets/panel/tilesetPanel";
import { currentStamp, setCurrentStamp } from "../../src/app/tools/stamp/currentStamp";
import { assignFirstGids, cellValue } from "../../src/core/cells";
import type { Stamp } from "../../src/core/cells";
import type { History } from "../../src/core/history";
import {
    assertInvariants,
    createGroupLayer,
    createMap,
    createProjectSession,
    createTileLayer,
    exportNames,
} from "../../src/core/model";
import type { Project, ProjectMap, TileLayer } from "../../src/core/model";
import {
    TILESET_LABELS,
    TilesetEditError,
    deleteTilesetCommand,
    mapsUsingTileset,
    moveTilesetCommand,
    renameTilesetCommand,
    setTileOffsetCommand,
    setTilesetClassCommand,
    setTilesetFieldsCommand,
    setTilesetExportNameCommand,
    tilesetPropertiesCommand,
} from "../../src/core/tileset";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { setup, tileLayer, tileset } from "./te-006-support";

// TE-026: the tileset commands of SPEC §6.2. Each passes the TE-006 symmetry harness; a
// duplicate export name is refused; delete is refused naming the maps that use the tileset;
// delete and the redo of a delete leave the current stamp and the clipboard with no cell of
// the deleted tileset (SPEC §4.2). The project of `setup` has one map ("id2") and tileset "ts"
// in slot 1; each test adds "ts2" in slot 2 and "ts3" in slot 3.

function withTilesets(history: History): Project {
    const { project } = history.session;
    project.tilesets.push(tileset("ts2", 2), tileset("ts3", 3));
    assertInvariants(project);
    return project;
}

/** Adds a map named `name` with a group holding a tile layer; returns that layer. */
function addMap(project: Project, id: string, name: string): { map: ProjectMap; layer: TileLayer } {
    const map = createMap({ newId: () => id, name, takenExportNames: exportNames(project) });
    const group = createGroupLayer(2, "Group");
    const layer = createTileLayer(3, "Inner");
    group.layers.push(layer);
    map.layers.push(group);
    map.nextLayerId = 4;
    project.maps.push(map);
    return { map, layer };
}

/** Expects `run` to throw a `TilesetEditError` with `code` and to leave the project unchanged. */
function expectRefused(history: History, run: () => void, code: string): TilesetEditError {
    const before = snapshotProject(history.session.project);
    const undoCount = history.undoCount;
    let caught: unknown = null;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(TilesetEditError);
    expect((caught as TilesetEditError).code).toBe(code);
    expect(snapshotProject(history.session.project)).toStrictEqual(before);
    expect(history.undoCount).toBe(undoCount);
    return caught as TilesetEditError;
}

describe("every tileset command passes the symmetry harness", () => {
    it("rename", () => {
        const history = setup();
        withTilesets(history);
        const command = expectSymmetric(history, renameTilesetCommand("ts2", "Grass"));
        expect(command.label).toBe(TILESET_LABELS.rename);
        expect(history.session.project.tilesets[1]!.name).toBe("Grass");
    });

    it("export name", () => {
        const history = setup();
        withTilesets(history);
        const command = expectSymmetric(history, setTilesetExportNameCommand("ts2", "grass_1"));
        expect(command.label).toBe(TILESET_LABELS.exportName);
        expect(history.session.project.tilesets[1]!.exportName).toBe("grass_1");
    });

    it("class", () => {
        const history = setup();
        withTilesets(history);
        expectSymmetric(history, setTilesetClassCommand("ts2", "Terrain"));
        expect(history.session.project.tilesets[1]!.class).toBe("Terrain");
    });

    it("tile offset, which names the tileset as changed for the viewport", () => {
        const history = setup();
        withTilesets(history);
        const command = expectSymmetric(history, setTileOffsetCommand("ts2", -4096, 4096));
        expect(command.touched.tilesetIds).toEqual(["ts2"]);
        expect(command.touched.structure).toBe(false);
        const { offsetX, offsetY } = history.session.project.tilesets[1]!;
        expect([offsetX, offsetY]).toEqual([-4096, 4096]);
    });

    it("Tileset Properties: the changed fields as one entry, none when nothing changed", () => {
        const history = setup();
        const project = withTilesets(history);
        const values = {
            name: "Grass",
            exportName: "grass",
            class: "Ground",
            offsetX: 3,
            offsetY: -2,
        };
        const command = tilesetPropertiesCommand(project, "ts2", values)!;
        expect(command.label).toBe(TILESET_LABELS.properties);
        expectSymmetric(history, command);
        expect(history.undoCount).toBe(1);
        expect(history.session.project.tilesets[1]).toMatchObject(values);
        expect(tilesetPropertiesCommand(history.session.project, "ts2", values)).toBeNull();
        // One changed field takes that field's label.
        const one = tilesetPropertiesCommand(history.session.project, "ts2", {
            ...values,
            name: "Meadow",
        })!;
        expect(one.label).toBe(TILESET_LABELS.rename);
    });

    it("move left and right: the list order only, the maps' cells unchanged", () => {
        const history = setup();
        const project = withTilesets(history);
        tileLayer(project).cells.set(1, 1, cellValue(2, 1));
        const order = () => history.session.project.tilesets.map((each) => each.id);

        const right = expectSymmetric(history, moveTilesetCommand("ts", 1));
        expect(right.label).toBe(TILESET_LABELS.moveRight);
        expect(right.touched.structure).toBe(true);
        expect(order()).toEqual(["ts2", "ts", "ts3"]);
        const left = expectSymmetric(history, moveTilesetCommand("ts3", -1));
        expect(left.label).toBe(TILESET_LABELS.moveLeft);
        expect(order()).toEqual(["ts2", "ts3", "ts"]);

        // Cells keep their slot; the order assigns firstGid only when written (FORMAT §1.2).
        expect(tileLayer(history.session.project).cells.get(1, 1)).toBe(cellValue(2, 1));
        const firstGids = assignFirstGids(history.session.project.tilesets).entries.map((entry) => [
            entry.slot,
            entry.firstGid,
        ]);
        expect(firstGids).toEqual([
            [2, 1],
            [3, 3],
            [1, 5],
        ]);
    });

    it("move past either end is refused", () => {
        const history = setup();
        withTilesets(history);
        expectRefused(history, () => history.execute(moveTilesetCommand("ts", -1)), "move");
        expectRefused(history, () => history.execute(moveTilesetCommand("ts3", 1)), "move");
    });

    it("delete of an unused tileset; undo puts it back at its place and slot", () => {
        const history = setup();
        const project = withTilesets(history);
        const removed = project.tilesets[1]!;
        const command = expectSymmetric(history, deleteTilesetCommand(project, "ts2"));
        expect(command.label).toBe(TILESET_LABELS.delete);
        expect(command.touched).toMatchObject({ tilesetIds: ["ts2"], structure: true });
        expect(history.session.project.tilesets.map((each) => each.id)).toEqual(["ts", "ts3"]);
        history.undo();
        expect(history.session.project.tilesets[1]).toBe(removed);
        expect(removed.slot).toBe(2);
    });
});

describe("refusals", () => {
    it("refuses an export name another map, tileset or image has", () => {
        const history = setup();
        const project = withTilesets(history);
        const mapName = project.maps[0]!.exportName;
        for (const taken of ["tiles-1", "tiles-3", mapName]) {
            const error = expectRefused(
                history,
                () => history.execute(setTilesetExportNameCommand("ts2", taken)),
                "export-name",
            );
            expect(error.message).toContain(taken);
        }
        // Its own export name is not taken by itself; Tileset Properties refuses the same.
        expect(tilesetPropertiesCommand(project, "ts2", { exportName: "tiles-2" })).toBeNull();
        expectRefused(
            history,
            () =>
                history.execute(
                    tilesetPropertiesCommand(project, "ts2", { name: "X", exportName: "tiles-1" })!,
                ),
            "export-name",
        );
    });

    it("refuses a blank name, a non-slug export name and an offset out of range", () => {
        const history = setup();
        withTilesets(history);
        expectRefused(history, () => history.execute(renameTilesetCommand("ts2", "  ")), "name");
        expectRefused(
            history,
            () => history.execute(setTilesetExportNameCommand("ts2", "Grass")),
            "export-name",
        );
        expectRefused(
            history,
            () => history.execute(setTilesetExportNameCommand("ts2", "ngne-tilemap")),
            "export-name",
        );
        expectRefused(
            history,
            () => history.execute(setTileOffsetCommand("ts2", 4097, 0)),
            "offset",
        );
        expectRefused(
            history,
            () => history.execute(setTileOffsetCommand("ts2", 0, 1.5)),
            "offset",
        );
    });

    it("refuses to delete a tileset a map uses, naming the maps", () => {
        const history = setup();
        const project = withTilesets(history);
        const first = project.maps[0]!;
        const cave = addMap(project, "cave", "Cave");
        addMap(project, "town", "Town");
        assertInvariants(project);

        // Used by one map, in a layer inside a group.
        cave.layer.cells.set(3, 4, cellValue(2, 0));
        expect(mapsUsingTileset(project, project.tilesets[1]!)).toEqual([cave.map]);
        let error = expectRefused(
            history,
            () => history.execute(deleteTilesetCommand(project, "ts2")),
            "in-use",
        );
        expect(error.maps).toEqual(["Cave"]);
        expect(error.message).toBe("“Tileset 2” is used by the map “Cave”.");

        // Used by two maps: both named, in project order.
        tileLayer(project).cells.set(0, 0, cellValue(2, 1));
        error = expectRefused(
            history,
            () => history.execute(deleteTilesetCommand(project, "ts2")),
            "in-use",
        );
        expect(error.maps).toEqual([first.name, "Cave"]);
        expect(error.message).toBe(`“Tileset 2” is used by the maps “${first.name}” and “Cave”.`);

        // Cells of other tilesets do not count; erased cells free it.
        tileLayer(project).cells.set(0, 0, 0);
        cave.layer.cells.set(3, 4, cellValue(3, 0));
        expect(mapsUsingTileset(project, project.tilesets[1]!)).toEqual([]);
        history.execute(deleteTilesetCommand(project, "ts2"));
        expect(project.tilesets.map((each) => each.id)).toEqual(["ts", "ts3"]);
    });
});

describe("delete and the current stamp and the clipboard (SPEC §4.2)", () => {
    const KEPT = 1;
    const DELETED = 2;
    const kept = (tile: number) => cellValue(KEPT, tile);
    const deleted = (tile: number) => cellValue(DELETED, tile);
    const stamp = (cells: number[]): Stamp => ({
        width: cells.length,
        height: 1,
        cells: Uint32Array.from(cells),
    });
    const cells = (value: Stamp | null | undefined) => (value ? [...value.cells] : null);
    const history = () => sessionStore.getState().history;

    beforeEach(() => {
        const session = setup().session;
        session.project.tilesets.push(tileset("ts2", DELETED));
        sessionStore.getState().replace(createProjectSession(session.project));
        setCurrentStamp(null);
    });

    it("delete and its redo leave no cell of the deleted tileset", () => {
        const { project } = sessionStore.getState().session;
        setCurrentStamp(stamp([deleted(0), kept(1), deleted(1)]));
        copyCellsToClipboard(stamp([kept(0), deleted(1)]));

        history().execute(deleteTilesetCommand(project, "ts2"));
        expect(cells(currentStamp())).toEqual([0, kept(1), 0]);
        expect(cells(clipboardContent()?.stamp)).toEqual([kept(0), 0]);

        // Undo brings the tileset back but not the cells; new cells of it are emptied by redo.
        history().undo();
        expect(project.tilesets.map((each) => each.id)).toEqual(["ts", "ts2"]);
        expect(cells(currentStamp())).toEqual([0, kept(1), 0]);
        setCurrentStamp(stamp([kept(0), deleted(0)]));
        copyCellsToClipboard(stamp([deleted(1), deleted(0), kept(1)]));
        history().redo();
        expect(cells(currentStamp())).toEqual([kept(0), 0]);
        expect(cells(clipboardContent()?.stamp)).toEqual([0, 0, kept(1)]);
    });

    it("a stamp and a clipboard of the deleted tileset only are none after it", () => {
        const { project } = sessionStore.getState().session;
        setCurrentStamp(stamp([deleted(0), 0, deleted(1)]));
        copyCellsToClipboard(stamp([deleted(1)]));
        history().execute(deleteTilesetCommand(project, "ts2"));
        expect(currentStamp()).toBeNull();
        expect(clipboardContent()).toBeNull();

        history().undo();
        setCurrentStamp(stamp([deleted(1)]));
        copyCellsToClipboard(stamp([0, deleted(0)]));
        history().redo();
        expect(currentStamp()).toBeNull();
        expect(clipboardContent()).toBeNull();
    });
});

describe("review fixes", () => {
    it("a field given as undefined is left as it is", () => {
        const history = setup();
        withTilesets(history);
        expectSymmetric(history, setTilesetFieldsCommand("ts2", { name: undefined, class: "x" }));
        expect(history.session.project.tilesets[1]).toMatchObject({
            name: "Tileset 2",
            class: "x",
        });
    });

    it("moving the shown tileset keeps its tab shown while no tab was picked", () => {
        const session = setup().session;
        session.project.tilesets.push(tileset("ts2", 2));
        sessionStore.getState().replace(createProjectSession(session.project));
        tilesetPanelStore.setState({ activeTilesetId: null });
        const shown = () =>
            shownTileset(sessionStore.getState().session.project, tilesetPanelStore.getState())?.id;
        expect(shown()).toBe("ts");
        expect(moveCurrentTileset(1)).toBe(true);
        expect(sessionStore.getState().session.project.tilesets.map((each) => each.id)).toEqual([
            "ts2",
            "ts",
        ]);
        expect(shown()).toBe("ts");
        sessionStore.getState().history.undo();
        expect(shown()).toBe("ts");
    });
});
