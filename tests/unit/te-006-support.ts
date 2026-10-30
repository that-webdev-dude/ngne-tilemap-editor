import { expect } from "vitest";
import { cellValue } from "../../src/core/cells";
import { History } from "../../src/core/history";
import type { Allocator, Command, Touched, Transaction } from "../../src/core/history";
import {
    assertInvariants,
    createProject,
    createProjectSession,
    sequentialIds,
} from "../../src/core/model";
import type { Project, ProjectSession, TileLayer, Tileset } from "../../src/core/model";

// Shared by the TE-006 tests. `execute`, `undo`, `redo` and `commit` call `assertInvariants`
// after the step they perform, so every do, undo and redo made through them is checked.

export const MB = 1024 * 1024;
/** ID of the project's one map (`sequentialIds`: project `id1`, map `id2`). */
export const MAP = "id2";
/** ID of the map's one tile layer. */
export const LAYER = 1;
/** Slot of the fixture tileset. */
export const SLOT = 1;
const FINGERPRINT = "0".repeat(64);

/** A 2-tile 8 × 8 tileset in `slot`, so that cells can name tiles 0 and 1. */
export function tileset(id: string, slot: number, tiles = 2): Tileset {
    const columns = tiles;
    return {
        id,
        name: `Tileset ${slot}`,
        exportName: `tiles-${slot}`,
        class: "",
        slot,
        tileWidth: 8,
        tileHeight: 8,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels: { width: columns * 8, height: 8, data: new Uint8ClampedArray(columns * 8 * 8 * 4) },
        nextTileId: tiles,
        source: { kind: "image", fileName: "tiles.png", margin: 0, spacing: 0 },
        tiles: Array.from({ length: tiles }, (_, id) => ({
            id,
            sourceKey: [id, 0] as [number, number],
            fingerprint: FINGERPRINT,
            class: "",
            collision: [],
            animation: [],
            properties: [],
        })),
        terrainSets: [],
        properties: [],
    };
}

/** A session on a new `width` × `height` project with one map, one tile layer and one tileset. */
export function newSession(width = 8, height = 8): ProjectSession {
    const project = createProject({ newId: sequentialIds(), map: { width, height } });
    project.tilesets.push(tileset("ts", SLOT));
    assertInvariants(project);
    return createProjectSession(project);
}

/** The value of tile `tileId` of the fixture tileset. */
export const tile = (tileId: number) => cellValue(SLOT, tileId);

export const tileLayer = (project: Project) => project.maps[0]!.layers[0] as TileLayer;

export const NOTHING: Touched = {
    mapId: null,
    layerIds: [],
    cellRects: [],
    tilesetIds: [],
    structure: false,
};

/** A command that renames the project. `bytes` is the memory it claims to retain. */
export function rename(to: string, bytes = 0, touched: Touched = NOTHING): Command {
    let from = "";
    return {
        label: `Rename to ${to}`,
        bytes,
        touched,
        do(session) {
            from = session.project.name;
            session.project.name = to;
        },
        undo(session) {
            session.project.name = from;
        },
    };
}

export function setup(options: { budgetBytes?: number; allocate?: Allocator } = {}): History {
    return new History(newSession(), { ...options, verify: assertInvariants });
}

export function execute(history: History, command: Command): void {
    history.execute(command);
    assertInvariants(history.session.project);
}

export function undo(history: History): void {
    expect(history.undo()).toBe(true);
    assertInvariants(history.session.project);
}

export function redo(history: History): void {
    expect(history.redo()).toBe(true);
    assertInvariants(history.session.project);
}

/** Commits the history's open transaction. */
export function commit(history: History, label: string, extra?: Command): Command | null {
    const transaction = history.transaction;
    if (!transaction) throw new Error("commit: no transaction is open");
    const command = transaction.commit(label, extra);
    assertInvariants(history.session.project);
    return command;
}

/** Writes `value` over the rectangle. */
export function paintRect(
    transaction: Transaction,
    rect: { x: number; y: number; width: number; height: number },
    value: number,
): void {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) transaction.set(x, y, value);
    }
}

/** The cells of the layer as `[x, y, value]` triples, in row order, empty cells left out. */
export function cellsOf(layer: TileLayer, width: number, height: number): number[][] {
    const out: number[][] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const value = layer.cells.get(x, y);
            if (value !== 0) out.push([x, y, value]);
        }
    }
    return out;
}

/** What the platform throws when it cannot allocate a buffer. */
function outOfMemory(): never {
    throw new RangeError("Array buffer allocation failed");
}

/** An allocator that always fails. */
export const failingAllocator: Allocator = outOfMemory;

/**
 * An allocator that works `successes` times and fails from then on, until `heal()` is
 * called. `calls` counts every request.
 */
export function flakyAllocator(successes: number): {
    allocate: Allocator;
    heal(): void;
    readonly calls: number;
} {
    let calls = 0;
    let healed = false;
    return {
        allocate(byteLength) {
            calls++;
            if (!healed && calls > successes) outOfMemory();
            return new ArrayBuffer(byteLength);
        },
        heal() {
            healed = true;
        },
        get calls() {
            return calls;
        },
    };
}
