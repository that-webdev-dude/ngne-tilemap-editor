import { describe, expect, it, vi } from "vitest";
import {
    assetsFor,
    classAt,
    collisionRects,
    collisionShapes,
    findLayer,
    grid,
    invalidate,
    markers,
    propertyAt,
    readTilemap,
    setCell,
    tileAt,
    TilemapError,
} from "../../src/core/runtime/runtime";
import type { TileLayerData, Tilemap, TilemapLayer } from "../../src/core/runtime/runtime";
import {
    D,
    H,
    layer,
    layoutFixture,
    meadowAtlases,
    meadowJson,
    rotatedFixture,
} from "./te-050-support";

// TE-050: the runtime's data API (SPEC 11.2) against hand-computed results.

function meadow(edit?: (json: Record<string, unknown>) => void): Tilemap {
    const json = meadowJson();
    edit?.(json);
    return readTilemap(json, meadowAtlases());
}

function tileLayer(tilemap: Tilemap, name: string): TileLayerData {
    const found: TilemapLayer | undefined = findLayer(tilemap, name);
    if (found?.type !== "tile") throw new Error(`No tile layer ${name}.`);
    return found;
}

/** The layers of a parsed tilemap, for edits before it is read. */
function layersOf(json: Record<string, unknown>): Record<string, unknown>[] {
    return json.layers as Record<string, unknown>[];
}

describe("readTilemap", () => {
    it("reads the meadow fixture with its atlas into new objects each call", () => {
        const a = meadow();
        const b = meadow();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
        expect(tileLayer(a, "Ground").data).toBeInstanceOf(Uint32Array);
        expect(tileLayer(a, "Ground").data).not.toBe(tileLayer(b, "Ground").data);
    });

    it("runs the atlas checks and throws only TilemapError", () => {
        expect(() => readTilemap(meadowJson(), {})).toThrow(TilemapError);
        expect(() => readTilemap(meadowJson(), {})).toThrow(/atlas/);
        expect(() => readTilemap("{}", meadowAtlases())).toThrow(TilemapError);
        const newer = meadowJson();
        newer.version = 2;
        expect(() => readTilemap(newer, meadowAtlases())).toThrow(
            expect.objectContaining({ code: "newer-version" }),
        );
    });
});

describe("findLayer", () => {
    it("finds the first layer of a name from the bottom, case-sensitively", () => {
        const tilemap = meadow((json) => {
            const layers = layersOf(json);
            layers.push({ ...layers[1]!, id: 9, markers: [] });
        });
        expect(findLayer(tilemap, "Ground")).toBe(tilemap.layers[0]);
        expect(findLayer(tilemap, "Spawns")).toBe(tilemap.layers[1]);
        expect(findLayer(tilemap, "spawns")).toBeUndefined();
        expect(findLayer(tilemap, "World")).toBeUndefined();
    });
});

