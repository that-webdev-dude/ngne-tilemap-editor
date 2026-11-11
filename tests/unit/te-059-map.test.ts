import { readFileSync } from "node:fs";
import fc from "fast-check";
import { gunzipSync, unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { FLIP_COMBINATIONS } from "../fixtures/tmj/build";
import { cellValue, MAX_TILE_ID } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import { sequentialIds, walkLayers } from "../../src/core/model";
import type { Layer, Marker, ProjectMap } from "../../src/core/model";
import { TmjError, convertTmjMap, decodeGid, groupReport } from "../../src/core/tmj";
import type { TmjMapConversion, TmjReportEntry, TmjReportRow } from "../../src/core/tmj";

// TE-059: TMJ map conversion (SPEC §13, BRIEF §7). Each fixture of tests/fixtures/tmj converts to
// the map its README describes, with the report entries of its BRIEF §7 row; non-orthogonal and
// zstd maps are refused. The cells of every tile layer are checked against an independent
// decode of the fixture's data (Node's base64 and fflate).

const FOLDER = new URL("../fixtures/tmj/", import.meta.url);

type Json = Record<string, unknown>;

const fixtureText = (name: string): string => readFileSync(new URL(name, FOLDER), "utf8");
const fixtureJson = (name: string): Json => JSON.parse(fixtureText(name)) as Json;

const readTemplate = (path: string): string | undefined => {
    try {
        return fixtureText(path);
    } catch {
        return undefined;
    }
};

function convert(name: string, text = fixtureText(name)): TmjMapConversion {
    return convertTmjMap(text, {
        fileName: name,
        template: readTemplate,
        newId: sequentialIds("id"),
    });
}

function refusal(run: () => unknown): TmjError {
    try {
        run();
    } catch (error) {
        if (error instanceof TmjError) return error;
        throw error;
    }
    throw new Error("Expected the conversion to be refused.");
}

const rows = (conversion: TmjMapConversion): Partial<Record<TmjReportRow, number>> =>
    Object.fromEntries(groupReport(conversion.report).map((group) => [group.row, group.count]));

const details = (conversion: TmjMapConversion, row: TmjReportRow): string[] =>
    conversion.report.filter((entry) => entry.row === row).map((entry) => entry.detail);

function layer(map: ProjectMap, name: string): Layer {
    const found = [...walkLayers(map.layers)].find((entry) => entry.layer.name === name);
    if (!found) throw new Error(`No layer ${name}.`);
    return found.layer;
}

function markers(map: ProjectMap, name: string): Marker[] {
    const found = layer(map, name);
    if (found.type !== "marker") throw new Error(`${name} is no marker layer.`);
    return found.markers;
}

function rawLayers(layers: unknown): Json[] {
    return (layers as Json[]).flatMap((raw) =>
        raw.type === "group" ? [raw, ...rawLayers(raw.layers)] : [raw],
    );
}

/** The raw GIDs of a layer or chunk, decoded independently of src/core/tmj. */
function rawGids(source: Json, raw: Json): number[] {
    if (Array.isArray(source.data)) return (source.data as number[]).map((value) => value >>> 0);
    let bytes: Uint8Array = Buffer.from(source.data as string, "base64");
    if (raw.compression === "zlib") bytes = unzlibSync(bytes);
    if (raw.compression === "gzip") bytes = gunzipSync(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true));
}

/** The in-memory value a raw GID should become, with the map's `firstgid`s ascending. */
function expectedValue(gidRaw: number, firstGids: number[]): number {
    const gid = gidRaw & 0x0fffffff;
    if (gid === 0) return 0;
    let index = firstGids.length - 1;
    while (firstGids[index]! > gid) index -= 1;
    return cellValue(index + 1, gid - firstGids[index]!, (gidRaw >>> 29) as Orientation);
}

