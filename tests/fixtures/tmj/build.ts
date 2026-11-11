import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "fast-png";
import { gzipSync, zlibSync } from "fflate";

// TE-058: writes the TMJ import fixtures of SPEC §13 into tests/fixtures/tmj/, replacing what
// is there (this file excepted). Maps, tilesets and templates follow Tiled 1.12.2's JSON
// writer (`MapToVariantConverter`, `JsonWriter` with auto-formatting) and its TSX writer
// (`MapWriter`); tile and image PNGs are generated. The TE-058 tests check that the committed
// files are exactly what this script writes, and that the README names every BRIEF §7 row and
// SPEC §13 coverage item.
//
//     node tests/fixtures/tmj/build.ts
//
// Everything is integer arithmetic or exact decimals: no Math.random, no trigonometry, no
// clock, so every run writes the same bytes.

const TILED_VERSION = "1.12.2";
const FORMAT_VERSION = "1.11";
const TILE = 16;

// --- Tiled's JSON -----------------------------------------------------------------------------

type Json = number | string | boolean | readonly Json[] | { readonly [key: string]: Json };
type JsonObject = { readonly [key: string]: Json };

/** Tiled's `escape` (`src/plugins/json/qjsonparser/json.cpp`), one UTF-16 unit at a time. */
function escape(text: string): string {
    let out = "";
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        const code = text.charCodeAt(i);
        if (char === "\b") out += "\\b";
        else if (char === "\f") out += "\\f";
        else if (char === "\n") out += "\\n";
        else if (char === "\r") out += "\\r";
        else if (char === "\t") out += "\\t";
        else if (char === '"') out += '\\"';
        else if (char === "\\") out += "\\\\";
        else if (char === "/") out += "\\/";
        else if (code > 127) out += `\\u${code.toString(16).padStart(4, "0")}`;
        else out += char;
    }
    return out;
}

/** A double as `QString::number(value, 'g', 15)` writes it, for the values used here. */
function numberText(value: number): string {
    if (!Number.isFinite(value)) throw new Error(`Cannot write ${value}.`);
    if (Number.isInteger(value)) return String(value);
    const text = String(Number(value.toPrecision(15)));
    if (text.includes("e")) throw new Error(`Exponent notation is not written: ${value}.`);
    return text;
}

const INDENT = "    ";

/**
 * Tiled's `JsonWriter::stringify` with auto-formatting on: 4-space indent, map keys in
 * `QVariantMap` order, arrays wrapped every `wrap` items (0: never).
 */
function stringify(value: Json, depth: number, wrap: number): string {
    const indent = INDENT.repeat(depth);
    if (Array.isArray(value)) {
        const items = value as readonly Json[];
        let out = "[";
        items.forEach((item, i) => {
            if (i !== 0) out += "," + (wrap && i % wrap === 0 ? "\n" + indent : " ");
            out += stringify(item, depth + 1, wrap);
        });
        return out + "]";
    }
    if (typeof value === "object") {
        const map = value as JsonObject;
        let out = depth !== 0 ? `\n${indent}{\n` : "{";
        Object.keys(map)
            .sort()
            .forEach((key, i) => {
                if (i !== 0) out += ",\n";
                out += `${indent} "${escape(key)}":${stringify(map[key]!, depth + 1, wrap)}`;
            });
        return out + `\n${indent}}`;
    }
    if (typeof value === "string") return `"${escape(value)}"`;
    if (typeof value === "boolean") return value ? "true" : "false";
    return numberText(value);
}

// --- Images -----------------------------------------------------------------------------------

type Rgba = readonly [number, number, number, number];

function rgb(hex: string, alpha = 255): Rgba {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    return [r!, g!, b!, alpha];
}

/** Each channel times `num / den`, rounded down. */
function shade(color: Rgba, num: number, den: number): Rgba {
    const [r, g, b, a] = color;
    return [
        Math.floor((r * num) / den),
        Math.floor((g * num) / den),
        Math.floor((b * num) / den),
        a,
    ];
}

const WHITE = rgb("#ffffff");
const MAGENTA = rgb("#ff00ff");

class Picture {
    // Plain fields: Node runs this script with type stripping, which has no parameter properties.
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8Array(width * height * 4);
    }

    set(x: number, y: number, color: Rgba): void {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
        this.data.set(color, (y * this.width + x) * 4);
    }

    rect(x: number, y: number, width: number, height: number, color: Rgba): void {
        for (let py = y; py < y + height; py++) {
            for (let px = x; px < x + width; px++) this.set(px, py, color);
        }
    }

    /** The ellipse inscribed in the rectangle, tested at pixel centres in integers. */
    ellipse(x: number, y: number, width: number, height: number, color: Rgba): void {
        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                const dx = 2 * px + 1 - width;
                const dy = 2 * py + 1 - height;
                if (
                    dx * dx * height * height + dy * dy * width * width <=
                    width * width * height * height
                ) {
                    this.set(x + px, y + py, color);
                }
            }
        }
    }

    /** A flat tile: the colour, its bottom row and right column a quarter darker. */
    tile(x: number, y: number, size: number, color: Rgba): void {
        this.rect(x, y, size, size, color);
        const edge = shade(color, 3, 4);
        this.rect(x, y + size - 1, size, 1, edge);
        this.rect(x + size - 1, y, 1, size, edge);
    }

    png(): Uint8Array {
        return encode({
            width: this.width,
            height: this.height,
            data: this.data,
            depth: 8,
            channels: 4,
        });
    }
}

// --- The shared tileset `tiles.png` -------------------------------------------------------------

/** Tiles 0–23 of `tiles.png`: one flat colour each. */
const MATERIALS = [
    ["grass", "#5a9e3a"],
    ["dirt", "#8a5a2b"],
    ["stone", "#8c8c8c"],
    ["water", "#3a6ea5"],
    ["sand", "#e2c275"],
    ["wall", "#4a4458"],
    ["floor", "#b8a888"],
    ["lava", "#d8501e"],
    ["wood", "#a0703c"],
    ["forest", "#2f6b2a"],
    ["snow", "#eef2f6"],
    ["brick", "#9c3b2e"],
    ["torch-a", "#f0c040"],
    ["torch-b", "#f08020"],
    ["cloud", "#f4f4ff"],
    ["road", "#c8b088"],
    ["deep-water", "#24497a"],
    ["mountain", "#6e6258"],
    ["door", "#7a4a1c"],
    ["chest", "#c09030"],
    ["pillar", "#9a96a8"],
    ["slope", "#7c7488"],
    ["bush", "#3f8a32"],
    ["coin", "#ffd700"],
] as const;

type Material = (typeof MATERIALS)[number][0];

/** Local tile ID of a material in `tiles.png`. */
const T = Object.fromEntries(MATERIALS.map(([name], id) => [name, id])) as Record<Material, number>;

/** Tiles 24–31 of `tiles.png`: arrow tiles, each in its own colour with a white mark. */
const ARROW_COLORS = [
    "#c0392b",
    "#d35400",
    "#b7950b",
    "#1e8449",
    "#117a65",
    "#1f618d",
    "#6c3483",
    "#7b7d7d",
];
const ARROW = 24;

/** The arrow mark: a 5 × 5 square in the top-left corner and a bar along the top edge. */
function arrowMark(px: number, py: number): boolean {
    return (px < 5 && py < 5) || (py < 2 && px < 12);
}

function tilesPng(): Uint8Array {
    const picture = new Picture(8 * TILE, 4 * TILE);
    MATERIALS.forEach(([name, hex], id) => {
        const x = (id % 8) * TILE;
        const y = Math.floor(id / 8) * TILE;
        // Clouds are translucent, so the parallax layer of the overworld shows through.
        picture.tile(x, y, TILE, name === "cloud" ? rgb(hex, 176) : rgb(hex));
    });
    ARROW_COLORS.forEach((hex, i) => {
        const id = ARROW + i;
        const x = (id % 8) * TILE;
        const y = Math.floor(id / 8) * TILE;
        picture.rect(x, y, TILE, TILE, rgb(hex));
        for (let py = 0; py < TILE; py++) {
            for (let px = 0; px < TILE; px++)
                if (arrowMark(px, py)) picture.set(x + px, y + py, WHITE);
        }
    });
    return picture.png();
}

const TILES_TSJ = "tiles.tsj";

/** The fields of the `tiles.png` tileset, for `tiles.tsj` and for embedded copies. */
function tilesFields(name: string): JsonObject {
    return {
        columns: 8,
        image: "tiles.png",
        imageheight: 4 * TILE,
        imagewidth: 8 * TILE,
        margin: 0,
        name,
        spacing: 0,
        tilecount: 32,
        tileheight: TILE,
        tilewidth: TILE,
    };
}

/** An external tileset file (`.tsj`) as Tiled writes it. */
function tilesetFile(fields: JsonObject): string {
    return stringify(
        { ...fields, tiledversion: TILED_VERSION, type: "tileset", version: FORMAT_VERSION },
        0,
        0,
    );
}

// --- Other images -----------------------------------------------------------------------------

/** `iso.png`: four 32 × 32 tiles, each a 32 × 16 diamond in its bottom half. */
function isoPng(): Uint8Array {
    const colors = [T.grass, T.dirt, T.water, T.stone].map((id) => rgb(MATERIALS[id]![1]));
    const picture = new Picture(128, 32);
    colors.forEach((color, i) => {
        for (let py = 16; py < 32; py++) {
            for (let px = 0; px < 32; px++) {
                // |2px + 1 - 32| / 32 + |2py + 1 - 48| / 16 <= 1, in integers.
                if (Math.abs(2 * px + 1 - 32) + 2 * Math.abs(2 * py + 1 - 48) <= 32) {
                    picture.set(i * 32 + px, py, color);
                }
            }
        }
    });
    return picture.png();
}

