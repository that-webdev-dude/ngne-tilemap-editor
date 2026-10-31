import type {
    CellMode,
    CellSource,
    EmitLayerOptions,
    EmitTileset,
    SpriteLike,
    SpriteSink,
} from "../../src/core/runtime/emit";
import { QuadEmitter } from "../../src/core/runtime/emit";

/** A sprite as the sink saw it: a copy, since the emitter reuses one object. */
export type Quad = Readonly<SpriteLike>;

export interface Collected {
    quads: Quad[];
    /** The object each `sprite` call received. */
    received: SpriteLike[];
}

export function collect(): Collected & SpriteSink {
    const quads: Quad[] = [];
    const received: SpriteLike[] = [];
    return {
        quads,
        received,
        sprite(s) {
            received.push(s);
            quads.push({ ...s });
        },
    };
}

export interface TilesetOptions {
    key: number;
    tileWidth: number;
    tileHeight: number;
    offsetX?: number;
    offsetY?: number;
    /** Tiles with IDs `0 .. tiles − 1`. */
    tiles?: number;
    texture?: string;
    /** Length of the tile ID span; default `tiles`. */
    span?: number;
}

/** A tileset whose tile `i` has the rectangle `u = i / tiles`, `v = 0.25`, `uw = 1 / tiles`, `vh = 0.5`. */
export function tilesetOf(options: TilesetOptions): EmitTileset {
    const tiles = options.tiles ?? 2;
    const ids = Array.from({ length: tiles }, (_, i) => i);
    const uv = new Float32Array(tiles * 4);
    ids.forEach((id) => uv.set([id / tiles, 0.25, 1 / tiles, 0.5], id * 4));
    return {
        texture: options.texture ?? `tex-${options.key}`,
        tileWidth: options.tileWidth,
        tileHeight: options.tileHeight,
        offsetX: options.offsetX ?? 0,
        offsetY: options.offsetY ?? 0,
        key: options.key,
        ids,
        uv,
        span: options.span ?? tiles,
    };
}

/** Layer options for a `width × height` map of `grid × grid` cells with the whole map in view. */
export function wholeMap(
    width: number,
    height: number,
    gridWidth: number,
    gridHeight = gridWidth,
): EmitLayerOptions {
    return {
        width,
        height,
        gridWidth,
        gridHeight,
        viewX: -1e7,
        viewY: -1e7,
        viewWidth: 2e7,
        viewHeight: 2e7,
        translateX: 0,
        translateY: 0,
        scale: 1,
        alpha: 1,
        color: 0xffffffff,
        layer: 0,
        depth: 0,
    };
}

/** Emits one layer through a new emitter and returns what the sink received. */
export function emitAll(
    mode: CellMode,
    tilesets: readonly EmitTileset[],
    cells: CellSource,
    options: EmitLayerOptions,
): Collected {
    const sink = collect();
    new QuadEmitter(mode, tilesets).emitLayer(sink, cells, options);
    return sink;
}

/** A sparse layer from a map of `"x,y"` to value. */
export function sparseCells(values: Readonly<Record<string, number>>): CellSource {
    return { get: (x, y) => values[`${x},${y}`] ?? 0 };
}
