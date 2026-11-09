import { describe, expect, it } from "vitest";
import type { Command, History } from "../../src/core/history";
import { MAX_TERRAIN_SETS, assertInvariants } from "../../src/core/model";
import type { TerrainSet, Tileset } from "../../src/core/model";
import {
    BOTTOM,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
    LEFT,
    RIGHT,
    TERRAIN_LABELS,
    TOP,
    TOP_LEFT,
    TOP_RIGHT,
    TerrainEditError,
    addTerrainCommand,
    addTerrainSetCommand,
    assignTerrainCommand,
    brushIndexAt,
    defaultTerrainColour,
    moveTerrainCommand,
    moveTerrainSetCommand,
    removeTerrainCommand,
    removeTerrainSetCommand,
    renameTerrainSetCommand,
    setTerrainFieldCommand,
    setTerrainSetTypeCommand,
    terrainAnalysis,
} from "../../src/core/terrain";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { setup, tileset } from "./te-006-support";

// TE-043: the terrain set commands of SPEC §5.1. Each passes the TE-006 symmetry harness; a
// type change clears exactly the indexes the new type does not use; refusals leave the project
// as it was; the index a click assigns is picked as the terrain brush picks it (SPEC §5.3).
// The project of `setup` has tileset "ts" (slot 1); each test adds "tt" (slot 2, 8 tiles) with
// the sets below.

const TT = "tt";

/** A mixed set with two terrains: tile 0 all 1, tile 1 edges 1 and corners 2, tile 2 corners 2. */
function mixedSet(): TerrainSet {
    return {
        name: "Ground",
        type: "mixed",
        colors: [
            { name: "Grass", color: "#00ff00ff", tile: 0 },
            { name: "Sand", color: "#ffff00ff", tile: null },
        ],
        tiles: [
            { tile: 0, wangId: [1, 1, 1, 1, 1, 1, 1, 1] },
            { tile: 1, wangId: [1, 2, 1, 2, 1, 2, 1, 2] },
            { tile: 2, wangId: [0, 2, 0, 2, 0, 2, 0, 2] },
            { tile: 3, wangId: [2, 0, 2, 0, 0, 0, 0, 0] },
        ],
    };
}

/** A corner set with three terrains: tiles 4..6. */
function cornerSet(): TerrainSet {
    return {
        name: "Cliffs",
        type: "corner",
        colors: [
            { name: "Low", color: "#112233ff", tile: null },
            { name: "Mid", color: "#445566ff", tile: 5 },
            { name: "High", color: "#778899ff", tile: null },
        ],
        tiles: [
            { tile: 4, wangId: [0, 1, 0, 2, 0, 3, 0, 1] },
            { tile: 5, wangId: [0, 2, 0, 2, 0, 2, 0, 2] },
            { tile: 6, wangId: [0, 3, 0, 0, 0, 0, 0, 0] },
        ],
    };
}

function withSets(history: History): Tileset {
    const { project } = history.session;
    const tt = tileset(TT, 2, 8);
    tt.terrainSets = [mixedSet(), cornerSet()];
    project.tilesets.push(tt);
    assertInvariants(project);
    return tt;
}

const sets = (history: History) =>
    history.session.project.tilesets.find((each) => each.id === TT)!.terrainSets;

/** Expects `run` to throw a `TerrainEditError` with `code`, the project unchanged. */
function expectRefused(history: History, run: () => void, code: string): void {
    const before = snapshotProject(history.session.project);
    const undoCount = history.undoCount;
    let caught: unknown = null;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(TerrainEditError);
    expect((caught as TerrainEditError).code).toBe(code);
    expect(snapshotProject(history.session.project)).toStrictEqual(before);
    expect(history.undoCount).toBe(undoCount);
}

function some(command: Command | null): Command {
    expect(command).not.toBeNull();
    return command!;
}