/** Every tile layer's cells equal the fixture's GIDs, moved by the conversion's offset. */
function expectCellsMatch(name: string, conversion: TmjMapConversion): void {
    const json = fixtureJson(name);
    const firstGids = (json.tilesets as Json[]).map((tileset) => tileset.firstgid as number);
    const { map, offset } = conversion;
    const tileLayers = rawLayers(json.layers).filter((raw) => raw.type === "tilelayer");
    expect(tileLayers.length).toBeGreaterThan(0);
    for (const raw of tileLayers) {
        const converted = [...walkLayers(map.layers)].find(
            (entry) => entry.layer.id === raw.id,
        )?.layer;
        if (converted?.type !== "tile") throw new Error(`Layer ${String(raw.id)} is missing.`);
        const blocks = json.infinite ? (raw.chunks as Json[]) : [raw];
        let count = 0;
        for (const block of blocks) {
            const width = block.width as number;
            const x0 = json.infinite ? (block.x as number) : 0;
            const y0 = json.infinite ? (block.y as number) : 0;
            rawGids(block, raw).forEach((gid, index) => {
                const x = x0 + (index % width) + offset.x;
                const y = y0 + Math.floor(index / width) + offset.y;
                const value = expectedValue(gid, firstGids);
                if (value !== 0) count += 1;
                expect(converted.cells.get(x, y)).toBe(value);
            });
        }
        expect(converted.cells.count).toBe(count);
    }
}

describe("TE-059 encodings", () => {
    const names = ["csv", "base64", "zlib", "gzip"].map((kind) => `encoding-${kind}.tmj`);

    it.each(names)("%s decodes to the fixture's cells with no report entry", (name) => {
        const conversion = convert(name);
        expect(conversion.map).toMatchObject({
            name: name.replace(".tmj", ""),
            exportName: name.replace(".tmj", ""),
            orientation: "orthogonal",
            width: 10,
            height: 8,
            tileWidth: 16,
            tileHeight: 16,
            nextLayerId: 2,
            nextMarkerId: 1,
        });
        expect(conversion.tilesets).toEqual([
            {
                slot: 1,
                firstGid: 1,
                source: "tiles.tsj",
                embedded: null,
                usedTileIds: [0, 2, 3, 4, 9, 24],
            },
        ]);
        expect(conversion.report).toEqual([]);
        expectCellsMatch(name, conversion);
    });

    it("all four encodings give the same cells", () => {
        const values = names.map((name) => {
            const ground = layer(convert(name).map, "Ground");
            if (ground.type !== "tile") throw new Error("Ground is no tile layer.");
            return [...ground.cells.chunksIn({ x: 0, y: 0, width: 10, height: 8 })].map((chunk) =>
                Array.from(chunk.cells),
            );
        });
        for (const value of values) expect(value).toEqual(values[0]);
    });

    it("encoding-zstd.tmj is refused with the re-save message", () => {
        const error = refusal(() => convert("encoding-zstd.tmj"));
        expect(error.code).toBe("zstd");
        expect(error.message).toContain("re-save in Tiled with zlib or gzip");
    });

    it("zstd is refused even in a layer after one that decodes", () => {
        const json = fixtureJson("encoding-zlib.tmj");
        const zstd = fixtureJson("encoding-zstd.tmj");
        json.layers = [...(json.layers as Json[]), { ...(zstd.layers as Json[])[0]!, id: 2 }];
        expect(refusal(() => convert("x.tmj", JSON.stringify(json))).code).toBe("zstd");
    });
});

describe("TE-059 orientation refusals", () => {
    it.each(["isometric.tmj", "hexagonal.tmj"])("%s is refused", (name) => {
        const error = refusal(() => convert(name));
        expect(error.code).toBe("orientation");
        expect(error.message).toMatch(/Only orthogonal maps can be imported; this map is \w+\./);
    });
});

describe("TE-059 GID flip bits", () => {
    it("flips.tmj keeps H, V and D in every combination and clears bit 28", () => {
        const conversion = convert("flips.tmj");
        const flips = layer(conversion.map, "Flips");
        if (flips.type !== "tile") throw new Error("Flips is no tile layer.");
        FLIP_COMBINATIONS.forEach((flags, column) => {
            const expected = cellValue(1, 24, (flags >>> 29) as Orientation);
            expect(flips.cells.get(column, 0)).toBe(expected);
            expect(flips.cells.get(column, 1)).toBe(expected);
        });
        expect(conversion.report).toEqual<TmjReportEntry[]>([
            {
                row: "gid-flip-bits",
                detail: "Bit 28 cleared (hexagonal 120° rotation)",
                count: 8,
                where: { layer: { id: 1, name: "Flips" } },
            },
        ]);
        expectCellsMatch("flips.tmj", conversion);
    });

    it("a GID below every firstgid is refused", () => {
        const json = fixtureJson("encoding-csv.tmj");
        (json.tilesets as Json[])[0]!.firstgid = 5;
        const error = refusal(() => convert("x.tmj", JSON.stringify(json)));
        expect(error.code).toBe("gid");
        expect(error.message).toContain('Layer "Ground"');
    });
});

