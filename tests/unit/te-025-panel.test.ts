import { describe, expect, it, vi } from "vitest";
import { createSessionStore } from "../../src/app/state/session";
import { installTilesetDrop } from "../../src/app/tilesets/import/tilesetDrop";
import type { PickedFile } from "../../src/app/tilesets/import/importSources";
import {
    gridLayout,
    gridPointAt,
    selectionStamp,
    spanGridRect,
    tileLabel,
    tileMarks,
    tileMatches,
    tileOrigin,
} from "../../src/app/tilesets/panel/tileGrid";
import {
    createTilesetPanelStore,
    followProject,
    selectionRect,
    shownTileset,
    tilesetPanelActions,
    tilesetPanelStore,
} from "../../src/app/tilesets/panel/tilesetPanel";
import type { Stamp } from "../../src/core/cells";
import { cellValue } from "../../src/core/cells";
import { createProject, createProjectSession, sequentialIds } from "../../src/core/model";
import type { Project, Tile, Tileset } from "../../src/core/model";
import { panelTile } from "../../src/ui/tilesets/tilesetPanel.status";

// TE-025: the Tilesets panel's grid geometry, the stamp a selection makes (laid out as in the
// panel, the class filter hiding tiles in place), the panel's operations and how it follows
// the project, the panel's file drop and its status field.

function tile(id: number, extra: Partial<Tile> = {}): Tile {
    return {
        id,
        sourceKey: null,
        fingerprint: "",
        class: "",
        collision: [],
        animation: [],
        properties: [],
        ...extra,
    };
}

function tileset(id: string, slot: number, count: number, columns: number, size = 16): Tileset {
    return {
        id,
        name: id,
        exportName: id,
        class: "",
        slot,
        tileWidth: size,
        tileHeight: size,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels: { width: 0, height: 0, data: new Uint8ClampedArray() },
        nextTileId: count,
        source: { kind: "image", fileName: `${id}.png`, margin: 0, spacing: 0 },
        tiles: Array.from({ length: count }, (_, index) => tile(index)),
        terrainSets: [],
        properties: [],
    };
}

function project(...tilesets: Tileset[]): Project {
    const result = createProject({ newId: sequentialIds() });
    result.tilesets.push(...tilesets);
    return result;
}

const values = (stamp: Stamp | null) => (stamp ? [...stamp.cells] : null);

describe("grid geometry", () => {
    const layout = gridLayout(tileset("a", 1, 10, 4), 2);

    it("lays tiles out on the tileset's columns, zoomed, with a 1 px gap round each", () => {
        expect(layout).toEqual({
            columns: 4,
            rows: 3,
            tileWidth: 32,
            tileHeight: 32,
            pitchX: 33,
            pitchY: 33,
            width: 133,
            height: 100,
        });
        expect(tileOrigin(layout, { column: 2, row: 1 })).toEqual({ x: 67, y: 34 });
    });

    it("maps grid pixels to positions, gaps to the tile after them; clamps when asked", () => {
        expect(gridPointAt(layout, 1, 1)).toEqual({ column: 0, row: 0 });
        expect(gridPointAt(layout, 33, 33)).toEqual({ column: 0, row: 0 });
        expect(gridPointAt(layout, 34, 66)).toEqual({ column: 1, row: 1 });
        expect(gridPointAt(layout, 0, 0)).toBeNull();
        expect(gridPointAt(layout, 200, 50)).toBeNull();
        expect(gridPointAt(layout, 200, 500, true)).toEqual({ column: 3, row: 2 });
        expect(gridPointAt(layout, -5, -5, true)).toEqual({ column: 0, row: 0 });
    });

    it("spans a rectangle from any two corners", () => {
        expect(spanGridRect({ column: 3, row: 1 }, { column: 1, row: 0 })).toEqual({
            column: 1,
            row: 0,
            columns: 3,
            rows: 2,
        });
    });
});

describe("selection stamp", () => {
    const set = tileset("a", 3, 10, 4);
    set.tiles[1]!.class = "solid";
    set.tiles[6]!.class = "Solid wall";

    it("is laid out as in the panel, values of the tileset's slot", () => {
        const stamp = selectionStamp(set, { column: 1, row: 0, columns: 3, rows: 2 }, "");
        expect(stamp?.width).toBe(3);
        expect(stamp?.height).toBe(2);
        expect(values(stamp)).toEqual([1, 2, 3, 5, 6, 7].map((id) => cellValue(3, id)));
    });

    it("leaves positions past the last tile empty", () => {
        const stamp = selectionStamp(set, { column: 1, row: 2, columns: 3, rows: 1 }, "");
        expect(values(stamp)).toEqual([cellValue(3, 9), 0, 0]);
        expect(selectionStamp(set, { column: 2, row: 2, columns: 2, rows: 1 }, "")).toBeNull();
    });

    it("leaves tiles the class filter hides empty, in place", () => {
        expect(tileMatches(set.tiles[1]!, "SOLID ")).toBe(true);
        expect(tileMatches(set.tiles[6]!, "solid")).toBe(true);
        expect(tileMatches(set.tiles[0]!, "solid")).toBe(false);
        expect(tileMatches(set.tiles[0]!, "  ")).toBe(true);
        const stamp = selectionStamp(set, { column: 0, row: 0, columns: 3, rows: 2 }, "solid");
        expect(values(stamp)).toEqual([0, cellValue(3, 1), 0, 0, 0, cellValue(3, 6)]);
        expect(selectionStamp(set, { column: 0, row: 0, columns: 1, rows: 1 }, "solid")).toBeNull();
    });
});