describe("every terrain command passes the symmetry harness", () => {
    it("add a terrain set: “Unnamed Set” with one terrain, at the end", () => {
        const history = setup();
        withSets(history);
        const command = expectSymmetric(history, addTerrainSetCommand(TT, "edge"));
        expect(command.label).toBe(TERRAIN_LABELS.addSet);
        expect(command.touched).toStrictEqual({
            mapId: null,
            layerIds: [],
            cellRects: [],
            tilesetIds: [],
            structure: false,
        });
        expect(sets(history)[2]).toStrictEqual({
            name: "Unnamed Set",
            type: "edge",
            colors: [{ name: "Terrain 1", color: "#ff0000ff", tile: null }],
            tiles: [],
        });
    });

    it("remove a terrain set", () => {
        const history = setup();
        withSets(history);
        expectSymmetric(history, removeTerrainSetCommand(TT, 0));
        expect(sets(history).map((set) => set.name)).toEqual(["Cliffs"]);
    });

    it("rename a terrain set; none when the name is the same", () => {
        const history = setup();
        withSets(history);
        const { project } = history.session;
        expect(renameTerrainSetCommand(project, TT, 1, "Cliffs")).toBeNull();
        const command = expectSymmetric(
            history,
            some(renameTerrainSetCommand(project, TT, 1, "Rocks")),
        );
        expect(command.label).toBe(TERRAIN_LABELS.renameSet);
        expect(sets(history)[1]!.name).toBe("Rocks");
    });

    it("move a terrain set up and down", () => {
        const history = setup();
        withSets(history);
        expectSymmetric(history, moveTerrainSetCommand(TT, 1, -1));
        expect(sets(history).map((set) => set.name)).toEqual(["Cliffs", "Ground"]);
        expectSymmetric(history, moveTerrainSetCommand(TT, 0, 1));
        expect(sets(history).map((set) => set.name)).toEqual(["Ground", "Cliffs"]);
    });

    it("change a set's type", () => {
        const history = setup();
        withSets(history);
        const command = expectSymmetric(
            history,
            some(setTerrainSetTypeCommand(history.session.project, TT, 0, "corner")),
        );
        expect(command.label).toBe(TERRAIN_LABELS.setType);
        expect(sets(history)[0]!.type).toBe("corner");
    });

    it("add a terrain: “Terrain n” in Tiled's next default colour", () => {
        const history = setup();
        withSets(history);
        expectSymmetric(history, addTerrainCommand(TT, 1));
        expect(sets(history)[1]!.colors[3]).toStrictEqual({
            name: "Terrain 4",
            color: defaultTerrainColour(4),
            tile: null,
        });
        expect(defaultTerrainColour(4)).toBe("#ff7700ff");
        expect(defaultTerrainColour(16)).toBe(defaultTerrainColour(1));
    });

    it("remove a terrain: its indexes cleared, later terrains down one, empty tiles out", () => {
        const history = setup();
        withSets(history);
        expectSymmetric(history, removeTerrainCommand(TT, 1, 2));
        const set = sets(history)[1]!;
        expect(set.colors.map((color) => color.name)).toEqual(["Low", "High"]);
        expect(set.tiles).toStrictEqual([
            { tile: 4, wangId: [0, 1, 0, 0, 0, 2, 0, 1] },
            { tile: 6, wangId: [0, 2, 0, 0, 0, 0, 0, 0] },
        ]);
    });

    it("move a terrain: the colours and every index swap", () => {
        const history = setup();
        withSets(history);
        const command = expectSymmetric(history, moveTerrainCommand(TT, 1, 1, 1));
        expect(command.label).toBe(TERRAIN_LABELS.moveTerrainDown);
        const set = sets(history)[1]!;
        expect(set.colors.map((color) => color.name)).toEqual(["Mid", "Low", "High"]);
        expect(set.tiles.map((tile) => tile.wangId)).toEqual([
            [0, 2, 0, 1, 0, 3, 0, 2],
            [0, 1, 0, 1, 0, 1, 0, 1],
            [0, 3, 0, 0, 0, 0, 0, 0],
        ]);
    });

    it("move a terrain up", () => {
        const history = setup();
        withSets(history);
        const command = expectSymmetric(history, moveTerrainCommand(TT, 1, 3, -1));
        expect(command.label).toBe(TERRAIN_LABELS.moveTerrainUp);
        const set = sets(history)[1]!;
        expect(set.colors.map((color) => color.name)).toEqual(["Low", "High", "Mid"]);
        expect(set.tiles.map((tile) => tile.wangId)).toEqual([
            [0, 1, 0, 3, 0, 2, 0, 1],
            [0, 3, 0, 3, 0, 3, 0, 3],
            [0, 2, 0, 0, 0, 0, 0, 0],
        ]);
    });

    it("a terrain's name, colour and icon, each its own entry; none when unchanged", () => {
        const history = setup();
        withSets(history);
        const { project } = history.session;
        expect(setTerrainFieldCommand(project, TT, 0, 1, "name", "Grass")).toBeNull();
        expect(setTerrainFieldCommand(project, TT, 0, 1, "tile", 0)).toBeNull();
        const name = expectSymmetric(
            history,
            some(setTerrainFieldCommand(project, TT, 0, 1, "name", "Meadow")),
        );
        expect(name.label).toBe(TERRAIN_LABELS.renameTerrain);
        const colour = expectSymmetric(
            history,
            some(setTerrainFieldCommand(project, TT, 0, 2, "color", "#123456aa")),
        );
        expect(colour.label).toBe(TERRAIN_LABELS.colour);
        const icon = expectSymmetric(
            history,
            some(setTerrainFieldCommand(project, TT, 0, 2, "tile", 7)),
        );
        expect(icon.label).toBe(TERRAIN_LABELS.icon);
        expectSymmetric(history, some(setTerrainFieldCommand(project, TT, 0, 1, "tile", null)));
        expect(sets(history)[0]!.colors).toStrictEqual([
            { name: "Meadow", color: "#00ff00ff", tile: null },
            { name: "Sand", color: "#123456aa", tile: 7 },
        ]);
    });

    it("assign one index of a tile not yet in the set: the tile joins it", () => {
        const history = setup();
        withSets(history);
        const command = expectSymmetric(
            history,
            some(assignTerrainCommand(history.session.project, TT, 1, 7, TOP_RIGHT, 3)),
        );
        expect(command.label).toBe(TERRAIN_LABELS.tile);
        expect(sets(history)[1]!.tiles.at(-1)).toStrictEqual({
            tile: 7,
            wangId: [0, 3, 0, 0, 0, 0, 0, 0],
        });
    });

    it("assign one index of a tile in the set: only that index changes, in place", () => {
        const history = setup();
        withSets(history);
        expectSymmetric(
            history,
            some(assignTerrainCommand(history.session.project, TT, 0, 1, LEFT, 2)),
        );
        expect(sets(history)[0]!.tiles[1]).toStrictEqual({
            tile: 1,
            wangId: [1, 2, 1, 2, 1, 2, 2, 2],
        });
    });

    it("assign the whole tile: every index of the set's type", () => {
        const history = setup();
        withSets(history);
        const { project } = history.session;
        expectSymmetric(history, some(assignTerrainCommand(project, TT, 1, 6, "tile", 2)));
        expectSymmetric(history, some(assignTerrainCommand(project, TT, 0, 7, "tile", 1)));
        expect(sets(history)[1]!.tiles[2]).toStrictEqual({
            tile: 6,
            wangId: [0, 2, 0, 2, 0, 2, 0, 2],
        });
        expect(sets(history)[0]!.tiles.at(-1)).toStrictEqual({
            tile: 7,
            wangId: [1, 1, 1, 1, 1, 1, 1, 1],
        });
    });

    it("clear an index; a tile left with no terrain leaves the set", () => {
        const history = setup();
        withSets(history);
        const { project } = history.session;
        expectSymmetric(history, some(assignTerrainCommand(project, TT, 1, 4, TOP_LEFT, 0)));
        expect(sets(history)[1]!.tiles[0]!.wangId).toEqual([0, 1, 0, 2, 0, 3, 0, 0]);
        expectSymmetric(history, some(assignTerrainCommand(project, TT, 1, 6, TOP_RIGHT, 0)));
        expect(sets(history)[1]!.tiles.map((tile) => tile.tile)).toEqual([4, 5]);
        expect(assignTerrainCommand(project, TT, 1, 6, TOP_RIGHT, 0)).toBeNull();
        expect(assignTerrainCommand(project, TT, 1, 5, "tile", 2)).toBeNull();
    });
});

