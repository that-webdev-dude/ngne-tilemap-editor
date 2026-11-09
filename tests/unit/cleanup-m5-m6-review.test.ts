import { beforeEach, describe, expect, it } from "vitest";
import { indexedDbRecentFiles } from "../../src/app/file/recentFiles";
import { reason } from "../../src/app/worker/errorReason";
import { sessionStore } from "../../src/app/state/session";
import {
    cancelTerrainRename,
    moveSelectedSet,
    newTerrainSet,
    removeSelectedSet,
    selectTerrain,
    selectedSet,
} from "../../src/app/terrains/terrainsPanel";
import { tilesetPanelStore } from "../../src/app/tilesets/panel/tilesetPanel";
import { provideBrushSource } from "../../src/app/tools/terrain/brushSource";
import { brushTerrain, chooseBrushTerrain } from "../../src/app/tools/terrain/brushTerrain";
import {
    brushStroke,
    previewStep,
    resetTerrainBrush,
    seedTerrainBrush,
    terrainBrushTool,
} from "../../src/app/tools/terrain/terrainBrush.tools";
import type { PaintStroke, ToolContext, ToolPointer } from "../../src/app/tools/types";
import { WorkerError } from "../../src/app/worker/protocol";
import { cellValue } from "../../src/core/cells";
import { createProject, createProjectSession } from "../../src/core/model";
import type { ProjectMap, TerrainSet, Tileset } from "../../src/core/model";
import { analyzeTerrainSet, brushTargetAt, effectiveTypeForColor } from "../../src/core/terrain";
import { makeTileset } from "./te-046-support";

// The findings of the M5–M6 review (TE-041 to TE-048), each fixed from a test that failed:
// the brush's "erase terrain" kept while the selection only follows its set; the brush's hover
// preview and its press breaking ties alike; the recent files reconnecting to IndexedDB; one
// `reason` for every message.

describe("cleanup: the brush's erase terrain (SPEC §5.3)", () => {
    beforeEach(() => {
        const project = createProject();
        const tileset = makeTileset({
            id: "terrain-tiles",
            slot: 1,
            kind: "image",
            tiles: 4,
            columns: 2,
            tileWidth: 8,
            tileHeight: 8,
        });
        project.tilesets.push(tileset);
        sessionStore.getState().replace(createProjectSession(project));
        tilesetPanelStore.setState({ activeTilesetId: tileset.id });
    });

    /** Adds corner sets named by their index, the last one selected. */
    function addSets(count: number): void {
        for (let k = 0; k < count; k++) {
            expect(newTerrainSet("corner")).toBe(true);
            cancelTerrainRename();
        }
    }

    it("stays on when a move of its set changes the set's index", () => {
        addSets(2);
        expect(selectedSet()!.selection.set).toBe(1);
        chooseBrushTerrain(0);
        expect(brushTerrain()!.color).toBe(0);
        expect(moveSelectedSet(-1)).toBe(true);
        expect(selectedSet()!.selection.set).toBe(0);
        expect(brushTerrain()!.color).toBe(0);
    });

    it("stays on when undo puts back a set before the selected one", () => {
        addSets(3);
        selectTerrain(0);
        expect(removeSelectedSet()).toBe(true);
        expect(selectedSet()!.selection.set).toBe(0);
        chooseBrushTerrain(0);
        sessionStore.getState().history.undo();
        expect(selectedSet()!.selection.set).toBe(1);
        expect(brushTerrain()!.color).toBe(0);
    });

    it("goes when the user selects a terrain, the selected one included", () => {
        addSets(1);
        chooseBrushTerrain(0);
        selectTerrain(0, 1);
        expect(brushTerrain()!.color).toBe(1);
        chooseBrushTerrain(0);
        newTerrainSet("edge");
        cancelTerrainRename();
        expect(brushTerrain()!.color).toBe(1);
    });
});

/**
 * An incomplete corner set of 3 terrains (60 of the 81 combinations; each tile's top-right,
 * bottom-right, bottom-left and top-left terrain), and a 5 × 5 layer of its tiles (−1 empty)
 * where a full tile of terrain 2 at (2, 0) meets ties whose choice decides which cells the
 * corrections leave invalid.
 */
