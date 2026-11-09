import { beforeAll, describe, expect, it } from "vitest";
import {
    MAX_TILEMAP_CELLS,
    MAX_TILEMAP_LAYER_CELLS,
    MAX_TILEMAP_MARKERS,
    MAX_TILEMAP_MARKER_POINTS,
    TilemapError,
    validateTilemap,
} from "../../src/core/tilemap";
import type { TilemapErrorCode } from "../../src/core/tilemap";
import type { AtlasMeta } from "../../src/core/sprite/export/atlasFormat";
import { grassAtlas, meadowText } from "./te-049-support";

// TE-049: `validateTilemap` (FORMAT §3.8), against the meadow fixture and copies of it with one
// thing broken each.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

let atlas: AtlasMeta;
beforeAll(async () => {
    atlas = await grassAtlas();
});

/** A fresh parsed copy of the fixture. */
function meadow(): Loose {
    return JSON.parse(meadowText());
}

/** A fresh copy of the grass atlas, loosely typed for breaking. */
function grass(): Loose {
    return structuredClone(atlas);
}

/** The error `validateTilemap` throws on `json`; fails the test when it throws none. */
function rejection(json: unknown, atlases: Record<string, unknown> = { grass: grass() }) {
    try {
        validateTilemap(json, atlases);
    } catch (error) {
        expect(error).toBeInstanceOf(TilemapError);
        const { code, path, message } = error as TilemapError;
        return { code, path, message };
    }
    throw new Error("validateTilemap accepted the value.");
}

/** Expects the fixture, changed by `change`, to be refused with `code` at `path`. */
function expectRejected(
    change: (json: Loose, atlases: Loose) => void,
    code: TilemapErrorCode,
    path: string,
) {
    const json = meadow();
    const atlases: Loose = { grass: grass() };
    change(json, atlases);
    expect(rejection(json, atlases)).toMatchObject({ code, path });
}

/** A valid marker with `id`. */
function point(id: number): Loose {
    return { shape: "point", id, name: "", class: "", x: 0, y: 0, properties: [] };
}

describe("validateTilemap: the meadow fixture", () => {
    it("reads the fixture into the members of the tables, data as Uint32Array", () => {
        const tilemap = validateTilemap(meadow(), { grass: atlas });
        expect(tilemap.name).toBe("meadow");
        expect(tilemap.backgroundColor).toBe("#6db3e8ff");
        const ground = tilemap.layers[0]!;
        expect(ground.type).toBe("tile");
        if (ground.type !== "tile") return;
        expect(ground.data).toBeInstanceOf(Uint32Array);
        expect([...ground.data]).toEqual([0, 0, 3, 0, 0, 0x80000001, 0, 0xa0000002, 4, 4, 4, 4]);
        expect(tilemap.tilesets[0]!.tiles[0]!.collision).toEqual([
            { shape: "rectangle", x: 0, y: 0, width: 16, height: 16 },
        ]);
        expect(tilemap.groups).toEqual([
            { id: 4, name: "World", class: "", parentId: null, properties: [] },
        ]);
    });

    it("returns new objects: changing the result leaves the input as it was", () => {
        const json = meadow();
        const tilemap = validateTilemap(json, { grass: atlas });
        const ground = tilemap.layers[0]!;
        if (ground.type === "tile") ground.data[0] = 7;
        expect(json.layers[0].data[0]).toBe(0);
        expect(tilemap.layers[1]).not.toBe(json.layers[1]);
    });

    it("ignores unknown members and leaves them out of the result", () => {
        const json = meadow();
        json.extra = 1;
        json.tilesets[0].extra = 1;
        json.tilesets[0].tiles[0].extra = 1;
        json.tilesets[0].tiles[0].collision[0].extra = 1;
        json.groups[0].extra = 1;
        json.layers[0].extra = 1;
        json.layers[1].markers = [{ ...json.layers[1].markers[0], extra: 1 }];
        json.properties[0].extra = 1;
        const plain = JSON.parse(JSON.stringify(validateTilemap(json, { grass: atlas })));
        const expected = meadow();
        expected.layers[1].markers = [expected.layers[1].markers[0]];
        expected.layers[0].data = Object.fromEntries(
            expected.layers[0].data.map((value: number, index: number) => [index, value]),
        );
        expect(plain).toEqual(expected);
    });

    it("reads only own members; `__proto__` and `constructor` are names like any other", () => {
        const json = meadow();
        json.properties.push({ name: "__proto__", type: "int", value: 1 });
        const parsed = JSON.parse(
            JSON.stringify(json).replace('{"format"', '{"__proto__":{"x":1},"format"'),
        );
        const tilemap = validateTilemap(parsed, { grass: atlas });
        expect(tilemap.properties.map(({ name }) => name)).toEqual(["music", "__proto__"]);
        expect(Object.getPrototypeOf(tilemap)).toBe(Object.prototype);
        expect(Object.hasOwn(tilemap, "__proto__")).toBe(false);

        // A member inherited from the prototype is not a member.
        const { generator, ...rest } = meadow();
        const inherited = Object.assign(Object.create({ generator }), rest);
        expect(rejection(inherited)).toMatchObject({ code: "field", path: "generator" });

        // A tileset named like a member of Object.prototype has no atlas unless one is given.
        expectRejected(
            (json) => {
                json.tilesets[0].name = "constructor";
                json.tilesets[0].atlas = "constructor.atlas.json";
            },
            "atlas",
            "tilesets[0].atlas",
        );
    });
});