describe("tileAt, classAt, propertyAt on meadow", () => {
    // Ground, 16 px cells:  . . g2 .  /  . g0(H) . g1(HD)  /  g3 g3 g3 g3
    const tilemap = meadow();
    const ground = tileLayer(tilemap, "Ground");
    const grass = tilemap.tilesets[0]!;

    it("names the tile and its orientation under a map pixel", () => {
        expect(tileAt(tilemap, ground, 40, 8)).toEqual({
            tileset: grass,
            id: 2,
            flipH: false,
            flipV: false,
            flipD: false,
            class: "",
            properties: [],
            collision: [],
        });
        expect(tileAt(tilemap, ground, 16, 31.9)).toMatchObject({
            id: 0,
            flipH: true,
            flipD: false,
        });
        expect(tileAt(tilemap, ground, 63, 16)).toMatchObject({
            id: 1,
            flipH: true,
            flipV: false,
            flipD: true,
        });
        expect(tileAt(tilemap, ground, 0, 47)).toMatchObject({ id: 3, flipH: false });
    });

    it("is null for an empty cell and outside the map", () => {
        expect(tileAt(tilemap, ground, 0, 0)).toBeNull();
        expect(tileAt(tilemap, ground, -0.5, 40)).toBeNull();
        expect(tileAt(tilemap, ground, 64, 40)).toBeNull();
        expect(tileAt(tilemap, ground, 8, 48)).toBeNull();
        expect(tileAt(tilemap, ground, Number.NaN, 40)).toBeNull();
    });

    it("gives every cell of one value the same object", () => {
        expect(tileAt(tilemap, ground, 0, 40)).toBe(tileAt(tilemap, ground, 50, 40));
    });

    it("reads the tile's class and properties", () => {
        expect(classAt(tilemap, ground, 8, 40)).toBe("solid");
        expect(classAt(tilemap, ground, 40, 8)).toBe("");
        expect(classAt(tilemap, ground, 0, 0)).toBe("");
        expect(propertyAt(tilemap, ground, 8, 40, "friction")).toBe(0.8);
        expect(propertyAt(tilemap, ground, 8, 40, "Friction")).toBeUndefined();
        expect(propertyAt(tilemap, ground, 40, 8, "friction")).toBeUndefined();
        expect(propertyAt(tilemap, ground, 0, 0, "friction")).toBeUndefined();
    });

    it("counts the layer's offset into positions", () => {
        const moved = meadow((json) => {
            Object.assign(layersOf(json)[0]!, { offsetX: 5, offsetY: -3 });
        });
        const layer = tileLayer(moved, "Ground");
        expect(tileAt(moved, layer, 45, 5)).toMatchObject({ id: 2 });
        expect(tileAt(moved, layer, 4.5, 40)).toBeNull();
        expect(classAt(moved, layer, 5, 29)).toBe("solid");
        expect(classAt(moved, layer, 5, 28.5)).toBe("");
    });
});