/** `keyed.png`: four 16 × 16 tiles, a coloured disc on magenta (the colour key). */
function keyedPng(): Uint8Array {
    const picture = new Picture(64, 16);
    picture.rect(0, 0, 64, 16, MAGENTA);
    [T.grass, T.water, T.lava, T.coin].forEach((id, i) => {
        picture.ellipse(i * 16 + 2, 2, 12, 12, rgb(MATERIALS[id]![1]));
    });
    return picture.png();
}

/** `big.png`: two 32 × 32 tiles in 4-pixel checks with a white border. */
function bigPng(): Uint8Array {
    const picture = new Picture(64, 32);
    const pairs = [
        [T.grass, T.forest],
        [T.water, T["deep-water"]],
    ] as const;
    pairs.forEach(([a, b], i) => {
        for (let py = 0; py < 32; py++) {
            for (let px = 0; px < 32; px++) {
                const check = ((px >> 2) + (py >> 2)) % 2 === 0 ? a : b;
                picture.set(i * 32 + px, py, rgb(MATERIALS[check]![1]));
            }
        }
        picture.rect(i * 32, 0, 32, 1, WHITE);
        picture.rect(i * 32, 31, 32, 1, WHITE);
        picture.rect(i * 32, 0, 1, 32, WHITE);
        picture.rect(i * 32 + 31, 0, 1, 32, WHITE);
    });
    return picture.png();
}

/** `images/backdrop.png`: 160 × 128, a vertical gradient with magenta holes. */
function backdropPng(): Uint8Array {
    const picture = new Picture(160, 128);
    for (let y = 0; y < 128; y++) {
        const t = y;
        picture.rect(0, y, 160, 1, [40 + t, 80 + Math.floor(t / 2), 160 - Math.floor(t / 2), 255]);
    }
    picture.rect(16, 16, 48, 32, MAGENTA);
    picture.ellipse(96, 56, 48, 48, MAGENTA);
    return picture.png();
}

/** `images/sky.png`: 64 × 640, a vertical gradient from deep blue to pale blue. */
function skyPng(): Uint8Array {
    const picture = new Picture(64, 640);
    for (let y = 0; y < 640; y++) {
        const t = Math.floor((y * 128) / 640);
        picture.rect(0, y, 64, 1, [40 + t, 90 + t, 170 + Math.floor(t / 2), 255]);
    }
    return picture.png();
}

interface Prop {
    readonly file: string;
    readonly width: number;
    readonly height: number;
    draw(picture: Picture): void;
}

const UNIFORM_PROPS: readonly Prop[] = [
    {
        file: "images/crate.png",
        width: 16,
        height: 16,
        draw: (p) => {
            p.rect(0, 0, 16, 16, rgb(MATERIALS[T.wood][1]));
            for (let i = 0; i < 16; i++) {
                p.set(i, i, shade(rgb(MATERIALS[T.wood][1]), 1, 2));
                p.set(15 - i, i, shade(rgb(MATERIALS[T.wood][1]), 1, 2));
            }
        },
    },
    {
        file: "images/barrel.png",
        width: 16,
        height: 16,
        draw: (p) => {
            p.ellipse(1, 0, 14, 16, rgb(MATERIALS[T.dirt][1]));
            p.rect(1, 4, 14, 1, rgb(MATERIALS[T.stone][1]));
            p.rect(1, 11, 14, 1, rgb(MATERIALS[T.stone][1]));
        },
    },
    {
        file: "images/bush.png",
        width: 16,
        height: 16,
        draw: (p) => p.ellipse(0, 2, 16, 14, rgb(MATERIALS[T.bush][1])),
    },
];

function treeDraw(width: number, height: number) {
    return (p: Picture) => {
        const trunk = Math.max(2, width >> 3);
        p.rect(
            (width - trunk) >> 1,
            height - (height >> 2),
            trunk,
            height >> 2,
            rgb(MATERIALS[T.wood][1]),
        );
        p.ellipse(0, 0, width, height - (height >> 3), rgb(MATERIALS[T.forest][1]));
    };
}

const MIXED_PROPS: readonly Prop[] = [
    { file: "images/tree-small.png", width: 16, height: 16, draw: treeDraw(16, 16) },
    { file: "images/tree-tall.png", width: 16, height: 32, draw: treeDraw(16, 32) },
    { file: "images/tree-wide.png", width: 32, height: 32, draw: treeDraw(32, 32) },
];

function propPng(prop: Prop): Uint8Array {
    const picture = new Picture(prop.width, prop.height);
    prop.draw(picture);
    return picture.png();
}

/** An image-collection tileset as Tiled writes it: every tile listed with its image. */
function collectionFields(name: string, props: readonly Prop[]): JsonObject {
    return {
        columns: 0,
        grid: { height: 1, orientation: "orthogonal", width: 1 },
        margin: 0,
        name,
        spacing: 0,
        tilecount: props.length,
        tileheight: Math.max(...props.map((prop) => prop.height)),
        tiles: props.map((prop, id) => ({
            id,
            image: prop.file,
            imageheight: prop.height,
            imagewidth: prop.width,
        })),
        tilewidth: Math.max(...props.map((prop) => prop.width)),
    };
}

// --- Layer data -------------------------------------------------------------------------------

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;
const ROTATE_120 = 0x10000000;

type Encoding = "csv" | "base64" | "zlib" | "gzip" | "zstd";

function gidBytes(gids: readonly number[]): Uint8Array {
    const bytes = new Uint8Array(gids.length * 4);
    const view = new DataView(bytes.buffer);
    gids.forEach((gid, i) => view.setUint32(i * 4, gid >>> 0, true));
    return bytes;
}

/**
 * A Zstandard frame of raw (stored) blocks: magic, a frame header with Single_Segment set and
 * a 4-byte content size, then blocks of at most 128 KiB, the last flagged. Every zstd decoder
 * reads it, and it needs no encoder.
 */
export function zstdRawFrame(bytes: Uint8Array): Uint8Array {
    const MAX_BLOCK = 128 * 1024;
    const out: number[] = [0x28, 0xb5, 0x2f, 0xfd, 0xa0];
    const size = bytes.length;
    out.push(size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff);
    let offset = 0;
    do {
        const length = Math.min(MAX_BLOCK, size - offset);
        const last = offset + length >= size ? 1 : 0;
        const header = last | (length << 3);
        out.push(header & 0xff, (header >>> 8) & 0xff, (header >>> 16) & 0xff);
        for (let i = 0; i < length; i++) out.push(bytes[offset + i]!);
        offset += length;
    } while (offset < size);
    return Uint8Array.from(out);
}

function base64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64");
}

/** The `data` value of a layer or chunk, and the layer keys its encoding adds. */
function encodeData(gids: readonly number[], encoding: Encoding): { data: Json; keys: JsonObject } {
    if (encoding === "csv") return { data: [...gids], keys: {} };
    const raw = gidBytes(gids);
    const packed =
        encoding === "zlib"
            ? zlibSync(raw)
            : encoding === "gzip"
              ? // mtime 0 leaves the header's time field zero, so the bytes never change.
                gzipSync(raw, { mtime: 0 })
              : encoding === "zstd"
                ? zstdRawFrame(raw)
                : raw;
    return {
        data: base64(packed),
        keys: { compression: encoding === "base64" ? "" : encoding, encoding: "base64" },
    };
}

/** GIDs from rows of characters; a space is an empty cell. */
function cells(rows: readonly string[], legend: Readonly<Record<string, number>>): number[] {
    const width = rows[0]!.length;
    const gids: number[] = [];
    for (const row of rows) {
        if (row.length !== width) throw new Error(`Row "${row}" is not ${width} wide.`);
        for (const char of row) {
            if (char === " ") gids.push(0);
            else if (legend[char] === undefined) throw new Error(`No tile for "${char}".`);
            else gids.push(legend[char]);
        }
    }
    return gids;
}

/** GID of a `tiles.png` tile in a map where its tileset has firstgid 1. */
const gid = (id: number) => id + 1;

// --- Layers and objects -------------------------------------------------------------------------

interface LayerOptions {
    readonly extra?: JsonObject;
    readonly properties?: readonly Json[];
}

function layerBase(id: number, name: string, type: string, options: LayerOptions): JsonObject {
    return {
        id,
        name,
        opacity: 1,
        type,
        visible: true,
        x: 0,
        y: 0,
        ...(options.properties ? { properties: options.properties } : {}),
        ...options.extra,
    };
}

function tileLayer(
    id: number,
    name: string,
    width: number,
    height: number,
    gids: readonly number[],
    encoding: Encoding = "csv",
    options: LayerOptions = {},
): JsonObject {
    if (gids.length !== width * height) throw new Error(`${name}: ${gids.length} cells.`);
    const { data, keys } = encodeData(gids, encoding);
    return { ...layerBase(id, name, "tilelayer", options), data, height, width, ...keys };
}

interface Chunk {
    readonly x: number;
    readonly y: number;
    readonly gids: readonly number[];
}