describe("a type change clears exactly the indexes the new type does not use", () => {
    const change = (history: History, setIndex: number, type: "corner" | "edge" | "mixed") =>
        expectSymmetric(
            history,
            some(setTerrainSetTypeCommand(history.session.project, TT, setIndex, type)),
        );

    it("mixed to corner: the edges cleared, the corners kept, a tile of edges only out", () => {
        const history = setup();
        withSets(history);
        change(history, 0, "corner");
        expect(sets(history)[0]!.tiles).toStrictEqual([
            { tile: 0, wangId: [0, 1, 0, 1, 0, 1, 0, 1] },
            { tile: 1, wangId: [0, 2, 0, 2, 0, 2, 0, 2] },
            { tile: 2, wangId: [0, 2, 0, 2, 0, 2, 0, 2] },
        ]);
        expect(sets(history)[0]!.colors).toStrictEqual(mixedSet().colors);
    });

    it("mixed to edge: the corners cleared, the edges kept", () => {
        const history = setup();
        withSets(history);
        change(history, 0, "edge");
        expect(sets(history)[0]!.tiles).toStrictEqual([
            { tile: 0, wangId: [1, 0, 1, 0, 1, 0, 1, 0] },
            { tile: 1, wangId: [1, 0, 1, 0, 1, 0, 1, 0] },
            { tile: 3, wangId: [2, 0, 2, 0, 0, 0, 0, 0] },
        ]);
    });

    it("edge to corner clears every index; edge to mixed clears none", () => {
        const history = setup();
        withSets(history);
        change(history, 0, "edge");
        const edges = sets(history)[0]!.tiles;
        change(history, 0, "mixed");
        expect(sets(history)[0]!.tiles).toStrictEqual(edges);
        change(history, 0, "corner");
        expect(sets(history)[0]!.tiles).toStrictEqual([]);
    });

    it("corner to edge clears every index; corner to mixed clears none", () => {
        const history = setup();
        withSets(history);
        change(history, 1, "mixed");
        expect(sets(history)[1]!.tiles).toStrictEqual(cornerSet().tiles);
        change(history, 1, "edge");
        expect(sets(history)[1]!.tiles).toStrictEqual([]);
        expect(setTerrainSetTypeCommand(history.session.project, TT, 1, "edge")).toBeNull();
    });
});

