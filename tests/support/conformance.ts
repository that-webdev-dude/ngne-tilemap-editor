import { cellOrientation, cellSlot, cellTileId } from "../../src/core/cells";
import { walkLayers } from "../../src/core/model";
import type { Layer, Project, ProjectMap, Property } from "../../src/core/model";
import type { Tilemap } from "../../src/core/runtime/runtime";

// Checks of SPEC §10.3 shared by the TE-055 unit test (Node) and the conformance page
// (browser): condition 2, the round trip of a map through its export, and the comparison of a
// canvas with its reference image. Plain ECMAScript with no Node or DOM import.

/** At most this many differences are listed; the count is always given. */
const LISTED = 12;

const json = (value: unknown) => JSON.stringify(value);

/** A property list as a writer orders it (FORMAT §1.4): by name, in UTF-16 code-unit order. */
function byName(list: readonly Property[]): Property[] {
    return [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Condition 2 of SPEC §10.3: what `readTilemap` made of `map`'s export against `map` in
 * `project`. Compares the cells (tileset, tile and flags of every cell of every tile layer),
 * the properties of the map, its tilesets, tiles, groups and layers, each tile's class and
 * collision, and the markers. Returns the differences found, as text; empty when equal.
 */
export function roundTripDifferences(
    project: Project,
    map: ProjectMap,
    tilemap: Tilemap,
): string[] {
    const out: string[] = [];
    const differ = (what: string, read: unknown, expected: unknown) => {
        if (json(read) !== json(expected)) {
            out.push(`${what}: read ${json(read)}, expected ${json(expected)}`);
        }
    };

    differ("map properties", tilemap.properties, byName(map.properties));
    differ("map size", [tilemap.width, tilemap.height], [map.width, map.height]);

    // Tilesets: those the map's cells use, in project order (FORMAT §1.2).
    const bySlot = new Map(project.tilesets.map((tileset) => [tileset.slot, tileset]));
    const used = new Set<number>();
    const entries = [...walkLayers(map.layers)];
    for (const { layer } of entries) {
        if (layer.type !== "tile") continue;
        for (let y = 0; y < map.height; y += 1) {
            for (let x = 0; x < map.width; x += 1) {
                const value = layer.cells.get(x, y);
                if (value !== 0) used.add(cellSlot(value));
            }
        }
    }
    const listed = project.tilesets.filter((tileset) => used.has(tileset.slot));
    differ(
        "tilesets",
        tilemap.tilesets.map((tileset) => tileset.name),
        listed.map((tileset) => tileset.exportName),
    );
    for (const read of tilemap.tilesets) {
        const source = listed.find((tileset) => tileset.exportName === read.name);
        if (!source) continue;
        const what = `tileset ${read.name}`;
        differ(`${what} class`, read.class, source.class);
        differ(`${what} properties`, read.properties, byName(source.properties));
        differ(
            `${what} tiles`,
            read.tiles,
            source.tiles
                .filter(
                    (tile) =>
                        tile.class !== "" ||
                        tile.collision.length > 0 ||
                        tile.properties.length > 0,
                )
                .map((tile) => ({
                    id: tile.id,
                    class: tile.class,
                    collision: tile.collision,
                    properties: byName(tile.properties),
                })),
        );
    }

    // Groups and layers, in the order of the tree, each with its properties.
    const groups = entries.filter(({ layer }) => layer.type === "group");
    differ(
        "groups",
        tilemap.groups.map((group) => [group.id, group.name, group.class, group.parentId]),
        groups.map(({ layer, ancestors }) => [
            layer.id,
            layer.name,
            layer.class,
            ancestors.at(-1)?.id ?? null,
        ]),
    );
    for (const { layer } of groups) {
        const read = tilemap.groups.find((group) => group.id === layer.id);
        differ(`group ${layer.id} properties`, read?.properties, byName(layer.properties));
    }
    const layers = entries.filter(({ layer }) => layer.type !== "group");
    differ(
        "layers",
        tilemap.layers.map((layer) => [layer.id, layer.type, layer.name, layer.class]),
        layers.map(({ layer }) => [layer.id, layer.type, layer.name, layer.class]),
    );
    for (const { layer } of layers) {
        const read = tilemap.layers.find((item) => item.id === layer.id);
        if (!read) continue;
        differ(`layer ${layer.id} properties`, read.properties, byName(layer.properties));
        if (layer.type === "marker" && read.type === "marker") {
            differ(`layer ${layer.id} markers`, read.markers, layer.markers);
        }
        if (layer.type === "tile" && read.type === "tile") {
            cellDifferences(map, layer, read, bySlot, tilemap, out);
        }
    }
    return out.length > LISTED ? [...out.slice(0, LISTED), `… ${out.length} differences`] : out;
}

/** The cells of one tile layer: same tileset, tile and flags in every cell. */
function cellDifferences(
    map: ProjectMap,
    layer: Extract<Layer, { type: "tile" }>,
    read: Extract<Tilemap["layers"][number], { type: "tile" }>,
    bySlot: Map<number, Project["tilesets"][number]>,
    tilemap: Tilemap,
    out: string[],
): void {
    if (read.data.length !== map.width * map.height) {
        out.push(
            `layer ${layer.id}: ${read.data.length} cells, expected ${map.width * map.height}`,
        );
        return;
    }
    let wrong = 0;
    let first = "";
    for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
            const value = layer.cells.get(x, y);
            const cell = read.data[y * map.width + x]!;
            let expected = "empty";
            if (value !== 0) {
                const tileset = bySlot.get(cellSlot(value));
                expected = `${tileset?.exportName}:${cellTileId(value)}:${cellOrientation(value)}`;
            }
            let got = "empty";
            if (cell !== 0) {
                const gid = cell & 0x0fffffff;
                let tileset: (typeof tilemap.tilesets)[number] | undefined;
                for (const candidate of tilemap.tilesets) {
                    if (candidate.firstGid <= gid) tileset = candidate;
                }
                got = `${tileset?.name}:${gid - (tileset?.firstGid ?? 0)}:${cell >>> 29}`;
            }
            if (got !== expected) {
                wrong += 1;
                first ||= `(${x}, ${y}) read ${got}, expected ${expected}`;
            }
        }
    }
    if (wrong > 0) out.push(`layer ${layer.id}: ${wrong} cells differ, first ${first}`);
}

