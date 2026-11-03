import { cellValue } from "../../src/core/cells";
import { History } from "../../src/core/history";
import {
    assertInvariants,
    createGroupLayer,
    createMap,
    createProject,
    createProjectSession,
    createTileLayer,
    exportNames,
    sequentialIds,
} from "../../src/core/model";
import type { Project, TileLayer, TileSourceKey, Tileset } from "../../src/core/model";
import { tileFingerprint } from "../../src/core/tileset";
import type { SourceAnimation, SourceTiles } from "../../src/core/tileset";

// Shared by the TE-027 tests: tilesets of 2 × 2 tiles of one colour each, sources made of such
// tiles, and a project with two maps (the second with a tile layer inside a group) to see cells
// change in every map.

/** Slot of the fixture tileset. */
export const SLOT = 1;
const SIZE = 2;
const BYTES = SIZE * SIZE * 4;

/** A tile of colour `n`: `n, 255 − n, 7, 255` in every pixel. */
export function solid(n: number): Uint8Array {
    const bytes = new Uint8Array(BYTES);
    for (let at = 0; at < BYTES; at += 4) bytes.set([n, 255 - n, 7, 255], at);
    return bytes;
}

const fingerprintOf = (bytes: Uint8Array) =>
    tileFingerprint(
        { width: SIZE, height: SIZE, data: new Uint8ClampedArray(bytes) },
        0,
        0,
        SIZE,
        SIZE,
    );

export interface TileSpec {
    key: TileSourceKey | null;
    color: number;
}

/**
 * Tileset "ts" in `SLOT`: tile `k` has ID `k`, key and colour of `specs[k]`, `columns` a row
 * (all in one row by default).
 */
export function fixtureTileset(
    specs: readonly TileSpec[],
    nextTileId = specs.length,
    columns = specs.length,
): Tileset {
    const rows = Math.ceil(specs.length / columns);
    const width = columns * SIZE;
    const data = new Uint8ClampedArray(width * rows * SIZE * 4);
    specs.forEach((spec, k) => {
        const bytes = solid(spec.color);
        const x = (k % columns) * SIZE;
        const top = Math.floor(k / columns) * SIZE;
        for (let y = 0; y < SIZE; y++) {
            data.set(bytes.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), ((top + y) * width + x) * 4);
        }
    });
    return {
        id: "ts",
        name: "Tiles",
        exportName: "tiles",
        class: "",
        slot: SLOT,
        tileWidth: SIZE,
        tileHeight: SIZE,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels: { width, height: rows * SIZE, data },
        nextTileId,
        source: { kind: "image", fileName: "tiles.png", margin: 0, spacing: 0 },
        tiles: specs.map((spec, id) => ({
            id,
            sourceKey: spec.key,
            fingerprint: fingerprintOf(solid(spec.color)),
            class: "",
            collision: [],
            animation: [],
            properties: [],
        })),
        terrainSets: [],
        properties: [],
    };
}

/** A source re-read whose entry `e` has the key and colour of `specs[e]`. */
export function sourceOf(
    specs: readonly { key: TileSourceKey; color: number }[],
    animations: SourceAnimation[] = [],
): SourceTiles {
    return {
        tileWidth: SIZE,
        tileHeight: SIZE,
        entries: specs.map((spec) => ({
            key: spec.key,
            fingerprint: fingerprintOf(solid(spec.color)),
            pixels: solid(spec.color),
        })),
        animations,
        warnings: [],
    };
}

/** A project with `tileset`, map "id2" (tile layer 1) and map "m2" (layer 3 in group 2). */
export function fixtureProject(tileset: Tileset): Project {
    const project = createProject({ newId: sequentialIds(), map: { width: 8, height: 8 } });
    project.tilesets.push(tileset);
    const map = createMap({
        newId: () => "m2",
        name: "Second",
        width: 8,
        height: 8,
        takenExportNames: exportNames(project),
    });
    const group = createGroupLayer(2, "Group");
    group.layers.push(createTileLayer(3, "Inner"));
    map.layers.push(group);
    map.nextLayerId = 4;
    project.maps.push(map);
    assertInvariants(project);
    return project;
}

/** A history over `project` that checks the invariants after every step. */
export function historyOf(project: Project): History {
    return new History(createProjectSession(project), { verify: assertInvariants });
}

/** The first map's tile layer and the second map's layer inside its group. */
export function layers(project: Project): [TileLayer, TileLayer] {
    const first = project.maps[0]!.layers[0] as TileLayer;
    const group = project.maps[1]!.layers.find((layer) => layer.type === "group");
    if (group?.type !== "group") throw new Error("fixture: no group");
    return [first, group.layers[0] as TileLayer];
}

/** The value of tile `id` of the fixture tileset, with `flags`. */
export const cell = (id: number, flags = 0) => (cellValue(SLOT, id) | flags) >>> 0;

/** The colour number of the tile with ID `id` of `tileset`, read from its stored image. */
export function colorOf(tileset: Tileset, id: number): number {
    const k = tileset.tiles.findIndex((tile) => tile.id === id);
    if (k < 0) throw new Error(`fixture: no tile ${id}`);
    const x = (k % tileset.columns) * tileset.tileWidth;
    const y = Math.floor(k / tileset.columns) * tileset.tileHeight;
    const at = (y * tileset.pixels.width + x) * 4;
    return tileset.pixels.data[at]!;
}

/** Every non-empty cell of `layer` as `[x, y, value]`, row by row. */
export function cellsOf(layer: TileLayer): number[][] {
    const out: number[][] = [];
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const value = layer.cells.get(x, y);
            if (value !== 0) out.push([x, y, value]);
        }
    }
    return out;
}