describe("TE-059 GID decoding (fast-check)", () => {
    /** Tilesets as `firstgid` and span; the last one's span reaches as far as GIDs allow. */
    const table = fc
        .array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 8 })
        .chain((spans) =>
            fc.integer({ min: 1, max: 1000 }).map((start) => {
                const firstGids: number[] = [];
                let next = start;
                for (const span of spans) {
                    firstGids.push(next);
                    next += span;
                }
                return { firstGids, spans };
            }),
        );
    const pick = table.chain(({ firstGids, spans }) =>
        fc.record({
            firstGids: fc.constant(firstGids),
            tileset: fc.integer({ min: 0, max: firstGids.length - 1 }),
            local: fc.nat(),
            flags: fc.integer({ min: 0, max: 15 }),
            spans: fc.constant(spans),
        }),
    );

    it("keeps H/V/D, clears bit 28 and maps to the right local ID", () => {
        fc.assert(
            fc.property(pick, ({ firstGids, tileset, local, flags, spans }) => {
                const last = tileset === firstGids.length - 1;
                const span = last ? MAX_TILE_ID + 1 : spans[tileset]!;
                const tileId = local % span;
                const raw = ((flags << 28) | (firstGids[tileset]! + tileId)) >>> 0;
                const decoded = decodeGid(raw, firstGids);
                expect(decoded).toEqual({
                    kind: "tile",
                    tileset,
                    tileId,
                    orientation: flags >>> 1,
                    bit28: (flags & 1) === 1,
                });
                // The signed spelling of the same 32 bits decodes alike (`>>> 0`).
                expect(decodeGid(raw | 0, firstGids)).toEqual(decoded);
            }),
            { numRuns: 2000 },
        );
    });

    it("a converted cell holds the flags and local ID of its GID", () => {
        fc.assert(
            fc.property(pick, ({ firstGids, tileset, local, flags, spans }) => {
                const last = tileset === firstGids.length - 1;
                const tileId = local % (last ? 4096 : spans[tileset]!);
                const raw = ((flags << 28) | (firstGids[tileset]! + tileId)) >>> 0;
                const map = {
                    type: "map",
                    orientation: "orthogonal",
                    width: 1,
                    height: 1,
                    tilewidth: 16,
                    tileheight: 16,
                    nextlayerid: 2,
                    nextobjectid: 1,
                    tilesets: firstGids.map((firstgid, i) => ({
                        firstgid,
                        source: `t${i}.tsj`,
                    })),
                    layers: [
                        { id: 1, name: "L", type: "tilelayer", width: 1, height: 1, data: [raw] },
                    ],
                };
                const conversion = convert("p.tmj", JSON.stringify(map));
                const cells = layer(conversion.map, "L");
                if (cells.type !== "tile") throw new Error("L is no tile layer.");
                const orientation = (flags >>> 1) as Orientation;
                expect(cells.cells.get(0, 0)).toBe(cellValue(tileset + 1, tileId, orientation));
                expect(conversion.tilesets[tileset]!.usedTileIds).toEqual([tileId]);
                expect(rows(conversion)["gid-flip-bits"] ?? 0).toBe(flags & 1);
            }),
            { numRuns: 300 },
        );
    });

    it("an empty GID is empty whatever its flags", () => {
        for (let flags = 0; flags < 16; flags += 1) {
            expect(decodeGid((flags << 28) >>> 0, [1])).toEqual({ kind: "empty" });
        }
    });
});