describe("tile marks and labels", () => {
    it("marks class or properties, animation and collision", () => {
        expect(tileMarks(tile(0))).toEqual({ data: false, animated: false, collision: false });
        expect(tileMarks(tile(0, { class: "x" })).data).toBe(true);
        expect(
            tileMarks(tile(0, { properties: [{ name: "n", type: "int", value: 1 }] })).data,
        ).toBe(true);
        expect(tileMarks(tile(0, { animation: [{ tile: 0, ms: 100 }] })).animated).toBe(true);
        expect(tileMarks(tile(0, { collision: [{ shape: "point", x: 0, y: 0 }] })).collision).toBe(
            true,
        );
    });

    it("names a tile tileset#id with its class", () => {
        expect(tileLabel({ name: "grass" }, { id: 14, class: "solid" })).toBe("grass#14 (solid)");
        expect(tileLabel({ name: "grass" }, { id: 3, class: "" })).toBe("grass#3");
    });
});

function setup(...tilesets: Tileset[]) {
    const session = createSessionStore(createProjectSession(project(...tilesets)));
    const store = createTilesetPanelStore();
    const taken: Stamp[] = [];
    const actions = tilesetPanelActions(store, session, {
        takeStamp: (stamp) => taken.push(stamp),
    });
    return { session, store, taken, actions };
}

describe("panel operations", () => {
    it("shows the first tileset until another is chosen; [ and ] stop at the ends", () => {
        const { session, store, actions } = setup(
            tileset("a", 1, 4, 2),
            tileset("b", 2, 4, 2),
            tileset("c", 3, 4, 2),
        );
        const shown = () => shownTileset(session.getState().session.project, store.getState())?.id;
        expect(shown()).toBe("a");
        expect(actions.canCycleTileset(-1)).toBe(false);
        actions.cycleTileset(-1);
        expect(shown()).toBe("a");
        actions.cycleTileset(1);
        expect(shown()).toBe("b");
        actions.showTileset("c");
        expect(actions.canCycleTileset(1)).toBe(false);
        actions.cycleTileset(1);
        expect(shown()).toBe("c");
        actions.cycleTileset(-1);
        expect(shown()).toBe("b");
    });

    it("moves the selection inside the grid; Shift extends it", () => {
        const { session, store, actions } = setup(tileset("a", 1, 10, 4));
        const rect = () =>
            selectionRect(session.getState().session.project.tilesets[0]!, store.getState());
        actions.moveSelection(1, 0, false);
        expect(rect()).toEqual({ column: 0, row: 0, columns: 1, rows: 1 });
        actions.moveSelection(1, 0, false);
        actions.moveSelection(1, 0, true);
        actions.moveSelection(1, 0, true);
        actions.moveSelection(0, 1, true);
        expect(rect()).toEqual({ column: 1, row: 0, columns: 3, rows: 2 });
        actions.moveSelection(5, 5, false);
        expect(rect()).toEqual({ column: 3, row: 2, columns: 1, rows: 1 });
        actions.moveSelection(-9, 0, true);
        expect(rect()).toEqual({ column: 0, row: 2, columns: 4, rows: 1 });
    });

    it("makes the selection the stamp; a selection without a tile makes none", () => {
        const { store, taken, actions } = setup(tileset("a", 1, 10, 4));
        expect(actions.makeStamp()).toBe(false);
        actions.select("a", { column: 1, row: 0 }, { column: 3, row: 1 });
        expect(actions.makeStamp()).toBe(true);
        expect(values(taken[0]!)).toEqual([1, 2, 3, 5, 6, 7].map((id) => cellValue(1, id)));
        actions.select("a", { column: 2, row: 2 }, { column: 3, row: 2 });
        expect(actions.makeStamp()).toBe(false);
        expect(taken).toHaveLength(1);
        expect(store.getState().selections["a"]).toBeDefined();
    });

    it("forgets the hovered tile when another tab is shown", () => {
        const { store, actions } = setup(tileset("a", 1, 4, 2), tileset("b", 2, 4, 2));
        actions.setHovered({ tilesetId: "a", index: 1 });
        actions.cycleTileset(1);
        expect(store.getState().hovered).toBeNull();
        actions.setHovered({ tilesetId: "b", index: 0 });
        actions.showTileset("a");
        expect(store.getState().hovered).toBeNull();
    });

    it("keeps one selection per tileset", () => {
        const { store, actions } = setup(tileset("a", 1, 4, 2), tileset("b", 2, 4, 2));
        actions.select("a", { column: 1, row: 1 }, { column: 1, row: 1 });
        actions.showTileset("b");
        actions.moveSelection(1, 0, false);
        expect(store.getState().selections).toEqual({
            a: { anchor: { column: 1, row: 1 }, focus: { column: 1, row: 1 } },
            b: { anchor: { column: 0, row: 0 }, focus: { column: 0, row: 0 } },
        });
    });
});

