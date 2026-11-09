import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Shared by the TE-050 tests: the meadow fixture as parsed JSON, and tilemaps built here for
// what meadow lacks (rotated tiles, a collision layout, offsets, an image layer).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURE_DIR = resolve(ROOT, "tests/fixtures/format");

type Json = Record<string, unknown>;

/** The meadow fixture (FORMAT 3.10) as parsed JSON, a new object each call. */
export function meadowJson(): Json {
    return JSON.parse(readFileSync(resolve(FIXTURE_DIR, "meadow.tilemap.json"), "utf8")) as Json;
}

/** The atlases of the meadow fixture, by tileset name. */
export function meadowAtlases(): Record<string, unknown> {
    return {
        grass: JSON.parse(
            readFileSync(resolve(FIXTURE_DIR, "grass.atlas.json"), "utf8"),
        ) as unknown,
    };
}

/** H, V and D flags of a cell value (FORMAT 1.2). */
export const H = 0x80000000;
export const V = 0x40000000;
export const D = 0x20000000;

/** An atlas of `count` tiles of `tileWidth x tileHeight` for the tileset `name` (FORMAT 4). */
export function atlasFor(name: string, count: number, tileWidth: number, tileHeight: number): Json {
    const frames: Json = {};
    for (let id = 0; id < count; id += 1) {
        frames[`${name}-${id}`] = {
            x: 1,
            y: 1,
            w: tileWidth + (tileWidth % 2),
            h: tileHeight + (tileHeight % 2),
            sourceW: tileWidth,
            sourceH: tileHeight,
            offsetX: 0,
            offsetY: 0,
            pivot: [0, 1],
        };
    }
    return {
        format: "ngne-sprite-atlas",
        version: 1,
        generator: "test",
        image: `${name}.png`,
        width: 64,
        height: 64,
        frames,
        animations: {},
    };
}

interface TilesetSpec {
    readonly name: string;
    readonly tileWidth: number;
    readonly tileHeight: number;
    readonly nextTileId: number;
    readonly offsetX?: number;
    readonly offsetY?: number;
    readonly tiles: readonly Json[];
}

/** A tile layer, or a marker or image layer through `extra`. */
export function layer(id: number, name: string, extra: Json): Json {
    return {
        id,
        type: "tile",
        name,
        class: "",
        groupId: null,
        visible: true,
        opacity: 255,
        offsetX: 0,
        offsetY: 0,
        parallaxX: 1,
        parallaxY: 1,
        properties: [],
        ...extra,
    };
}

/** A tilemap of one tileset (`firstGid` 1) and the given layers. */
export function tilemapJson(
    size: { width: number; height: number; tileWidth: number; tileHeight: number },
    tileset: TilesetSpec,
    layers: readonly Json[],
): Json {
    return {
        format: "ngne-tilemap",
        version: 1,
        generator: "test",
        project: "test-game",
        name: "test",
        title: "Test",
        class: "",
        orientation: "orthogonal",
        ...size,
        backgroundColor: null,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
        tilesets: [
            {
                name: tileset.name,
                atlas: `${tileset.name}.atlas.json`,
                class: "",
                firstGid: 1,
                nextTileId: tileset.nextTileId,
                tileWidth: tileset.tileWidth,
                tileHeight: tileset.tileHeight,
                offsetX: tileset.offsetX ?? 0,
                offsetY: tileset.offsetY ?? 0,
                tiles: tileset.tiles,
                properties: [],
            },
        ],
        groups: [],
        layers,
        properties: [],
    };
}

/** The 8 orientations in the order of the FORMAT 1.2 table, as flag bits. */
export const ORIENTATIONS = [0, H, V, H | V, H | D, V | D, D, H | V | D] as const;

const NO_OFFSET = { x: 0, y: 0 } as const;

/**
 * The rotated-tile fixture: a 3 x 2 tile (odd width, asymmetric) with a rectangle in its top
 * right and a triangle in its top left, drawn once in each orientation along one row of 4 x 4
 * cells. `offset` is the tileset's tile offset.
 */
export function rotatedFixture(offset: { x: number; y: number } = NO_OFFSET): {
    json: Json;
    atlases: Record<string, unknown>;
} {
    const json = tilemapJson(
        { width: 8, height: 1, tileWidth: 4, tileHeight: 4 },
        {
            name: "rot",
            tileWidth: 3,
            tileHeight: 2,
            nextTileId: 1,
            offsetX: offset.x,
            offsetY: offset.y,
            tiles: [
                {
                    id: 0,
                    class: "wedge",
                    collision: [
                        { shape: "rectangle", x: 1, y: 0, width: 2, height: 1 },
                        {
                            shape: "polygon",
                            x: 0,
                            y: 0,
                            points: [
                                [0, 0],
                                [3, 0],
                                [0, 2],
                            ],
                        },
                    ],
                    properties: [],
                },
            ],
        },
        [layer(1, "Walls", { data: ORIENTATIONS.map((flags) => (flags | 1) >>> 0) })],
    );
    return { json, atlases: { rot: atlasFor("rot", 1, 3, 2) } };
}

/**
 * The collision layout: 16 px tiles; tile 0 is solid (one rectangle over the whole tile), tile 1
 * has a smaller rectangle. `#` solid, `h` solid flipped horizontally, `d` solid flipped over the
 * diagonal, `p` the partial tile, `.` empty.
 */
export const LAYOUT = ["###.##", "###.##", "##..##", "p.....", "h.#d#."] as const;

export function layoutFixture(): { json: Json; atlases: Record<string, unknown> } {
    const cell: Record<string, number> = {
        "#": 1,
        h: (H | 1) >>> 0,
        d: (D | 1) >>> 0,
        p: 2,
        ".": 0,
    };
    const data = LAYOUT.flatMap((row) => [...row].map((char) => cell[char]!));
    const json = tilemapJson(
        { width: 6, height: 5, tileWidth: 16, tileHeight: 16 },
        {
            name: "box",
            tileWidth: 16,
            tileHeight: 16,
            nextTileId: 2,
            tiles: [
                {
                    id: 0,
                    class: "solid",
                    collision: [{ shape: "rectangle", x: 0, y: 0, width: 16, height: 16 }],
                    properties: [{ name: "solid", type: "bool", value: true }],
                },
                {
                    id: 1,
                    class: "ledge",
                    collision: [{ shape: "rectangle", x: 0, y: 0, width: 16, height: 4 }],
                    properties: [{ name: "solid", type: "bool", value: false }],
                },
            ],
        },
        [layer(1, "Collision", { data })],
    );
    return { json, atlases: { box: atlasFor("box", 2, 16, 16) } };
}