describe("TE-059 infinite maps", () => {
    const conversion = convert("infinite.tmj");
    const { map } = conversion;

    it("the union of used chunks becomes the map", () => {
        // Chunks of 16 cells at (-16,-16), (0,0) and (32,16): x −16..47, y −16..31.
        expect(conversion.offset).toEqual({ x: 16, y: 16 });
        expect([map.width, map.height]).toEqual([64, 48]);
        expectCellsMatch("infinite.tmj", conversion);
    });

    it("layers and markers move by the same offset", () => {
        const ground = layer(map, "Ground");
        const overlay = layer(map, "Overlay");
        if (ground.type !== "tile" || overlay.type !== "tile") throw new Error("Not tile layers.");
        // Ground: blocks at (−4..−1) and (0..7) → (12..15) and (16..23); Overlay (36,20) → (52,36).
        expect(ground.cells.get(12, 12)).toBe(cellValue(1, 0));
        expect(ground.cells.get(11, 11)).toBe(0);
        expect(ground.cells.get(23, 23)).toBe(cellValue(1, 0));
        expect(overlay.cells.get(52, 36)).toBe(cellValue(1, 2));
        expect(overlay.cells.count).toBe(1);
        // 16 cells of 16 px: 256 px.
        expect(markers(map, "Markers").map(({ name, x, y }) => ({ name, x, y }))).toEqual([
            { name: "Far corner", x: -200 + 256, y: -120 + 256 },
            { name: "Beyond", x: 520 + 256, y: 300 + 256 },
        ]);
    });

    it("the report states the offset in cells", () => {
        expect(conversion.report).toEqual<TmjReportEntry[]>([
            {
                row: "infinite-map",
                detail:
                    "Converted to a fixed 64 × 48 map over the used chunks; every layer and " +
                    "marker moved by (16, 16) cells",
                count: 1,
                where: {},
            },
        ]);
    });

    it("image layers and the parallax origin move by the offset too", () => {
        const json = fixtureJson("infinite.tmj");
        json.parallaxoriginx = 10;
        json.layers = [
            ...(json.layers as Json[]),
            { id: 4, name: "Sky", type: "imagelayer", image: "sky.png", offsetx: 5, offsety: -3 },
        ];
        const moved = convert("x.tmj", JSON.stringify(json)).map;
        expect(layer(moved, "Sky")).toMatchObject({ offsetX: 5 + 256, offsetY: -3 + 256 });
        expect([moved.parallaxOriginX, moved.parallaxOriginY]).toEqual([10 + 256, 256]);
    });
});

describe("TE-059 tilesets as the map lists them", () => {
    it("tileset-embedded.tmj hands on the embedded tileset without firstgid", () => {
        const [ref] = convert("tileset-embedded.tmj").tilesets;
        const embedded = (fixtureJson("tileset-embedded.tmj").tilesets as Json[])[0]!;
        const rest: Json = { ...embedded };
        delete rest.firstgid;
        expect(ref).toMatchObject({ slot: 1, firstGid: 1, source: null });
        expect(ref!.embedded).toEqual(rest);
    });

    it.each([
        ["tileset-tsj.tmj", "tiles.tsj"],
        ["tileset-tsx.tmj", "tiles-xml.tsx"],
        ["terrain.tmj", "terrain.tsj"],
        ["dungeon.tmj", "dungeon.tsj"],
    ])("%s names its external tileset %s", (name, source) => {
        const conversion = convert(name);
        expect(conversion.tilesets.map((ref) => ref.source)).toEqual([source]);
        expect(conversion.report).toEqual([]);
        expectCellsMatch(name, conversion);
    });

    it.each(["collection-uniform.tmj", "collection-mixed.tmj"])(
        "%s gives each tileset its own slot",
        (name) => {
            const conversion = convert(name);
            expect(conversion.tilesets.map((ref) => [ref.slot, ref.firstGid])).toEqual([
                [1, 1],
                [2, 4],
            ]);
            expect(conversion.tilesets[0]!.usedTileIds).toEqual([0, 1, 2]);
            expect(conversion.report).toEqual([]);
            expectCellsMatch(name, conversion);
        },
    );

    it("tilerendersize.tmj converts its map; the tileset's render size is TE-060's", () => {
        const conversion = convert("tilerendersize.tmj");
        expect(conversion.tilesets[0]!.embedded).toMatchObject({ tilerendersize: "grid" });
        expect(conversion.report).toEqual([]);
        expectCellsMatch("tilerendersize.tmj", conversion);
    });
});