describe("following the project", () => {
    it("keeps the tab shown when a tileset is added; drops a removed one's selection", () => {
        const { session, store, actions } = setup(tileset("a", 1, 4, 2));
        const stop = followProject(store, session);
        const state = session.getState();
        const shown = () => shownTileset(state.session.project, store.getState())?.id;
        actions.select("a", { column: 0, row: 0 }, { column: 0, row: 0 });
        state.session.project.tilesets.push(tileset("b", 2, 4, 2), tileset("c", 3, 4, 2));
        state.touch();
        expect(shown()).toBe("a");
        state.session.project.tilesets.shift();
        state.touch();
        expect(store.getState().selections).toEqual({});
        expect(shown()).toBe("b");
        stop();
    });

    it("shows the tab after a removed shown one, else the last", () => {
        const { session, store, actions } = setup(
            tileset("a", 1, 4, 2),
            tileset("b", 2, 4, 2),
            tileset("c", 3, 4, 2),
        );
        const stop = followProject(store, session);
        const state = session.getState();
        const { tilesets } = state.session.project;
        actions.showTileset("b");
        tilesets.splice(1, 1);
        state.touch();
        expect(store.getState().activeTilesetId).toBe("c");
        tilesets.splice(1, 1);
        state.touch();
        expect(store.getState().activeTilesetId).toBe("a");
        stop();
    });

    it("starts afresh, zoom kept, when another project takes the window", () => {
        const { session, store, actions } = setup(tileset("a", 1, 4, 2));
        const stop = followProject(store, session);
        actions.select("a", { column: 1, row: 0 }, { column: 1, row: 0 });
        actions.setZoom(5);
        actions.setFilter("x");
        session.getState().replace(createProjectSession(project(tileset("z", 1, 4, 2))));
        expect(store.getState()).toMatchObject({
            activeTilesetId: null,
            selections: {},
            filter: "",
            zoom: 5,
            hovered: null,
        });
        stop();
    });
});

describe("drop on the panel", () => {
    /** A drag event carrying files, on a fake target. */
    function dragEvent(type: string, names: string[]) {
        const files = names.map((name) => ({ name, arrayBuffer: async () => new ArrayBuffer(0) }));
        const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
            dataTransfer: unknown;
        };
        event.dataTransfer = { types: ["Files"], files, dropEffect: "none" };
        return event;
    }

    it("hands every dropped file on and stops the drop at the panel", () => {
        const target = new EventTarget();
        const received: PickedFile[][] = [];
        const stop = installTilesetDrop({
            target,
            files: "all",
            overlayOpen: () => false,
            importFiles: (files) => received.push([...files]),
        });
        const drop = dragEvent("drop", ["rocks.png", "rocks.atlas.json"]);
        const stopPropagation = vi.spyOn(drop, "stopPropagation");
        target.dispatchEvent(drop);
        expect(drop.defaultPrevented).toBe(true);
        expect(stopPropagation).toHaveBeenCalled();
        expect(received.map((files) => files.map((file) => file.name))).toEqual([
            ["rocks.png", "rocks.atlas.json"],
        ]);
        stop();
    });

    it("on the window takes only a sprite project and lets the drop go on", () => {
        const target = new EventTarget();
        const received: string[] = [];
        const stop = installTilesetDrop({
            target,
            overlayOpen: () => false,
            importFiles: (files) => received.push(...files.map((file) => file.name)),
        });
        const drop = dragEvent("drop", ["rocks.png"]);
        const stopPropagation = vi.spyOn(drop, "stopPropagation");
        target.dispatchEvent(drop);
        target.dispatchEvent(dragEvent("drop", ["a.png", "tiles.ngsprite"]));
        expect(stopPropagation).not.toHaveBeenCalled();
        expect(received).toEqual(["tiles.ngsprite"]);
        stop();
    });
});

describe("status field", () => {
    it("shows the hovered tile, else the selected one or the selection's size", () => {
        const set = tileset("grass", 1, 6, 3);
        set.tiles[4]!.class = "solid";
        const session = createProjectSession(project(set));
        const input = { session, map: null, cursor: null };
        tilesetPanelStore.setState({
            activeTilesetId: null,
            selections: {},
            hovered: null,
            filter: "",
        });
        expect(panelTile(input)).toBe("");
        tilesetPanelStore.setState({
            selections: { grass: { anchor: { column: 1, row: 1 }, focus: { column: 1, row: 1 } } },
        });
        expect(panelTile(input)).toBe("grass#4 (solid)");
        tilesetPanelStore.setState({ hovered: { tilesetId: "grass", index: 2 } });
        expect(panelTile(input)).toBe("grass#2");
        tilesetPanelStore.setState({
            hovered: null,
            selections: { grass: { anchor: { column: 0, row: 0 }, focus: { column: 2, row: 1 } } },
        });
        expect(panelTile(input)).toBe("grass 3 × 2");
        tilesetPanelStore.setState({ selections: {} });
    });
});