const CORNERS = [
    [1, 1, 1, 1], [2, 1, 1, 1], [3, 1, 1, 1], [1, 2, 1, 1], [2, 2, 1, 1], [3, 2, 1, 1],
    [1, 3, 1, 1], [2, 3, 1, 1], [3, 3, 1, 1], [1, 1, 2, 1], [1, 2, 2, 1], [2, 2, 2, 1],
    [3, 2, 2, 1], [2, 3, 2, 1], [1, 1, 3, 1], [2, 1, 3, 1], [3, 1, 3, 1], [1, 2, 3, 1],
    [2, 2, 3, 1], [3, 2, 3, 1], [1, 3, 3, 1], [2, 3, 3, 1], [3, 3, 3, 1], [2, 1, 1, 2],
    [3, 1, 1, 2], [1, 2, 1, 2], [2, 2, 1, 2], [3, 2, 1, 2], [1, 3, 1, 2], [2, 3, 1, 2],
    [3, 3, 1, 2], [1, 1, 2, 2], [2, 1, 2, 2], [3, 1, 2, 2], [1, 2, 2, 2], [2, 2, 2, 2],
    [1, 3, 2, 2], [3, 3, 2, 2], [1, 1, 3, 2], [3, 1, 3, 2], [1, 2, 3, 2], [2, 2, 3, 2],
    [3, 2, 3, 2], [1, 1, 1, 3], [2, 1, 1, 3], [3, 1, 1, 3], [2, 2, 1, 3], [2, 3, 1, 3],
    [3, 3, 1, 3], [1, 1, 2, 3], [2, 1, 2, 3], [3, 1, 2, 3], [2, 2, 2, 3], [1, 3, 2, 3],
    [1, 1, 3, 3], [2, 1, 3, 3], [3, 1, 3, 3], [1, 2, 3, 3], [1, 3, 3, 3], [2, 3, 3, 3],
]; // prettier-ignore
const LAYER = [
    10, 46, -1, 17, 37,
    42, 47, 25, 2, -1,
    5, -1, 29, 7, 47,
    33, 1, 25, 51, -1,
    47, -1, 59, 59, 40,
]; // prettier-ignore
const SIZE = 5;
const TILE = 16;
const AT: [number, number] = [2.28, 0.33];

describe("cleanup: the brush's preview breaks ties as its press does (SPEC §5.3)", () => {
    const set: TerrainSet = {
        name: "Ties",
        type: "corner",
        colors: [1, 2, 3].map((n) => ({ name: `T${n}`, color: "#000000ff", tile: null })),
        tiles: CORNERS.map(([tr, br, bl, tl], tile) => ({
            tile,
            wangId: [0, tr!, 0, br!, 0, bl!, 0, tl!],
        })),
    };
    const analysis = analyzeTerrainSet(set, 1);
    const color = 2;
    const mode = effectiveTypeForColor(analysis, color);
    const map = { id: "m", width: SIZE, height: SIZE, tileWidth: TILE, tileHeight: TILE };

    beforeEach(() => {
        provideBrushSource({
            current: () => ({ tileset: {} as Tileset, setIndex: 0, set, analysis, color }),
            choose: () => undefined,
        });
        resetTerrainBrush();
    });

    /** What a full-tile press at `AT` leaves invalid, through the tool as the pipeline runs it. */
    function press() {
        const cells = LAYER.map((id) => (id < 0 ? 0 : cellValue(1, id)));
        const paint = {
            mapId: map.id,
            layerId: 1,
            map: map as ProjectMap,
            get: (x: number, y: number) => cells[y * SIZE + x] ?? 0,
            set: (x: number, y: number, value: number) => {
                cells[y * SIZE + x] = value;
            },
        } as unknown as PaintStroke;
        const context = {
            map,
            layerId: 1,
            options: { fullTile: true },
            paint,
            feedback: () => undefined,
        } as unknown as ToolContext;
        const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
        const pointer = {
            button: "primary",
            modifiers,
            position: { x: AT[0] * TILE, y: AT[1] * TILE },
            cell: { x: Math.floor(AT[0]), y: Math.floor(AT[1]) },
        } as unknown as ToolPointer;
        terrainBrushTool.onDown!(context, pointer);
        return brushStroke()!.invalid;
    }

    it("leaves invalid exactly what the preview showed, whatever the seed", () => {
        const outcomes = new Set<string>();
        for (let seed = 1; seed <= 40; seed++) {
            seedTerrainBrush(seed);
            const preview = previewStep(
                {
                    analysis,
                    back: (x, y) => {
                        const id = LAYER[y * SIZE + x]!;
                        return id < 0 ? 0 : cellValue(1, id);
                    },
                    width: SIZE,
                    height: SIZE,
                },
                {
                    mode,
                    tileMode: true,
                    behaviour: "single",
                    from: null,
                    to: brushTargetAt(mode, true, AT[0], AT[1]),
                    color,
                    symmetry: false,
                },
            ).invalid;
            const pressed = press();
            expect(pressed).toEqual(preview);
            outcomes.add(JSON.stringify(pressed));
        }
        // The ties matter here: a preview that broke them one fixed way would miss some presses.
        expect(outcomes.size).toBeGreaterThan(1);
    });
});

