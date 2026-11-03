import { beforeEach, describe, expect, it } from "vitest";
import { clipboardContent, clipboardStore } from "../../src/app/clipboard/clipboard";
import { appCommands } from "../../src/app/commands/appCommands";
import { sessionStore } from "../../src/app/state/session";
import { currentStamp, setCurrentStamp } from "../../src/app/tools/stamp/currentStamp";
import { CellStore, cellValue } from "../../src/core/cells";
import {
    createMap,
    createMapSession,
    createProject,
    createProjectSession,
    sequentialIds,
} from "../../src/core/model";
import type { ProjectSession, TileLayer } from "../../src/core/model";
import { copySelectedCells, createMask, rectMask, selectionOf } from "../../src/core/selection";
import type { Region } from "../../src/core/model";
import { tileset } from "./te-006-support";

// TE-021: the cell clipboard (SPEC §4.4). Copy takes the selected cells of the active layer over
// the selection's bounding box, cells outside the mask empty (Tiled's `copySelection`); the
// clipboard is the editor's, one for the window, so its content is the same whichever map of
// the project is active, and Paste on another map makes that content the current stamp.

const v = (tile: number) => cellValue(1, tile, 0);

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

function run(id: string): void {
    const command = appCommands.get(id);
    if (!command) throw new Error(`no command ${id}`);
    expect(command.enabled(), `${id} enabled`).toBe(true);
    void command.run();
}

/** A project of two 8 × 6 maps, each cell of their tile layers another tile of one tileset. */
function twoMaps(): ProjectSession {
    const project = createProject({ newId: sequentialIds("p"), map: { width: 8, height: 6 } });
    const second = createMap({
        name: "Map 2",
        width: 8,
        height: 6,
        newId: sequentialIds("m"),
        takenExportNames: project.maps.map((map) => map.exportName),
    });
    project.maps.push(second);
    project.tilesets.push(tileset("ts", 1, 64));
    const session = createProjectSession(project);
    session.perMap.set(second.id, createMapSession(second));
    project.maps.forEach((map, index) => {
        const cells = (map.layers[0] as TileLayer).cells;
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) cells.set(x, y, v(index * 10 + y * 8 + x));
        }
    });
    return session;
}

function activate(session: ProjectSession, index: number): void {
    session.activeMapId = session.project.maps[index]!.id;
    sessionStore.getState().touch();
}

function select(session: ProjectSession, selection: Region): void {
    session.perMap.get(session.activeMapId)!.tileSelection = selection;
    sessionStore.getState().touch();
}

beforeEach(() => {
    clipboardStore.setState({ content: null });
    setCurrentStamp(null);
});

describe("copySelectedCells", () => {
    it("covers the selection's bounding box with the cells outside the mask empty", () => {
        const cells = new CellStore();
        for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) cells.set(x, y, v(y * 4 + x));
        expect(copySelectedCells(cells, pictured(1, 1, ["#.", "##"]))).toEqual({
            width: 2,
            height: 2,
            cells: Uint32Array.from([v(5), 0, v(9), v(10)]),
        });
        expect(copySelectedCells(cells, rectMask({ x: 2, y: 0, width: 2, height: 1 }))).toEqual({
            width: 2,
            height: 1,
            cells: Uint32Array.from([v(2), v(3)]),
        });
    });
});

describe("the clipboard across the maps of a project", () => {
    it("holds the same content whichever map is active", () => {
        const session = twoMaps();
        sessionStore.getState().replace(session);
        select(session, pictured(2, 1, ["##", ".#"]));
        run("edit.copy");
        const copied = {
            kind: "cells",
            stamp: { width: 2, height: 2, cells: Uint32Array.from([v(10), v(11), 0, v(19)]) },
        };
        expect(clipboardContent()).toEqual(copied);

        activate(session, 1);
        expect(clipboardContent()).toEqual(copied);
        // The second map has no selection: Copy has nothing to take there, Paste has the content.
        expect(appCommands.get("edit.copy")!.enabled()).toBe(false);
        run("edit.paste");
        expect(currentStamp()).toEqual(copied.stamp);

        // A copy on the second map is what the first one sees.
        select(session, rectMask({ x: 0, y: 0, width: 1, height: 1 }));
        run("edit.copy");
        const second = {
            kind: "cells",
            stamp: { width: 1, height: 1, cells: Uint32Array.from([v(10)]) },
        };
        expect(clipboardContent()).toEqual(second);
        activate(session, 0);
        expect(clipboardContent()).toEqual(second);
    });

    it("keeps its content when a cut or delete erases the copied cells", () => {
        const session = twoMaps();
        sessionStore.getState().replace(session);
        select(session, rectMask({ x: 0, y: 0, width: 2, height: 1 }));
        run("edit.cut");
        const cut = {
            kind: "cells",
            stamp: { width: 2, height: 1, cells: Uint32Array.from([v(0), v(1)]) },
        };
        expect(clipboardContent()).toEqual(cut);
        activate(session, 1);
        expect(clipboardContent()).toEqual(cut);
    });
});