describe("TE-059 objects", () => {
    it("objects-shapes.tmj keeps every shape; the hidden one imports visible", () => {
        const conversion = convert("objects-shapes.tmj");
        const layerOut = layer(conversion.map, "Markers");
        expect(layerOut).toMatchObject({ type: "marker", color: 0xff8000ff });
        expect(markers(conversion.map, "Markers")).toEqual<Marker[]>([
            {
                shape: "rectangle",
                id: 1,
                name: "Spawn area",
                class: "Zone",
                x: 16,
                y: 16,
                width: 48,
                height: 32,
                properties: [{ name: "team", type: "string", value: "red" }],
            },
            { shape: "point", id: 2, name: "Start", class: "", x: 96, y: 24, properties: [] },
            {
                shape: "ellipse",
                id: 3,
                name: "Pond",
                class: "",
                x: 120,
                y: 16,
                width: 48,
                height: 32,
                properties: [],
            },
            {
                shape: "polygon",
                id: 4,
                name: "Rock",
                class: "",
                x: 24,
                y: 80,
                points: [
                    [0, 0],
                    [32, 8],
                    [16, 32],
                ],
                properties: [],
            },
            {
                shape: "polyline",
                id: 5,
                name: "Path",
                class: "",
                x: 80,
                y: 72,
                points: [
                    [0, 0],
                    [24, 16],
                    [56, 8],
                    [88, 32],
                ],
                properties: [],
            },
            {
                shape: "rectangle",
                id: 6,
                name: "Secret",
                class: "",
                x: 150,
                y: 90,
                width: 24,
                height: 16,
                properties: [],
            },
        ]);
        expect(conversion.map.nextMarkerId).toBe(7);
        expect(conversion.report).toEqual<TmjReportEntry[]>([
            {
                row: "hidden-objects",
                detail: "Hidden object imported visible",
                count: 1,
                where: { layer: { id: 2, name: "Markers" }, object: { id: 6, name: "Secret" } },
            },
        ]);
    });

    it("objects-rotated.tmj keeps the shapes and reports each rotation", () => {
        const conversion = convert("objects-rotated.tmj");
        expect(markers(conversion.map, "Markers").map((marker) => marker.shape)).toEqual([
            "rectangle",
            "ellipse",
            "polygon",
        ]);
        expect(markers(conversion.map, "Markers")[0]).toMatchObject({ x: 32, y: 24 });
        expect(details(conversion, "object-rotation")).toEqual([
            "Rotation 30° dropped",
            "Rotation 45° dropped",
            "Rotation 90° dropped",
        ]);
        expect(rows(conversion)).toEqual({ "object-rotation": 3 });
    });

    it("objects-dropped.tmj drops tile, text and capsule objects", () => {
        const conversion = convert("objects-dropped.tmj");
        expect(markers(conversion.map, "Things")).toEqual([]);
        expect(conversion.report.map((entry) => [entry.detail, entry.where.object?.name])).toEqual([
            ["Tile object dropped", "Chest"],
            ["Tile object dropped", "Flipped arrow"],
            ["Text object dropped", "Sign"],
            ["Capsule object dropped", "Pill"],
        ]);
        expect(rows(conversion)).toEqual({ "dropped-objects": 4 });
        expect(conversion.map.nextMarkerId).toBe(5);
    });

    it("templates.tmj inlines each template first, then applies the rows", () => {
        const conversion = convert("templates.tmj");
        expect(markers(conversion.map, "Instances")).toEqual<Marker[]>([
            {
                shape: "rectangle",
                id: 1,
                name: "Door",
                class: "Door",
                x: 32,
                y: 64,
                width: 16,
                height: 32,
                properties: [{ name: "locked", type: "bool", value: false }],
            },
            {
                shape: "rectangle",
                id: 2,
                name: "Vault door",
                class: "Door",
                x: 96,
                y: 64,
                width: 16,
                height: 32,
                properties: [{ name: "locked", type: "bool", value: true }],
            },
            {
                shape: "polygon",
                id: 4,
                name: "Zone",
                class: "Zone",
                x: 136,
                y: 72,
                points: [
                    [0, 0],
                    [32, 0],
                    [40, 24],
                    [0, 24],
                ],
                properties: [],
            },
        ]);
        expect(details(conversion, "template-instances")).toEqual([
            "Template templates/door.tj inlined",
            "Template templates/door.tj inlined",
            "Template templates/coin.tj inlined",
            "Template templates/zone.tj inlined",
        ]);
        expect(conversion.report.find((entry) => entry.row === "dropped-objects")).toEqual({
            row: "dropped-objects",
            detail: "Tile object dropped",
            count: 1,
            where: { layer: { id: 2, name: "Instances" }, object: { id: 3, name: "Coin" } },
        });
        expect(rows(conversion)).toEqual({ "dropped-objects": 1, "template-instances": 4 });
    });

    it("a missing template refuses the map and names it", () => {
        const error = refusal(() =>
            convertTmjMap(fixtureText("templates.tmj"), { fileName: "templates.tmj" }),
        );
        expect(error.code).toBe("missing-file");
        expect(error.path).toBe("templates/door.tj");
    });
});

