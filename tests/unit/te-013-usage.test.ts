import { describe, expect, it, vi } from "vitest";
import { cellValue } from "../../src/core/cells";
import { createMap, createProjectSession } from "../../src/core/model";
import type { TileLayer } from "../../src/core/model";
import { TilesetUsage, openMapIds, slotsInMap } from "../../src/app/viewport/mapTilesets";
import { readScene } from "../../src/app/viewport/scene";
import { createSessionStore } from "../../src/app/state/session";
import { defaultPreferences } from "../../src/app/preferences/preferences";
import { createViewportSceneProject } from "../support/viewportScene";

// TE-013: which tilesets the open maps use (ENGINE §3) and what the viewport reads from the
// stores (SPEC §3, §7).

function project() {
    return createViewportSceneProject({ background: null });
}

describe("slotsInMap", () => {
    it("finds the slots of every tile layer", () => {
        expect([...slotsInMap(project().maps[0]!)].sort()).toEqual([1, 2, 3]);
    });

    it("finds the slots in the given rectangles only", () => {
        const map = project().maps[0]!;
        // Row 0 of the base layer holds tileset 1; row 1 tileset 2; row 2 tileset 3.
        expect([...slotsInMap(map, [{ x: 0, y: 1, width: 2, height: 1 }])]).toEqual([2]);
        expect([...slotsInMap(map, [{ x: 19, y: 11, width: 5, height: 5 }])]).toEqual([]);
        // A rectangle reaching outside the map is clipped to it: only cell (0, 0) is read.
        expect([...slotsInMap(map, [{ x: -3, y: -3, width: 4, height: 4 }])]).toEqual([1]);
    });

    it("reads the rectangles' cells chunk by chunk, not one by one", () => {
        const map = createMap({ width: 100, height: 100 });
        const cells = (map.layers[0] as TileLayer).cells;
        // On either side of the corner of four chunks, and in a chunk further right.
        cells.set(31, 31, cellValue(1, 0));
        cells.set(32, 32, cellValue(2, 0));
        cells.set(70, 5, cellValue(3, 0));
        const get = vi.spyOn(cells, "get");
        const slots = (rect: { x: number; y: number; width: number; height: number }) =>
            [...slotsInMap(map, [rect])].sort();
        expect(slots({ x: 20, y: 20, width: 12, height: 12 })).toEqual([1]);
        expect(slots({ x: 31, y: 31, width: 2, height: 2 })).toEqual([1, 2]);
        expect(slots({ x: 32, y: 0, width: 68, height: 32 })).toEqual([3]);
        expect(slots({ x: 33, y: 33, width: 30, height: 30 })).toEqual([]);
        expect(slots({ x: -50, y: -50, width: 1000, height: 1000 })).toEqual([1, 2, 3]);
        expect(get).not.toHaveBeenCalled();
    });

    it("finds nothing in an empty map", () => {
        expect(slotsInMap(createMap()).size).toBe(0);
    });
});

describe("TilesetUsage", () => {
    it("names the project's tilesets that the open maps have cells of, in list order", () => {
        const p = project();
        const partial = createMap({ name: "Partial", width: 4, height: 4 });
        (partial.layers[0] as TileLayer).cells.set(0, 0, cellValue(3, 0));
        p.maps.push(partial, createMap({ name: "Empty" }));
        const usage = new TilesetUsage();
        const ids = (mapIds: string[]) => usage.tilesetsOf(p, mapIds).map((t) => t.slot);
        expect(ids([p.maps[0]!.id])).toEqual([1, 2, 3]);
        expect(ids([partial.id])).toEqual([3]);
        expect(ids([p.maps[2]!.id])).toEqual([]);
        expect(ids([partial.id, p.maps[2]!.id])).toEqual([3]);
        expect(ids([])).toEqual([]);
        expect(ids(["no-such-map"])).toEqual([]);
    });

    it("adds the slots of touched cells and rescans a map that was forgotten", () => {
        const p = project();
        const map = createMap({ width: 4, height: 4 });
        p.maps.push(map);
        const usage = new TilesetUsage();
        expect(usage.tilesetsOf(p, [map.id])).toEqual([]);

        (map.layers[0] as TileLayer).cells.set(1, 1, cellValue(2, 0));
        // Not seen yet: the cached answer stands until the command's cells are noted.
        expect(usage.tilesetsOf(p, [map.id])).toEqual([]);
        usage.noteCells(map, [{ x: 1, y: 1, width: 1, height: 1 }]);
        expect(usage.tilesetsOf(p, [map.id]).map((t) => t.slot)).toEqual([2]);

        (map.layers[0] as TileLayer).cells.set(2, 2, cellValue(1, 0));
        usage.forget(map.id);
        expect(usage.tilesetsOf(p, [map.id]).map((t) => t.slot)).toEqual([1, 2]);
        usage.reset();
        expect(usage.tilesetsOf(p, [map.id]).map((t) => t.slot)).toEqual([1, 2]);
    });

    it("keeps a tileset until the map closes, not when its last cell is erased", () => {
        const p = project();
        const map = p.maps[0]!;
        const usage = new TilesetUsage();
        usage.tilesetsOf(p, [map.id]);
        for (const layer of map.layers as TileLayer[]) layer.cells.clear();
        usage.noteCells(map, [{ x: 0, y: 0, width: 20, height: 12 }]);
        expect(usage.tilesetsOf(p, [map.id]).map((t) => t.slot)).toEqual([1, 2, 3]);
        usage.forget(map.id);
        expect(usage.tilesetsOf(p, [map.id])).toEqual([]);
    });
});

describe("openMapIds", () => {
    it("is the active map until map tabs exist", () => {
        const session = createProjectSession(project());
        expect(openMapIds(session)).toEqual([session.activeMapId]);
        expect(openMapIds({ ...session, activeMapId: "" })).toEqual([]);
    });
});

describe("readScene", () => {
    const themeChecker = { a: 0x111111, b: 0x222222 };

    it("reads the active map, its view and the checkerboard of the theme", () => {
        const session = createSessionStore(createProjectSession(project()));
        const state = session.getState();
        const view = { centreX: 5, centreY: 6, zoom: 3 };
        state.session.perMap.get(state.session.activeMapId)!.view = view;
        const scene = readScene({
            session: state,
            preferences: defaultPreferences(),
            themeChecker,
            dpr: 1.25,
        })!;
        expect(scene.map).toBe(state.session.project.maps[0]);
        expect(scene.view).toBe(view);
        expect(scene.dpr).toBe(1.25);
        expect(scene.checker).toEqual({ ...themeChecker, size: 8 });
    });

    it("uses the colours of the preference when they are not the theme's", () => {
        const preferences = {
            ...defaultPreferences(),
            checkerboard: { colors: { a: 1, b: 2 }, size: 4 },
        };
        const session = createSessionStore(createProjectSession(project()));
        const scene = readScene({ session: session.getState(), preferences, themeChecker, dpr: 1 });
        expect(scene!.checker).toEqual({ a: 1, b: 2, size: 4 });
    });

    it("centres a map that has no session state yet, and has no scene without a map", () => {
        const session = createSessionStore(createProjectSession(project()));
        const state = session.getState();
        state.session.perMap.clear();
        const scene = readScene({
            session: state,
            preferences: defaultPreferences(),
            themeChecker,
            dpr: 1,
        })!;
        expect(scene.view).toEqual({ centreX: 160, centreY: 96, zoom: 1 });

        state.session.activeMapId = "gone";
        expect(
            readScene({ session: state, preferences: defaultPreferences(), themeChecker, dpr: 1 }),
        ).toBeNull();
    });
});
