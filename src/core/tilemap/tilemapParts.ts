import type { Project, ProjectMap } from "../model";
import { invalidate, readTilemap, validateTilemap } from "../runtime/runtime";
import type { Tilemap } from "../runtime/runtime";
import { tilemapFor } from "./tilemapFor";

// A map's tilemap made on one thread and used on another (SPEC §12). `readTilemap` keeps what
// `drawTilemap` and the data functions need per `Tilemap` object, so its result cannot cross
// between threads. `tilemapParts` does the long work and returns plain data: the text of
// `tilemapFor`, parsed and checked by `validateTilemap` as a game's load checks it, with the
// cells apart as typed arrays. `tilemapFromParts` makes the `Tilemap` of those parts with
// `readTilemap`, in a time that does not depend on what the cells hold; `cellsFromParts` gives
// a `Tilemap` the cells of later parts that differ in their cells alone.

/** The GID bits of a cell value (FORMAT 1.2): the value without its flags. */
const GID_MASK = 0x0fffffff;

export interface TilemapParts {
    /**
     * The tilemap (FORMAT §3) as JSON text, checked, every tile layer's `data` empty. Parts of
     * equal text and equal atlases differ in their cells alone.
     */
    readonly text: string;
    /** The `data` of each tile layer, bottom to top, as the reader read it. */
    readonly cells: readonly Uint32Array[];
    /** The GID and the frame durations of every animated tile of the tilesets listed. */
    readonly animated: readonly (readonly [gid: number, durations: number[]])[];
    /** The GIDs of `animated` that the visible tile layers place, each once, as first met. */
    readonly placed: readonly number[];
}

/**
 * The parts of the tilemap of `map`: `tilemapFor`, `JSON.parse` and `validateTilemap` with
 * `atlases` (the parsed atlas of each tileset the map's cells use, by export name).
 *
 * Throws what those throw: `CellConversionError`, `TilemapError`, or an `Error` for an image
 * layer whose image the project lacks.
 */
export function tilemapParts(
    project: Project,
    map: ProjectMap,
    atlases: Readonly<Record<string, unknown>>,
): TilemapParts {
    const json = JSON.parse(tilemapFor(project, map)) as {
        tilesets: { name: string; firstGid: number }[];
        layers: { type: string; data?: unknown }[];
    };
    const tilemap = validateTilemap(json, atlases);
    const cells: Uint32Array[] = [];
    for (const layer of tilemap.layers) if (layer.type === "tile") cells.push(layer.data);
    for (const layer of json.layers) if (layer.type === "tile") layer.data = [];

    const durations = new Map<number, number[]>();
    for (const { name, firstGid } of json.tilesets) {
        const tileset = project.tilesets.find((each) => each.exportName === name);
        for (const tile of tileset?.tiles ?? []) {
            if (tile.animation.length > 1) {
                durations.set(
                    firstGid + tile.id,
                    tile.animation.map((frame) => frame.ms),
                );
            }
        }
    }
    const placed = new Set<number>();
    if (durations.size > 0) {
        for (const layer of tilemap.layers) {
            if (layer.type !== "tile" || !layer.visible) continue;
            for (const value of layer.data) {
                if (value !== 0 && durations.has(value & GID_MASK)) placed.add(value & GID_MASK);
            }
        }
    }
    return { text: JSON.stringify(json), cells, animated: [...durations], placed: [...placed] };
}

/**
 * Writes the cells of `parts` into `tilemap` and `invalidate`s its tile layers. `tilemap` is
 * the tilemap of parts with the same `text`.
 */
export function cellsFromParts(parts: TilemapParts, tilemap: Tilemap): void {
    let next = 0;
    for (const layer of tilemap.layers) {
        if (layer.type !== "tile") continue;
        layer.data.set(parts.cells[next++]!);
        invalidate(tilemap, layer);
    }
}

/**
 * The `Tilemap` of `parts`, as `readTilemap` returns it for the text the parts were made from:
 * read with empty cells, then given the cells of the parts. `atlases` are those the parts were
 * made with. The tile layers' `data` are new arrays; `parts` is not changed.
 *
 * Throws `TilemapError` when the parts are not those of `tilemapParts` with these atlases.
 */
export function tilemapFromParts(
    parts: TilemapParts,
    atlases: Readonly<Record<string, unknown>>,
): Tilemap {
    const json = JSON.parse(parts.text) as {
        width: number;
        height: number;
        layers: { type: string; data?: unknown }[];
    };
    const empty = new Array<number>(json.width * json.height).fill(0);
    for (const layer of json.layers) if (layer.type === "tile") layer.data = empty;
    const tilemap = readTilemap(json, atlases);
    cellsFromParts(parts, tilemap);
    return tilemap;
}
