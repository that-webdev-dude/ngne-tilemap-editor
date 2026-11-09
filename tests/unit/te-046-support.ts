import { zipSync } from "fflate";
import { CellStore, cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import {
    assertInvariants,
    createGroupLayer,
    createImageLayer,
    createMarkerLayer,
    createTileLayer,
    walkLayers,
} from "../../src/core/model";
import type {
    Layer,
    PixelBuffer,
    Project,
    ProjectImage,
    ProjectMap,
    Tile,
    TileSourceKey,
    Tileset,
    TilesetSourceKind,
} from "../../src/core/model";
import { encodeJson } from "../../src/core/project/json";
import { crc32 } from "../../src/core/sprite/project/zip";
import { sha256Hex } from "../support/sha256";

// Shared by the TE-046 tests: a deterministic project that uses every member of FORMAT §2.4 and
// §2.5, a comparable form of a project, and a zip writer that can break each container rule.

/** Deterministic pixels: every byte from position and a seed; alpha 0 in one pixel of 7. */
export function pixelsOf(width: number, height: number, seed: number): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        const opaque = (i + seed) % 7 !== 0;
        data[i * 4] = opaque ? (i * 31 + seed) & 0xff : 0;
        data[i * 4 + 1] = opaque ? (i * 17 + seed * 3) & 0xff : 0;
        data[i * 4 + 2] = opaque ? (i * 7 + seed * 5) & 0xff : 0;
        data[i * 4 + 3] = opaque ? 128 + ((i + seed) & 0x7f) : 0;
    }
    return { width, height, data };
}

/** The pixels of tile `k` of a tileset image, rows top to bottom. */
function tilePixels(image: PixelBuffer, k: number, columns: number, tw: number, th: number) {
    const out = new Uint8ClampedArray(tw * th * 4);
    const left = (k % columns) * tw;
    const top = Math.floor(k / columns) * th;
    for (let y = 0; y < th; y += 1) {
        const start = ((top + y) * image.width + left) * 4;
        out.set(image.data.subarray(start, start + tw * 4), y * tw * 4);
    }
    return out;
}

const SOURCE_KEYS: Record<TilesetSourceKind, (k: number) => TileSourceKey> = {
    image: (k) => [k % 3, Math.floor(k / 3)],
    sprite: (k) => ["frame-a", k % 2, Math.floor(k / 2)],
    atlas: (k) => `walk/${k}`,
    collection: (k) => `tile-${k}.png`,
};

interface TilesetOptions {
    id: string;
    slot: number;
    kind: TilesetSourceKind;
    tiles: number;
    columns: number;
    tileWidth: number;
    tileHeight: number;
}

/** A tileset whose last row is partly empty (alpha 0) and whose tile IDs have gaps. */
export function makeTileset(options: TilesetOptions): Tileset {
    const { id, slot, kind, tiles: count, columns, tileWidth: tw, tileHeight: th } = options;
    const rows = Math.ceil(count / columns);
    const pixels = pixelsOf(columns * tw, rows * th, slot);
    // Pixels no tile covers are transparent black (FORMAT §2.6).
    for (let k = count; k < rows * columns; k += 1) {
        const left = (k % columns) * tw;
        const top = Math.floor(k / columns) * th;
        for (let y = 0; y < th; y += 1) {
            const start = ((top + y) * pixels.width + left) * 4;
            pixels.data.fill(0, start, start + tw * 4);
        }
    }
    // IDs 0, 2, 3, …: tile 1 was deleted, so `nextTileId` stays above the highest.
    const ids = Array.from({ length: count }, (_, k) => (k === 0 ? 0 : k + 1));
    const tiles: Tile[] = ids.map((tileId, k) => ({
        id: tileId,
        sourceKey: k === count - 1 ? null : SOURCE_KEYS[kind](k),
        fingerprint: sha256Hex(tilePixels(pixels, k, columns, tw, th)),
        class: "",
        collision: [],
        animation: [],
        properties: [],
    }));
    const grid = kind === "image" || kind === "sprite";
    return {
        id,
        name: `Tileset ${slot}`,
        exportName: `tileset-${slot}`,
        class: "",
        slot,
        tileWidth: tw,
        tileHeight: th,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels,
        nextTileId: ids[ids.length - 1]! + 3,
        source: {
            kind,
            fileName: `source-${slot}.${kind === "sprite" ? "ngsprite" : "png"}`,
            margin: grid ? 1 : 0,
            spacing: grid ? 2 : 0,
        },
        tiles,
        terrainSets: [],
        properties: [],
    };
}

function image(
    id: string,
    name: string,
    width: number,
    height: number,
    seed: number,
): ProjectImage {
    return { id, name, exportName: name.toLowerCase(), pixels: pixelsOf(width, height, seed) };
}