describe("validateTilemap: step 1, format and version", () => {
    it("refuses a value that is not an object", () => {
        for (const value of [null, [], "tilemap", 3]) {
            expect(rejection(value)).toMatchObject({ code: "format", path: "" });
        }
    });

    it("refuses another format, or none", () => {
        expectRejected((json) => (json.format = "ngne-sprite-atlas"), "format", "format");
        expectRejected((json) => delete json.format, "format", "format");
    });

    it("refuses any version above 1 as newer-version, however large", () => {
        expectRejected((json) => (json.version = 1e20), "newer-version", "version");
    });

    it("refuses version 2 as newer-version before any other check", () => {
        const json = { format: "ngne-tilemap", version: 2, layers: "broken" };
        const error = rejection(json);
        expect(error).toMatchObject({ code: "newer-version", path: "version" });
        expect(error.message).toContain("2");
        expect(error.message).toContain("1 to 1");
    });

    it("refuses a version that is not an integer of at least 1", () => {
        expectRejected((json) => (json.version = 0), "field", "version");
        expectRejected((json) => (json.version = "1"), "field", "version");
        expectRejected((json) => delete json.version, "field", "version");
    });

    it("refuses a value that throws when it is read, as format", () => {
        const json = {};
        Object.defineProperty(json, "format", {
            enumerable: true,
            get() {
                throw new Error("no");
            },
        });
        expect(rejection(json)).toMatchObject({ code: "format", path: "" });
    });
});