describe("refusals leave the project as it was", () => {
    it("the only terrain of a set is not removed", () => {
        const history = setup();
        withSets(history);
        history.execute(addTerrainSetCommand(TT, "corner"));
        expectRefused(
            history,
            () => history.execute(removeTerrainCommand(TT, 2, 1)),
            "last-terrain",
        );
    });

    it("blank names, bad colours, icons and terrains that do not exist", () => {
        const history = setup();
        withSets(history);
        const { project } = history.session;
        const run = (command: Command | null) => () => history.execute(some(command));
        expectRefused(history, run(renameTerrainSetCommand(project, TT, 0, "  ")), "name");
        expectRefused(history, run(setTerrainFieldCommand(project, TT, 0, 1, "name", "")), "name");
        expectRefused(
            history,
            run(setTerrainFieldCommand(project, TT, 0, 1, "color", "#12345")),
            "colour",
        );
        expectRefused(
            history,
            run(setTerrainFieldCommand(project, TT, 0, 1, "tile", 99)),
            "not-found",
        );
        expectRefused(history, () => assignTerrainCommand(project, TT, 0, 1, TOP, 3), "terrain");
        expectRefused(history, () => assignTerrainCommand(project, TT, 0, 99, TOP, 1), "not-found");
        expectRefused(
            history,
            () => removeTerrainSetCommand(TT, 5).do(history.session),
            "not-found",
        );
    });

    it("an index the set's type does not use", () => {
        const history = setup();
        withSets(history);
        const { project } = history.session;
        expectRefused(history, () => assignTerrainCommand(project, TT, 1, 4, TOP, 1), "index");
    });

    it("moves past either end", () => {
        const history = setup();
        withSets(history);
        expectRefused(history, () => history.execute(moveTerrainSetCommand(TT, 0, -1)), "move");
        expectRefused(history, () => history.execute(moveTerrainSetCommand(TT, 1, 1)), "move");
        expectRefused(history, () => history.execute(moveTerrainCommand(TT, 1, 3, 1)), "move");
        expectRefused(history, () => history.execute(moveTerrainCommand(TT, 1, 1, -1)), "move");
    });

    it("a 257th terrain set", () => {
        const history = setup();
        const tt = withSets(history);
        while (tt.terrainSets.length < MAX_TERRAIN_SETS) tt.terrainSets.push(cornerSet());
        expectRefused(history, () => history.execute(addTerrainSetCommand(TT, "mixed")), "limit");
    });
});

