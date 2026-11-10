import { CellStore, cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import {
    createImageLayer,
    createMarkerLayer,
    createTileLayer,
    sequentialIds,
} from "../../src/core/model";
import type { PixelBuffer, Project, ProjectMap, Tile, Tileset } from "../../src/core/model";
import { sha256Hex } from "./sha256";

// The project of the TE-053 tests: two maps, two tilesets and an image. Tileset "Grass" has
// 16 × 16 tiles, two of them with the same pixels (they share one atlas rectangle), an animated
// tile and a tile with a class and collision; tileset "Rocks" has odd 15 × 9 tiles (rectangles
// rounded up to even). Map "Level 1" uses both tilesets and the image; map "Level 2" uses
// "Rocks" only. Deterministic and plain ECMAScript with no Node import, so E2E pages load it.

/** A tile's pixels: from its colour index and position, opaque but for one corner pixel. */
function tilePixels(width: number, height: number, colour: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const at = (y * width + x) * 4;
            const corner = x === 0 && y === 0;
            data[at] = corner ? 0 : (colour * 53 + x * 9) & 0xff;
            data[at + 1] = corner ? 0 : (colour * 97 + y * 11) & 0xff;
            data[at + 2] = corner ? 0 : (colour * 31 + ((x ^ y) << 2)) & 0xff;
            data[at + 3] = corner ? 0 : 255;
        }
    }
    return data;
}

interface TilesetSpec {
    id: string;
    name: string;
    exportName: string;
    slot: number;
    tileWidth: number;
    tileHeight: number;
    columns: number;
    /** The colour index of each tile, in display order; equal indices give equal pixels. */
    colours: readonly number[];
}

function tileset(spec: TilesetSpec): Tileset {
    const { tileWidth, tileHeight, columns, colours } = spec;
    const rows = Math.ceil(colours.length / columns);
    const width = columns * tileWidth;
    const data = new Uint8ClampedArray(width * rows * tileHeight * 4);
    const tiles: Tile[] = colours.map((colour, position) => {
        const pixels = tilePixels(tileWidth, tileHeight, colour);
        const left = (position % columns) * tileWidth;
        const top = Math.floor(position / columns) * tileHeight;
        for (let y = 0; y < tileHeight; y += 1) {
            const source = y * tileWidth * 4;
            data.set(
                pixels.subarray(source, source + tileWidth * 4),
                ((top + y) * width + left) * 4,
            );
        }
        return {
            id: position,
            sourceKey: [position % columns, Math.floor(position / columns)],
            fingerprint: sha256Hex(pixels),
            class: "",
            collision: [],
            animation: [],
            properties: [],
        };
    });
    return {
        id: spec.id,
        name: spec.name,
        exportName: spec.exportName,
        class: "",
        slot: spec.slot,
        tileWidth,
        tileHeight,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels: { width, height: rows * tileHeight, data },
        nextTileId: colours.length,
        source: { kind: "image", fileName: `${spec.exportName}.png`, margin: 0, spacing: 0 },
        tiles,
        terrainSets: [],
        properties: [],
    };
}

function imagePixels(width: number, height: number): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        data[i * 4] = (i * 3) & 0xff;
        data[i * 4 + 1] = 120;
        data[i * 4 + 2] = (255 - i) & 0xff;
        data[i * 4 + 3] = i % 5 === 0 ? 128 : 255;
    }
    return { width, height, data };
}

function map(
    id: string,
    name: string,
    exportName: string,
    width: number,
    height: number,
): ProjectMap {
    return {
        id,
        name,
        exportName,
        class: "",
        orientation: "orthogonal",
        width,
        height,
        tileWidth: 16,
        tileHeight: 16,
        backgroundColor: null,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
        nextLayerId: 1,
        nextMarkerId: 1,
        layers: [],
        properties: [],
    };
}

/** A tile layer whose cells `fill(x, y)` gives (a cell value, or 0). */
function tileLayer(
    id: number,
    width: number,
    height: number,
    fill: (x: number, y: number) => number,
) {
    const layer = createTileLayer(id, `Tiles ${id}`);
    const cells = new CellStore();
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const value = fill(x, y);
            if (value !== 0) cells.set(x, y, value);
        }
    }
    layer.cells = cells;
    return layer;
}

/** The TE-053 project; `id` is its project ID. */
export function createExportProject(id = "export-project"): Project {
    const newId = sequentialIds(`${id}-`);
    const grass = tileset({
        id: newId(),
        name: "Grass",
        exportName: "grass",
        slot: 1,
        tileWidth: 16,
        tileHeight: 16,
        columns: 3,
        colours: [1, 2, 3, 1, 4],
    });
    grass.tiles[1]!.animation = [
        { tile: 1, ms: 120 },
        { tile: 2, ms: 80 },
    ];
    grass.tiles[2]!.class = "water";
    grass.tiles[2]!.collision = [{ shape: "rectangle", x: 0, y: 4, width: 16, height: 12 }];
    const rocks = tileset({
        id: newId(),
        name: "Rocks",
        exportName: "rocks",
        slot: 2,
        tileWidth: 15,
        tileHeight: 9,
        columns: 2,
        colours: [5, 6, 7],
    });
    const sky = { id: newId(), name: "Sky", exportName: "sky", pixels: imagePixels(40, 20) };

    const first = map(newId(), "Level 1", "level-1", 6, 4);
    const ground = tileLayer(1, 6, 4, (x, y) =>
        y < 2
            ? cellValue(1, (x + y) % 5, ((x * 3 + y) % 8) as Orientation)
            : cellValue(2, x % 3, 0),
    );
    const background = createImageLayer(2, "Sky", sky.id);
    const markers = createMarkerLayer(3, "Spawns");
    markers.markers.push({
        shape: "point",
        x: 24,
        y: 40,
        id: 1,
        name: "start",
        class: "spawn",
        properties: [],
    });
    first.layers.push(background, ground, markers);
    first.nextLayerId = 4;
    first.nextMarkerId = 2;

    const second = map(newId(), "Level 2", "level-2", 4, 3);
    second.layers.push(
        tileLayer(1, 4, 3, (x, y) => ((x + y) % 2 === 0 ? cellValue(2, y % 3, 0) : 0)),
    );
    second.nextLayerId = 2;

    return {
        id,
        name: "Export test",
        exportName: "export-test",
        maps: [first, second],
        tilesets: [grass, rocks],
        images: [sky],
        exportSettings: { exportOnSave: false },
        properties: [],
    };
}