// --- A fake IndexedDB: enough of `open`, a connection and one store for the recent files ---

interface FakeRequest {
    result?: unknown;
    error?: unknown;
    onsuccess?: (() => void) | null;
    onerror?: (() => void) | null;
    onupgradeneeded?: (() => void) | null;
    onblocked?: (() => void) | null;
}

interface FakeDb {
    closed: boolean;
    onclose: (() => void) | null;
    onversionchange: (() => void) | null;
}

function fakeIndexedDb(options: { block?: boolean } = {}) {
    const values = new Map<unknown, unknown>();
    const opened: FakeDb[] = [];
    const pending: FakeRequest[] = [];
    const later = (request: FakeRequest, result: unknown) => {
        setTimeout(() => {
            request.result = result;
            request.onsuccess?.();
        }, 0);
        return request;
    };
    const makeDb = (): FakeDb => {
        const db = {
            closed: false,
            onclose: null,
            onversionchange: null,
            objectStoreNames: { contains: () => true },
            createObjectStore: () => undefined,
            close() {
                db.closed = true;
            },
            transaction() {
                if (db.closed)
                    throw new DOMException("The connection is closed.", "InvalidStateError");
                return {
                    objectStore: () => ({
                        get: (key: unknown) => later({}, values.get(key)),
                        put: (value: unknown, key: unknown) => {
                            values.set(key, value);
                            return later({}, key);
                        },
                    }),
                };
            },
        };
        opened.push(db);
        return db;
    };
    const factory = {
        open() {
            const request: FakeRequest = {};
            if (options.block) {
                pending.push(request);
                setTimeout(() => request.onblocked?.(), 0);
            } else {
                setTimeout(() => {
                    request.result = makeDb();
                    request.onupgradeneeded?.();
                    request.onsuccess?.();
                }, 0);
            }
            return request;
        },
    } as unknown as Pick<IDBFactory, "open">;
    /** Lets a blocked open succeed after all. */
    const unblock = () => {
        for (const request of pending.splice(0)) {
            request.result = makeDb();
            request.onsuccess?.();
        }
    };
    return { factory, opened, values, unblock };
}

describe("cleanup: the recent files' IndexedDB connection (SPEC §10.1)", () => {
    it("opens a new connection after the browser closed the one it had", async () => {
        const idb = fakeIndexedDb();
        const storage = indexedDbRecentFiles({ factory: idb.factory, timeoutMs: 1000 });
        await storage.save(["a"]);
        expect(idb.opened).toHaveLength(1);
        // Closed abnormally (site data cleared, say): the browser closes it and tells `onclose`.
        const first = idb.opened[0]!;
        first.closed = true;
        first.onclose?.();
        await storage.save(["b"]);
        expect(idb.opened).toHaveLength(2);
        expect(await storage.load()).toEqual(["b"]);
    });

    it("closes a connection that opens after a blocked open gave up", async () => {
        const idb = fakeIndexedDb({ block: true });
        const storage = indexedDbRecentFiles({ factory: idb.factory, timeoutMs: 1000 });
        await storage.save(["a"]);
        expect(idb.values.size).toBe(0);
        idb.unblock();
        expect(idb.opened).toHaveLength(1);
        expect(idb.opened[0]!.closed).toBe(true);
    });
});

describe("cleanup: one reason for every message", () => {
    it("takes a worker task's own message, else the error's, else the value", () => {
        const remote = Object.assign(new Error("Entry “maps/a.json” is damaged."), {
            name: "ProjectError",
        });
        expect(reason(new WorkerError("failed", "project.read", "", remote))).toBe(remote.message);
        expect(reason(new Error("No permission."))).toBe("No permission.");
        expect(reason("plain")).toBe("plain");
    });
});
