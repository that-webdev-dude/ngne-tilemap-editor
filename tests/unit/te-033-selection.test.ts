import { beforeEach, describe, expect, it } from "vitest";
import { clipboardContent, clipboardStore } from "../../src/app/clipboard/clipboard";
import { appCommands } from "../../src/app/commands/appCommands";
import { sessionStore } from "../../src/app/state/session";
import { cellValue } from "../../src/core/cells";
import { resizeMapCommand } from "../../src/core/maps";
import {
    assertInvariants,
    createProject,
    createProjectSession,
    sequentialIds,
} from "../../src/core/model";
import type { ProjectSession, Region, TileLayer } from "../../src/core/model";
import { createMask, rectMask, selectionOf, selectionsEqual } from "../../src/core/selection";
import { tileset } from "./te-006-support";

// TE-033: the tile selection under Resize / Offset Map (SPEC §7.1, §4.4). It moves by the
// offset in the same history entry and is not cut to the new bounds (Tiled's
// `MapDocument::resizeMap`); undo puts it back. Copy, Cut and Delete then act on its cells
// inside the map only (Tiled's `eraseTileLayers` cuts the region to the layer's bounds).

const v = (tile: number) => cellValue(1, tile, 0);

/** A 6 × 5 map whose every cell holds another tile, in the app's session store. */
function load(): ProjectSession {
    const project = createProject({ newId: sequentialIds(), map: { width: 6, height: 5 } });
    project.tilesets.push(tileset("ts", 1, 64));
    const map = project.maps[0]!;
    const cells = (map.layers[0] as TileLayer).cells;
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) cells.set(x, y, v(y * 6 + x));
    }
    assertInvariants(project);
    const session = createProjectSession(project);
    sessionStore.getState().replace(session, { verify: assertInvariants });
    return session;
}

const mapId = (session: ProjectSession) => session.activeMapId;
const selection = (session: ProjectSession) => session.perMap.get(mapId(session))!.tileSelection;
const layer = (session: ProjectSession) => session.project.maps[0]!.layers[0] as TileLayer;

function select(session: ProjectSession, region: Region): void {
    session.perMap.get(mapId(session))!.tileSelection = region;
    sessionStore.getState().touch();
}

function resize(session: ProjectSession, width: number, height: number, dx: number, dy: number) {
    const command = resizeMapCommand(session.project, mapId(session), {
        width,
        height,
        offsetX: dx,
        offsetY: dy,
    });
    sessionStore.getState().history.execute(command!);
}

function run(id: string): void {
    const command = appCommands.get(id);
    if (!command) throw new Error(`no command ${id}`);
    expect(command.enabled(), `${id} enabled`).toBe(true);
    expect(() => command.run()).not.toThrow();
}

/** The mask of the `#` cells of `rows`, whose top-left cell is `(x, y)`. */
function pictured(x: number, y: number, rows: string[]): Region {
    const mask = createMask({ x, y, width: rows[0]!.length, height: rows.length });
    rows.forEach((row, dy) =>
        [...row].forEach((char, dx) => {
            if (char === "#") mask.mask[dy * mask.width + dx] = 1;
        }),
    );
    return selectionOf(mask)!;
}

beforeEach(() => {
    clipboardStore.setState({ content: null });
});