/** A tile layer of an infinite map: 16 × 16 chunks, bounds the union of the chunks. */
function chunkLayer(id: number, name: string, chunks: readonly Chunk[]): JsonObject {
    const left = Math.min(...chunks.map((c) => c.x));
    const top = Math.min(...chunks.map((c) => c.y));
    const right = Math.max(...chunks.map((c) => c.x + 16));
    const bottom = Math.max(...chunks.map((c) => c.y + 16));
    const sorted = [...chunks].sort((a, b) => a.y - b.y || a.x - b.x);
    return {
        ...layerBase(id, name, "tilelayer", {}),
        chunks: sorted.map((chunk) => {
            if (chunk.gids.length !== 256) throw new Error(`${name}: chunk is not 16 × 16.`);
            return { data: [...chunk.gids], height: 16, width: 16, x: chunk.x, y: chunk.y };
        }),
        height: bottom - top,
        startx: left,
        starty: top,
        width: right - left,
    };
}

function objectGroup(
    id: number,
    name: string,
    objects: readonly Json[],
    options: LayerOptions = {},
): JsonObject {
    return { ...layerBase(id, name, "objectgroup", options), draworder: "topdown", objects };
}

function imageLayer(
    id: number,
    name: string,
    image: string,
    size: readonly [number, number],
    options: LayerOptions = {},
): JsonObject {
    return {
        ...layerBase(id, name, "imagelayer", options),
        image,
        imageheight: size[1],
        imagewidth: size[0],
    };
}

function groupLayer(
    id: number,
    name: string,
    layers: readonly Json[],
    options: LayerOptions = {},
): JsonObject {
    return { ...layerBase(id, name, "group", options), layers };
}

interface ObjectOptions {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly name?: string;
    readonly type?: string;
    readonly width?: number;
    readonly height?: number;
    readonly rotation?: number;
    readonly visible?: boolean;
    readonly properties?: readonly Json[];
    readonly shape?: JsonObject;
}

/** A map object that is not a template instance: Tiled writes every field. */
function object(options: ObjectOptions): JsonObject {
    return {
        height: options.height ?? 0,
        id: options.id,
        name: options.name ?? "",
        opacity: 1,
        rotation: options.rotation ?? 0,
        type: options.type ?? "",
        visible: options.visible ?? true,
        width: options.width ?? 0,
        x: options.x,
        y: options.y,
        ...(options.properties ? { properties: options.properties } : {}),
        ...options.shape,
    };
}

const points = (...xy: number[]): Json[] => {
    const list: Json[] = [];
    for (let i = 0; i < xy.length; i += 2) list.push({ x: xy[i]!, y: xy[i + 1]! });
    return list;
};

function prop(name: string, type: string, value: Json, propertytype?: string): JsonObject {
    return { name, type, value, ...(propertytype ? { propertytype } : {}) };
}

// --- Maps -------------------------------------------------------------------------------------

interface MapOptions {
    readonly width: number;
    readonly height: number;
    readonly layers: readonly JsonObject[];
    readonly tilesets: readonly Json[];
    readonly tilewidth?: number;
    readonly tileheight?: number;
    readonly orientation?: string;
    readonly infinite?: boolean;
    readonly extra?: JsonObject;
}

function maxIds(layers: readonly Json[]): { layer: number; object: number } {
    let layer = 0;
    let objectId = 0;
    for (const value of layers) {
        const entry = value as JsonObject;
        layer = Math.max(layer, entry["id"] as number);
        if (entry["objects"]) {
            for (const o of entry["objects"] as readonly JsonObject[]) {
                objectId = Math.max(objectId, o["id"] as number);
            }
        }
        if (entry["layers"]) {
            const inner = maxIds(entry["layers"] as readonly Json[]);
            layer = Math.max(layer, inner.layer);
            objectId = Math.max(objectId, inner.object);
        }
    }
    return { layer, object: objectId };
}

/** A map file as Tiled writes it; arrays wrap at the map width (chunk width when infinite). */
function mapFile(options: MapOptions): string {
    const ids = maxIds(options.layers);
    const infinite = options.infinite ?? false;
    return stringify(
        {
            compressionlevel: -1,
            height: options.height,
            infinite,
            layers: options.layers,
            nextlayerid: ids.layer + 1,
            nextobjectid: ids.object + 1,
            orientation: options.orientation ?? "orthogonal",
            renderorder: "right-down",
            tiledversion: TILED_VERSION,
            tileheight: options.tileheight ?? TILE,
            tilesets: options.tilesets,
            tilewidth: options.tilewidth ?? TILE,
            type: "map",
            version: FORMAT_VERSION,
            width: options.width,
            ...options.extra,
        },
        0,
        infinite ? 16 : options.width,
    );
}

const externalTiles = (firstgid = 1, source = TILES_TSJ): JsonObject => ({ firstgid, source });

// --- Fixture: encodings ---------------------------------------------------------------------------

const ENCODING_ROWS = [
    "SSSSSSSSSS",
    "S>gggggggS",
    "SggsssgggS",
    "SgswwwsggS",
    "SgswwwsggS",
    "SggsssgggS",
    "SgggggggfS",
    "SSSSSSSSSS",
];

const ENCODING_LEGEND = {
    S: gid(T.stone),
    g: gid(T.grass),
    s: gid(T.sand),
    w: gid(T.water),
    f: gid(T.forest),
    // The arrow tile flipped horizontally: the flag bits survive every encoding.
    ">": (gid(ARROW) | FLIP_H) >>> 0,
};

/** The GIDs every encoding fixture holds, row by row (exported for the TE-058 tests). */
export const ENCODING_GIDS: readonly number[] = cells(ENCODING_ROWS, ENCODING_LEGEND);

function encodingMap(encoding: Encoding): string {
    return mapFile({
        width: 10,
        height: 8,
        tilesets: [externalTiles()],
        layers: [tileLayer(1, "Ground", 10, 8, ENCODING_GIDS, encoding)],
    });
}

// --- Fixture: flips -------------------------------------------------------------------------

/** The eight flag combinations in the order of `flips.tmj`'s columns. */
export const FLIP_COMBINATIONS: readonly number[] = [
    0,
    FLIP_H,
    FLIP_V,
    FLIP_H | FLIP_V,
    FLIP_D,
    FLIP_D | FLIP_H,
    FLIP_D | FLIP_V,
    FLIP_D | FLIP_H | FLIP_V,
].map((flags) => flags >>> 0);

function flipsMap(): string {
    const row = FLIP_COMBINATIONS.map((flags) => (gid(ARROW) | flags) >>> 0);
    const withBit28 = row.map((value) => (value | ROTATE_120) >>> 0);
    return mapFile({
        width: 8,
        height: 2,
        tilesets: [externalTiles()],
        layers: [tileLayer(1, "Flips", 8, 2, [...row, ...withBit28])],
    });
}

// --- Fixture: orientations -----------------------------------------------------------------------

function isometricMap(): string {
    const gids: number[] = [];
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const edge = x === 0 || y === 0 || x === 7 || y === 7;
            const pond = x >= 3 && x <= 4 && y >= 3 && y <= 4;
            gids.push(1 + (edge ? 3 : pond ? 2 : (x + y) % 2));
        }
    }
    return mapFile({
        width: 8,
        height: 8,
        tilewidth: 32,
        tileheight: 16,
        orientation: "isometric",
        tilesets: [
            {
                columns: 4,
                firstgid: 1,
                image: "iso.png",
                imageheight: 32,
                imagewidth: 128,
                margin: 0,
                name: "iso",
                spacing: 0,
                tilecount: 4,
                tileheight: 32,
                tilewidth: 32,
            },
        ],
        layers: [tileLayer(1, "Ground", 8, 8, gids)],
    });
}

function hexagonalMap(): string {
    const gids: number[] = [];
    for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 8; x++) gids.push(gid([T.grass, T.sand, T.water][(x + 2 * y) % 3]!));
    }
    return mapFile({
        width: 8,
        height: 6,
        orientation: "hexagonal",
        tilesets: [externalTiles()],
        layers: [tileLayer(1, "Ground", 8, 6, gids)],
        extra: { hexsidelength: 8, staggeraxis: "y", staggerindex: "odd" },
    });
}

// --- Fixture: infinite ------------------------------------------------------------------------

/** A 16 × 16 chunk with the tile on the cells the predicate picks. */
function chunk(
    x: number,
    y: number,
    tile: number,
    pick: (cx: number, cy: number) => boolean,
): Chunk {
    const gids: number[] = [];
    for (let cy = 0; cy < 16; cy++) {
        for (let cx = 0; cx < 16; cx++) gids.push(pick(cx, cy) ? gid(tile) : 0);
    }
    return { x, y, gids };
}

function infiniteMap(): string {
    return mapFile({
        width: 30,
        height: 20,
        infinite: true,
        tilesets: [externalTiles()],
        layers: [
            chunkLayer(1, "Ground", [
                chunk(-16, -16, T.grass, (cx, cy) => cx >= 12 && cy >= 12),
                chunk(0, 0, T.grass, (cx, cy) => cx < 8 && cy < 8),
            ]),
            chunkLayer(2, "Overlay", [chunk(32, 16, T.stone, (cx, cy) => cx === 4 && cy === 4)]),
            objectGroup(3, "Markers", [
                object({ id: 1, name: "Far corner", x: -200, y: -120, shape: { point: true } }),
                object({ id: 2, name: "Beyond", x: 520, y: 300, width: 32, height: 16 }),
            ]),
        ],
    });
}

// --- Fixture: tilesets -------------------------------------------------------------------------

