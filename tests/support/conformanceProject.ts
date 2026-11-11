import { CellStore, cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import {
    createGroupLayer,
    createImageLayer,
    createMarkerLayer,
    createTileLayer,
    sequentialIds,
} from "../../src/core/model";
import type { Layer, PixelBuffer, Project, ProjectMap, Tile, Tileset } from "../../src/core/model";
import { sha256Hex } from "./sha256";

// The reference export project of the TE-055 conformance tests (SPEC §10.3): every orientation
// of odd and even tile sizes, a tile odd on one side only, a tile larger than the grid, a tile
// offset, a parallax layer, an opacity layer (a group's and a layer's opacity together), an image
// layer of odd size, markers, properties and collision. The grid is 16 × 16 px throughout.
// Deterministic and plain ECMAScript with no Node import, so E2E pages load it.
//
// Every texel says where it comes from: red rises with its column, blue with its row, and green
// names its tile, one value per tile of the project (a duplicate tile has the same pixels as its
// original, and shares its atlas rectangle). So a texel of a neighbouring atlas rectangle never
// has a colour of the tile drawn next to it, and a texel one place off differs by 11 in red or
// 9 in blue. A few texels of every tile are transparent, so the layer below shows through.

/** The grid of every map. */
export const CONFORMANCE_GRID = 16;

interface TilesetSpec {
    name: string;
    exportName: string;
    slot: number;
    tileWidth: number;
    tileHeight: number;
    offsetX: number;
    offsetY: number;
    columns: number;
    /** Per tile, its index in the project's tile palette; equal indices give equal pixels. */
    palette: readonly number[];
}

/** The four tilesets, in project order. */
const TILESETS: readonly TilesetSpec[] = [
    // Even tiles, with a duplicate of tile 0 (tile 4).
    {
        name: "Even",
        exportName: "even",
        slot: 1,
        tileWidth: 16,
        tileHeight: 16,
        offsetX: 0,
        offsetY: 0,
        columns: 3,
        palette: [0, 1, 2, 3, 0],
    },
    // Odd tiles in both directions: atlas rectangles 16 × 10.
    {
        name: "Odd",
        exportName: "odd",
        slot: 2,
        tileWidth: 15,
        tileHeight: 9,
        offsetX: 0,
        offsetY: 0,
        columns: 3,
        palette: [4, 5, 6],
    },
    // Larger than the grid and odd: they grow up and to the right of their cell.
    {
        name: "Large",
        exportName: "large",
        slot: 3,
        tileWidth: 21,
        tileHeight: 27,
        offsetX: 0,
        offsetY: 0,
        columns: 2,
        palette: [7, 8],
    },
    // A tile offset, with odd tiles: 9 × 13 moved 4 right and 6 up.
    {
        name: "Offset",
        exportName: "offset",
        slot: 4,
        tileWidth: 9,
        tileHeight: 13,
        offsetX: 4,
        offsetY: -6,
        columns: 2,
        palette: [9, 10],
    },
    // Even across and odd down: only the height is padded (rectangles 14 × 10).
    {
        name: "Mixed",
        exportName: "mixed",
        slot: 5,
        tileWidth: 14,
        tileHeight: 9,
        offsetX: 0,
        offsetY: 0,
        columns: 2,
        palette: [11, 12],
    },
];

/** The texel `(x, y)` of the tile with palette index `index`, as RGBA. */
export function conformanceTexel(
    index: number,
    x: number,
    y: number,
): [number, number, number, number] {
    const hole = (x * 3 + y * 5 + index) % 13 === 0;
    if (hole) return [0, 0, 0, 0];
    return [8 + x * 11, 16 + index * 6, 6 + y * 9, 255];
}

function tilePixels(index: number, width: number, height: number): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1)
            data.set(conformanceTexel(index, x, y), (y * width + x) * 4);
    }
    return data;
}