describe("validateTilemap: step 2, members", () => {
    it("refuses a missing member at its path", () => {
        expectRejected((json) => delete json.generator, "field", "generator");
        expectRejected((json) => delete json.tilesets[0].offsetY, "field", "tilesets[0].offsetY");
        expectRejected(
            (json) => delete json.layers[1].markers[1].width,
            "field",
            "layers[1].markers[1].width",
        );
    });

    it("refuses a member of the wrong type or outside its range", () => {
        expectRejected((json) => (json.width = "4"), "field", "width");
        expectRejected((json) => (json.tileWidth = 257), "field", "tileWidth");
        expectRejected((json) => (json.name = "Meadow"), "field", "name");
        expectRejected((json) => (json.project = "ngne-tilemap"), "field", "project");
        expectRejected((json) => (json.title = "x".repeat(256)), "field", "title");
        expectRejected((json) => (json.orientation = "isometric"), "field", "orientation");
        expectRejected((json) => (json.backgroundColor = "#fff"), "field", "backgroundColor");
        expectRejected((json) => (json.parallaxOriginX = 1_048_577), "field", "parallaxOriginX");
        expectRejected((json) => (json.layers[0].opacity = 256), "field", "layers[0].opacity");
        expectRejected((json) => (json.layers[0].parallaxY = 101), "field", "layers[0].parallaxY");
        expectRejected((json) => (json.layers[0].visible = 1), "field", "layers[0].visible");
        expectRejected((json) => (json.layers[0].type = "group"), "field", "layers[0].type");
        expectRejected((json) => (json.layers[0].groupId = 0), "field", "layers[0].groupId");
        expectRejected((json) => (json.groups[0].parentId = "4"), "field", "groups[0].parentId");
    });

    it("refuses tileset members outside their rules", () => {
        expectRejected(
            (json) => (json.tilesets[0].atlas = "other.atlas.json"),
            "field",
            "tilesets[0].atlas",
        );
        expectRejected((json) => (json.tilesets[0].firstGid = 0), "field", "tilesets[0].firstGid");
        expectRejected(
            (json) => (json.tilesets[0].nextTileId = 1_048_577),
            "field",
            "tilesets[0].nextTileId",
        );
        expectRejected((json) => (json.tilesets[0].offsetX = 4097), "field", "tilesets[0].offsetX");
        expectRejected(
            (json) => (json.tilesets[0].tiles[0].id = 4),
            "field",
            "tilesets[0].tiles[0].id",
        );
        expectRejected(
            (json) => json.tilesets[0].tiles.push({ ...json.tilesets[0].tiles[0] }),
            "field",
            "tilesets[0].tiles[1].id",
        );
        expectRejected(
            (json) => (json.tilesets[0].tiles = Array(5).fill(null)),
            "field",
            "tilesets[0].tiles",
        );
    });

    it("refuses collision shapes outside FORMAT §2.4", () => {
        const at = "tilesets[0].tiles[0].collision[0]";
        expectRejected(
            (json) => (json.tilesets[0].tiles[0].collision[0].shape = "point"),
            "field",
            `${at}.shape`,
        );
        expectRejected(
            (json) => (json.tilesets[0].tiles[0].collision[0].x = 4097),
            "field",
            `${at}.x`,
        );
        expectRejected(
            (json) => (json.tilesets[0].tiles[0].collision[0].width = -1),
            "field",
            `${at}.width`,
        );
        expectRejected(
            (json) =>
                (json.tilesets[0].tiles[0].collision[0] = {
                    shape: "polygon",
                    x: 0,
                    y: 0,
                    points: [
                        [0, 0],
                        [1, 1],
                    ],
                }),
            "field",
            `${at}.points`,
        );
        expectRejected(
            (json) =>
                (json.tilesets[0].tiles[0].collision[0] = {
                    shape: "polygon",
                    x: 0,
                    y: 0,
                    points: [[0, 0], [1], [1, 1]],
                }),
            "field",
            `${at}.points[1]`,
        );
    });

    it("refuses property lists outside FORMAT §1.4", () => {
        expectRejected(
            (json) => json.properties.push({ ...json.properties[0] }),
            "field",
            "properties[1].name",
        );
        expectRejected((json) => (json.properties[0].name = " "), "field", "properties[0].name");
        expectRejected(
            (json) => (json.properties[0].type = "vector"),
            "field",
            "properties[0].type",
        );
        expectRejected(
            (json) => (json.properties[0] = { name: "n", type: "int", value: 1.5 }),
            "field",
            "properties[0].value",
        );
        expectRejected(
            (json) => (json.properties[0] = { name: "c", type: "color", value: "red" }),
            "field",
            "properties[0].value",
        );
        expectRejected(
            (json) => (json.properties[0] = { name: "f", type: "file", value: "x".repeat(1025) }),
            "field",
            "properties[0].value",
        );
    });

    it("refuses tile data of the wrong length or with a value outside 0..2^32 - 1", () => {
        expectRejected((json) => json.layers[0].data.pop(), "field", "layers[0].data");
        expectRejected((json) => (json.layers[0].data[3] = -1), "field", "layers[0].data[3]");
        expectRejected((json) => (json.layers[0].data[3] = 2 ** 32), "field", "layers[0].data[3]");
        expectRejected((json) => (json.layers[0].data[3] = 1.5), "field", "layers[0].data[3]");
    });

    it("refuses an image layer whose image is not <image>.png", () => {
        const image = (name: unknown) => (json: Loose) => {
            json.layers[1] = {
                ...json.layers[1],
                type: "image",
                image: name,
                imageWidth: 8,
                imageHeight: 8,
                repeatX: false,
                repeatY: false,
            };
            delete json.layers[1].markers;
        };
        expect(() => {
            const json = meadow();
            image("sky.png")(json);
            validateTilemap(json, { grass: atlas });
        }).not.toThrow();
        expectRejected(image("../sky.png"), "field", "layers[1].image");
        expectRejected(image("sky.jpg"), "field", "layers[1].image");
        // A plain file name as an atlas's `image` (FORMAT §3.4): no Windows device name.
        expectRejected(image("nul.png"), "field", "layers[1].image");
        expectRejected(image("sky\\bg.png"), "field", "layers[1].image");
        expectRejected(image("c:sky.png"), "field", "layers[1].image");
        expectRejected(image("Con .png"), "field", "layers[1].image");
        expect(() => {
            const json = meadow();
            image("Sky Bg.png")(json);
            validateTilemap(json, { grass: atlas });
        }).not.toThrow();
    });

    it("refuses a map without layers", () => {
        expectRejected((json) => (json.layers = []), "field", "layers");
    });
});