describe("TE-059 properties and classes", () => {
    const conversion = convert("properties.tmj");
    const { map } = conversion;

    it("keeps classes, converts enums and colours, drops object, list and class types", () => {
        expect(map.class).toBe("Level");
        expect(map.properties).toEqual([
            { name: "alive", type: "bool", value: true },
            { name: "backdrop", type: "file", value: "images/backdrop.png" },
            { name: "facing", type: "string", value: "east" },
            { name: "flags", type: "int", value: 5 },
            { name: "gravity", type: "float", value: 9.81 },
            { name: "lives", type: "int", value: 3 },
            { name: "tint", type: "color", value: "#33669980" },
            { name: "title", type: "string", value: "Every property" },
        ]);
        expect(layer(map, "Ground")).toMatchObject({
            class: "Terrain",
            properties: [{ name: "biome", type: "string", value: "meadow" }],
        });
        expect(layer(map, "Actors").class).toBe("Actors");
        expect(markers(map, "Actors").map((marker) => [marker.name, marker.class])).toEqual([
            ["Hero", "Npc"],
            ["Sidekick", "Npc"],
        ]);
        expect(markers(map, "Actors")[0]!.properties).toEqual([]);
    });

    it("reports every dropped property and every enum where it was", () => {
        const dropped = conversion.report
            .filter((entry) => entry.row === "dropped-properties")
            .map((entry) => [entry.detail, entry.where]);
        expect(dropped).toEqual([
            ["Property of type list dropped", { property: "route" }],
            ["Property of type class Stats dropped", { property: "stats" }],
            ["Property of type object dropped", { property: "target" }],
            [
                "Property of type object dropped",
                {
                    layer: { id: 2, name: "Actors" },
                    object: { id: 1, name: "Hero" },
                    property: "friend",
                },
            ],
            [
                "Property of type class Stats dropped",
                {
                    layer: { id: 2, name: "Actors" },
                    object: { id: 1, name: "Hero" },
                    property: "stats",
                },
            ],
        ]);
        expect(details(conversion, "enum-properties")).toEqual([
            'Enum Facing imported as string "east"',
            "Enum Layers imported as int 5",
        ]);
        expect(rows(conversion)).toEqual({ "dropped-properties": 5, "enum-properties": 2 });
    });

    it("groups the report by BRIEF §7 row in row order", () => {
        expect(groupReport(conversion.report).map((group) => [group.title, group.count])).toEqual([
            ["object, list and class-typed properties", 5],
            ["Enum properties", 2],
        ]);
    });
});