function tileset(spec: TilesetSpec, id: string): Tileset {
    const { tileWidth, tileHeight, columns, palette } = spec;
    const rows = Math.ceil(palette.length / columns);
    const width = columns * tileWidth;
    const data = new Uint8ClampedArray(width * rows * tileHeight * 4);
    const tiles: Tile[] = palette.map((index, position) => {
        const pixels = tilePixels(index, tileWidth, tileHeight);
        const left = (position % columns) * tileWidth;
        const top = Math.floor(position / columns) * tileHeight;
        for (let y = 0; y < tileHeight; y += 1) {
            const row = pixels.subarray(y * tileWidth * 4, (y + 1) * tileWidth * 4);
            data.set(row, ((top + y) * width + left) * 4);
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
        id,
        name: spec.name,
        exportName: spec.exportName,
        class: "",
        slot: spec.slot,
        tileWidth,
        tileHeight,
        offsetX: spec.offsetX,
        offsetY: spec.offsetY,
        columns,
        pixels: { width, height: rows * tileHeight, data },
        nextTileId: palette.length,
        source: { kind: "image", fileName: `${spec.exportName}.png`, margin: 0, spacing: 0 },
        tiles,
        terrainSets: [],
        properties: [],
    };
}

function emptyMap(
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
        tileWidth: CONFORMANCE_GRID,
        tileHeight: CONFORMANCE_GRID,
        backgroundColor: null,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
        nextLayerId: 1,
        nextMarkerId: 1,
        layers: [],
        properties: [],
    };
}

function cells(width: number, height: number, fill: (x: number, y: number) => number): CellStore {
    const store = new CellStore();
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const value = fill(x, y);
            if (value !== 0) store.set(x, y, value);
        }
    }
    return store;
}

/** Columns of an orientation map: 8 cells side by side, a free cell, then 8 cells one apart. */
const ORIENTATION_COLUMNS = 24;

/**
 * A map showing every tile of one tileset in all 8 orientations: tile `k` on row
 * `first + k · step`, once in 8 adjacent cells (columns 0..7, orientation = column) and once in
 * cells one apart (columns 9, 11, … 23), so both a tile's edges against its neighbours and its
 * edges against nothing are drawn.
 */
function orientationMap(id: string, spec: TilesetSpec, first: number, step: number): ProjectMap {
    const count = spec.palette.length;
    const height = first + (count - 1) * step + 1;
    const map = emptyMap(
        id,
        `${spec.name} tiles`,
        `${spec.exportName}-tiles`,
        ORIENTATION_COLUMNS,
        height,
    );
    const layer = createTileLayer(1, spec.name);
    layer.cells = cells(ORIENTATION_COLUMNS, height, (x, y) => {
        if (y < first || (y - first) % step !== 0) return 0;
        const tile = (y - first) / step;
        if (x < 8) return cellValue(spec.slot, tile, x as Orientation);
        if (x > 8 && x % 2 === 1) return cellValue(spec.slot, tile, ((x - 9) / 2) as Orientation);
        return 0;
    });
    map.layers.push(layer);
    map.nextLayerId = 2;
    return map;
}

/**
 * The image of the image layer, odd both ways (its PNG is padded to even, FORMAT §5): opaque but
 * for every fifth pixel, which is half transparent.
 */
function skyPixels(width: number, height: number): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        data[i * 4] = 200 - ((i * 3) & 63);
        data[i * 4 + 1] = 230;
        data[i * 4 + 2] = 120 + (i % 40);
        data[i * 4 + 3] = i % 5 === 0 ? 128 : 255;
    }
    return { width, height, data };
}

/** Size of the layers map, in cells. */
export const LAYERS_MAP = { width: 12, height: 8 } as const;

/**
 * The layers map, bottom to top: Ground (even tiles in every cell, every orientation), Sky (an
 * image layer at an offset), Far (odd tiles, parallax 0.5 × 0.75), Veil (a group: opacity 160,
 * offset 5, 3) holding Ghost (large tiles, opacity 200) and Spawns (markers).
 */