describe("validateTilemap: step 2, limits of FORMAT §3.6", () => {
    // Arrays over a limit hold items that would fail if read: counts come before elements.
    it("refuses too many tilesets, layers, groups and layers, properties", () => {
        expectRejected((json) => (json.tilesets = Array(256).fill(null)), "limit", "tilesets");
        expectRejected((json) => (json.layers = Array(257).fill(null)), "limit", "layers");
        expectRejected(
            (json) => {
                json.groups = Array(200).fill(null);
                json.layers = Array(57).fill(null);
            },
            "limit",
            "layers",
        );
        expectRejected((json) => (json.properties = Array(257).fill(null)), "limit", "properties");
    });

    it("refuses too many collision shapes or shape points", () => {
        expectRejected(
            (json) => (json.tilesets[0].tiles[0].collision = Array(65).fill(null)),
            "limit",
            "tilesets[0].tiles[0].collision",
        );
        expectRejected(
            (json) =>
                (json.tilesets[0].tiles[0].collision[0] = {
                    shape: "polygon",
                    x: 0,
                    y: 0,
                    points: Array(1025).fill(null),
                }),
            "limit",
            "tilesets[0].tiles[0].collision[0].points",
        );
    });

    it("refuses a map of more cells than one layer may hold", () => {
        expectRejected(
            (json) => {
                json.width = 4096;
                json.height = MAX_TILEMAP_LAYER_CELLS / 4096 + 1;
            },
            "limit",
            "height",
        );
    });

    it("refuses tile layers that together hold too many cells", () => {
        const json = meadow();
        json.width = 1024;
        json.height = 1024;
        const data = new Array(1024 * 1024).fill(0);
        const tile = { ...json.layers[0], groupId: null, data };
        const layers = MAX_TILEMAP_CELLS / data.length + 1;
        json.groups = [];
        json.layers = Array.from({ length: layers }, (_, index) => ({ ...tile, id: index + 1 }));
        expect(rejection(json)).toMatchObject({
            code: "limit",
            path: `layers[${layers - 1}].data`,
        });
    });

    it("refuses too many markers in all, before reading them", () => {
        expectRejected(
            (json) => (json.layers[1].markers = Array(MAX_TILEMAP_MARKERS + 1).fill(null)),
            "limit",
            "layers[1].markers",
        );
        expectRejected(
            (json) => {
                const half = {
                    ...json.layers[1],
                    markers: Array(MAX_TILEMAP_MARKERS / 2).fill(point(1)),
                };
                json.layers = [
                    half,
                    { ...half, id: 3, markers: Array(MAX_TILEMAP_MARKERS / 2 + 1).fill(null) },
                ];
            },
            "limit",
            "layers[1].markers",
        );
    });

    it("refuses too many marker points in all", () => {
        const points = Array.from({ length: 1024 }, (_, index) => [index, 0]);
        const polyline = { ...point(1), shape: "polyline", points };
        const count = MAX_TILEMAP_MARKER_POINTS / 1024 + 1;
        expectRejected(
            (json) => (json.layers[1].markers = Array(count).fill(polyline)),
            "limit",
            `layers[1].markers[${count - 1}].points`,
        );
    });
});

