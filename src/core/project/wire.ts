import { CellStore } from "../cells/store";
import type { GroupLayer, Layer, Project, ProjectMap, TileLayer } from "../model";

// A project as it crosses to and from the background worker (TE-047): Save hands the page's
// project to the writer there, Open takes the reader's project back. A message carries plain
// data only, so each tile layer's `CellStore` travels as its chunks; everything else is the
// project itself. The typed arrays (chunks, tileset and image pixels) are listed by
// `wireBuffers`, so they are transferred instead of copied.

/** One chunk of a tile layer: chunk coordinates and its 32 × 32 values (`CellChunk`). */
export interface WireChunk {
    readonly cx: number;
    readonly cy: number;
    readonly cells: Uint32Array;
}

export type WireLayer =
    | Exclude<Layer, TileLayer | GroupLayer>
    | (Omit<TileLayer, "cells"> & { cells: WireChunk[] })
    | (Omit<GroupLayer, "layers"> & { layers: WireLayer[] });

export type WireMap = Omit<ProjectMap, "layers"> & { layers: WireLayer[] };

export type ProjectWire = Omit<Project, "maps"> & { maps: WireMap[] };

function layerToWire(layer: Layer): WireLayer {
    switch (layer.type) {
        case "tile":
            return {
                ...layer,
                cells: Array.from(layer.cells.allChunks(), ({ cx, cy, cells }) => ({
                    cx,
                    cy,
                    cells,
                })),
            };
        case "group":
            return { ...layer, layers: layer.layers.map(layerToWire) };
        default:
            return layer;
    }
}

function layerFromWire(layer: WireLayer): Layer {
    switch (layer.type) {
        case "tile":
            return { ...layer, cells: CellStore.fromChunks(layer.cells) };
        case "group":
            return { ...layer, layers: layer.layers.map(layerFromWire) };
        default:
            return layer;
    }
}

/**
 * `project` as plain data. It shares its arrays and objects with `project`: a message clones
 * them when it is posted, or `structuredClone` makes a snapshot that later changes of the
 * project do not reach.
 */
export function projectToWire(project: Project): ProjectWire {
    return {
        ...project,
        maps: project.maps.map((map) => ({ ...map, layers: map.layers.map(layerToWire) })),
    };
}

/** The project `wire` holds; its chunk arrays become the cell stores' own. */
export function projectFromWire(wire: ProjectWire): Project {
    return {
        ...wire,
        maps: wire.maps.map((map) => ({ ...map, layers: map.layers.map(layerFromWire) })),
    };
}

function layerBuffers(layer: WireLayer, into: Set<ArrayBuffer>): void {
    if (layer.type === "tile") {
        for (const chunk of layer.cells) {
            if (chunk.cells.buffer instanceof ArrayBuffer) into.add(chunk.cells.buffer);
        }
    } else if (layer.type === "group") {
        for (const child of layer.layers) layerBuffers(child, into);
    }
}

/** The buffers behind the typed arrays of `wire`, each once: what a message can transfer. */
export function wireBuffers(wire: ProjectWire): ArrayBuffer[] {
    const buffers = new Set<ArrayBuffer>();
    for (const { pixels } of [...wire.tilesets, ...wire.images]) {
        if (pixels.data.buffer instanceof ArrayBuffer) buffers.add(pixels.data.buffer);
    }
    for (const map of wire.maps) {
        for (const layer of map.layers) layerBuffers(layer, buffers);
    }
    return [...buffers];
}
