import { CellStore, cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import { createTileLayer, sequentialIds } from "../../src/core/model";
import type { Project, ProjectMap, Tile, Tileset } from "../../src/core/model";
import { sha256Hex } from "./sha256";

// The reference map of ENGINE §6 (BRIEF D1 worst case), built in code: 256 × 256 cells of
// 16 px, 8 tile layers with every cell filled, two tilesets of 256 tiles, exactly 12.5% of
// cells flipped or rotated, one parallax layer. Everything is deterministic (sequential IDs,
// a seeded generator), so two builds are equal member for member. Plain ECMAScript with no
// Node import, so E2E perf pages load it too.

export const REFERENCE = {
    width: 256,
    height: 256,
    tileWidth: 16,
    tileHeight: 16,
    layers: 8,
    /** The index of the parallax layer in `map.layers`. */
    parallaxLayer: 7,
    parallaxX: 0.5,
    parallaxY: 0.5,
    tilesets: 2,
    tilesPerTileset: 256,
    columns: 16,
    /** 1 in 8: `(x + y + layer) % 8 === 0`. */
    orientedFraction: 1 / 8,
    seed: 0x7e005,
} as const;

/** mulberry32: a small seeded generator of 32-bit values. */
function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;
    };
}

function tilePixels(tilesetIndex: number, tileId: number): Uint8ClampedArray {
    const { tileWidth, tileHeight } = REFERENCE;
    const data = new Uint8ClampedArray(tileWidth * tileHeight * 4);
    for (let y = 0; y < tileHeight; y += 1) {
        for (let x = 0; x < tileWidth; x += 1) {
            const i = (y * tileWidth + x) * 4;
            data[i] = (tileId * 7 + x * 16 + tilesetIndex * 128) & 0xff;
            data[i + 1] = (tileId * 13 + y * 16) & 0xff;
            data[i + 2] = (tileId + ((x ^ y) << 3)) & 0xff;
            data[i + 3] = 255;
        }
    }
    return data;
}

function referenceTileset(index: number, slot: number, newId: () => string): Tileset {
    const { tileWidth, tileHeight, columns, tilesPerTileset } = REFERENCE;
    const rows = tilesPerTileset / columns;
    const width = columns * tileWidth;
    const height = rows * tileHeight;
    const data = new Uint8ClampedArray(width * height * 4);
    const tiles: Tile[] = [];
    for (let id = 0; id < tilesPerTileset; id += 1) {
        const pixels = tilePixels(index, id);
        const column = id % columns;
        const row = Math.floor(id / columns);
        for (let y = 0; y < tileHeight; y += 1) {
            const source = y * tileWidth * 4;
            const target = ((row * tileHeight + y) * width + column * tileWidth) * 4;
            data.set(pixels.subarray(source, source + tileWidth * 4), target);
        }
        tiles.push({
            id,
            sourceKey: [column, row],
            fingerprint: sha256Hex(pixels),
            class: "",
            collision: [],
            animation: [],
            properties: [],
        });
    }
    return {
        id: newId(),
        name: `Reference ${index + 1}`,
        exportName: `reference-${index + 1}`,
        class: "",
        slot,
        tileWidth,
        tileHeight,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels: { width, height, data },
        nextTileId: tilesPerTileset,
        source: {
            kind: "image",
            fileName: `reference-${index + 1}.png`,
            margin: 0,
            spacing: 0,
        },
        tiles,
        terrainSets: [],
        properties: [],
    };
}

function referenceMap(newId: () => string, slots: readonly number[]): ProjectMap {
    const { width, height, layers, tilesPerTileset } = REFERENCE;
    const next = generator(REFERENCE.seed);
    const map: ProjectMap = {
        id: newId(),
        name: "Reference",
        exportName: "reference",
        class: "",
        orientation: "orthogonal",
        width,
        height,
        tileWidth: REFERENCE.tileWidth,
        tileHeight: REFERENCE.tileHeight,
        backgroundColor: null,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
        nextLayerId: layers + 1,
        nextMarkerId: 1,
        layers: [],
        properties: [],
    };
    for (let index = 0; index < layers; index += 1) {
        const layer = createTileLayer(index + 1, `Layer ${index + 1}`);
        const cells = new CellStore();
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const r = next();
                const slot = slots[r & 1]!;
                const tileId = (r >>> 1) % tilesPerTileset;
                const oriented = (x + y + index) % 8 === 0;
                const orientation = oriented ? ((((r >>> 9) % 7) + 1) as Orientation) : 0;
                cells.set(x, y, cellValue(slot, tileId, orientation));
            }
        }
        layer.cells = cells;
        if (index === REFERENCE.parallaxLayer) {
            layer.parallaxX = REFERENCE.parallaxX;
            layer.parallaxY = REFERENCE.parallaxY;
        }
        map.layers.push(layer);
    }
    return map;
}

/** The reference project: one map of the ENGINE §6 shape and its two tilesets. */
export function createReferenceProject(): Project {
    const newId = sequentialIds("ref-");
    const projectId = newId();
    const tilesets = Array.from({ length: REFERENCE.tilesets }, (_, index) =>
        referenceTileset(index, index + 1, newId),
    );
    const map = referenceMap(
        newId,
        tilesets.map((tileset) => tileset.slot),
    );
    return {
        id: projectId,
        name: "Reference",
        exportName: "reference-project",
        maps: [map],
        tilesets,
        images: [],
        exportSettings: { exportOnSave: false },
        properties: [],
    };
}