describe("TE-059 layers", () => {
    it("tint-blend.tmj drops tint and blend modes, converts opacity and offsets", () => {
        const conversion = convert("tint-blend.tmj");
        expect(layer(conversion.map, "Screen")).toMatchObject({
            opacity: 128,
            offsetX: 32,
            offsetY: 16,
        });
        expect(
            conversion.report.map((entry) => [entry.row, entry.detail, entry.where.layer?.name]),
        ).toEqual([
            ["tint-blend", "Tint #ff6060 dropped", "Tinted"],
            ["tint-blend", "Blend mode multiply dropped", "Multiply"],
            ["tint-blend", "Blend mode screen dropped", "Screen"],
        ]);
        expectCellsMatch("tint-blend.tmj", conversion);
    });

    it("transparent-color.tmj: image layer, colour key and background colour", () => {
        const conversion = convert("transparent-color.tmj");
        expect(conversion.map.backgroundColor).toBe(0x203040ff);
        expect(conversion.images).toEqual([
            { id: "id2", path: "images/backdrop.png", transparentColor: 0xff00ffff },
        ]);
        expect(layer(conversion.map, "Backdrop")).toMatchObject({
            type: "image",
            imageId: "id2",
            repeatX: false,
            repeatY: false,
        });
        expect(conversion.tilesets[0]!.embedded).toMatchObject({ name: "keyed" });
        expect(conversion.report).toEqual([]);
    });

    it("side-scroller.tmj: 1000 × 40, parallax image layer, zlib layers, 14 spawns", () => {
        const conversion = convert("side-scroller.tmj");
        expect([conversion.map.width, conversion.map.height]).toEqual([1000, 40]);
        expect(layer(conversion.map, "Sky")).toMatchObject({
            type: "image",
            parallaxX: 0.2,
            parallaxY: 1,
            repeatX: true,
        });
        expect(layer(conversion.map, "Spawns")).toMatchObject({ color: 0xff4040ff });
        expect(markers(conversion.map, "Spawns")).toHaveLength(14);
        expect(markers(conversion.map, "Spawns")[1]).toMatchObject({
            shape: "point",
            name: "Enemy 1",
            class: "Spawn",
            properties: [{ name: "kind", type: "string", value: "bat" }],
        });
        expect(conversion.report).toEqual([]);
        expectCellsMatch("side-scroller.tmj", conversion);
    });

    it("overworld.tmj: groups with opacity, parallax and offsets, gzip layers", () => {
        const conversion = convert("overworld.tmj");
        const { map } = conversion;
        expect([map.width, map.height]).toEqual([256, 256]);
        expect(map.layers.map((group) => [group.type, group.name, group.id])).toEqual([
            ["group", "World", 1],
            ["group", "Sky", 5],
        ]);
        expect(layer(map, "Sky")).toMatchObject({ opacity: 179, parallaxX: 0.5, parallaxY: 0.5 });
        expect(layer(map, "Clouds")).toMatchObject({ offsetX: 8, offsetY: 8 });
        expect(markers(map, "Towns").map((marker) => marker.name)).toEqual([
            "Northwatch",
            "Riverbend",
            "Stonegate",
            "Saltmarsh",
        ]);
        expect(map.nextLayerId).toBe(7);
        expect(conversion.report).toEqual([]);
        expectCellsMatch("overworld.tmj", conversion);
    });

    it("dungeon.tmj: three tile layers and nine markers", () => {
        const conversion = convert("dungeon.tmj");
        expect(conversion.map.layers.map((entry) => entry.name)).toEqual([
            "Floor",
            "Walls",
            "Items",
            "Markers",
        ]);
        expect(layer(conversion.map, "Markers")).toMatchObject({ color: 0xffaa00ff });
        expect(markers(conversion.map, "Markers").map((marker) => marker.shape)).toEqual([
            "rectangle",
            "rectangle",
            "rectangle",
            "rectangle",
            "point",
            "point",
            "polygon",
            "polyline",
            "ellipse",
        ]);
        expect(conversion.map.nextMarkerId).toBe(10);
        expect(conversion.report).toEqual([]);
        expectCellsMatch("dungeon.tmj", conversion);
    });

    it("fractional offsets are rounded and reported; render order is reported", () => {
        const json = fixtureJson("encoding-csv.tmj");
        json.renderorder = "left-up";
        (json.layers as Json[])[0]!.offsetx = 2.6;
        (json.layers as Json[])[0]!.offsety = -1.25;
        const conversion = convert("x.tmj", JSON.stringify(json));
        expect(layer(conversion.map, "Ground")).toMatchObject({ offsetX: 3, offsetY: -1 });
        expect(conversion.report.map((entry) => [entry.row, entry.detail])).toEqual([
            ["render-order", "Render order left-up drawn right-down"],
            ["layer-offsets", "Offset (2.6, -1.25) rounded to (3, -1)"],
        ]);
    });

    it("keeps nextlayerid and nextobjectid; repeated IDs take new ones", () => {
        const json = fixtureJson("objects-shapes.tmj");
        json.nextlayerid = 9;
        json.nextobjectid = 20;
        const objectsRaw = (json.layers as Json[])[1]!.objects as Json[];
        objectsRaw[1]!.id = 1;
        const conversion = convert("x.tmj", JSON.stringify(json));
        expect(conversion.map.nextLayerId).toBe(9);
        expect(conversion.map.nextMarkerId).toBe(21);
        expect(markers(conversion.map, "Markers").map((marker) => marker.id)).toEqual([
            1, 20, 3, 4, 5, 6,
        ]);
        expect(details(conversion, "out-of-range")).toEqual(["Object ID 1 replaced by 20"]);
    });

    it("refuses tiles above 256 px and maps above the cell limits", () => {
        const big = fixtureJson("encoding-csv.tmj");
        big.tilewidth = 512;
        expect(refusal(() => convert("x.tmj", JSON.stringify(big))).code).toBe("limit");
        const wide = fixtureJson("encoding-csv.tmj");
        wide.width = 5000;
        expect(refusal(() => convert("x.tmj", JSON.stringify(wide))).code).toBe("limit");
    });

    it("refuses text that is no Tiled map", () => {
        expect(refusal(() => convert("x.tmj", "{")).code).toBe("format");
        expect(refusal(() => convert("x.tsj", fixtureText("tiles.tsj"))).code).toBe("format");
    });

    it("refuses data that does not hold the layer's cells", () => {
        const json = fixtureJson("encoding-zlib.tmj");
        (json.layers as Json[])[0]!.height = 4;
        expect(refusal(() => convert("x.tmj", JSON.stringify(json))).code).toBe("format");
    });
});