function layersMap(id: string, imageId: string): ProjectMap {
    const { width, height } = LAYERS_MAP;
    const map = emptyMap(id, "Layers", "layers", width, height);
    map.class = "level";
    map.properties = [
        { name: "music", type: "file", value: "meadow.ogg" },
        { name: "gravity", type: "float", value: 9.5 },
    ];
    const ground = createTileLayer(1, "Ground");
    ground.cells = cells(width, height, (x, y) =>
        cellValue(1, (x + 2 * y) % 4, ((x + y * 3) % 8) as Orientation),
    );
    ground.properties = [{ name: "solid", type: "bool", value: true }];

    const sky = createImageLayer(2, "Sky", imageId);
    sky.offsetX = 70;
    sky.offsetY = 18;

    const far = createTileLayer(3, "Far");
    far.cells = cells(width, height, (x, y) =>
        (x + y) % 3 === 0 ? cellValue(2, y % 3, ((x * 5 + y) % 8) as Orientation) : 0,
    );
    far.parallaxX = 0.5;
    far.parallaxY = 0.75;

    const veil = createGroupLayer(4, "Veil");
    veil.opacity = 160;
    veil.offsetX = 5;
    veil.offsetY = 3;
    veil.properties = [{ name: "fade", type: "int", value: 3 }];
    const ghost = createTileLayer(5, "Ghost");
    ghost.opacity = 200;
    ghost.class = "decor";
    ghost.cells = cells(width, height, (x, y) =>
        y >= 2 && y % 3 === 2 && x % 3 === 1
            ? cellValue(3, x % 2, ((x + y) % 8) as Orientation)
            : 0,
    );
    veil.layers.push(ghost);

    const spawns = createMarkerLayer(6, "Spawns");
    spawns.markers.push(
        { shape: "point", x: 24, y: 40, id: 1, name: "player", class: "spawn", properties: [] },
        {
            shape: "rectangle",
            x: 64.5,
            y: 16,
            width: 32,
            height: 20.25,
            id: 2,
            name: "door",
            class: "trigger",
            properties: [{ name: "to", type: "string", value: "cave" }],
        },
        {
            shape: "polygon",
            x: 100,
            y: 90,
            points: [
                [0, 0],
                [12, -4],
                [6, 10],
            ],
            id: 3,
            name: "pond",
            class: "",
            properties: [{ name: "deep", type: "bool", value: false }],
        },
        {
            shape: "polyline",
            x: -8,
            y: 4,
            points: [
                [0, 0],
                [30, 30],
            ],
            id: 4,
            name: "path",
            class: "",
            properties: [],
        },
        {
            shape: "ellipse",
            x: 150,
            y: 20,
            width: 10,
            height: 6,
            id: 5,
            name: "",
            class: "",
            properties: [],
        },
    );
    const layers: Layer[] = [ground, sky, far, veil, spawns];
    map.layers.push(...layers);
    map.nextLayerId = 7;
    map.nextMarkerId = 6;
    return map;
}

/** The TE-055 reference export project. */
export function createConformanceProject(): Project {
    const newId = sequentialIds("conformance-");
    const projectId = newId();
    const tilesets = TILESETS.map((spec) => tileset(spec, newId()));
    const [even, odd, large] = tilesets as [Tileset, Tileset, Tileset, Tileset, Tileset];
    even.class = "terrain";
    even.properties = [{ name: "biome", type: "string", value: "meadow" }];
    even.tiles[1]!.class = "wall";
    even.tiles[1]!.collision = [
        { shape: "rectangle", x: 0, y: 4, width: 16, height: 12 },
        { shape: "ellipse", x: 2, y: 2, width: 5, height: 3.5 },
    ];
    even.tiles[1]!.properties = [{ name: "solid", type: "bool", value: true }];
    even.tiles[2]!.properties = [
        { name: "speed", type: "int", value: 40 },
        { name: "tint", type: "color", value: "#336699ff" },
    ];
    odd.tiles[0]!.collision = [
        {
            shape: "polygon",
            x: 0,
            y: 9,
            points: [
                [0, 0],
                [15, -9],
                [15, 0],
            ],
        },
    ];
    large.tiles[1]!.class = "tree";

    const image = { id: newId(), name: "Sky", exportName: "sky", pixels: skyPixels(41, 21) };
    const [evenSpec, oddSpec, largeSpec, offsetSpec, mixedSpec] = TILESETS as [
        TilesetSpec,
        TilesetSpec,
        TilesetSpec,
        TilesetSpec,
        TilesetSpec,
    ];
    const maps = [
        orientationMap(newId(), evenSpec, 0, 2),
        orientationMap(newId(), oddSpec, 0, 2),
        // 27 px high: two free rows above each row of large tiles.
        orientationMap(newId(), largeSpec, 2, 3),
        orientationMap(newId(), offsetSpec, 1, 2),
        orientationMap(newId(), mixedSpec, 0, 2),
        layersMap(newId(), image.id),
    ];
    return {
        id: projectId,
        name: "Conformance",
        exportName: "conformance",
        maps,
        tilesets,
        images: [image],
        exportSettings: { exportOnSave: false },
        properties: [{ name: "version", type: "int", value: 1 }],
    };
}