describe("grid", () => {
    const tilemap = meadow();
    const ground = tileLayer(tilemap, "Ground");

    it("marks cells whose tile has the property set", () => {
        expect([...grid(tilemap, ground, "friction")]).toEqual([
            0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
        ]);
        expect([...grid(tilemap, ground, "none")]).toEqual(new Array<number>(12).fill(0));
    });

    it("counts true, non-zero numbers and non-empty strings as set", () => {
        const values: [string, unknown][] = [
            ["bool", true],
            ["bool", false],
            ["int", 0],
            ["int", -2],
            ["float", 0.5],
            ["string", ""],
            ["string", "x"],
            ["color", "#00000000"],
            ["file", ""],
        ];
        const json = meadowJson();
        const tileset = (json.tilesets as Record<string, unknown>[])[0]!;
        const tiles = tileset.tiles as Record<string, unknown>[];
        tiles[0]!.properties = values.map(([type, value], index) => ({
            name: `p${index}`,
            type,
            value,
        }));
        const tilemap = readTilemap(json, meadowAtlases());
        const layer = tileLayer(tilemap, "Ground");
        const set = values.map((_, index) => grid(tilemap, layer, `p${index}`)[8]);
        expect(set).toEqual([1, 0, 0, 1, 1, 0, 1, 1, 0]);
    });

    it("takes a predicate, called once per distinct cell value", () => {
        const select = vi.fn((tile: { id: number }) => tile.id === 2 || tile.id === 0);
        expect([...grid(tilemap, ground, select)]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
        // Values 3, 0x80000001, 0xa0000002, 4.
        expect(select).toHaveBeenCalledTimes(4);
    });
});

describe("collisionShapes and collisionRects on meadow", () => {
    const tilemap = meadow();
    const ground = tileLayer(tilemap, "Ground");

    it("places each solid tile's rectangle in map pixels with its cell and tile", () => {
        const shapes = collisionShapes(tilemap, ground);
        expect(shapes.map(({ shape, x, y, cellX, cellY }) => [shape, x, y, cellX, cellY])).toEqual([
            ["rectangle", 0, 32, 0, 2],
            ["rectangle", 16, 32, 1, 2],
            ["rectangle", 32, 32, 2, 2],
            ["rectangle", 48, 32, 3, 2],
        ]);
        expect(shapes[0]).toMatchObject({ width: 16, height: 16, tile: { id: 3 } });
    });

    it("merges the solid row into one rectangle", () => {
        expect(collisionRects(tilemap, ground)).toEqual([{ x: 0, y: 32, width: 64, height: 16 }]);
    });

    it("moves both by the layer's offset", () => {
        const moved = meadow((json) => {
            Object.assign(layersOf(json)[0]!, { offsetX: 5, offsetY: -3 });
        });
        const layer = tileLayer(moved, "Ground");
        expect(collisionShapes(moved, layer)[0]).toMatchObject({ x: 5, y: 29 });
        expect(collisionRects(moved, layer)).toEqual([{ x: 5, y: 29, width: 64, height: 16 }]);
    });
});

describe("collisionShapes on the rotated-tile fixture", () => {
    // The 3 x 2 tile in cell (i, 0) of a 4 px grid, orientation i of the FORMAT 1.2 table.
    // As drawn its box has its bottom-left corner at (4i, 4); with D the box is 2 x 3.
    const RECTANGLES = [
        [1, 2, 2, 1], //   0 0 0 as drawn
        [4, 2, 2, 1], //   1 0 0 flipped horizontally
        [9, 3, 2, 1], //   0 1 0 flipped vertically
        [12, 3, 2, 1], //  1 1 0 rotated 180
        [17, 2, 1, 2], //  1 0 1 rotated 90 clockwise
        [20, 1, 1, 2], //  0 1 1 rotated 90 counter-clockwise
        [24, 2, 1, 2], //  0 0 1 flipped over the main diagonal
        [29, 1, 1, 2], //  1 1 1 flipped over the anti-diagonal
    ];
    // The triangle's corners: the tile's top-left, top-right and bottom-left, as drawn.
    const TRIANGLES = [
        [
            [0, 2],
            [3, 2],
            [0, 4],
        ],
        [
            [7, 2],
            [4, 2],
            [7, 4],
        ],
        [
            [8, 4],
            [11, 4],
            [8, 2],
        ],
        [
            [15, 4],
            [12, 4],
            [15, 2],
        ],
        [
            [18, 1],
            [18, 4],
            [16, 1],
        ],
        [
            [20, 4],
            [20, 1],
            [22, 4],
        ],
        [
            [24, 1],
            [24, 4],
            [26, 1],
        ],
        [
            [30, 4],
            [30, 1],
            [28, 4],
        ],
    ];

    function absolute(shape: { x: number; y: number; points: readonly (readonly number[])[] }) {
        return shape.points.map(([a, b]) => [shape.x + a!, shape.y + b!]);
    }

    it("orients each shape about the tile's centre in all 8 orientations", () => {
        const { json, atlases } = rotatedFixture();
        const tilemap = readTilemap(json, atlases);
        const shapes = collisionShapes(tilemap, tileLayer(tilemap, "Walls"));
        expect(shapes).toHaveLength(16);
        RECTANGLES.forEach(([x, y, width, height], cell) => {
            expect(shapes[2 * cell]).toMatchObject({
                shape: "rectangle",
                x,
                y,
                width,
                height,
                cellX: cell,
            });
            const triangle = shapes[2 * cell + 1]!;
            if (triangle.shape !== "polygon") throw new Error("Not a polygon.");
            expect(absolute(triangle)).toEqual(TRIANGLES[cell]);
            expect(Object.is(triangle.points[0]![0], -0)).toBe(false);
        });
        expect(shapes[9]).toMatchObject({
            x: 18,
            y: 1,
            points: [
                [0, 0],
                [0, 3],
                [-2, 0],
            ],
        });
    });

    it("moves every shape by the tile offset", () => {
        const { json, atlases } = rotatedFixture({ x: 2, y: -1 });
        const tilemap = readTilemap(json, atlases);
        const shapes = collisionShapes(tilemap, tileLayer(tilemap, "Walls"));
        RECTANGLES.forEach(([x, y], cell) => {
            expect(shapes[2 * cell]).toMatchObject({ x: x! + 2, y: y! - 1 });
        });
    });

    it("keeps the cell's tile with each shape", () => {
        const { json, atlases } = rotatedFixture();
        const tilemap = readTilemap(json, atlases);
        const shapes = collisionShapes(tilemap, tileLayer(tilemap, "Walls"));
        expect(shapes[8]!.tile).toMatchObject({ id: 0, flipH: true, flipV: false, flipD: true });
        expect(collisionRects(tilemap, tileLayer(tilemap, "Walls"))).toEqual([]);
    });
});

describe("collisionRects on a known layout", () => {
    // ###.##  /  ###.##  /  ##..##  /  p.....  /  h.#d#.   (16 px cells)
    const EXPECTED = [
        { x: 0, y: 0, width: 48, height: 32 },
        { x: 64, y: 0, width: 32, height: 48 },
        { x: 0, y: 32, width: 32, height: 16 },
        { x: 0, y: 64, width: 16, height: 16 },
        { x: 32, y: 64, width: 48, height: 16 },
    ];

    it("merges row runs, then equal x-ranges of consecutive rows", () => {
        const { json, atlases } = layoutFixture();
        const tilemap = readTilemap(json, atlases);
        expect(collisionRects(tilemap, tileLayer(tilemap, "Collision"))).toEqual(EXPECTED);
    });

    it("is deterministic across reads and recomputation", () => {
        const { json, atlases } = layoutFixture();
        const a = readTilemap(json, atlases);
        const b = readTilemap(json, atlases);
        const layerA = tileLayer(a, "Collision");
        const first = collisionRects(a, layerA);
        invalidate(a, layerA);
        expect(collisionRects(a, layerA)).not.toBe(first);
        expect(collisionRects(a, layerA)).toEqual(first);
        expect(collisionRects(b, tileLayer(b, "Collision"))).toEqual(EXPECTED);
    });

    it("leaves partial tiles to collisionShapes", () => {
        const { json, atlases } = layoutFixture();
        const tilemap = readTilemap(json, atlases);
        const layer = tileLayer(tilemap, "Collision");
        const ledge = collisionShapes(tilemap, layer).filter((shape) => shape.tile.id === 1);
        expect(ledge).toEqual([
            expect.objectContaining({
                shape: "rectangle",
                x: 0,
                y: 48,
                width: 16,
                height: 4,
                cellX: 0,
                cellY: 3,
            }),
        ]);
        expect([...grid(tilemap, layer, "solid")].slice(18, 24)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it("does not merge boxes that overlap rather than meet", () => {
        // 16 px tiles in an 8 px grid: neighbouring boxes overlap, so nothing merges.
        const { json, atlases } = layoutFixture();
        Object.assign(json, { width: 3, height: 1, tileWidth: 8, tileHeight: 8 });
        layersOf(json)[0]!.data = [1, 1, 0];
        const tilemap = readTilemap(json, atlases);
        expect(collisionRects(tilemap, tileLayer(tilemap, "Collision"))).toEqual([
            { x: 0, y: -8, width: 16, height: 16 },
            { x: 8, y: -8, width: 16, height: 16 },
        ]);
    });
});

describe("markers", () => {
    it("returns the markers of marker layers with filters", () => {
        const tilemap = meadow();
        expect(markers(tilemap).map((marker) => marker.name)).toEqual(["player", "exit"]);
        expect(markers(tilemap, { class: "zone" })).toEqual([
            expect.objectContaining({ id: 2, name: "exit", x: 48, y: 16, width: 16, height: 16 }),
        ]);
        expect(markers(tilemap, { name: "player" })).toEqual([
            expect.objectContaining({ id: 1, shape: "point", x: 8, y: 24, class: "spawn" }),
        ]);
        expect(markers(tilemap, { layer: "Spawns", name: "player", class: "zone" })).toEqual([]);
        expect(markers(tilemap, { layer: "Ground" })).toEqual([]);
    });

    it("adds the layer's offset to positions", () => {
        const tilemap = meadow((json) => {
            Object.assign(layersOf(json)[1]!, { offsetX: -8, offsetY: 4 });
        });
        expect(markers(tilemap).map(({ x, y }) => [x, y])).toEqual([
            [0, 28],
            [40, 20],
        ]);
        expect(markers(tilemap)[1]).toMatchObject({
            properties: [{ name: "target", value: "cave" }],
        });
    });
});

describe("caches, setCell and invalidate", () => {
    it("caches grid, collisionShapes and collisionRects per layer", () => {
        const tilemap = meadow();
        const ground = tileLayer(tilemap, "Ground");
        expect(grid(tilemap, ground, "friction")).toBe(grid(tilemap, ground, "friction"));
        const solid = (tile: { class: string }) => tile.class === "solid";
        expect(grid(tilemap, ground, solid)).toBe(grid(tilemap, ground, solid));
        expect(grid(tilemap, ground, solid)).not.toBe(grid(tilemap, ground, "friction"));
        expect(grid(tilemap, ground, solid)).toEqual(grid(tilemap, ground, "friction"));
        expect(collisionShapes(tilemap, ground)).toBe(collisionShapes(tilemap, ground));
        expect(collisionRects(tilemap, ground)).toBe(collisionRects(tilemap, ground));
    });

    it("setCell writes a cell and refreshes every cached result", () => {
        const tilemap = meadow();
        const ground = tileLayer(tilemap, "Ground");
        const before = [
            grid(tilemap, ground, "friction"),
            collisionShapes(tilemap, ground),
            collisionRects(tilemap, ground),
        ] as const;
        setCell(tilemap, ground, 1, 2, 0);
        expect(ground.data[9]).toBe(0);
        expect(tileAt(tilemap, ground, 16, 32)).toBeNull();
        expect(grid(tilemap, ground, "friction")).not.toBe(before[0]);
        expect([...grid(tilemap, ground, "friction")].slice(8)).toEqual([1, 0, 1, 1]);
        expect(collisionShapes(tilemap, ground)).toHaveLength(3);
        expect(collisionRects(tilemap, ground)).toEqual([
            { x: 0, y: 32, width: 16, height: 16 },
            { x: 32, y: 32, width: 32, height: 16 },
        ]);
        setCell(tilemap, ground, 0, 0, (H | D | 4) >>> 0);
        expect(collisionShapes(tilemap, ground)[0]).toMatchObject({
            x: 0,
            y: 0,
            cellX: 0,
            cellY: 0,
        });
    });

    it("setCell ignores a cell outside the map", () => {
        const tilemap = meadow();
        const ground = tileLayer(tilemap, "Ground");
        const data = ground.data.slice();
        const rects = collisionRects(tilemap, ground);
        for (const [x, y] of [
            [-1, 0],
            [4, 0],
            [0, 3],
            [0.5, 0],
        ]) {
            setCell(tilemap, ground, x!, y!, 4);
        }
        expect(ground.data).toEqual(data);
        expect(collisionRects(tilemap, ground)).toBe(rects);
    });

    it("invalidate refreshes after a direct write to data", () => {
        const tilemap = meadow();
        const ground = tileLayer(tilemap, "Ground");
        const rects = collisionRects(tilemap, ground);
        ground.data.fill(0, 8);
        expect(collisionRects(tilemap, ground)).toBe(rects);
        invalidate(tilemap, ground);
        expect(collisionRects(tilemap, ground)).toEqual([]);
        expect(collisionShapes(tilemap, ground)).toEqual([]);
        expect([...grid(tilemap, ground, "friction")]).toEqual(new Array<number>(12).fill(0));
    });

    it("reads a value that names no tile as an empty cell", () => {
        const tilemap = meadow();
        const ground = tileLayer(tilemap, "Ground");
        setCell(tilemap, ground, 0, 0, 0x10000001);
        setCell(tilemap, ground, 1, 0, H);
        setCell(tilemap, ground, 3, 0, 99);
        expect(tileAt(tilemap, ground, 0, 0)).toBeNull();
        expect(tileAt(tilemap, ground, 16, 0)).toBeNull();
        expect(tileAt(tilemap, ground, 48, 0)).toBeNull();
        expect(grid(tilemap, ground, () => true).slice(0, 4)).toEqual(new Uint8Array([0, 0, 1, 0]));
    });

    it("keeps two readTilemap results apart", () => {
        const a = meadow();
        const b = meadow();
        const groundA = tileLayer(a, "Ground");
        const groundB = tileLayer(b, "Ground");
        const rectsB = collisionRects(b, groundB);
        setCell(a, groundA, 0, 2, 0);
        groundA.data[10] = 0;
        invalidate(a, groundA);
        expect(groundB.data[8]).toBe(4);
        expect(groundB.data[10]).toBe(4);
        expect(tileAt(b, groundB, 0, 32)).toMatchObject({ id: 3 });
        expect(collisionRects(b, groundB)).toBe(rectsB);
        expect(collisionRects(b, groundB)).toEqual([{ x: 0, y: 32, width: 64, height: 16 }]);
        expect(collisionRects(a, groundA)).toEqual([
            { x: 16, y: 32, width: 16, height: 16 },
            { x: 48, y: 32, width: 16, height: 16 },
        ]);
    });
});

describe("assetsFor", () => {
    function withImage(project: string): Tilemap {
        return meadow((json) => {
            json.project = project;
            layersOf(json).push(
                layer(10, "Sky", {
                    type: "image",
                    image: "sky.png",
                    imageWidth: 8,
                    imageHeight: 8,
                    repeatX: true,
                    repeatY: false,
                }),
            );
        });
    }

    it("returns one asset per tileset and image with namespaced IDs", () => {
        const imageAsset = vi.fn((id: string, url: string) => ({ id, url }));
        expect(assetsFor(withImage("assets-a"), imageAsset)).toEqual([
            { id: "ngne-tilemap:assets-a/grass", url: "grass.png" },
            { id: "ngne-tilemap:assets-a/sky", url: "sky.png" },
        ]);
    });

    it("returns identical objects across calls and tilemaps", () => {
        const imageAsset = vi.fn((id: string, url: string) => ({ id, url }));
        const first = assetsFor(withImage("assets-b"), imageAsset);
        const second = assetsFor(withImage("assets-b"), imageAsset);
        expect(second).not.toBe(first);
        expect(second[0]).toBe(first[0]);
        expect(second[1]).toBe(first[1]);
        expect(imageAsset).toHaveBeenCalledTimes(2);
        const other = assetsFor(withImage("assets-c"), imageAsset);
        expect(other[0]).not.toBe(first[0]);
        expect(other.map((asset) => asset.id)).toEqual([
            "ngne-tilemap:assets-c/grass",
            "ngne-tilemap:assets-c/sky",
        ]);
    });

    it("lists an image shown by two layers once", () => {
        const tilemap = meadow((json) => {
            json.project = "assets-d";
            const sky = {
                type: "image",
                image: "sky.png",
                imageWidth: 8,
                imageHeight: 8,
                repeatX: false,
                repeatY: false,
            };
            layersOf(json).push(layer(10, "Sky", sky), layer(11, "Sky 2", sky));
        });
        expect(assetsFor(tilemap, (id) => id)).toEqual([
            "ngne-tilemap:assets-d/grass",
            "ngne-tilemap:assets-d/sky",
        ]);
    });
});