/** A tile layer filled by `fill(x, y)`, which returns a cell value or 0. */
function tileLayer(
    id: number,
    name: string,
    width: number,
    height: number,
    fill: (x: number, y: number) => number,
): Layer {
    const layer = createTileLayer(id, name);
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

/**
 * A project that uses every member of FORMAT §2.4 and §2.5 with non-default values: every
 * source kind, null source keys, all collision shapes, animations, every property type, the
 * three terrain set types, images, every layer type with nested groups, every marker shape,
 * all eight orientations, text with a character outside the Basic Multilingual Plane. Slots
 * are 1, 2, … in list order, as a read gives them.
 */
export function everyMemberProject(): Project {
    const tilesets = [
        makeTileset({
            id: "TS-image",
            slot: 1,
            kind: "image",
            tiles: 5,
            columns: 3,
            tileWidth: 8,
            tileHeight: 6,
        }),
        makeTileset({
            id: "ts-sprite",
            slot: 2,
            kind: "sprite",
            tiles: 4,
            columns: 2,
            tileWidth: 5,
            tileHeight: 7,
        }),
        makeTileset({
            id: "ts-atlas",
            slot: 3,
            kind: "atlas",
            tiles: 3,
            columns: 3,
            tileWidth: 4,
            tileHeight: 4,
        }),
        makeTileset({
            id: "ts_collection",
            slot: 4,
            kind: "collection",
            tiles: 2,
            columns: 1,
            tileWidth: 16,
            tileHeight: 8,
        }),
    ];
    const [first, second] = tilesets as [Tileset, Tileset];
    Object.assign(first, {
        class: "ground",
        offsetX: -3,
        offsetY: 4,
        properties: [
            { name: "a-bool", type: "bool", value: true },
            { name: "b-int", type: "int", value: -9_007_199_254_740_991 },
            { name: "c-float", type: "float", value: 2.5 },
            { name: "d-string", type: "string", value: 'line\nbreak "quoted" \u{1F600}' },
            { name: "e-color", type: "color", value: "#0a1b2cff" },
            { name: "f-file", type: "file", value: "../maps/next.ngtilemap" },
        ],
    });
    const [t0, t2, t3] = first.tiles as [Tile, Tile, Tile];
    t0.class = "wall";
    t0.collision = [
        { shape: "rectangle", x: 0, y: 0, width: 8, height: 3 },
        { shape: "ellipse", x: 1.5, y: 2, width: 4, height: 2.25 },
        {
            shape: "polygon",
            x: -4096,
            y: 4096,
            points: [
                [0, 0],
                [8, 0],
                [4, -6],
            ],
        },
    ];
    t0.properties = [{ name: "solid", type: "bool", value: true }];
    t2.animation = [
        { tile: 2, ms: 100 },
        { tile: 3, ms: 65_535 },
        { tile: 0, ms: 1 },
    ];
    t3.class = "Ünïcödé \u{1F642}";
    first.terrainSets = [
        {
            name: "Corners",
            type: "corner",
            colors: [
                { name: "Grass", color: "#00ff00ff", tile: 0 },
                { name: "Sand", color: "#ffee8880", tile: null },
            ],
            tiles: [
                { tile: 0, wangId: [0, 1, 0, 2, 0, 1, 0, 1] },
                { tile: 3, wangId: [0, 2, 0, 2, 0, 2, 0, 2] },
            ],
        },
        {
            name: "Edges",
            type: "edge",
            colors: [{ name: "Road", color: "#808080ff", tile: 2 }],
            tiles: [{ tile: 2, wangId: [1, 0, 1, 0, 0, 0, 1, 0] }],
        },
        {
            name: "Mixed",
            type: "mixed",
            colors: [{ name: "Water", color: "#0000ffff", tile: null }],
            tiles: [],
        },
    ];
    second.properties = [{ name: "only", type: "string", value: "" }];

    const images = [image("img-1", "Sky", 7, 3, 9), image("img-2", "Hills", 2, 5, 11)];

    const flags = (x: number, y: number) => ((x + 2 * y) % 8) as Orientation;
    const town: ProjectMap = {
        id: "map-town",
        name: "Town \u{1F3E0}",
        exportName: "town",
        class: "overworld",
        orientation: "orthogonal",
        width: 9,
        height: 5,
        tileWidth: 8,
        tileHeight: 6,
        backgroundColor: 0x102030ff,
        parallaxOriginX: -12.5,
        parallaxOriginY: 1_048_576,
        nextLayerId: 20,
        nextMarkerId: 40,
        layers: [],
        properties: [{ name: "music", type: "file", value: "town.ogg" }],
    };
    const ground = tileLayer(1, "Ground", 9, 5, (x, y) =>
        cellValue(1, [0, 2, 3, 4, 5][(x + y) % 5]!, flags(x, y)),
    );
    Object.assign(ground, {
        class: "floor",
        opacity: 200,
        offsetX: -2,
        offsetY: 3,
        parallaxX: 0.5,
        parallaxY: -1.25,
    });
    const decor = tileLayer(4, "Decor", 9, 5, (x, y) =>
        (x * y) % 3 === 0 ? 0 : cellValue(3, [0, 2, 3][x % 3]!, flags(y, x)),
    );
    decor.visible = false;
    decor.locked = true;
    const markers = createMarkerLayer(5, "Spawns");
    markers.color = 0xff8800c0;
    markers.markers = [
        {
            id: 3,
            name: "door",
            class: "warp",
            shape: "rectangle",
            x: 8,
            y: 6,
            width: 16,
            height: 12,
            properties: [{ name: "to", type: "string", value: "dungeon" }],
        },
        {
            id: 7,
            name: "",
            class: "",
            shape: "ellipse",
            x: -1_048_576,
            y: 0.25,
            width: 0,
            height: 3,
            properties: [],
        },
        { id: 8, name: "start", class: "", shape: "point", x: 33, y: 17, properties: [] },
        {
            id: 9,
            name: "zone",
            class: "",
            shape: "polygon",
            x: 1,
            y: 2,
            points: [
                [0, 0],
                [10, 0],
                [5, 5],
            ],
            properties: [],
        },
        {
            id: 39,
            name: "path",
            class: "",
            shape: "polyline",
            x: 4,
            y: 4,
            points: [
                [0, 0],
                [-3.5, 7],
            ],
            properties: [],
        },
    ];
    const sky = createImageLayer(6, "Sky", "img-1");
    Object.assign(sky, { repeatX: true, repeatY: false });
    const outer = createGroupLayer(10, "Outer");
    Object.assign(outer, { opacity: 128, offsetX: 5, parallaxX: 2 });
    const inner = createGroupLayer(11, "Inner");
    inner.layers = [
        tileLayer(12, "Sprites", 9, 5, (x, y) =>
            x === y ? cellValue(2, x % 4 === 0 ? 0 : (x % 4) + 1, 7) : 0,
        ),
        Object.assign(createImageLayer(13, "Hills", "img-2"), { repeatY: true }),
    ];
    outer.layers = [inner, createMarkerLayer(14, "Empty markers")];
    town.layers = [ground, decor, markers, sky, outer];

    const dungeon: ProjectMap = {
        id: "map-dungeon",
        name: "Dungeon",
        exportName: "dungeon",
        class: "",
        orientation: "orthogonal",
        width: 40,
        height: 3,
        tileWidth: 16,
        tileHeight: 8,
        backgroundColor: null,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
        nextLayerId: 2,
        nextMarkerId: 1,
        layers: [
            tileLayer(1, "Floor", 40, 3, (x, y) =>
                x % 4 === 0 ? 0 : cellValue(4, (x + y) % 2 === 0 ? 0 : 2),
            ),
        ],
        properties: [],
    };

    const project: Project = {
        id: "project-1",
        name: "Every member",
        exportName: "every-member",
        maps: [town, dungeon],
        tilesets,
        images,
        exportSettings: { exportOnSave: true },
        // Sorted by UTF-16 code unit, as the model keeps them: "Z" (0x5a) before "a" (0x61).
        properties: [
            { name: "Zeta", type: "int", value: 0 },
            { name: "author", type: "string", value: "fixtures" },
        ],
    };
    assertInvariants(project);
    return project;
}

/**
 * A project in a form `toEqual` compares member for member: each tile layer's cells as an
 * array of values row by row, with the slot replaced by the tileset's list index + 1, and
 * slots dropped. Two projects with the same cells under other slots compare equal.
 */
export function comparable(project: Project): unknown {
    const indexBySlot = new Map(
        project.tilesets.map((tileset, index) => [tileset.slot, index + 1]),
    );
    const copy = structuredClone({
        ...project,
        maps: [],
        tilesets: project.tilesets.map((tileset) => ({ ...tileset, slot: 0 })),
    });
    const maps = project.maps.map((map) => {
        const layer = (item: Layer): unknown => {
            switch (item.type) {
                case "tile": {
                    const cells: number[] = [];
                    for (let y = 0; y < map.height; y += 1) {
                        for (let x = 0; x < map.width; x += 1) {
                            const value = item.cells.get(x, y);
                            const slot = (value >>> 20) & 0xff;
                            cells.push(
                                value === 0
                                    ? 0
                                    : ((value & ~(0xff << 20)) | (indexBySlot.get(slot)! << 20)) >>>
                                          0,
                            );
                        }
                    }
                    return { ...structuredClone({ ...item, cells: null }), cells };
                }
                case "group":
                    return { ...item, layers: item.layers.map(layer) };
                default:
                    return structuredClone(item);
            }
        };
        return { ...map, layers: map.layers.map(layer) };
    });
    return { ...copy, maps };
}

/** Number of tile layers in all maps, for sanity checks of a comparison. */
export function tileLayerCount(project: Project): number {
    let count = 0;
    for (const map of project.maps) {
        for (const { layer } of walkLayers(map.layers)) if (layer.type === "tile") count += 1;
    }
    return count;
}

// --- raw archives -------------------------------------------------------------------------------

/** One entry of a raw archive and how to break it. */
export interface RawEntry {
    name: string;
    data: Uint8Array;
    /** Deflate the data (method 8); stored otherwise. */
    deflate?: boolean;
    /** Overrides of what the central directory states. */
    method?: number;
    flags?: number;
    crc?: number;
    size?: number;
    /** The name the local header carries, if not `name`. */
    localName?: string;
}

/** How to break the end record or the archive around it. */
export interface RawOptions {
    disk?: number;
    /** Entry count stated by the end record (both fields). */
    count?: number;
    /** Bytes inserted between the central directory and the end record. */
    gap?: Uint8Array;
    /** Bytes appended after the end record. */
    trailer?: Uint8Array;
    /** A zip64 locator in front of the end record. */
    zip64Locator?: boolean;
}

const encoder = new TextEncoder();

/** A zip archive written byte by byte, so each rule of FORMAT §2.1 can be broken alone. */
export function rawZip(entries: readonly RawEntry[], options: RawOptions = {}): Uint8Array {
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = encoder.encode(entry.name);
        const localName = encoder.encode(entry.localName ?? entry.name);
        const stored = entry.deflate
            ? (zipSync({ x: [entry.data, { level: 6 }] }) as Uint8Array)
            : entry.data;
        // fflate wraps the stream in its own zip; take the raw deflate data of its one entry.
        const payload = entry.deflate ? rawDeflate(stored) : stored;
        const method = entry.method ?? (entry.deflate ? 8 : 0);
        const crc = entry.crc ?? crc32(entry.data);
        const size = entry.size ?? entry.data.length;
        const local = new Uint8Array(30 + localName.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, entry.flags ?? 0, true);
        lv.setUint16(8, method, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, payload.length, true);
        lv.setUint32(22, size, true);
        lv.setUint16(26, localName.length, true);
        local.set(localName, 30);
        const record = new Uint8Array(46 + name.length);
        const cv = new DataView(record.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, entry.flags ?? 0, true);
        cv.setUint16(10, method, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, payload.length, true);
        cv.setUint32(24, size, true);
        cv.setUint16(28, name.length, true);
        cv.setUint32(42, offset, true);
        record.set(name, 46);
        parts.push(local, payload);
        central.push(record);
        offset += local.length + payload.length;
    }
    const directoryOffset = offset;
    const directorySize = central.reduce((sum, part) => sum + part.length, 0);
    parts.push(...central);
    if (options.gap) parts.push(options.gap);
    if (options.zip64Locator) {
        const locator = new Uint8Array(20);
        new DataView(locator.buffer).setUint32(0, 0x07064b50, true);
        parts.push(locator);
    }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    const count = options.count ?? entries.length;
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, options.disk ?? 0, true);
    ev.setUint16(6, options.disk ?? 0, true);
    ev.setUint16(8, count, true);
    ev.setUint16(10, count, true);
    ev.setUint32(12, directorySize, true);
    ev.setUint32(16, directoryOffset, true);
    parts.push(end);
    if (options.trailer) parts.push(options.trailer);
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        bytes.set(part, at);
        at += part.length;
    }
    return bytes;
}

/** The raw deflate data of the single entry of an fflate zip. */
function rawDeflate(zip: Uint8Array): Uint8Array {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const compressed = view.getUint32(18, true);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    return zip.subarray(start, start + compressed);
}

/** The entries of a project file as `RawEntry` values, JSON deflated, PNG stored. */
export function entriesOf(files: Record<string, Uint8Array>): RawEntry[] {
    return Object.entries(files).map(([name, data]) => ({
        name,
        data,
        deflate: name.endsWith(".json"),
    }));
}

/** A JSON entry's bytes, as the writer writes them. */
export function jsonBytes(value: unknown): Uint8Array {
    return encodeJson(value);
}
