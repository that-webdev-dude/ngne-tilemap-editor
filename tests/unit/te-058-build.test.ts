import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync, unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
    ENCODING_GIDS,
    FLIP_COMBINATIONS,
    listFiles,
    tmjFixtureFiles,
} from "../fixtures/tmj/build";

// TE-058: the TMJ fixtures of SPEC §13 are exactly what `tests/fixtures/tmj/build.ts` writes,
// and they hold what their README entries claim: every encoding decodes to the same GIDs, the
// flip map has all eight flag combinations with and without bit 28, and every file a map,
// tileset or template names exists.

const FOLDER = new URL("../fixtures/tmj/", import.meta.url);
const SCRIPT = "build.ts";

type Json = Record<string, unknown>;

const readJson = (path: string): Json =>
    JSON.parse(readFileSync(new URL(path, FOLDER), "utf8")) as Json;

const littleEndianGids = (bytes: Uint8Array): number[] => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: bytes.length / 4 }, (_, i) => view.getUint32(i * 4, true));
};

/** Reads a Zstandard frame made only of raw blocks (RFC 8878 §3.1.1), as the fixtures write. */
function readRawZstd(frame: Uint8Array): Uint8Array {
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint32(0, true)).toBe(0xfd2fb528);
    const descriptor = frame[4]!;
    expect(descriptor & 0x20).toBe(0x20); // Single_Segment: no window descriptor
    expect(descriptor >> 6).toBe(2); // 4-byte Frame_Content_Size
    expect(descriptor & 0x07).toBe(0); // no dictionary ID, no checksum (bit 2), reserved clear
    const size = view.getUint32(5, true);
    const out: number[] = [];
    let at = 9;
    for (;;) {
        const header = frame[at]! | (frame[at + 1]! << 8) | (frame[at + 2]! << 16);
        at += 3;
        expect((header >> 1) & 3, "block type").toBe(0); // Raw_Block
        const length = header >>> 3;
        out.push(...frame.subarray(at, at + length));
        at += length;
        if (header & 1) break;
    }
    expect(at).toBe(frame.length);
    expect(out.length).toBe(size);
    return Uint8Array.from(out);
}

function decodeLayer(layer: Json): number[] {
    if (layer["encoding"] === undefined) return layer["data"] as number[];
    expect(layer["encoding"]).toBe("base64");
    const bytes = new Uint8Array(Buffer.from(layer["data"] as string, "base64"));
    switch (layer["compression"]) {
        case "":
            return littleEndianGids(bytes);
        case "zlib":
            return littleEndianGids(unzlibSync(bytes));
        case "gzip":
            return littleEndianGids(gunzipSync(bytes));
        case "zstd":
            return littleEndianGids(readRawZstd(bytes));
        default:
            throw new Error(`Unknown compression ${String(layer["compression"])}.`);
    }
}

/** Every file a map, tileset or template refers to (`file` properties included), relative to the folder. */
function references(path: string, json: Json): string[] {
    const base = new URL(path, FOLDER);
    const found: string[] = [];
    const add = (relative: string) =>
        found.push(fileURLToPath(new URL(relative, base)).slice(fileURLToPath(FOLDER).length));
    const walk = (value: unknown, key?: string) => {
        if (Array.isArray(value)) value.forEach((item) => walk(item));
        else if (value && typeof value === "object") {
            // A `file` property names a file too: Tiled warns when it does not exist.
            const property = value as { type?: unknown; value?: unknown };
            if (property.type === "file" && typeof property.value === "string") add(property.value);
            for (const [k, v] of Object.entries(value)) walk(v, k);
        } else if (typeof value === "string" && ["source", "image", "template"].includes(key!)) {
            add(value);
        }
    };
    walk(json);
    return found.map((file) => file.split("\\").join("/"));
}

describe("TE-058 TMJ fixture script", () => {
    it("reproduces the committed fixtures byte for byte", () => {
        const files = tmjFixtureFiles();
        const committed = listFiles(fileURLToPath(FOLDER)).filter(
            // Tiled writes its per-user session next to the project file when the owner opens it.
            (path) => path !== SCRIPT && !path.endsWith(".tiled-session"),
        );
        expect(committed).toEqual([...files.keys()].sort());
        for (const [path, bytes] of files) {
            let disk = readFileSync(new URL(path, FOLDER));
            // Tiled re-saves the project whenever it opens it, with CRLF on Windows; git stores
            // it with LF (.gitattributes), so that copy is the same committed file.
            if (path === "tmj.tiled-project")
                disk = Buffer.from(disk.toString("utf8").replaceAll("\r\n", "\n"));
            expect(new Uint8Array(disk), path).toEqual(bytes);
        }
    });

    it("gives the same bytes on a second run (no clock, no randomness)", () => {
        const first = tmjFixtureFiles();
        const second = tmjFixtureFiles();
        for (const [path, bytes] of first) expect(second.get(path), path).toEqual(bytes);
    });
});