/** Straight RGBA8 pixels. */
export interface Rgba {
    width: number;
    height: number;
    data: Uint8ClampedArray | Uint8Array;
}

/** What `compareImages` found. */
export interface ImageComparison {
    /** Pixels compared. */
    pixels: number;
    /** Pixels compared with an allowance (`tolerant`). */
    tolerant: number;
    /** Pixels that differ beyond what was allowed. */
    wrong: number;
    /** The first of them, as text. */
    examples: string[];
}

/**
 * Compares `actual` with `expected` pixel for pixel: each channel within `tolerant[i]` (one
 * byte per pixel, row by row), exactly where it is 0 or `tolerant` is null.
 */
export function compareImages(
    actual: Rgba,
    expected: Rgba,
    tolerant: Uint8Array | null,
): ImageComparison {
    const result: ImageComparison = { pixels: 0, tolerant: 0, wrong: 0, examples: [] };
    if (actual.width !== expected.width || actual.height !== expected.height) {
        result.wrong = 1;
        result.examples.push(
            `size ${actual.width} × ${actual.height}, expected ${expected.width} × ${expected.height}`,
        );
        return result;
    }
    const { width, height } = actual;
    for (let i = 0; i < width * height; i += 1) {
        const slack = tolerant === null ? 0 : tolerant[i]!;
        result.pixels += 1;
        if (slack > 0) result.tolerant += 1;
        const o = i * 4;
        let off = false;
        for (let c = 0; c < 4; c += 1) {
            if (Math.abs(actual.data[o + c]! - expected.data[o + c]!) > slack) off = true;
        }
        if (!off) continue;
        result.wrong += 1;
        if (result.examples.length < LISTED) {
            const at = (data: Rgba["data"]) => json(Array.from(data.subarray(o, o + 4)));
            result.examples.push(
                `(${i % width}, ${Math.floor(i / width)}) ${at(actual.data)}, expected ${at(expected.data)}`,
            );
        }
    }
    return result;
}