describe("validateTilemap: step 3, cross-references", () => {
    it("refuses a group parent that does not exist, or a cycle", () => {
        expectRejected((json) => (json.groups[0].parentId = 9), "reference", "groups[0].parentId");
        expectRejected((json) => (json.groups[0].parentId = 4), "reference", "groups[0].parentId");
        expectRejected(
            (json) => {
                json.groups[0].parentId = 5;
                json.groups.push({ ...json.groups[0], id: 5, parentId: 4 });
            },
            "reference",
            "groups[0].parentId",
        );
    });

    it("refuses a groupId that names no group", () => {
        expectRejected((json) => (json.layers[1].groupId = 3), "reference", "layers[1].groupId");
    });

    it("checks group parents before unique IDs, in the order of FORMAT §3.8 step 3", () => {
        expectRejected(
            (json) => {
                json.groups[0].parentId = 99;
                json.layers[1].id = 1;
            },
            "reference",
            "groups[0].parentId",
        );
    });

    it("refuses a repeated group or layer ID, and a repeated marker ID", () => {
        expectRejected((json) => (json.layers[1].id = 4), "field", "layers[1].id");
        expectRejected((json) => (json.layers[1].id = 1), "field", "layers[1].id");
        expectRejected(
            (json) => (json.layers[1].markers[1].id = 1),
            "field",
            "layers[1].markers[1].id",
        );
    });

    it("refuses overlapping spans before looking at atlases", () => {
        expectRejected(
            (json) =>
                json.tilesets.push({
                    ...json.tilesets[0],
                    name: "moss",
                    atlas: "moss.atlas.json",
                    firstGid: 4,
                }),
            "field",
            "tilesets[1].firstGid",
        );
    });

    it("checks members (step 2) before cross-references (step 3)", () => {
        expectRejected(
            (json) => {
                json.groups[0].parentId = 9;
                json.properties[0].type = "vector";
            },
            "field",
            "properties[0].type",
        );
    });
});

describe("validateTilemap: step 4, atlases, cells and tile data", () => {
    it("refuses a tileset whose atlas was not given", () => {
        expectRejected((_json, atlases) => delete atlases.grass, "atlas", "tilesets[0].atlas");
        expectRejected((_json, atlases) => (atlases.grass = null), "atlas", "tilesets[0].atlas");
    });

    it("refuses an atlas that does not match FORMAT §4", () => {
        const broken: ((atlas: Loose) => void)[] = [
            (atlas) => (atlas.image = "moss.png"),
            (atlas) => (atlas.frames["grass-4"] = atlas.frames["grass-0"]),
            (atlas) => (atlas.frames["grass-01"] = atlas.frames["grass-0"]),
            (atlas) => (atlas.frames.other = atlas.frames["grass-0"]),
            (atlas) => (atlas.frames["grass-0"].sourceW = 15),
            (atlas) => (atlas.frames["grass-0"].w = 18),
            (atlas) => (atlas.frames["grass-0"].offsetX = 1),
            (atlas) => (atlas.frames["grass-0"].pivot = [0, 0]),
            (atlas) => (atlas.animations["grass-2"].playback = "once"),
            (atlas) => (atlas.animations.walk = atlas.animations["grass-2"]),
            (atlas) => (atlas.animations["grass-2"].entries[0].frame = "grass-9"),
            (atlas) => delete atlas.animations,
        ];
        for (const breakAtlas of broken) {
            expectRejected(
                (_json, atlases) => breakAtlas(atlases.grass),
                "atlas",
                "tilesets[0].atlas",
            );
        }
    });

    it("refuses an empty cell with a flag set", () => {
        expectRejected(
            (json) => (json.layers[0].data[0] = 0x80000000),
            "field",
            "layers[0].data[0]",
        );
    });

    it("refuses a cell value with the reserved bit 28 set", () => {
        expectRejected(
            (json) => (json.layers[0].data[2] = 0x10000003),
            "field",
            "layers[0].data[2]",
        );
    });

    it("refuses a cell outside every span", () => {
        expectRejected((json) => (json.layers[0].data[2] = 5), "reference", "layers[0].data[2]");
        // GID 1 (0x80000001) at data[5] lies below the only span, 2..5.
        expectRejected((json) => (json.tilesets[0].firstGid = 2), "reference", "layers[0].data[5]");
    });

    it("refuses a cell naming a tile its atlas lacks", () => {
        expectRejected(
            (_json, atlases) => delete atlases.grass.frames["grass-0"],
            "reference",
            "layers[0].data[5]",
        );
    });

    it("refuses tile data naming a tile the atlas lacks", () => {
        expectRejected(
            (json, atlases) => {
                json.layers[0].data.fill(0, 8);
                delete atlases.grass.frames["grass-3"];
            },
            "reference",
            "tilesets[0].tiles[0].id",
        );
    });

    it("checks cross-references (step 3) before atlases (step 4)", () => {
        expectRejected(
            (json, atlases) => {
                delete atlases.grass;
                json.layers[1].groupId = 3;
            },
            "reference",
            "layers[1].groupId",
        );
    });
});

describe("validateTilemap: errors", () => {
    it("throws TilemapError only, with a code, a path and a message naming the path", () => {
        const error = rejection({ ...meadow(), width: 0 });
        expect(error.code).toBe("field");
        expect(error.path).toBe("width");
        expect(error.message).toContain("`width`");
    });
});