describe("TE-058 TMJ fixture contents", () => {
    it.each(["csv", "base64", "zlib", "gzip", "zstd"])(
        "encoding-%s.tmj decodes to the shared GIDs",
        (encoding) => {
            const map = readJson(`encoding-${encoding}.tmj`);
            const layer = (map["layers"] as Json[])[0]!;
            expect(layer["encoding"] ?? "csv").toBe(encoding === "csv" ? "csv" : "base64");
            if (encoding !== "csv") {
                expect(layer["compression"]).toBe(encoding === "base64" ? "" : encoding);
            }
            expect(decodeLayer(layer)).toEqual(ENCODING_GIDS);
        },
    );

    it("flips.tmj holds the eight flag combinations, then the same with bit 28", () => {
        const map = readJson("flips.tmj");
        const gids = decodeLayer((map["layers"] as Json[])[0]!);
        const flags = gids.map((value) => (value & 0xf0000000) >>> 0);
        const tiles = gids.map((value) => value & 0x0fffffff);
        expect(new Set(tiles).size).toBe(1);
        expect(new Set(FLIP_COMBINATIONS).size).toBe(8);
        expect(flags.slice(0, 8)).toEqual(FLIP_COMBINATIONS);
        expect(flags.slice(8)).toEqual(FLIP_COMBINATIONS.map((f) => (f | 0x10000000) >>> 0));
    });

    it("composite maps have their stated sizes", () => {
        const size = (file: string) => {
            const map = readJson(file);
            return [map["width"], map["height"]];
        };
        expect(size("side-scroller.tmj")).toEqual([1000, 40]);
        expect(size("overworld.tmj")).toEqual([256, 256]);
        const dungeon = readJson("dungeon.tmj");
        expect(dungeon["width"] as number).toBeLessThanOrEqual(32);
        const overworld = readJson("overworld.tmj");
        const groups = (overworld["layers"] as Json[]).filter((l) => l["type"] === "group");
        expect(groups.length).toBeGreaterThanOrEqual(2);
        expect(groups.some((g) => g["parallaxx"] !== undefined)).toBe(true);
        for (const file of ["side-scroller.tmj", "overworld.tmj"]) {
            const map = readJson(file);
            const width = map["width"] as number;
            const height = map["height"] as number;
            const tileLayers = (map["layers"] as Json[])
                .flatMap((l) => (l["type"] === "group" ? (l["layers"] as Json[]) : [l]))
                .filter((l) => l["type"] === "tilelayer");
            for (const layer of tileLayers) {
                expect(decodeLayer(layer), `${file} ${String(layer["name"])}`).toHaveLength(
                    width * height,
                );
            }
        }
    });

    // Each SPEC §13 input is present in the data of the file the README names for it, so a
    // fixture cannot lose an input while its README entry still claims it.
    const layersOf = (map: Json): Json[] =>
        (map["layers"] as Json[]).flatMap((layer) =>
            layer["type"] === "group" ? [layer, ...layersOf(layer)] : [layer],
        );
    const objectsOf = (map: Json): Json[] =>
        layersOf(map).flatMap((layer) => (layer["objects"] as Json[] | undefined) ?? []);
    const tilesetOf = (file: string, index = 0): Json => {
        const entry = (readJson(file)["tilesets"] as Json[])[index]!;
        return entry["source"] ? readJson(entry["source"] as string) : entry;
    };
    /** Each property's type, and `<type>+custom` when it names a custom property type. */
    const propertyTypes = (properties: Json[]) =>
        new Set(
            properties.flatMap((p) =>
                p["propertytype"]
                    ? [String(p["type"]), `${String(p["type"])}+custom`]
                    : [String(p["type"])],
            ),
        );
    const sizes = (tileset: Json) =>
        new Set(
            (tileset["tiles"] as Json[]).map(
                (t) => `${String(t["imagewidth"])}x${String(t["imageheight"])}`,
            ),
        );

    const CONTENTS: [string, () => boolean][] = [
        ["isometric map", () => readJson("isometric.tmj")["orientation"] === "isometric"],
        ["hexagonal map", () => readJson("hexagonal.tmj")["orientation"] === "hexagonal"],
        [
            "infinite map",
            () => {
                const map = readJson("infinite.tmj");
                return (
                    map["infinite"] === true &&
                    layersOf(map).some((l) => Array.isArray(l["chunks"]))
                );
            },
        ],
        ["image tileset", () => tilesetOf("tileset-tsj.tmj")["image"] === "tiles.png"],
        ["embedded tileset", () => tilesetOf("tileset-embedded.tmj")["image"] === "tiles.png"],
        [
            "`.tsj` tileset",
            () => (readJson("tileset-tsj.tmj")["tilesets"] as Json[])[0]!["source"] === "tiles.tsj",
        ],
        [
            "`.tsx` tileset",
            () =>
                (readJson("tileset-tsx.tmj")["tilesets"] as Json[])[0]!["source"] ===
                "tiles-xml.tsx",
        ],
        [
            "image-collection tileset, uniform",
            () =>
                tilesetOf("collection-uniform.tmj")["columns"] === 0 &&
                sizes(tilesetOf("collection-uniform.tmj")).size === 1,
        ],
        [
            "image-collection tileset, mixed",
            () =>
                tilesetOf("collection-mixed.tmj")["columns"] === 0 &&
                sizes(tilesetOf("collection-mixed.tmj")).size > 1,
        ],
        [
            "every object shape",
            () => {
                const objects = objectsOf(readJson("objects-shapes.tmj"));
                const rectangle = objects.some(
                    (o) =>
                        (o["width"] as number) > 0 &&
                        !["point", "ellipse", "polygon", "polyline", "gid", "text", "capsule"].some(
                            (k) => k in o,
                        ),
                );
                return (
                    rectangle &&
                    ["point", "ellipse", "polygon", "polyline"].every((k) =>
                        objects.some((o) => k in o),
                    )
                );
            },
        ],
        [
            "rotated object",
            () => objectsOf(readJson("objects-rotated.tmj")).some((o) => o["rotation"] !== 0),
        ],
        ["tile object", () => objectsOf(readJson("objects-dropped.tmj")).some((o) => "gid" in o)],
        ["text object", () => objectsOf(readJson("objects-dropped.tmj")).some((o) => "text" in o)],
        [
            "capsule object",
            () => objectsOf(readJson("objects-dropped.tmj")).some((o) => o["capsule"] === true),
        ],
        [
            "templates",
            () =>
                objectsOf(readJson("templates.tmj")).every(
                    (o) => typeof o["template"] === "string",
                ) && readJson("templates/door.tj")["type"] === "template",
        ],
        [
            "every property type",
            () => {
                const types = propertyTypes(readJson("properties.tmj")["properties"] as Json[]);
                return [
                    "bool",
                    "color",
                    "file",
                    "float",
                    "int",
                    "string",
                    "object",
                    "class",
                    "list",
                ].every((t) => types.has(t));
            },
        ],
        [
            "class property",
            () =>
                propertyTypes(readJson("properties.tmj")["properties"] as Json[]).has(
                    "class+custom",
                ),
        ],
        [
            "enum property",
            () => {
                const types = propertyTypes(readJson("properties.tmj")["properties"] as Json[]);
                return types.has("string+custom") && types.has("int+custom");
            },
        ],
        [
            "`object` property",
            () => propertyTypes(readJson("properties.tmj")["properties"] as Json[]).has("object"),
        ],
        [
            "`list` property",
            () => propertyTypes(readJson("properties.tmj")["properties"] as Json[]).has("list"),
        ],
        [
            "tint",
            () =>
                layersOf(readJson("tint-blend.tmj")).some(
                    (l) => typeof l["tintcolor"] === "string",
                ),
        ],
        [
            "blend mode",
            () => layersOf(readJson("tint-blend.tmj")).some((l) => typeof l["mode"] === "string"),
        ],
        [
            "terrain probabilities",
            () => {
                const tileset = tilesetOf("terrain.tmj");
                const colors = (tileset["wangsets"] as Json[])[0]!["colors"] as Json[];
                return (
                    colors.some((c) => c["probability"] !== 1) &&
                    (tileset["tiles"] as Json[]).some((t) => t["probability"] !== undefined)
                );
            },
        ],
        [
            "terrain transformations",
            () => typeof tilesetOf("terrain.tmj")["transformations"] === "object",
        ],
        [
            "`transparentcolor`",
            () =>
                typeof tilesetOf("transparent-color.tmj")["transparentcolor"] === "string" &&
                layersOf(readJson("transparent-color.tmj")).some(
                    (l) => l["type"] === "imagelayer" && typeof l["transparentcolor"] === "string",
                ),
        ],
        ["`tilerendersize`", () => tilesetOf("tilerendersize.tmj")["tilerendersize"] === "grid"],
        [
            "small dungeon with markers and collision",
            () => {
                const tiles = tilesetOf("dungeon.tmj")["tiles"] as Json[];
                return (
                    tiles.some((t) => "objectgroup" in t) &&
                    objectsOf(readJson("dungeon.tmj")).length > 0
                );
            },
        ],
    ];

    it.each(CONTENTS)("holds %s in its data", (_, holds) => {
        expect(holds()).toBe(true);
    });

    it("every file a map, tileset or template names exists, `file` properties included", () => {
        const files = tmjFixtureFiles();
        const json = [...files.keys()].filter((path) => /\.(tmj|tsj|tj)$/.test(path));
        expect(json.length).toBeGreaterThan(0);
        for (const path of json) {
            for (const reference of references(path, readJson(path))) {
                expect(existsSync(new URL(reference, FOLDER)), `${path} → ${reference}`).toBe(true);
            }
        }
        const xml = readFileSync(new URL("tiles-xml.tsx", FOLDER), "utf8");
        for (const [, source] of xml.matchAll(/source="([^"]+)"/g)) {
            expect(existsSync(new URL(source!, FOLDER)), `tiles-xml.tsx → ${source}`).toBe(true);
        }
    });
});
