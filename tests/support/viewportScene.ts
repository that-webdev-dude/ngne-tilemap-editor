import { CellStore, cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import { createTileLayer, sequentialIds } from "../../src/core/model";
import type { Project, ProjectMap, Tile, Tileset } from "../../src/core/model";
import { sha256Hex } from "./sha256";

// The map of the viewport readback tests (TE-013): every orientation of tiles of an even size,
// of an odd size and of a tileset with a tile offset; a layer with opacity, a layer with
// parallax and a layer with an offset. Plain ECMAScript with no Node import, so E2E pages and
// the benchmark load it too.

export const SCENE = {
    width: 20,
    height: 12,
    grid: 16,
    /** Tiles per tileset. */
    tiles: 4,
    columns: 4,
    parallax: 0.5,
    opacity: 128,
    layerOffset: { x: 3, y: -2 },
} as const;

export interface ViewportSceneOptions {
    /** The map's background colour 0xRRGGBBAA; null shows the checkerboard. */
    background: number | null;
    parallaxOriginX?: number;
    parallaxOriginY?: number;
}

interface TilesetSpec {
    slot: number;
    size: number;
    offsetX: number;
    offsetY: number;
}

const TILESETS: readonly TilesetSpec[] = [
    // Even tiles.
    { slot: 1, size: 16, offsetX: 0, offsetY: 0 },
    // Odd tiles in the 16 px grid.
    { slot: 2, size: 15, offsetX: 0, offsetY: 0 },
    // Even tiles with a tile offset.
    { slot: 3, size: 16, offsetX: 3, offsetY: -2 },
];

/** One tile's pixels: asymmetric, so any wrong orientation shows; some pixels clear or faint. */
function tilePixels(spec: TilesetSpec, id: number): Uint8ClampedArray {
    const { size } = spec;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const i = (y * size + x) * 4;
            data[i] = (x * 16 + id * 40 + spec.slot * 20) & 255;
            data[i + 1] = (y * 16 + 30 * id) & 255;
            data[i + 2] = (x * y * 3 + 60 * spec.slot) & 255;
            // A clear diagonal, a faint stripe, the rest opaque.
            data[i + 3] = x === y ? 0 : y % 5 === 4 ? 96 : 255;
        }
    }
    return data;
}

function createTileset(spec: TilesetSpec, newId: () => string): Tileset {
    const { tiles, columns } = SCENE;
    const rows = Math.ceil(tiles / columns);
    const width = columns * spec.size;
    const height = rows * spec.size;
    const data = new Uint8ClampedArray(width * height * 4);
    const list: Tile[] = [];
    for (let id = 0; id < tiles; id += 1) {
        const pixels = tilePixels(spec, id);
        const column = id % columns;
        const row = Math.floor(id / columns);
        for (let y = 0; y < spec.size; y += 1) {
            const from = y * spec.size * 4;
            const to = ((row * spec.size + y) * width + column * spec.size) * 4;
            data.set(pixels.subarray(from, from + spec.size * 4), to);
        }
        list.push({
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
        name: `Scene ${spec.slot}`,
        exportName: `scene-${spec.slot}`,
        class: "",
        slot: spec.slot,
        tileWidth: spec.size,
        tileHeight: spec.size,
        offsetX: spec.offsetX,
        offsetY: spec.offsetY,
        columns,
        pixels: { width, height, data },
        nextTileId: tiles,
        source: { kind: "image", fileName: `scene-${spec.slot}.png`, margin: 0, spacing: 0 },
        tiles: list,
        terrainSets: [],
        properties: [],
    };
}

/** The project of the readback tests: one map, three tilesets (slots 1, 2, 3). */
export function createViewportSceneProject(options: ViewportSceneOptions): Project {
    const newId = sequentialIds("scene-");
    const projectId = newId();
    const tilesets = TILESETS.map((spec) => createTileset(spec, newId));
    const { width, height, grid, tiles } = SCENE;

    const map: ProjectMap = {
        id: newId(),
        name: "Scene",
        exportName: "scene",
        class: "",
        orientation: "orthogonal",
        width,
        height,
        tileWidth: grid,
        tileHeight: grid,
        backgroundColor: options.background,
        parallaxOriginX: options.parallaxOriginX ?? 0,
        parallaxOriginY: options.parallaxOriginY ?? 0,
        nextLayerId: 4,
        nextMarkerId: 1,
        layers: [],
        properties: [],
    };

    // Row 0..2 of the base layer: the 8 orientations of each tileset, one tileset a row.
    const base = createTileLayer(1, "Base");
    base.cells = new CellStore();
    for (const [row, spec] of TILESETS.entries()) {
        for (let o = 0; o < 8; o += 1) {
            base.cells.set(o, row, cellValue(spec.slot, o % tiles, o as Orientation));
        }
    }
    // Below them a sparse mix, so some cells show the checkerboard and others do not.
    for (let y = 4; y < 9; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if ((x + y) % 3 === 0) continue;
            const spec = TILESETS[(x + y) % TILESETS.length]!;
            base.cells.set(
                x,
                y,
                cellValue(spec.slot, (x * 3 + y) % tiles, ((x + y) % 8) as Orientation),
            );
        }
    }

    // Half opacity over the base, on tileset 1.
    const faint = createTileLayer(2, "Faint");
    faint.opacity = SCENE.opacity;
    for (let y = 0; y < 3; y += 1) {
        for (let x = 4; x < 12; x += 1) faint.cells.set(x, y, cellValue(1, (x + y) % tiles));
    }

    // Parallax on both axes and a layer offset, on tileset 2.
    const far = createTileLayer(3, "Far");
    far.parallaxX = SCENE.parallax;
    far.parallaxY = SCENE.parallax;
    far.offsetX = SCENE.layerOffset.x;
    far.offsetY = SCENE.layerOffset.y;
    for (let y = 9; y < 12; y += 1) {
        for (let x = 2; x < 18; x += 1) far.cells.set(x, y, cellValue(2, (x + y) % tiles));
    }

    map.layers.push(base, faint, far);
    return {
        id: projectId,
        name: "Scene",
        exportName: "scene-project",
        maps: [map],
        tilesets,
        images: [],
        exportSettings: { exportOnSave: false },
        properties: [],
    };
}