const TILESET_ROWS = ["gggggg", "g>sssg", "gswwsg", "gggggf"];
const TILESET_LEGEND = {
    g: gid(T.grass),
    s: gid(T.sand),
    w: gid(T.water),
    f: gid(T.forest),
    ">": gid(ARROW),
};

function embeddedTilesetMap(): string {
    return mapFile({
        width: 6,
        height: 4,
        tilesets: [{ ...tilesFields("tiles-embedded"), firstgid: 1 }],
        layers: [tileLayer(1, "Ground", 6, 4, cells(TILESET_ROWS, TILESET_LEGEND))],
    });
}

function externalTilesetMap(source: string): string {
    return mapFile({
        width: 6,
        height: 4,
        tilesets: [externalTiles(1, source)],
        layers: [tileLayer(1, "Ground", 6, 4, cells(TILESET_ROWS, TILESET_LEGEND))],
    });
}

/** `tiles-xml.tsx`: the `tiles.png` tileset in Tiled's XML, with a class and a property on tile 5. */
function tilesXml(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<tileset version="${FORMAT_VERSION}" tiledversion="${TILED_VERSION}" name="tiles-xml" tilewidth="16" tileheight="16" tilecount="32" columns="8">`,
        ' <image source="tiles.png" width="128" height="64"/>',
        ` <tile id="${T.wall}" type="Wall">`,
        "  <properties>",
        '   <property name="solid" type="bool" value="true"/>',
        "  </properties>",
        " </tile>",
        "</tileset>",
        "",
    ].join("\n");
}

const PROPS_TSJ = "props.tsj";

function collectionUniformMap(): string {
    const gids = cells(["ggggggg", "g1g2g3g", "ggggggg", "g3g1g2g"], {
        g: 0,
        "1": 1,
        "2": 2,
        "3": 3,
    });
    return mapFile({
        width: 7,
        height: 4,
        tilesets: [{ firstgid: 1, source: PROPS_TSJ }, externalTiles(4)],
        layers: [
            tileLayer(1, "Ground", 7, 4, new Array<number>(28).fill(3 + gid(T.grass))),
            tileLayer(2, "Props", 7, 4, gids),
        ],
    });
}

function collectionMixedMap(): string {
    const ground = new Array<number>(32).fill(3 + gid(T.grass));
    const trees = cells(["        ", "  1     ", "     2  ", " 3    1 "], {
        "1": 1,
        "2": 2,
        "3": 3,
    });
    return mapFile({
        width: 8,
        height: 4,
        tilesets: [{ ...collectionFields("trees", MIXED_PROPS), firstgid: 1 }, externalTiles(4)],
        layers: [tileLayer(1, "Ground", 8, 4, ground), tileLayer(2, "Trees", 8, 4, trees)],
    });
}

// --- Fixture: objects ---------------------------------------------------------------------------

const MEADOW = (width: number, height: number) =>
    tileLayer(1, "Ground", width, height, new Array<number>(width * height).fill(gid(T.grass)));

function objectsShapesMap(): string {
    return mapFile({
        width: 12,
        height: 8,
        tilesets: [externalTiles()],
        layers: [
            MEADOW(12, 8),
            objectGroup(
                2,
                "Markers",
                [
                    object({
                        id: 1,
                        name: "Spawn area",
                        type: "Zone",
                        x: 16,
                        y: 16,
                        width: 48,
                        height: 32,
                        properties: [prop("team", "string", "red")],
                    }),
                    object({ id: 2, name: "Start", x: 96, y: 24, shape: { point: true } }),
                    object({
                        id: 3,
                        name: "Pond",
                        x: 120,
                        y: 16,
                        width: 48,
                        height: 32,
                        shape: { ellipse: true },
                    }),
                    object({
                        id: 4,
                        name: "Rock",
                        x: 24,
                        y: 80,
                        shape: { polygon: points(0, 0, 32, 8, 16, 32) },
                    }),
                    object({
                        id: 5,
                        name: "Path",
                        x: 80,
                        y: 72,
                        shape: { polyline: points(0, 0, 24, 16, 56, 8, 88, 32) },
                    }),
                    object({
                        id: 6,
                        name: "Secret",
                        x: 150,
                        y: 90,
                        width: 24,
                        height: 16,
                        visible: false,
                    }),
                ],
                { extra: { color: "#ff8000" } },
            ),
        ],
    });
}

function objectsRotatedMap(): string {
    return mapFile({
        width: 12,
        height: 8,
        tilesets: [externalTiles()],
        layers: [
            MEADOW(12, 8),
            objectGroup(2, "Markers", [
                object({
                    id: 1,
                    name: "Tilted box",
                    x: 32,
                    y: 24,
                    width: 48,
                    height: 24,
                    rotation: 30,
                }),
                object({
                    id: 2,
                    name: "Tilted oval",
                    x: 120,
                    y: 24,
                    width: 40,
                    height: 20,
                    rotation: 45,
                    shape: { ellipse: true },
                }),
                object({
                    id: 3,
                    name: "Turned wedge",
                    x: 80,
                    y: 80,
                    rotation: 90,
                    shape: { polygon: points(0, 0, 32, 0, 0, 24) },
                }),
            ]),
        ],
    });
}

function objectsDroppedMap(): string {
    return mapFile({
        width: 12,
        height: 8,
        tilesets: [externalTiles()],
        layers: [
            MEADOW(12, 8),
            objectGroup(2, "Things", [
                object({
                    id: 1,
                    name: "Chest",
                    x: 32,
                    y: 48,
                    width: 16,
                    height: 16,
                    shape: { gid: gid(T.chest) },
                }),
                object({
                    id: 2,
                    name: "Flipped arrow",
                    x: 56,
                    y: 48,
                    width: 16,
                    height: 16,
                    shape: { gid: (gid(ARROW) | FLIP_H) >>> 0 },
                }),
                object({
                    id: 3,
                    name: "Sign",
                    x: 88,
                    y: 16,
                    width: 96,
                    height: 32,
                    shape: { text: { text: "Hello, Tiled", wrap: true } },
                }),
                object({
                    id: 4,
                    name: "Pill",
                    x: 40,
                    y: 80,
                    width: 64,
                    height: 24,
                    shape: { capsule: true },
                }),
            ]),
        ],
    });
}

// --- Fixture: templates -------------------------------------------------------------------------

/** A template's object: a template base has no ID and no position. */
function templateObject(options: Omit<ObjectOptions, "id" | "x" | "y">): JsonObject {
    return {
        height: options.height ?? 0,
        name: options.name ?? "",
        opacity: 1,
        rotation: options.rotation ?? 0,
        type: options.type ?? "",
        visible: true,
        width: options.width ?? 0,
        ...(options.properties ? { properties: options.properties } : {}),
        ...options.shape,
    };
}

function doorTemplate(): string {
    return stringify(
        {
            object: templateObject({
                name: "Door",
                type: "Door",
                width: 16,
                height: 32,
                properties: [prop("locked", "bool", false)],
            }),
            type: "template",
        },
        0,
        0,
    );
}

function coinTemplate(): string {
    return stringify(
        {
            object: templateObject({
                name: "Coin",
                width: 16,
                height: 16,
                shape: { gid: gid(T.coin) },
            }),
            tileset: { firstgid: 1, source: `../${TILES_TSJ}` },
            type: "template",
        },
        0,
        0,
    );
}

function zoneTemplate(): string {
    return stringify(
        {
            object: templateObject({
                name: "Zone",
                type: "Zone",
                shape: { polygon: points(0, 0, 32, 0, 40, 24, 0, 24) },
            }),
            type: "template",
        },
        0,
        0,
    );
}

function templatesMap(): string {
    return mapFile({
        width: 12,
        height: 8,
        tilesets: [externalTiles()],
        layers: [
            MEADOW(12, 8),
            objectGroup(2, "Instances", [
                { id: 1, template: "templates/door.tj", x: 32, y: 64 },
                {
                    id: 2,
                    name: "Vault door",
                    properties: [prop("locked", "bool", true)],
                    template: "templates/door.tj",
                    x: 96,
                    y: 64,
                },
                { id: 3, template: "templates/coin.tj", x: 64, y: 112 },
                { id: 4, template: "templates/zone.tj", x: 136, y: 72 },
            ]),
        ],
    });
}

// --- Fixture: properties and classes ------------------------------------------------------------

/** Every property type: the seven built-in ones, `object`, class, string and int enums, list. */
function everyProperty(): Json[] {
    return [
        prop("alive", "bool", true),
        prop("backdrop", "file", "images/backdrop.png"),
        prop("facing", "string", "east", "Facing"),
        prop("flags", "int", 5, "Layers"),
        prop("gravity", "float", 9.81),
        prop("lives", "int", 3),
        prop("route", "list", [
            { type: "int", value: 1 },
            { type: "string", value: "two" },
            { type: "bool", value: false },
        ]),
        prop("stats", "class", { hp: 12, speed: 1.5 }, "Stats"),
        prop("target", "object", 1),
        prop("tint", "color", "#80336699"),
        prop("title", "string", "Every property"),
    ];
}

function propertiesMap(): string {
    return mapFile({
        width: 8,
        height: 6,
        tilesets: [
            {
                ...tilesFields("typed"),
                class: "Palette",
                firstgid: 1,
                tiles: [
                    {
                        id: T.grass,
                        properties: [prop("walkable", "bool", true)],
                        type: "Grass",
                    },
                ],
            },
        ],
        layers: [
            tileLayer(1, "Ground", 8, 6, new Array<number>(48).fill(gid(T.grass)), "csv", {
                extra: { class: "Terrain" },
                properties: [prop("biome", "string", "meadow")],
            }),
            objectGroup(
                2,
                "Actors",
                [
                    object({
                        id: 1,
                        name: "Hero",
                        type: "Npc",
                        x: 32,
                        y: 32,
                        width: 16,
                        height: 16,
                        properties: [
                            prop("friend", "object", 2),
                            prop("stats", "class", { hp: 30 }, "Stats"),
                        ],
                    }),
                    object({
                        id: 2,
                        name: "Sidekick",
                        type: "Npc",
                        x: 80,
                        y: 48,
                        shape: { point: true },
                    }),
                ],
                { extra: { class: "Actors" } },
            ),
        ],
        extra: { class: "Level", properties: everyProperty() },
    });
}

/** `tmj.tiled-project`: the class and enum types the properties fixture uses. */
function projectFile(): string {
    const project = {
        automappingRulesFile: "",
        commands: [],
        compatibilityVersion: 1100,
        extensionsPath: "extensions",
        folders: ["."],
        properties: [],
        propertyTypes: [
            {
                id: 1,
                name: "Facing",
                storageType: "string",
                type: "enum",
                values: ["north", "east", "south", "west"],
                valuesAsFlags: false,
            },
            {
                id: 2,
                name: "Layers",
                storageType: "int",
                type: "enum",
                values: ["ground", "water", "air"],
                valuesAsFlags: true,
            },
            {
                color: "#ffa0a0a4",
                drawFill: true,
                id: 3,
                members: [
                    { name: "hp", type: "int", value: 10 },
                    { name: "speed", type: "float", value: 1 },
                ],
                name: "Stats",
                type: "class",
                useAs: ["property"],
            },
        ],
    };
    // Tiled writes the project with `QJsonDocument::Indented`, which re-saves it whenever the
    // project opens: like `JSON.stringify` at 4 spaces, except that an empty array spans two
    // lines, its `]` at the key's indent. Writing the same layout keeps a re-save from changing it.
    return JSON.stringify(project, null, 4).replace(/^( *)(.*)\[\](,?)$/gm, "$1$2[\n$1]$3") + "\n";
}

// --- Fixture: tint and blend mode ---------------------------------------------------------------

function tintBlendMap(): string {
    const fill = (id: number) => new Array<number>(80).fill(gid(id));
    const ring = cells(
        [
            "          ",
            " SSSSSSSS ",
            " S      S ",
            " S      S ",
            " S      S ",
            " S      S ",
            " SSSSSSSS ",
            "          ",
        ],
        { S: gid(T.stone) },
    );
    const pond = cells(
        [
            "          ",
            "          ",
            "   wwww   ",
            "   wwww   ",
            "   wwww   ",
            "   wwww   ",
            "          ",
            "          ",
        ],
        { w: gid(T.water) },
    );
    return mapFile({
        width: 10,
        height: 8,
        tilesets: [externalTiles()],
        layers: [
            tileLayer(1, "Base", 10, 8, fill(T.grass)),
            tileLayer(2, "Tinted", 10, 8, ring, "csv", { extra: { tintcolor: "#ff6060" } }),
            tileLayer(3, "Multiply", 10, 8, pond, "csv", { extra: { mode: "multiply" } }),
            tileLayer(4, "Screen", 10, 8, pond, "csv", {
                extra: { mode: "screen", offsetx: 32, offsety: 16, opacity: 0.5 },
            }),
        ],
    });
}

// --- Fixture: terrain ---------------------------------------------------------------------------

const TERRAIN_TSJ = "terrain.tsj";

function terrainTileset(): string {
    const all = (color: number) => [color, color, color, color, color, color, color, color];
    return tilesetFile({
        ...tilesFields("terrain"),
        tiles: [{ id: T.grass, probability: 0.25 }],
        transformations: { hflip: true, preferuntransformed: true, rotate: true, vflip: true },
        wangsets: [
            {
                colors: [
                    { color: "#5a9e3a", name: "Grass", probability: 1, tile: T.grass },
                    { color: "#8a5a2b", name: "Dirt", probability: 0.5, tile: T.dirt },
                ],
                name: "Ground",
                tile: T.grass,
                type: "corner",
                wangtiles: [
                    { tileid: T.grass, wangid: all(1).map((c, i) => (i % 2 ? c : 0)) },
                    { tileid: T.dirt, wangid: all(2).map((c, i) => (i % 2 ? c : 0)) },
                ],
            },
        ],
    });
}

function terrainMap(): string {
    const gids = cells(
        [
            "gggggggg",
            "ggddddgg",
            "gddddddg",
            "gddggddg",
            "gddggddg",
            "gddddddg",
            "ggddddgg",
            "gggggggg",
        ],
        {
            g: gid(T.grass),
            d: gid(T.dirt),
        },
    );
    return mapFile({
        width: 8,
        height: 8,
        tilesets: [externalTiles(1, TERRAIN_TSJ)],
        layers: [tileLayer(1, "Ground", 8, 8, gids)],
    });
}

// --- Fixture: transparent colour and tile render size --------------------------------------------

function transparentColorMap(): string {
    const gids = cells(["      ", " 1  2 ", "      ", " 3  4 ", "      "], {
        "1": 1,
        "2": 2,
        "3": 3,
        "4": 4,
    });
    return mapFile({
        width: 6,
        height: 5,
        tilesets: [
            {
                columns: 4,
                firstgid: 1,
                image: "keyed.png",
                imageheight: 16,
                imagewidth: 64,
                margin: 0,
                name: "keyed",
                spacing: 0,
                tilecount: 4,
                tileheight: 16,
                tilewidth: 16,
                transparentcolor: "#ff00ff",
            },
        ],
        layers: [
            {
                ...imageLayer(1, "Backdrop", "images/backdrop.png", [160, 128]),
                transparentcolor: "#ff00ff",
            },
            tileLayer(2, "Discs", 6, 5, gids),
        ],
        extra: { backgroundcolor: "#203040" },
    });
}

function tileRenderSizeMap(): string {
    const gids = cells(["12121212", "21212121", "12121212", "21212121", "12121212", "21212121"], {
        "1": 1,
        "2": 2,
    });
    return mapFile({
        width: 8,
        height: 6,
        tilesets: [
            {
                columns: 2,
                fillmode: "preserve-aspect-fit",
                firstgid: 1,
                image: "big.png",
                imageheight: 32,
                imagewidth: 64,
                margin: 0,
                name: "big",
                spacing: 0,
                tilecount: 2,
                tileheight: 32,
                tilerendersize: "grid",
                tilewidth: 32,
            },
        ],
        layers: [tileLayer(1, "Checks", 8, 6, gids)],
    });
}

// --- Composite: side-scroller -------------------------------------------------------------------

/** A hash of integers in [0, 2^32), the same on every machine. */
function hash(...values: number[]): number {
    let h = 0x9e3779b9;
    for (const value of values) {
        h = Math.imul(h ^ (value | 0), 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
    }
    return h >>> 0;
}

const SCROLLER_W = 1000;
const SCROLLER_H = 40;

/** Ground height of column x: linear between control points every 16 columns, rows 24–33. */
function groundTop(x: number): number {
    const at = (i: number) => 24 + (hash(1, i) % 10);
    const i = Math.floor(x / 16);
    const f = x % 16;
    return at(i) + Math.floor(((at(i + 1) - at(i)) * f) / 16);
}

/** A pit three columns wide every 97 columns, away from both ends. */
const isPit = (x: number) => x > 20 && x < SCROLLER_W - 20 && x % 97 >= 40 && x % 97 <= 42;

function sideScrollerMap(): string {
    const ground: number[] = [];
    const decor: number[] = [];
    for (let y = 0; y < SCROLLER_H; y++) {
        for (let x = 0; x < SCROLLER_W; x++) {
            const top = groundTop(x);
            let g = 0;
            if (isPit(x)) g = y >= 37 ? gid(T.water) : 0;
            else if (y === top) g = gid(T.grass);
            else if (y > top + 4) g = gid(T.stone);
            else if (y > top) g = gid(T.dirt);
            ground.push(g);

            let d = 0;
            const platform = x % 61 >= 30 && x % 61 <= 33 && x > 20 && x < SCROLLER_W - 20;
            if (platform && y === groundTop(x - (x % 61) + 30) - 5) d = gid(T.wood);
            else if (platform && y === groundTop(x - (x % 61) + 30) - 6) d = gid(T.coin);
            else if (!isPit(x) && y === top - 1 && hash(2, x) % 100 < 12) d = gid(T.bush);
            decor.push(d);
        }
    }
    const spawns: JsonObject[] = [
        object({
            id: 1,
            name: "Player",
            type: "Spawn",
            x: 32,
            y: groundTop(2) * TILE,
            shape: { point: true },
        }),
    ];
    for (let x = 80; x < SCROLLER_W - 20; x += 80) {
        const column = isPit(x) ? x + 4 : x;
        spawns.push(
            object({
                id: spawns.length + 1,
                name: `Enemy ${spawns.length}`,
                type: "Spawn",
                x: column * TILE,
                y: groundTop(column) * TILE,
                shape: { point: true },
                properties: [prop("kind", "string", (hash(3, x) & 1) === 0 ? "slime" : "bat")],
            }),
        );
    }
    spawns.push(
        object({
            id: spawns.length + 1,
            name: "Goal",
            type: "Goal",
            x: (SCROLLER_W - 8) * TILE,
            y: (groundTop(SCROLLER_W - 8) - 4) * TILE,
            width: 4 * TILE,
            height: 4 * TILE,
        }),
    );
    return mapFile({
        width: SCROLLER_W,
        height: SCROLLER_H,
        tilesets: [externalTiles()],
        layers: [
            imageLayer(1, "Sky", "images/sky.png", [64, 640], {
                extra: { parallaxx: 0.2, repeatx: true },
            }),
            tileLayer(2, "Ground", SCROLLER_W, SCROLLER_H, ground, "zlib"),
            tileLayer(3, "Decor", SCROLLER_W, SCROLLER_H, decor, "zlib"),
            objectGroup(4, "Spawns", spawns, { extra: { color: "#ff4040" } }),
        ],
    });
}

// --- Composite: overworld -----------------------------------------------------------------------

const WORLD = 256;

/** Value noise in [0, 255]: hashed corners every `cell` cells, bilinear in integers. */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const fx = x % cell;
    const fy = y % cell;
    const corner = (cx: number, cy: number) => hash(seed, cx, cy) & 0xff;
    const sum =
        corner(gx, gy) * (cell - fx) * (cell - fy) +
        corner(gx + 1, gy) * fx * (cell - fy) +
        corner(gx, gy + 1) * (cell - fx) * fy +
        corner(gx + 1, gy + 1) * fx * fy;
    return Math.floor(sum / (cell * cell));
}

function elevation(x: number, y: number): number {
    return Math.floor((3 * valueNoise(x, y, 32, 10) + valueNoise(x, y, 8, 11)) / 4);
}

const TOWNS = [
    ["Northwatch", 64, 40],
    ["Riverbend", 200, 72],
    ["Stonegate", 48, 180],
    ["Saltmarsh", 180, 210],
] as const;

function overworldMap(): string {
    const ground: number[] = [];
    const roads: number[] = [];
    const clouds: number[] = [];
    const isRoad = (x: number, y: number) =>
        (y === 128 && x >= 16 && x < WORLD - 16) || (x === 128 && y >= 16 && y < WORLD - 16);
    for (let y = 0; y < WORLD; y++) {
        for (let x = 0; x < WORLD; x++) {
            const e = elevation(x, y);
            const tile =
                e < 70
                    ? T["deep-water"]
                    : e < 100
                      ? T.water
                      : e < 110
                        ? T.sand
                        : e < 160
                          ? T.grass
                          : e < 190
                            ? T.forest
                            : e < 215
                              ? T.mountain
                              : T.snow;
            ground.push(gid(tile));
            roads.push(isRoad(x, y) && e >= 100 ? gid(T.road) : 0);
            clouds.push(valueNoise(x, y, 16, 12) > 190 ? gid(T.cloud) : 0);
        }
    }
    return mapFile({
        width: WORLD,
        height: WORLD,
        tilesets: [externalTiles()],
        layers: [
            groupLayer(1, "World", [
                tileLayer(2, "Ground", WORLD, WORLD, ground, "gzip"),
                tileLayer(3, "Roads", WORLD, WORLD, roads, "gzip"),
                objectGroup(
                    4,
                    "Towns",
                    TOWNS.map(([name, x, y], i) =>
                        object({
                            id: i + 1,
                            name,
                            type: "Town",
                            x: x * TILE,
                            y: y * TILE,
                            shape: { point: true },
                        }),
                    ),
                ),
            ]),
            groupLayer(
                5,
                "Sky",
                [
                    tileLayer(6, "Clouds", WORLD, WORLD, clouds, "gzip", {
                        extra: { offsetx: 8, offsety: 8 },
                    }),
                ],
                {
                    extra: { opacity: 0.7, parallaxx: 0.5, parallaxy: 0.5 },
                },
            ),
        ],
    });
}

// --- Composite: dungeon -------------------------------------------------------------------------

const DUNGEON_TSJ = "dungeon.tsj";

/** A tile collision shape in a tile's `objectgroup`, as Tiled writes it. */
function collision(objects: readonly Json[]): JsonObject {
    return {
        draworder: "index",
        name: "",
        objects,
        opacity: 1,
        type: "objectgroup",
        visible: true,
        x: 0,
        y: 0,
    };
}

function dungeonTileset(): string {
    return tilesetFile({
        ...tilesFields("dungeon"),
        tiles: [
            {
                id: T.wall,
                objectgroup: collision([object({ id: 1, x: 0, y: 0, width: 16, height: 16 })]),
                type: "Wall",
            },
            {
                animation: [
                    { duration: 200, tileid: T["torch-a"] },
                    { duration: 200, tileid: T["torch-b"] },
                ],
                id: T["torch-a"],
                objectgroup: collision([object({ id: 1, x: 4, y: 0, width: 8, height: 16 })]),
            },
            {
                id: T.pillar,
                objectgroup: collision([
                    object({ id: 1, x: 2, y: 2, width: 12, height: 12, shape: { ellipse: true } }),
                ]),
            },
            {
                id: T.slope,
                objectgroup: collision([
                    object({
                        id: 1,
                        x: 0,
                        y: 16,
                        shape: { polygon: points(0, 0, 16, 0, 16, -16) },
                    }),
                    object({ id: 2, name: "anchor", x: 8, y: 8, shape: { point: true } }),
                    object({
                        id: 3,
                        name: "edge",
                        x: 0,
                        y: 16,
                        shape: { polyline: points(0, 0, 16, -16) },
                    }),
                ]),
            },
        ],
    });
}

const DUNGEON_ROWS = [
    "########################",
    "#.......#......t#......#",
    "#..P....#.......#..C...#",
    "#.......D.......D......#",
    "#..P....#.......#......#",
    "#.......#..P.P..#......#",
    "####D####.......####D###",
    "#......./......\\.......#",
    "#......................#",
    "#..C...................#",
    "#.......####D####......#",
    "#.......#.......#......#",
    "#t......#...C...#.....t#",
    "#.......#.......#......#",
    "#.......#.......#......#",
    "########################",
];

function dungeonMap(): string {
    const rows = DUNGEON_ROWS;
    const floor = cells(
        rows.map((row) => row.replace(/[^#]/g, ".").replace(/#/g, " ")),
        { ".": gid(T.floor) },
    );
    const walls = cells(
        rows.map((row) => row.replace(/[.DC]/g, " ")),
        {
            "#": gid(T.wall),
            t: gid(T["torch-a"]),
            P: gid(T.pillar),
            "/": gid(T.slope),
            "\\": (gid(T.slope) | FLIP_H) >>> 0,
        },
    );
    const items = cells(
        rows.map((row) => row.replace(/[^DC]/g, " ")),
        { D: gid(T.door), C: gid(T.chest) },
    );
    const room = (id: number, name: string, x: number, y: number, w: number, h: number) =>
        object({
            id,
            name,
            type: "Room",
            x: x * TILE,
            y: y * TILE,
            width: w * TILE,
            height: h * TILE,
            properties: [prop("lit", "bool", id % 2 === 1)],
        });
    return mapFile({
        width: 24,
        height: 16,
        tilesets: [externalTiles(1, DUNGEON_TSJ)],
        layers: [
            tileLayer(1, "Floor", 24, 16, floor),
            tileLayer(2, "Walls", 24, 16, walls),
            tileLayer(3, "Items", 24, 16, items),
            objectGroup(
                4,
                "Markers",
                [
                    room(1, "Hall", 1, 1, 7, 5),
                    room(2, "Shrine", 9, 1, 7, 5),
                    room(3, "Armoury", 17, 1, 6, 5),
                    room(4, "Crypt", 9, 11, 7, 4),
                    object({
                        id: 5,
                        name: "Entry",
                        type: "Spawn",
                        x: 40,
                        y: 200,
                        shape: { point: true },
                    }),
                    object({
                        id: 6,
                        name: "Boss",
                        type: "Spawn",
                        x: 200,
                        y: 200,
                        shape: { point: true },
                    }),
                    object({
                        id: 7,
                        name: "Spikes",
                        type: "Trap",
                        x: 288,
                        y: 136,
                        shape: { polygon: points(0, 0, 48, 0, 64, 24, 16, 24) },
                        properties: [prop("damage", "int", 2)],
                    }),
                    object({
                        id: 8,
                        name: "Patrol",
                        type: "Path",
                        x: 24,
                        y: 152,
                        shape: { polyline: points(0, 0, 96, 0, 96, 24, 320, 24) },
                    }),
                    object({
                        id: 9,
                        name: "Glow",
                        type: "Light",
                        x: 168,
                        y: 72,
                        width: 48,
                        height: 32,
                        shape: { ellipse: true },
                    }),
                ],
                { extra: { color: "#ffaa00" } },
            ),
        ],
    });
}

// --- README ---------------------------------------------------------------------------------------

/** A README entry: one fixture map, what it covers and how it looks in Tiled. */
export interface FixtureEntry {
    readonly file: string;
    /** BRIEF §7 rows, by their Input text. */
    readonly brief: readonly string[];
    /** SPEC §13 coverage items. */
    readonly spec: readonly string[];
    /** Other files the map reads, or that open it as described. */
    readonly uses: readonly string[];
    readonly look: string;
}

const ENCODING_LOOK =
    "10 × 8 cells of 16 px. A grey stone border round a green meadow; a blue 3 × 2 pond ringed " +
    "with sand left of centre; a dark green forest tile at the bottom right; at cell (1,1) the " +
    "red arrow tile, its white mark in the top-right corner and its bar along the top (flipped " +
    "horizontally). All five encoding maps look the same.";

const ENTRIES: readonly FixtureEntry[] = [
    {
        file: "encoding-csv.tmj",
        brief: [],
        spec: ["csv data"],
        uses: [TILES_TSJ, "tiles.png"],
        look: ENCODING_LOOK,
    },
    {
        file: "encoding-base64.tmj",
        brief: [],
        spec: ["base64 uncompressed data"],
        uses: [TILES_TSJ, "tiles.png"],
        look: ENCODING_LOOK,
    },
    {
        file: "encoding-zlib.tmj",
        brief: [],
        spec: ["zlib data"],
        uses: [TILES_TSJ, "tiles.png"],
        look: ENCODING_LOOK,
    },
    {
        file: "encoding-gzip.tmj",
        brief: [],
        spec: ["gzip data"],
        uses: [TILES_TSJ, "tiles.png"],
        look: ENCODING_LOOK,
    },
    {
        file: "encoding-zstd.tmj",
        brief: ["`zstd` compression"],
        spec: ["zstd data"],
        uses: [TILES_TSJ, "tiles.png"],
        look: ENCODING_LOOK + " The editor refuses this map; Tiled opens it.",
    },
    {
        file: "flips.tmj",
        brief: ["GID flip bits"],
        spec: ["all 8 flip combinations", "bit 28 set"],
        uses: [TILES_TSJ, "tiles.png"],
        look:
            "8 × 2 cells, every one the red arrow tile: a white 5 × 5 mark in a corner and a white " +
            "bar from it along one edge. Columns 1–8 show: mark top-left, bar along the top " +
            "(unflipped); top-right, top (H); bottom-left, bottom (V); bottom-right, bottom (H+V); " +
            "top-left, left edge (anti-diagonal); top-right, right edge (anti-diagonal+H, 90° " +
            "clockwise); bottom-left, left edge (anti-diagonal+V, 90° anticlockwise); " +
            "bottom-right, right edge (all three). Row 2 has bit 28 set as well and looks exactly " +
            "like row 1: Tiled ignores the bit on orthogonal maps.",
    },
    {
        file: "isometric.tmj",
        brief: ["Non-orthogonal map"],
        spec: ["isometric map"],
        uses: ["iso.png"],
        look:
            "An 8 × 8 isometric diamond of 32 × 16 cells: a grey stone rim, a green and brown " +
            "checkerboard inside and a 2 × 2 blue pond in the middle. The editor refuses this map; " +
            "Tiled opens it.",
    },
    {
        file: "hexagonal.tmj",
        brief: ["Non-orthogonal map"],
        spec: ["hexagonal map"],
        uses: [TILES_TSJ, "tiles.png"],
        look:
            "An 8 × 6 hexagonal map (stagger axis y, odd rows shifted right by half a cell, side " +
            "length 8): square green, sand and blue tiles in diagonal stripes, rows overlapping " +
            "by 4 px. The editor refuses this map; Tiled opens it.",
    },
    {
        file: "infinite.tmj",
        brief: ["Infinite map"],
        spec: ["infinite map"],
        uses: [TILES_TSJ, "tiles.png"],
        look:
            "An infinite map. Layer Ground: a 4 × 4 green block at cells (-4,-4)–(-1,-1) and an " +
            "8 × 8 green block at (0,0)–(7,7), touching corner to corner. Layer Overlay: one " +
            "stone tile at (36,20). Layer Markers: a point Far corner at pixel (-200,-120) and a " +
            "32 × 16 rectangle Beyond at (520,300).",
    },
    {
        file: "tileset-embedded.tmj",
        brief: [],
        spec: ["image tileset", "embedded tileset"],
        uses: ["tiles.png"],
        look:
            "6 × 4 cells: a green meadow with a 2 × 1 pond edged with sand, a forest tile " +
            "at the bottom right and the unflipped red arrow at (1,1). Its tileset tiles-embedded " +
            "is stored in the map.",
    },
    {
        file: "tileset-tsj.tmj",
        brief: [],
        spec: ["image tileset", "`.tsj` tileset"],
        uses: [TILES_TSJ, "tiles.png"],
        look: "As tileset-embedded.tmj, with its tileset read from tiles.tsj.",
    },
    {
        file: "tileset-tsx.tmj",
        brief: [],
        spec: ["image tileset", "`.tsx` tileset"],
        uses: ["tiles-xml.tsx", "tiles.png"],
        look:
            "As tileset-embedded.tmj, with its tileset read from tiles-xml.tsx; in the tileset, " +
            "tile 5 (dark wall) has class Wall and a bool property solid = true.",
    },
    {
        file: "collection-uniform.tmj",
        brief: ["Image-collection tileset, uniform tile size"],
        spec: ["image-collection tileset, uniform"],
        uses: [PROPS_TSJ, ...UNIFORM_PROPS.map((p) => p.file), TILES_TSJ, "tiles.png"],
        look:
            "7 × 4 cells of grass with six 16 × 16 props from the collection props.tsj: row 1 " +
            "has a crate, a barrel and a bush; row 3 a bush, a crate and a barrel.",
    },
    {
        file: "collection-mixed.tmj",
        brief: ["Image-collection tileset, mixed sizes"],
        spec: ["image-collection tileset, mixed"],
        uses: [...MIXED_PROPS.map((p) => p.file), TILES_TSJ, "tiles.png"],
        look:
            "8 × 4 cells of grass with trees from the embedded collection trees: 16 × 16 at " +
            "(2,1) and (6,3), 16 × 32 at (5,2) and 32 × 32 at (1,3), each drawn from its cell's " +
            "bottom-left corner, so taller trees reach into the row above. The editor refuses " +
            "this map; Tiled opens it.",
    },
    {
        file: "objects-shapes.tmj",
        brief: ["Object layer: rectangle, point, ellipse, polygon, polyline"],
        spec: ["every object shape"],
        uses: [TILES_TSJ, "tiles.png"],
        look:
            "12 × 8 grass cells; object layer Markers (orange): rectangle Spawn area (class " +
            "Zone, property team), point Start, ellipse Pond, triangle polygon Rock, four-point " +
            "polyline Path, and rectangle Secret, hidden (its eye is off in the Objects view).",
    },
    {
        file: "objects-rotated.tmj",
        brief: ["Object rotation"],
        spec: ["rotated object"],
        uses: [TILES_TSJ, "tiles.png"],
        look:
            "12 × 8 grass cells; a rectangle turned 30°, an ellipse turned 45° and a right-angle " +
            "wedge turned 90° clockwise, each about its top-left point.",
    },
    {
        file: "objects-dropped.tmj",
        brief: ["Tile objects, text, capsule"],
        spec: ["tile object", "text object", "capsule object"],
        uses: [TILES_TSJ, "tiles.png"],
        look:
            "12 × 8 grass cells; a chest tile object, the red arrow as a tile object flipped " +
            "horizontally, a text object reading Hello, Tiled (wrapped in a 96 × 32 box) and a " +
            "64 × 24 capsule.",
    },
    {
        file: "templates.tmj",
        brief: ["Template instances"],
        spec: ["templates"],
        uses: [
            "templates/door.tj",
            "templates/coin.tj",
            "templates/zone.tj",
            TILES_TSJ,
            "tiles.png",
        ],
        look:
            "12 × 8 grass cells; object layer Instances: a 16 × 32 Door (locked false), a second " +
            "door renamed Vault door with locked true, a coin tile object and a four-point Zone " +
            "polygon, all from templates (Template section of the Properties view filled).",
    },
    {
        file: "properties.tmj",
        brief: ["`object`, `list` and class-typed properties", "Enum properties", "Class names"],
        spec: [
            "every property type",
            "class property",
            "enum property",
            "`object` property",
            "`list` property",
        ],
        uses: ["tiles.png", "tmj.tiled-project"],
        look:
            "8 × 6 grass cells. The map has class Level and one property of each type: bool, " +
            "color, file, float, int, string, object (target → Hero), class Stats, string enum " +
            "Facing, int flag enum Layers and a list of three values. Layer Ground has class " +
            "Terrain, layer Actors class Actors; Hero and Sidekick are class Npc, Hero has an " +
            "object property friend → Sidekick; the embedded tileset typed has class Palette and " +
            "its grass tile class Grass. Open tmj.tiled-project first (Project → Open Project) so " +
            "Tiled knows Stats, Facing and Layers; without it the map still opens and the Issues " +
            "view lists the unknown types.",
    },
    {
        file: "tint-blend.tmj",
        brief: ["Layer tint, blend mode"],
        spec: ["tint", "blend mode"],
        uses: [TILES_TSJ, "tiles.png"],
        look:
            "10 × 8 grass cells; a stone ring tinted red (layer Tinted); a 4 × 4 pond in Multiply " +
            "mode (darker blue over the grass) and the same pond shifted by (32,16) px at 50% " +
            "opacity in Screen mode (lighter).",
    },
    {
        file: "terrain.tmj",
        brief: ["Terrain probability, terrain-set transformations, tile probability"],
        spec: ["terrain probabilities", "terrain transformations"],
        uses: [TERRAIN_TSJ, "tiles.png"],
        look:
            "8 × 8 cells: a brown dirt ring on grass with grass in the middle. Tileset terrain.tsj " +
            "has the corner terrain set Ground (Grass probability 1, Dirt 0.5), grass tile " +
            "probability 0.25, and all four transformation boxes ticked.",
    },
    {
        file: "transparent-color.tmj",
        brief: [],
        spec: ["`transparentcolor`"],
        uses: ["keyed.png", "images/backdrop.png"],
        look:
            "6 × 5 cells on a dark blue background: image layer Backdrop (blue to orange " +
            "gradient) with a rectangular and a round hole where its magenta was keyed out; four " +
            "discs (green, blue, orange, gold) with no magenta round them.",
    },
    {
        file: "tilerendersize.tmj",
        brief: [],
        spec: ["`tilerendersize`"],
        uses: ["big.png"],
        look:
            "8 × 6 cells of 16 px in a checkerboard of two 32 × 32 tiles (green and blue checks, " +
            "white border), each drawn shrunk to one 16 px cell (tile render size Grid).",
    },
    {
        file: "side-scroller.tmj",
        brief: [],
        spec: ["1000 × 40 side-scroller"],
        uses: ["images/sky.png", TILES_TSJ, "tiles.png"],
        look:
            "1000 × 40 cells. Image layer Sky (blue gradient, repeated across, parallax 0.2); " +
            "layer Ground: rolling grass over dirt over stone, a three-column pit with water at " +
            "the bottom every 97 columns; layer Decor: bushes, wooden platforms with coins; " +
            "object layer Spawns: point Player at the left, an Enemy point every 80 columns, " +
            "rectangle Goal at the right end. Ground and Decor are zlib.",
    },
    {
        file: "overworld.tmj",
        brief: [],
        spec: ["256 × 256 overworld with groups and parallax"],
        uses: [TILES_TSJ, "tiles.png"],
        look:
            "256 × 256 cells. Group World: layer Ground (deep water, water, sand, grass, forest, " +
            "mountain and snow by height), layer Roads (a cross of road tiles through the centre, " +
            "not over water), object layer Towns (four points). Group Sky at 70% opacity, " +
            "parallax 0.5: layer Clouds, white translucent patches offset by 8 px. All tile " +
            "layers are gzip.",
    },
    {
        file: "dungeon.tmj",
        brief: ["Object layer: rectangle, point, ellipse, polygon, polyline"],
        spec: ["small dungeon with markers and collision"],
        uses: [DUNGEON_TSJ, "tiles.png"],
        look:
            "24 × 16 cells of rooms: layers Floor, Walls (walls, pillars, torches, slopes) and " +
            "Items (doors, chests); object layer Markers (light orange): four Room rectangles, " +
            "two Spawn points, a Trap polygon, a Path polyline and a Light ellipse. Tileset " +
            "dungeon.tsj: wall tile with a full-cell collision rectangle, pillar an ellipse, " +
            "slope a triangle polygon plus a point and a polyline, torch an 8 × 16 rectangle and " +
            "a two-frame animation (yellow, orange, 200 ms each), seen in the Tile Collision and " +
            "Tile Animation editors.",
    },
];

/** The fixture entries the README lists (exported for the TE-058 tests). */
export const FIXTURE_ENTRIES = ENTRIES;

function readme(): string {
    const lines = [
        "# TMJ import fixtures",
        "",
        "Fixtures of TMJ import (BRIEF §7, SPEC §13), authored for this repository, so their licence",
        "is the repository's. Every file here except `build.ts` is written by",
        "`node tests/fixtures/tmj/build.ts` as Tiled 1.12.2 writes it (JSON maps, tilesets and",
        "templates; one XML tileset) with generated PNGs; `tests/unit/te-058-build.test.ts` checks",
        "that the script reproduces them byte for byte, and `tests/unit/te-058-coverage.test.ts` that",
        "every BRIEF §7 row and SPEC §13 coverage item is named below by a file that exists.",
        "",
        "## Conventions",
        "",
        "- Cells are 16 px unless an entry says otherwise; cell (x,y) counts from the top-left, as",
        "  Tiled's status bar shows it.",
        "- `tiles.png` is 8 × 4 tiles: 0–23 flat colours (0 grass, 1 dirt, 2 stone, 3 water, 4 sand,",
        "  5 wall, 6 floor, 7 lava, 8 wood, 9 forest, 10 snow, 11 brick, 12–13 torch frames, 14 cloud,",
        "  15 road, 16 deep water, 17 mountain, 18 door, 19 chest, 20 pillar, 21 slope, 22 bush,",
        "  23 coin), each with a darker bottom row and right column; 24–31 arrow tiles, each a colour",
        "  with a white 5 × 5 mark in the top-left corner and a white bar along the top edge, so every",
        "  flip and rotation shows.",
        "- `tmj.tiled-project` defines the custom types of `properties.tmj`.",
        "",
        "## Owner check in Tiled 1.12.2",
        "",
        "Open `tmj.tiled-project` (Project → Open Project…), then open each `.tmj` below (File →",
        "Open). Each must open without an error dialog and look as its entry says. Reply `tmj pass`,",
        "or `tmj fail: <file> <what differs>`.",
        "",
        "## Files",
    ];
    for (const entry of ENTRIES) {
        lines.push("", `### \`${entry.file}\``, "");
        if (entry.brief.length) lines.push(`- BRIEF §7: ${entry.brief.join("; ")}`);
        lines.push(`- SPEC §13: ${entry.spec.join("; ")}`);
        lines.push(`- Uses: ${entry.uses.map((use) => `\`${use}\``).join(", ")}`);
        lines.push(`- In Tiled: ${entry.look}`);
    }
    return lines.join("\n") + "\n";
}

// --- Files ---------------------------------------------------------------------------------------

/** Every file of `tests/fixtures/tmj/` but `build.ts`, by path relative to the folder. */
export function tmjFixtureFiles(): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    const text = (value: string) => new TextEncoder().encode(value);
    const add = (path: string, bytes: Uint8Array) => {
        if (files.has(path)) throw new Error(`${path} is written twice.`);
        files.set(path, bytes);
    };

    add("tiles.png", tilesPng());
    add("iso.png", isoPng());
    add("keyed.png", keyedPng());
    add("big.png", bigPng());
    add("images/backdrop.png", backdropPng());
    add("images/sky.png", skyPng());
    for (const p of [...UNIFORM_PROPS, ...MIXED_PROPS]) add(p.file, propPng(p));

    add(TILES_TSJ, text(tilesetFile(tilesFields("tiles"))));
    add("tiles-xml.tsx", text(tilesXml()));
    add(PROPS_TSJ, text(tilesetFile(collectionFields("props", UNIFORM_PROPS))));
    add(TERRAIN_TSJ, text(terrainTileset()));
    add(DUNGEON_TSJ, text(dungeonTileset()));
    add("templates/door.tj", text(doorTemplate()));
    add("templates/coin.tj", text(coinTemplate()));
    add("templates/zone.tj", text(zoneTemplate()));
    add("tmj.tiled-project", text(projectFile()));

    for (const encoding of ["csv", "base64", "zlib", "gzip", "zstd"] as const) {
        add(`encoding-${encoding}.tmj`, text(encodingMap(encoding)));
    }
    add("flips.tmj", text(flipsMap()));
    add("isometric.tmj", text(isometricMap()));
    add("hexagonal.tmj", text(hexagonalMap()));
    add("infinite.tmj", text(infiniteMap()));
    add("tileset-embedded.tmj", text(embeddedTilesetMap()));
    add("tileset-tsj.tmj", text(externalTilesetMap(TILES_TSJ)));
    add("tileset-tsx.tmj", text(externalTilesetMap("tiles-xml.tsx")));
    add("collection-uniform.tmj", text(collectionUniformMap()));
    add("collection-mixed.tmj", text(collectionMixedMap()));
    add("objects-shapes.tmj", text(objectsShapesMap()));
    add("objects-rotated.tmj", text(objectsRotatedMap()));
    add("objects-dropped.tmj", text(objectsDroppedMap()));
    add("templates.tmj", text(templatesMap()));
    add("properties.tmj", text(propertiesMap()));
    add("tint-blend.tmj", text(tintBlendMap()));
    add("terrain.tmj", text(terrainMap()));
    add("transparent-color.tmj", text(transparentColorMap()));
    add("tilerendersize.tmj", text(tileRenderSizeMap()));
    add("side-scroller.tmj", text(sideScrollerMap()));
    add("overworld.tmj", text(overworldMap()));
    add("dungeon.tmj", text(dungeonMap()));

    for (const entry of ENTRIES) {
        for (const path of [entry.file, ...entry.uses]) {
            if (!files.has(path))
                throw new Error(`README entry ${entry.file}: ${path} is not written.`);
        }
    }
    add("README.md", text(readme()));
    return files;
}

// --- Writing ---------------------------------------------------------------------------------------

const SCRIPT = "build.ts";

/** Every file under `folder`, as `/`-separated paths relative to it. */
export function listFiles(folder: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else out.push(relative(folder, path).split(sep).join("/"));
        }
    };
    walk(folder);
    return out.sort();
}

function write(): void {
    const folder = dirname(fileURLToPath(import.meta.url));
    const files = tmjFixtureFiles();
    for (const path of listFiles(folder)) {
        if (path !== SCRIPT && !files.has(path)) rmSync(join(folder, path));
    }
    for (const [path, bytes] of files) {
        mkdirSync(dirname(join(folder, path)), { recursive: true });
        writeFileSync(join(folder, path), bytes);
    }
    console.log(`Wrote ${files.size} files to tests/fixtures/tmj/.`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    write();
}
