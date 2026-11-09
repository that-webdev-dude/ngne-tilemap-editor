import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CellStore, cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import { createGroupLayer, createMarkerLayer, createTileLayer } from "../../src/core/model";
import type { PixelBuffer, Project, ProjectMap, Tile, Tileset } from "../../src/core/model";
import { decodePng } from "../../src/core/sprite/png";
import { validateAtlas } from "../../src/core/sprite/export/validateAtlas";
import type { AtlasMeta } from "../../src/core/sprite/export/atlasFormat";

// Shared by the TE-049 tests: the meadow project of FORMAT §3.10 and its fixture files.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURE_DIR = resolve(ROOT, "tests/fixtures/format");
export const MEADOW_TILEMAP = resolve(FIXTURE_DIR, "meadow.tilemap.json");
export const GRASS_ATLAS = resolve(FIXTURE_DIR, "grass.atlas.json");
export const GRASS_PNG = resolve(FIXTURE_DIR, "grass.png");

/** The generator the fixture names, as the FORMAT §3.10 example does. */
export const FIXTURE_GENERATOR = "ngne-tilemap-editor 1.0.0";

/** H, V and D as an orientation: `H V D` read as a binary number (FORMAT §1.2). */
export const H = 4;
export const D = 1;

/** Four 16 × 16 tiles in a row, each a different solid colour with a marked corner. */
function grassPixels(): PixelBuffer {
    const width = 64;
    const height = 16;
    const data = new Uint8ClampedArray(width * height * 4);
    const colours = [
        [80, 160, 60],
        [100, 180, 70],
        [120, 200, 90],
        [90, 70, 50],
    ];
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = colours[Math.floor(x / 16)]!;
            const corner = x % 16 === 0 && y === 0;
            data.set(corner ? [255, 255, 255, 255] : [r!, g!, b!, 255], (y * width + x) * 4);
        }
    }
    return { width, height, data };
}

function tile(id: number, extra: Partial<Tile> = {}): Tile {
    return {
        id,
        sourceKey: [id, 0],
        fingerprint: "0".repeat(64),
        class: "",
        collision: [],
        animation: [],
        properties: [],
        ...extra,
    };
}

/** The tileset `grass`: four tiles, tile 2 animated, tile 3 solid. */
export function grassTileset(slot = 1): Tileset {
    return {
        id: "grass-id",
        name: "Grass",
        exportName: "grass",
        class: "",
        slot,
        tileWidth: 16,
        tileHeight: 16,
        offsetX: 0,
        offsetY: 0,
        columns: 4,
        pixels: grassPixels(),
        nextTileId: 4,
        source: { kind: "image", fileName: "grass.png", margin: 0, spacing: 0 },
        tiles: [
            tile(0),
            tile(1),
            tile(2, {
                animation: [
                    { tile: 2, ms: 250 },
                    { tile: 1, ms: 250 },
                ],
            }),
            tile(3, {
                class: "solid",
                collision: [{ shape: "rectangle", x: 0, y: 0, width: 16, height: 16 }],
                properties: [{ name: "friction", type: "float", value: 0.8 }],
            }),
        ],
        terrainSets: [],
        properties: [],
    };
}

/** The map `meadow` of FORMAT §3.10, cells in the grass tileset's `slot`. */
export function meadowMap(slot = 1): ProjectMap {
    const cell = (tileId: number, orientation: Orientation = 0) =>
        cellValue(slot, tileId, orientation);
    const cells = new CellStore();
    cells.set(2, 0, cell(2));
    cells.set(1, 1, cell(0, H as Orientation));
    cells.set(3, 1, cell(1, (H | D) as Orientation));
    for (let x = 0; x < 4; x += 1) cells.set(x, 2, cell(3));
    const ground = { ...createTileLayer(1, "Ground"), cells };
    const world = { ...createGroupLayer(4, "World"), layers: [ground] };
    const spawns = {
        ...createMarkerLayer(2, "Spawns"),
        markers: [
            {
                shape: "point" as const,
                x: 8,
                y: 24,
                id: 1,
                name: "player",
                class: "spawn",
                properties: [],
            },
            {
                shape: "rectangle" as const,
                x: 48,
                y: 16,
                width: 16,
                height: 16,
                id: 2,
                name: "exit",
                class: "zone",
                properties: [{ name: "target", type: "string" as const, value: "cave" }],
            },
        ],
    };
    return {
        id: "meadow-id",
        name: "Meadow",
        exportName: "meadow",
        class: "",
        orientation: "orthogonal",
        width: 4,
        height: 3,
        tileWidth: 16,
        tileHeight: 16,
        backgroundColor: 0x6db3e8ff,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
        nextLayerId: 5,
        nextMarkerId: 3,
        layers: [world, spawns],
        properties: [{ name: "music", type: "file", value: "meadow.ogg" }],
    };
}

/** The project `meadow-game`: the grass tileset and the meadow map. */
export function meadowProject(): Project {
    return {
        id: "meadow-game-id",
        name: "Meadow game",
        exportName: "meadow-game",
        maps: [meadowMap()],
        tilesets: [grassTileset()],
        images: [],
        exportSettings: { exportOnSave: false },
        properties: [],
    };
}

/** The fixture tilemap's text. */
export function meadowText(): string {
    return readFileSync(MEADOW_TILEMAP, "utf8");
}

/** The fixture atlas of the grass tileset, read by the atlas reader with its PNG's size. */
export async function grassAtlas(): Promise<AtlasMeta> {
    const png = await decodePng(new Uint8Array(readFileSync(GRASS_PNG)));
    return validateAtlas(JSON.parse(readFileSync(GRASS_ATLAS, "utf8")), png);
}

/** The JSON of the FORMAT §3.10 example, taken from the document. */
export function formatExample(): unknown {
    const doc = readFileSync(resolve(ROOT, "docs/FORMAT.md"), "utf8");
    const section = doc.slice(doc.indexOf("### 3.10 Example"));
    const match = /```json\n([\s\S]*?)\n```/.exec(section);
    if (match === null) throw new Error("FORMAT.md §3.10 has no JSON example.");
    return JSON.parse(match[1]!);
}