describe("the analysis sees each change", () => {
    it("the missing count of a corner set follows assignments", () => {
        const history = setup();
        withSets(history);
        const before = terrainAnalysis(sets(history)[1]!, 2).missingCount;
        expect(before).toBe(3 ** 4 - 2);
        history.execute(some(assignTerrainCommand(history.session.project, TT, 1, 7, "tile", 1)));
        expect(terrainAnalysis(sets(history)[1]!, 2).missingCount).toBe(3 ** 4 - 3);
        history.undo();
        expect(terrainAnalysis(sets(history)[1]!, 2).missingCount).toBe(before);
    });
});

describe("the index a click picks, as the terrain brush picks it (SPEC §5.3)", () => {
    it("corner sets round to the nearest corner", () => {
        expect(brushIndexAt("corner", 0.1, 0.1)).toBe(TOP_LEFT);
        expect(brushIndexAt("corner", 0.45, 0.55)).toBe(BOTTOM_LEFT);
        expect(brushIndexAt("corner", 0.5, 0.2)).toBe(TOP_RIGHT);
        expect(brushIndexAt("corner", 0.9, 0.9)).toBe(BOTTOM_RIGHT);
        // The centre third too: no dead zone.
        expect(brushIndexAt("corner", 0.4, 0.4)).toBe(TOP_LEFT);
    });

    it("edge sets pick the edge by the cell's diagonals", () => {
        expect(brushIndexAt("edge", 0.5, 0.1)).toBe(TOP);
        expect(brushIndexAt("edge", 0.9, 0.5)).toBe(RIGHT);
        expect(brushIndexAt("edge", 0.5, 0.9)).toBe(BOTTOM);
        expect(brushIndexAt("edge", 0.1, 0.5)).toBe(LEFT);
        expect(brushIndexAt("edge", 0.2, 0.1)).toBe(TOP);
        expect(brushIndexAt("edge", 0.1, 0.2)).toBe(LEFT);
    });

    it("mixed sets use a 3 × 3 grid whose centre picks nothing", () => {
        expect(brushIndexAt("mixed", 0.1, 0.1)).toBe(TOP_LEFT);
        expect(brushIndexAt("mixed", 0.5, 0.1)).toBe(TOP);
        expect(brushIndexAt("mixed", 0.9, 0.1)).toBe(TOP_RIGHT);
        expect(brushIndexAt("mixed", 0.9, 0.5)).toBe(RIGHT);
        expect(brushIndexAt("mixed", 0.9, 0.9)).toBe(BOTTOM_RIGHT);
        expect(brushIndexAt("mixed", 0.5, 0.9)).toBe(BOTTOM);
        expect(brushIndexAt("mixed", 0.1, 0.9)).toBe(BOTTOM_LEFT);
        expect(brushIndexAt("mixed", 0.1, 0.5)).toBe(LEFT);
        expect(brushIndexAt("mixed", 0.5, 0.5)).toBeNull();
        expect(brushIndexAt("mixed", 1, 1)).toBe(BOTTOM_RIGHT);
    });
});