describe("Resize / Offset Map: the tile selection", () => {
    it("moves by the offset in the same entry, and undo restores it", () => {
        const session = load();
        const before = pictured(1, 1, ["##", ".#"]);
        select(session, before);
        const { history } = sessionStore.getState();
        const entries = history.undoCount;

        resize(session, 9, 7, 3, 2);
        expect(history.undoCount).toBe(entries + 1);
        expect(selectionsEqual(selection(session), pictured(4, 3, ["##", ".#"]))).toBe(true);

        expect(history.undo()).toBe(true);
        expect(selectionsEqual(selection(session), before)).toBe(true);
        expect(session.project.maps[0]).toMatchObject({ width: 6, height: 5 });

        expect(history.redo()).toBe(true);
        expect(selectionsEqual(selection(session), pictured(4, 3, ["##", ".#"]))).toBe(true);
    });

    it("undo puts back the selection the resize moved, as Tiled's ChangeSelectedArea", () => {
        const session = load();
        const before = pictured(1, 1, ["##", ".#"]);
        select(session, before);
        resize(session, 9, 7, 3, 2);
        // A selection set outside the history (a test hook) does not shift what undo restores.
        select(session, rectMask({ x: 0, y: 0, width: 1, height: 1 }));
        sessionStore.getState().history.undo();
        expect(selection(session)).toBe(before);
    });

    it("is not cut to the new bounds", () => {
        const session = load();
        select(session, rectMask({ x: 0, y: 0, width: 6, height: 5 }));
        resize(session, 3, 2, -2, -1);
        // Moved by (−2, −1): it reaches past every side of the 3 × 2 map.
        expect(selection(session)).toMatchObject({ x: -2, y: -1, width: 6, height: 5 });
        sessionStore.getState().history.undo();
        expect(selection(session)).toMatchObject({ x: 0, y: 0, width: 6, height: 5 });
    });

    it("no selection stays none", () => {
        const session = load();
        resize(session, 8, 8, 1, 1);
        expect(selection(session)).toBeNull();
    });
});

describe("Copy, Cut and Delete after a shrink", () => {
    /**
     * Selects cells (1, 1)..(4, 3) of the 6 × 5 map, then shrinks it to 3 × 3 with the old map
     * moved by (−2, −1): the selection becomes (−1, 0)..(2, 2), its column −1 outside the map.
     * Inside are the old cells (2..4, 1..3), now at (0..2, 0..2).
     */
    function shrunk(): ProjectSession {
        const session = load();
        select(session, rectMask({ x: 1, y: 1, width: 4, height: 3 }));
        resize(session, 3, 3, -2, -1);
        expect(selection(session)).toMatchObject({ x: -1, y: 0, width: 4, height: 3 });
        return session;
    }

    const inside = [v(8), v(9), v(10), v(14), v(15), v(16), v(20), v(21), v(22)];

    it("Copy copies the selected cells inside the map", () => {
        shrunk();
        run("edit.copy");
        expect(clipboardContent()).toEqual({
            kind: "cells",
            stamp: { width: 3, height: 3, cells: Uint32Array.from(inside) },
        });
    });

    it("Cut copies and erases the selected cells inside the map, and clears the selection", () => {
        const session = shrunk();
        const { history } = sessionStore.getState();
        const entries = history.undoCount;
        run("edit.cut");
        expect(clipboardContent()?.stamp.cells).toEqual(Uint32Array.from(inside));
        expect(layer(session).cells.count).toBe(0);
        expect(selection(session)).toBeNull();
        expect(history.undoCount).toBe(entries + 1);
        history.undo();
        expect(layer(session).cells.count).toBe(9);
        expect(selection(session)).toMatchObject({ x: -1, y: 0, width: 4, height: 3 });
    });

    it("Delete erases the selected cells inside the map and keeps the selection", () => {
        const session = shrunk();
        const kept = selection(session);
        // Leave one selected cell inside, so the erase is partial.
        select(session, pictured(-1, 0, ["#.##", "....", "...."]));
        run("edit.delete");
        expect(layer(session).cells.get(0, 0)).toBe(v(8));
        expect(layer(session).cells.get(1, 0)).toBe(0);
        expect(layer(session).cells.get(2, 0)).toBe(0);
        expect(layer(session).cells.count).toBe(7);
        expect(selectionsEqual(selection(session), pictured(-1, 0, ["#.##"]))).toBe(true);
        expect(kept).not.toBeNull();
    });

    it("a selection entirely outside the map leaves Copy, Cut and Delete with nothing to act on", () => {
        const session = shrunk();
        select(session, rectMask({ x: -1, y: 0, width: 1, height: 3 }));
        for (const id of ["edit.copy", "edit.cut", "edit.delete"]) {
            const command = appCommands.get(id)!;
            expect(command.enabled(), id).toBe(false);
            expect(() => command.run()).not.toThrow();
        }
        expect(clipboardContent()).toBeNull();
        expect(layer(session).cells.count).toBe(9);
    });
});