describe("TE-059 values the editor's ranges do not hold", () => {
    const base = (): Json => fixtureJson("encoding-csv.tmj");

    it("an effective offset or parallax out of range is clamped on the child and reported", () => {
        const json = base();
        const ground = (json.layers as Json[])[0]!;
        json.layers = [
            {
                id: 2,
                name: "Outer",
                type: "group",
                parallaxx: 50,
                offsetx: 1_000_000,
                layers: [{ ...ground, parallaxx: 50, offsetx: 1_000_000 }],
            },
        ];
        json.nextlayerid = 3;
        const conversion = convert("x.tmj", JSON.stringify(json));
        expect(layer(conversion.map, "Ground")).toMatchObject({
            offsetX: 1_048_576 - 1_000_000,
            parallaxX: 2,
        });
        expect(details(conversion, "out-of-range")).toEqual([
            "Effective offset 2000000 clamped to 1048576",
            "Effective parallax 2500 clamped to 100",
        ]);
    });

    it("a marker the infinite-map offset moves out of range is dropped and reported", () => {
        const json = fixtureJson("infinite.tmj");
        json.tilewidth = 256;
        json.tileheight = 256;
        // One used chunk, at cell x −4096: every marker moves right by 4096 × 256 px.
        const [ground, overlay, layerOfMarkers] = json.layers as Json[];
        ground!.chunks = [{ ...(ground!.chunks as Json[])[0]!, x: -4096 }];
        overlay!.chunks = [];
        const objectsRaw = layerOfMarkers!.objects as Json[];
        objectsRaw[0]!.x = 100;
        objectsRaw[1]!.x = -1_048_000;
        const conversion = convert("x.tmj", JSON.stringify(json));
        expect(markers(conversion.map, "Markers").map((marker) => marker.name)).toEqual(["Beyond"]);
        expect(details(conversion, "out-of-range")).toContain(
            "Object dropped: out of range after the infinite-map offset",
        );
    });

    it("an ID of 2147483647 refuses the map: the next ID would pass the limit", () => {
        const json = base();
        (json.layers as Json[])[0]!.id = 2_147_483_647;
        expect(refusal(() => convert("x.tmj", JSON.stringify(json))).code).toBe("limit");
    });

    it("unreadable background and transparent colours are dropped and reported", () => {
        const json = fixtureJson("transparent-color.tmj");
        json.backgroundcolor = "red";
        (json.layers as Json[])[0]!.transparentcolor = "pink";
        const conversion = convert("x.tmj", JSON.stringify(json));
        expect(conversion.map.backgroundColor).toBeNull();
        expect(conversion.images[0]!.transparentColor).toBeNull();
        expect(details(conversion, "out-of-range")).toEqual([
            "Transparent colour pink dropped",
            "Background colour red dropped",
        ]);
    });

    it("an invalid layer ID is reported with Tiled's value", () => {
        const json = base();
        (json.layers as Json[])[0]!.id = -5;
        const conversion = convert("x.tmj", JSON.stringify(json));
        expect(conversion.map.layers[0]!.id).toBe(2);
        expect(conversion.report).toEqual<TmjReportEntry[]>([
            {
                row: "out-of-range",
                detail: "Layer ID -5 replaced by 2",
                count: 1,
                where: { layer: { id: -5, name: "Ground" } },
            },
        ]);
    });
});
