import { CellStore, cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import { createImageLayer, createTileLayer } from "../../src/core/model";
import type {
    ImageLayer,
    Layer,
    PixelBuffer,
    Project,
    ProjectMap,
    Tile,
    TileLayer,
    Tileset,
} from "../../src/core/model";

// Small projects for the compositor tests: pixels are written as letters (`A`..`Z`, `.` for
// transparent) so that expected images read as pictures.

export type Rgba = readonly [number, number, number, number];

/** The colour of a letter: opaque and different for each of `A`..`Z`. */
export function colourOf(letter: string): Rgba {
    if (letter === ".") return [0, 0, 0, 0];
    const c = letter.charCodeAt(0) - 65;
    return [30 + c * 8, (c * 53) % 256, 255 - c * 5, 255];
}

/** Pixels from rows of letters; all rows have one length. */
export function pixelsOf(rows: readonly string[]): PixelBuffer {
    const width = rows[0]!.length;
    const data = new Uint8ClampedArray(width * rows.length * 4);
    rows.forEach((row, y) => {
        expectLength(row, width);
        [...row].forEach((letter, x) => data.set(colourOf(letter), (y * width + x) * 4));
    });
    return { width, height: rows.length, data };
}

function expectLength(row: string, width: number): void {
    if (row.length !== width) throw new Error(`Row ${JSON.stringify(row)} is not ${width} wide.`);
}

/** An image as rows of letters; a colour that is no letter's is `?`, any alpha 0 is `.`. */
export function asciiOf(buffer: PixelBuffer): string[] {
    const known = new Map<string, string>();
    for (let c = 0; c < 26; c += 1) {
        const letter = String.fromCharCode(65 + c);
        known.set(colourOf(letter).join(","), letter);
    }
    const rows: string[] = [];
    for (let y = 0; y < buffer.height; y += 1) {
        let row = "";
        for (let x = 0; x < buffer.width; x += 1) {
            const at = (y * buffer.width + x) * 4;
            const pixel = [...buffer.data.subarray(at, at + 4)];
            row += pixel[3] === 0 ? "." : (known.get(pixel.join(",")) ?? "?");
        }
        rows.push(row);
    }
    return rows;
}

export function pixelAt(buffer: PixelBuffer, x: number, y: number): number[] {
    const at = (y * buffer.width + x) * 4;
    return [...buffer.data.subarray(at, at + 4)];
}

export interface TilesetOptions {
    slot: number;
    offsetX?: number;
    offsetY?: number;
}

/** A tileset whose tile `i` is `tiles[i]` (rows of letters, all one size), in one row. */
export function tilesetOf(tiles: readonly (readonly string[])[], options: TilesetOptions): Tileset {
    const tileWidth = tiles[0]![0]!.length;
    const tileHeight = tiles[0]!.length;
    const width = tileWidth * tiles.length;
    const data = new Uint8ClampedArray(width * tileHeight * 4);
    tiles.forEach((rows, index) => {
        const tile = pixelsOf(rows);
        if (tile.width !== tileWidth || tile.height !== tileHeight) {
            throw new Error("All tiles of a tileset have one size.");
        }
        for (let y = 0; y < tileHeight; y += 1) {
            const source = tile.data.subarray(y * tileWidth * 4, (y + 1) * tileWidth * 4);
            data.set(source, (y * width + index * tileWidth) * 4);
        }
    });
    const list: Tile[] = tiles.map((_, id) => ({
        id,
        sourceKey: [id, 0],
        fingerprint: "0".repeat(64),
        class: "",
        collision: [],
        animation: [],
        properties: [],
    }));
    return {
        id: `tileset-${options.slot}`,
        name: `Tileset ${options.slot}`,
        exportName: `tileset-${options.slot}`,
        class: "",
        slot: options.slot,
        tileWidth,
        tileHeight,
        offsetX: options.offsetX ?? 0,
        offsetY: options.offsetY ?? 0,
        columns: tiles.length,
        pixels: { width, height: tileHeight, data },
        nextTileId: tiles.length,
        source: { kind: "image", fileName: "tiles.png", margin: 0, spacing: 0 },
        tiles: list,
        terrainSets: [],
        properties: [],
    };
}

/** A tile layer with the given cells, as `[x, y, slot, tileId, orientation?]`. */
export function tileLayerOf(
    id: number,
    cells: readonly (readonly [number, number, number, number, Orientation?])[],
    values: Partial<TileLayer> = {},
): TileLayer {
    const store = new CellStore();
    for (const [x, y, slot, tileId, orientation] of cells) {
        store.set(x, y, cellValue(slot, tileId, orientation ?? 0));
    }
    return { ...createTileLayer(id, `Layer ${id}`), ...values, cells: store };
}

export function imageLayerOf(
    id: number,
    imageId: string,
    values: Partial<ImageLayer> = {},
): ImageLayer {
    return { ...createImageLayer(id, `Image ${id}`, imageId), ...values };
}

export interface MapOptions {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight?: number;
    layers: Layer[];
    backgroundColor?: number | null;
    parallaxOriginX?: number;
    parallaxOriginY?: number;
}

export function mapOf(options: MapOptions): ProjectMap {
    return {
        id: "map-1",
        name: "Map",
        exportName: "map",
        class: "",
        orientation: "orthogonal",
        width: options.width,
        height: options.height,
        tileWidth: options.tileWidth,
        tileHeight: options.tileHeight ?? options.tileWidth,
        backgroundColor: options.backgroundColor ?? null,
        parallaxOriginX: options.parallaxOriginX ?? 0,
        parallaxOriginY: options.parallaxOriginY ?? 0,
        nextLayerId: 100,
        nextMarkerId: 1,
        layers: options.layers,
        properties: [],
    };
}

export function projectOf(
    map: ProjectMap,
    tilesets: Tileset[],
    images: { id: string; rows: readonly string[] }[] = [],
): Project {
    return {
        id: "project-1",
        name: "Project",
        exportName: "project",
        maps: [map],
        tilesets,
        images: images.map(({ id, rows }) => ({
            id,
            name: id,
            exportName: id,
            pixels: pixelsOf(rows),
        })),
        exportSettings: { exportOnSave: false },
        properties: [],
    };
}
