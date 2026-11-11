// The runtime of an exported tilemap (SPEC 11): the reader of `ngne-tilemap` version 1
// (FORMAT 3.8) and its error, loading, assets, `drawTilemap` and the data functions. The
// generator copies this file into `ngne-tilemap.ts` behind a header and the quad emitter, and
// replaces its last part with the export folder's tables; the editor imports it as code, so
// editor and games carry one reader. That is why the file:
// - imports the quad emitter alone, which the generator inlines and whose import it drops: the
//   generated module stands alone, and `src/core` stays free of the engine;
// - uses nothing but ECMAScript 2022, `fetch` in `loadTilemap` alone and `console.warn` as
//   `drawTilemap`'s default report (SPEC 11.4): no other DOM global, no engine type;
// - compiles under `strict`, `exactOptionalPropertyTypes`, `noUnusedLocals` and
//   `noUnusedParameters` (SPEC 11.4);
// - is ASCII, comments included, as every text file of an export is.
// The comments are read by the users of an exported runtime.

import { FlatCells, QuadEmitter } from "./emit";
import type { EmitLayerOptions, EmitTileset, SpriteLike, SpriteSink } from "./emit";

/** `format` of a tilemap. */
export const TILEMAP_FORMAT = "ngne-tilemap";

/** The version this reader reads, and the newest; the editor writes it. */
export const TILEMAP_VERSION = 1;

// The limits of FORMAT 3.6. A writer stays within them; the reader refuses a file beyond one.

/** Most cells along a side of a map. */
export const MAX_TILEMAP_SIDE = 4096;
/** Most cells of one tile layer: `width * height`. */
export const MAX_TILEMAP_LAYER_CELLS = 1_048_576;
/** Most cells of all tile layers together. */
export const MAX_TILEMAP_CELLS = 4_194_304;
/** Most groups and layers together. */
export const MAX_TILEMAP_LAYERS = 256;
/** Most tilesets. */
export const MAX_TILEMAP_TILESETS = 255;
/** Most markers of all marker layers together. */
export const MAX_TILEMAP_MARKERS = 16_384;
/** Most points of all marker shapes together. */
export const MAX_TILEMAP_MARKER_POINTS = 262_144;
/** Most collision shapes of one tile. */
export const MAX_TILEMAP_COLLISION_SHAPES = 64;
/** Most points of one polygon or polyline. */
export const MAX_TILEMAP_SHAPE_POINTS = 1024;
/** Most properties of one list. */
export const MAX_TILEMAP_PROPERTIES = 256;
/** Largest tilemap file, in bytes: 64 MiB. Checked by whoever reads the file's bytes. */
export const MAX_TILEMAP_BYTES = 67_108_864;

/**
 * What is wrong with a tilemap (FORMAT 3.8):
 * - `format`: not an object, `format` is not "ngne-tilemap", or the value cannot be read.
 * - `newer-version`: `version` is above the newest this reader knows.
 * - `field`: a member is missing, of the wrong type or outside its range; a value that must be
 *   unique (an ID, a property name, a tile of a tileset) is repeated; two tileset spans overlap;
 *   a cell value has its reserved bit 28 set, or a flag without a GID.
 * - `reference`: a group, tileset or tile that does not exist; a cell outside every span; a
 *   cycle of groups.
 * - `atlas`: the atlas of a tileset is missing, or does not match FORMAT 4.
 * - `limit`: a count above FORMAT 3.6.
 */
export type TilemapErrorCode =
    "format" | "newer-version" | "field" | "reference" | "atlas" | "limit";

/** The one error the reader throws: `code` says what is wrong, `path` where. */
export class TilemapError extends Error {
    override readonly name = "TilemapError";
    readonly code: TilemapErrorCode;
    /** The member at fault, as a path from the top (`layers[2].data[17]`); "" for the whole. */
    readonly path: string;

    constructor(code: TilemapErrorCode, path: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.code = code;
        this.path = path;
    }
}

/** A property of FORMAT 1.4. `type` tells a float `2` from an int `2`. */
export type TilemapProperty =
    | { readonly name: string; readonly type: "bool"; readonly value: boolean }
    | { readonly name: string; readonly type: "int"; readonly value: number }
    | { readonly name: string; readonly type: "float"; readonly value: number }
    | { readonly name: string; readonly type: "string"; readonly value: string }
    | { readonly name: string; readonly type: "color"; readonly value: string }
    | { readonly name: string; readonly type: "file"; readonly value: string };

export type PropertyValue = TilemapProperty["value"];

/** A point of a polygon or polyline, relative to the shape's `x, y`. */
export type TilemapPoint = readonly [number, number];

/** A shape of FORMAT 1.5, in pixels, x right, y down. */
export type TilemapShape =
    | {
          readonly shape: "rectangle" | "ellipse";
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
      }
    | { readonly shape: "point"; readonly x: number; readonly y: number }
    | {
          readonly shape: "polygon" | "polyline";
          readonly x: number;
          readonly y: number;
          readonly points: readonly TilemapPoint[];
      };

/** A tile with a class, properties or collision. Other tiles have none of them. */
export interface TileData {
    readonly id: number;
    /** "" for none. */
    readonly class: string;
    /** In tile pixels, untransformed: rectangles, ellipses and polygons. */
    readonly collision: readonly TilemapShape[];
    readonly properties: readonly TilemapProperty[];
}

export interface TilemapTileset {
    /** The tileset's export name: its atlas is `<name>.atlas.json` and `<name>.png`. */
    readonly name: string;
    readonly atlas: string;
    readonly class: string;
    /** The GIDs `firstGid .. firstGid + nextTileId - 1` are this tileset's tiles. */
    readonly firstGid: number;
    readonly nextTileId: number;
    readonly tileWidth: number;
    readonly tileHeight: number;
    /** Tile offset when drawn, +x right, +y down. */
    readonly offsetX: number;
    readonly offsetY: number;
    readonly tiles: readonly TileData[];
    readonly properties: readonly TilemapProperty[];
}

export interface TilemapGroup {
    readonly id: number;
    readonly name: string;
    readonly class: string;
    /** The group holding this one; null at the top. */
    readonly parentId: number | null;
    readonly properties: readonly TilemapProperty[];
}

/** What every layer has. Values are effective: its groups' values are already applied. */
interface TilemapLayerBase {
    readonly id: number;
    readonly name: string;
    readonly class: string;
    /** The innermost group holding the layer; null at the top. */
    readonly groupId: number | null;
    readonly visible: boolean;
    /** 0..255. */
    readonly opacity: number;
    readonly offsetX: number;
    readonly offsetY: number;
    /** Parallax factor; 1 moves with the map, 0 stays on screen. */
    readonly parallaxX: number;
    readonly parallaxY: number;
    readonly properties: readonly TilemapProperty[];
}

export interface TileLayerData extends TilemapLayerBase {
    readonly type: "tile";
    /**
     * `width * height` cell values, row by row from the top-left: bits 31, 30, 29 flip
     * horizontally, vertically and anti-diagonally, bits 0..27 are the GID (0: empty).
     */
    readonly data: Uint32Array;
}

/** A marker: a shape in map pixels with an ID, a name, a class and properties. */
export type TilemapMarker = TilemapShape & {
    readonly id: number;
    readonly name: string;
    readonly class: string;
    readonly properties: readonly TilemapProperty[];
};

export interface MarkerLayerData extends TilemapLayerBase {
    readonly type: "marker";
    readonly markers: readonly TilemapMarker[];
}

export interface ImageLayerData extends TilemapLayerBase {
    readonly type: "image";
    /** File name of the image, beside the tilemap. */
    readonly image: string;
    readonly imageWidth: number;
    readonly imageHeight: number;
    readonly repeatX: boolean;
    readonly repeatY: boolean;
}

export type TilemapLayer = TileLayerData | MarkerLayerData | ImageLayerData;

/** A tilemap as `validateTilemap` returns it: the members of FORMAT 3.2 and no other. */
export interface Tilemap {
    readonly format: typeof TILEMAP_FORMAT;
    readonly version: number;
    readonly generator: string;
    /** The project's export name. */
    readonly project: string;
    /** The map's export name. */
    readonly name: string;
    readonly title: string;
    readonly class: string;
    readonly orientation: "orthogonal";
    /** In cells. */
    readonly width: number;
    readonly height: number;
    /** Grid cell size in pixels. */
    readonly tileWidth: number;
    readonly tileHeight: number;
    /** "#rrggbbaa", or null for none. */
    readonly backgroundColor: string | null;
    readonly parallaxOriginX: number;
    readonly parallaxOriginY: number;
    readonly tilesets: readonly TilemapTileset[];
    /** Parents before their children. */
    readonly groups: readonly TilemapGroup[];
    /** Bottom to top. */
    readonly layers: readonly TilemapLayer[];
    readonly properties: readonly TilemapProperty[];
}

type Json = Record<string, unknown>;

const MAX_TEXT = 255;
const MAX_STRING_PROPERTY = 65_535;
const MAX_FILE_PROPERTY = 1024;
const MAX_TILE_SIDE = 256;
const MAX_FIRST_GID = 268_435_455;
const MAX_NEXT_TILE_ID = 1_048_576;
const MAX_TILE_OFFSET = 4096;
const MAX_COLLISION_COORD = 4096;
const MAX_ID = 2_147_483_647;
const MAX_LAYER_OFFSET = 1_048_576;
const MAX_PARALLAX = 100;
const MAX_PARALLAX_ORIGIN = 1_048_576;
const MAX_IMAGE_SIDE = 8192;
const MAX_CELL = 0xffffffff;
const RESERVED_BIT = 0x10000000;
const GID_MASK = 0x0fffffff;

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COLOUR = /^#[0-9a-fA-F]{8}$/;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const TILE_ID = /^(?:0|[1-9][0-9]{0,6})$/;
const PROPERTY_TYPES = ["bool", "int", "float", "string", "color", "file"] as const;
const LAYER_TYPES = ["tile", "marker", "image"] as const;
const MARKER_SHAPES = ["rectangle", "ellipse", "point", "polygon", "polyline"] as const;
const COLLISION_SHAPES = ["rectangle", "ellipse", "polygon"] as const;

/** A name as a message shows it: quoted, and cut when it is very long. */
function quoted(text: string): string {
    return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}...` : text);
}

/** A value as a message shows it. Objects and arrays are named, not printed. */
function shown(value: unknown): string {
    if (value === undefined) return "nothing";
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    if (typeof value === "string") return quoted(value);
    return typeof value === "object" ? "an object" : String(value);
}

/** Throws the error for the member at `path`; `problem` completes the sentence. */
function fail(code: TilemapErrorCode, path: string, problem: string): never {
    throw new TilemapError(
        code,
        path,
        `${path === "" ? "The tilemap" : `\`${path}\``} ${problem}.`,
    );
}

/** The path of the member `key` of the object at `path`. */
function at(path: string, key: string): string {
    return path === "" ? key : `${path}.${key}`;
}

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string): Json {
    if (!isObject(value)) fail("field", path, `must be an object, got ${shown(value)}`);
    return value;
}

/**
 * The member `key` of the object at `path`: only its own members count (`__proto__` is a plain
 * name). A missing member is reported at its own path.
 */
function member(owner: Json, key: string, path: string): unknown {
    if (!Object.hasOwn(owner, key)) fail("field", at(path, key), "is missing");
    return owner[key];
}

/**
 * An array of `min` to `max` items, its length checked before any item is read. Above `max`
 * is a `limit` when `max` is a limit of FORMAT 3.6, otherwise a `field`.
 */
function array(
    value: unknown,
    path: string,
    min: number,
    max: number,
    overCode: "field" | "limit" = "field",
): readonly unknown[] {
    if (!Array.isArray(value)) fail("field", path, `must be an array, got ${shown(value)}`);
    const items: readonly unknown[] = value;
    if (items.length > max) {
        fail(overCode, path, `holds ${items.length} items; at most ${max} are allowed`);
    }
    if (items.length < min) {
        fail("field", path, `holds ${items.length} items; at least ${min} are required`);
    }
    return items;
}

function integer(value: unknown, path: string, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        fail("field", path, `must be an integer from ${min} to ${max}, got ${shown(value)}`);
    }
    // -0 is the integer 0.
    return value === 0 ? 0 : value;
}

function number(value: unknown, path: string, min = -Infinity, max = Infinity): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        const range = min === -Infinity && max === Infinity ? "" : ` from ${min} to ${max}`;
        fail("field", path, `must be a number${range}, got ${shown(value)}`);
    }
    return value === 0 ? 0 : value;
}

function boolean(value: unknown, path: string): boolean {
    if (typeof value !== "boolean")
        fail("field", path, `must be true or false, got ${shown(value)}`);
    return value;
}

function string(value: unknown, path: string, maxLength: number): string {
    if (typeof value !== "string") fail("field", path, `must be a string, got ${shown(value)}`);
    if (value.length > maxLength) {
        fail("field", path, `must be at most ${maxLength} UTF-16 code units long`);
    }
    return value;
}

/** Text of FORMAT 1.1; `nonBlank` asks for a character that `trim` keeps. */
function text(value: unknown, path: string, nonBlank = false): string {
    const result = string(value, path, MAX_TEXT);
    if (nonBlank && result.trim() === "") fail("field", path, "must not be blank");
    return result;
}

function isSlug(value: string): boolean {
    return SLUG.test(value) && value !== TILEMAP_FORMAT;
}

/**
 * Whether the text is a plain file name, as an atlas's `image` must be (sprite editor FORMAT
 * 2.2): not empty; no `/`, `\` or `:`; no control character; not dots alone; and the part
 * before the first dot, without trailing spaces and in any case, is no Windows device name.
 */
function isPlainFileName(name: string): boolean {
    if (name === "" || /[/\\:]/.test(name) || /^\.+$/.test(name)) return false;
    for (let index = 0; index < name.length; index += 1) {
        const code = name.charCodeAt(index);
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
    }
    const first = name.split(".")[0]!;
    // A loop, not `/ +$/`: that pattern backtracks over a run of spaces (quadratic time).
    let end = first.length;
    while (end > 0 && first.charCodeAt(end - 1) === 0x20) end -= 1;
    const base = first.slice(0, end).replace(/[A-Z]/g, (c) => c.toLowerCase());
    return !DEVICE_NAME.test(base);
}

function slug(value: unknown, path: string): string {
    if (typeof value !== "string" || !isSlug(value)) {
        fail(
            "field",
            path,
            `must be a slug of 1 to 64 characters matching [a-z0-9][a-z0-9_-]*, not ` +
                `"ngne-tilemap", got ${shown(value)}`,
        );
    }
    return value;
}

function colour(value: unknown, path: string): string {
    if (typeof value !== "string" || !COLOUR.test(value)) {
        fail("field", path, `must be a colour written "#rrggbbaa", got ${shown(value)}`);
    }
    return value;
}

function oneOf<Option extends string>(
    value: unknown,
    path: string,
    options: readonly Option[],
): Option {
    const found = options.find((option) => option === value);
    if (found === undefined) {
        const list = options.map((option) => `"${option}"`).join(", ");
        fail("field", path, `must be one of ${list}, got ${shown(value)}`);
    }
    return found;
}

/** An integer ID or null. */
function idOrNull(value: unknown, path: string): number | null {
    return value === null ? null : integer(value, path, 1, MAX_ID);
}

function readProperties(value: unknown, path: string): TilemapProperty[] {
    const list = array(value, path, 0, MAX_TILEMAP_PROPERTIES, "limit");
    const names = new Set<string>();
    return list.map((item, index): TilemapProperty => {
        const itemPath = `${path}[${index}]`;
        const owner = object(item, itemPath);
        const name = text(member(owner, "name", itemPath), at(itemPath, "name"), true);
        if (names.has(name))
            fail("field", at(itemPath, "name"), `repeats the name ${quoted(name)}`);
        names.add(name);
        const type = oneOf(member(owner, "type", itemPath), at(itemPath, "type"), PROPERTY_TYPES);
        const raw = member(owner, "value", itemPath);
        const valuePath = at(itemPath, "value");
        switch (type) {
            case "bool":
                return { name, type, value: boolean(raw, valuePath) };
            case "int":
                return {
                    name,
                    type,
                    value: integer(
                        raw,
                        valuePath,
                        -Number.MAX_SAFE_INTEGER,
                        Number.MAX_SAFE_INTEGER,
                    ),
                };
            case "float":
                return { name, type, value: number(raw, valuePath) };
            case "string":
                return { name, type, value: string(raw, valuePath, MAX_STRING_PROPERTY) };
            case "color":
                return { name, type, value: colour(raw, valuePath) };
            case "file":
                return { name, type, value: string(raw, valuePath, MAX_FILE_PROPERTY) };
        }
    });
}

/** How far a shape's coordinates may lie, and a running count of points when one is kept. */
interface ShapeRules {
    readonly kinds: readonly TilemapShape["shape"][];
    readonly coordinate: number;
    readonly points?: { count: number };
}

/** The shape of FORMAT 1.5 that the object `owner` at `path` describes. */
function readShape(owner: Json, path: string, rules: ShapeRules): TilemapShape {
    const shape = oneOf(member(owner, "shape", path), at(path, "shape"), rules.kinds);
    const coordinate = (key: string) =>
        number(member(owner, key, path), at(path, key), -rules.coordinate, rules.coordinate);
    const x = coordinate("x");
    const y = coordinate("y");
    switch (shape) {
        case "rectangle":
        case "ellipse":
            return {
                shape,
                x,
                y,
                width: number(member(owner, "width", path), at(path, "width"), 0),
                height: number(member(owner, "height", path), at(path, "height"), 0),
            };
        case "point":
            return { shape, x, y };
        case "polygon":
        case "polyline": {
            const pointsPath = at(path, "points");
            const list = array(
                member(owner, "points", path),
                pointsPath,
                shape === "polygon" ? 3 : 2,
                MAX_TILEMAP_SHAPE_POINTS,
                "limit",
            );
            if (rules.points !== undefined) {
                rules.points.count += list.length;
                if (rules.points.count > MAX_TILEMAP_MARKER_POINTS) {
                    fail(
                        "limit",
                        pointsPath,
                        `brings the marker points to ${rules.points.count}; at most ` +
                            `${MAX_TILEMAP_MARKER_POINTS} are allowed`,
                    );
                }
            }
            const points = list.map((item, index): TilemapPoint => {
                const pointPath = `${pointsPath}[${index}]`;
                const pair = array(item, pointPath, 2, 2);
                return [
                    number(pair[0], `${pointPath}[0]`, -rules.coordinate, rules.coordinate),
                    number(pair[1], `${pointPath}[1]`, -rules.coordinate, rules.coordinate),
                ];
            });
            return { shape, x, y, points };
        }
    }
}

const COLLISION_RULES: ShapeRules = { kinds: COLLISION_SHAPES, coordinate: MAX_COLLISION_COORD };

function readTileData(value: unknown, path: string, seen: Uint8Array): TileData {
    const owner = object(value, path);
    const id = integer(member(owner, "id", path), at(path, "id"), 0, seen.length - 1);
    if (seen[id] !== 0) fail("field", at(path, "id"), `repeats the tile ${id}`);
    seen[id] = 1;
    const collisionPath = at(path, "collision");
    const shapes = array(
        member(owner, "collision", path),
        collisionPath,
        0,
        MAX_TILEMAP_COLLISION_SHAPES,
        "limit",
    );
    return {
        id,
        class: text(member(owner, "class", path), at(path, "class")),
        collision: shapes.map((shape, index) => {
            const shapePath = `${collisionPath}[${index}]`;
            return readShape(object(shape, shapePath), shapePath, COLLISION_RULES);
        }),
        properties: readProperties(member(owner, "properties", path), at(path, "properties")),
    };
}

function readTileset(value: unknown, path: string): TilemapTileset {
    const owner = object(value, path);
    const read = (key: string) => member(owner, key, path);
    const name = slug(read("name"), at(path, "name"));
    const atlas = read("atlas");
    if (atlas !== `${name}.atlas.json`) {
        fail("field", at(path, "atlas"), `must be "${name}.atlas.json", got ${shown(atlas)}`);
    }
    const tileClass = text(read("class"), at(path, "class"));
    const firstGid = integer(read("firstGid"), at(path, "firstGid"), 1, MAX_FIRST_GID);
    const nextTileId = integer(read("nextTileId"), at(path, "nextTileId"), 1, MAX_NEXT_TILE_ID);
    const side = (key: string) => integer(read(key), at(path, key), 1, MAX_TILE_SIDE);
    const offset = (key: string) =>
        integer(read(key), at(path, key), -MAX_TILE_OFFSET, MAX_TILE_OFFSET);
    const tileWidth = side("tileWidth");
    const tileHeight = side("tileHeight");
    const offsetX = offset("offsetX");
    const offsetY = offset("offsetY");
    // Tile IDs are unique and below `nextTileId`, so the list is never longer than that.
    const tilesPath = at(path, "tiles");
    const list = array(read("tiles"), tilesPath, 0, nextTileId);
    const seen = new Uint8Array(nextTileId);
    const tiles = list.map((tile, index) => readTileData(tile, `${tilesPath}[${index}]`, seen));
    return {
        name,
        atlas: `${name}.atlas.json`,
        class: tileClass,
        firstGid,
        nextTileId,
        tileWidth,
        tileHeight,
        offsetX,
        offsetY,
        tiles,
        properties: readProperties(read("properties"), at(path, "properties")),
    };
}

function readGroup(value: unknown, path: string): TilemapGroup {
    const owner = object(value, path);
    const read = (key: string) => member(owner, key, path);
    return {
        id: integer(read("id"), at(path, "id"), 1, MAX_ID),
        name: text(read("name"), at(path, "name")),
        class: text(read("class"), at(path, "class")),
        parentId: idOrNull(read("parentId"), at(path, "parentId")),
        properties: readProperties(read("properties"), at(path, "properties")),
    };
}

/** Running totals over the layers of one tilemap, against FORMAT 3.6. */
interface LayerBudget {
    cells: number;
    markers: number;
    readonly points: { count: number };
}

function readMarker(value: unknown, path: string, budget: LayerBudget): TilemapMarker {
    const owner = object(value, path);
    const read = (key: string) => member(owner, key, path);
    // The shape decides the members, so it is read first.
    const shape = readShape(owner, path, {
        kinds: MARKER_SHAPES,
        coordinate: Infinity,
        points: budget.points,
    });
    return {
        ...shape,
        id: integer(read("id"), at(path, "id"), 1, MAX_ID),
        name: text(read("name"), at(path, "name")),
        class: text(read("class"), at(path, "class")),
        properties: readProperties(read("properties"), at(path, "properties")),
    };
}

function readLayer(
    value: unknown,
    path: string,
    size: { width: number; height: number },
    budget: LayerBudget,
): TilemapLayer {
    const owner = object(value, path);
    const read = (key: string) => member(owner, key, path);
    const id = integer(read("id"), at(path, "id"), 1, MAX_ID);
    const type = oneOf(read("type"), at(path, "type"), LAYER_TYPES);
    const offset = (key: string) =>
        integer(read(key), at(path, key), -MAX_LAYER_OFFSET, MAX_LAYER_OFFSET);
    const parallax = (key: string) => number(read(key), at(path, key), -MAX_PARALLAX, MAX_PARALLAX);
    const base = {
        id,
        name: text(read("name"), at(path, "name")),
        class: text(read("class"), at(path, "class")),
        groupId: idOrNull(read("groupId"), at(path, "groupId")),
        visible: boolean(read("visible"), at(path, "visible")),
        opacity: integer(read("opacity"), at(path, "opacity"), 0, 255),
        offsetX: offset("offsetX"),
        offsetY: offset("offsetY"),
        parallaxX: parallax("parallaxX"),
        parallaxY: parallax("parallaxY"),
        properties: readProperties(read("properties"), at(path, "properties")),
    };
    switch (type) {
        case "tile": {
            const dataPath = at(path, "data");
            const count = size.width * size.height;
            const list = array(read("data"), dataPath, count, count);
            budget.cells += count;
            if (budget.cells > MAX_TILEMAP_CELLS) {
                fail(
                    "limit",
                    dataPath,
                    `brings the cells of all tile layers to ${budget.cells}; at most ` +
                        `${MAX_TILEMAP_CELLS} are allowed`,
                );
            }
            const data = new Uint32Array(count);
            for (let index = 0; index < count; index += 1) {
                data[index] = integer(list[index], `${dataPath}[${index}]`, 0, MAX_CELL);
            }
            return { ...base, type, data };
        }
        case "marker": {
            const markersPath = at(path, "markers");
            const list = array(read("markers"), markersPath, 0, MAX_TILEMAP_MARKERS, "limit");
            budget.markers += list.length;
            if (budget.markers > MAX_TILEMAP_MARKERS) {
                fail(
                    "limit",
                    markersPath,
                    `brings the markers to ${budget.markers}; at most ${MAX_TILEMAP_MARKERS} ` +
                        `are allowed`,
                );
            }
            const markers = list.map((marker, index) =>
                readMarker(marker, `${markersPath}[${index}]`, budget),
            );
            return { ...base, type, markers };
        }
        case "image": {
            const image = read("image");
            if (typeof image !== "string" || !image.endsWith(".png") || !isPlainFileName(image)) {
                fail(
                    "field",
                    at(path, "image"),
                    `must be a plain file name "<image>.png", got ${shown(image)}`,
                );
            }
            const side = (key: string) => integer(read(key), at(path, key), 1, MAX_IMAGE_SIDE);
            return {
                ...base,
                type,
                image,
                imageWidth: side("imageWidth"),
                imageHeight: side("imageHeight"),
                repeatX: boolean(read("repeatX"), at(path, "repeatX")),
                repeatY: boolean(read("repeatY"), at(path, "repeatY")),
            };
        }
    }
}

/** Step 3 of FORMAT 3.8, in its order: group parents and cycles, `groupId`s, IDs, spans. */
function checkReferences(
    tilesets: readonly TilemapTileset[],
    groups: readonly TilemapGroup[],
    layers: readonly TilemapLayer[],
): void {
    const parents = new Map<number, number | null>();
    for (const group of groups) parents.set(group.id, group.parentId);
    groups.forEach((group, index) => {
        const path = `groups[${index}].parentId`;
        if (group.parentId === null) return;
        if (!parents.has(group.parentId)) {
            fail("reference", path, `names the group ${group.parentId}, which does not exist`);
        }
        // A chain longer than the number of groups goes round a cycle.
        let parent: number | null = group.parentId;
        for (let steps = 0; parent !== null; steps += 1) {
            if (parent === group.id || steps > groups.length) {
                fail("reference", path, `makes the group ${group.id} its own ancestor`);
            }
            parent = parents.get(parent) ?? null;
        }
    });
    layers.forEach((layer, index) => {
        if (layer.groupId !== null && !parents.has(layer.groupId)) {
            fail(
                "reference",
                `layers[${index}].groupId`,
                `names the group ${layer.groupId}, which does not exist`,
            );
        }
    });

    const ids = new Set<number>();
    const unique = (id: number, path: string) => {
        if (ids.has(id)) fail("field", path, `repeats the ID ${id} of another group or layer`);
        ids.add(id);
    };
    groups.forEach((group, index) => unique(group.id, `groups[${index}].id`));
    layers.forEach((layer, index) => unique(layer.id, `layers[${index}].id`));

    const markerIds = new Set<number>();
    layers.forEach((layer, index) => {
        if (layer.type !== "marker") return;
        layer.markers.forEach((marker, markerIndex) => {
            if (markerIds.has(marker.id)) {
                fail(
                    "field",
                    `layers[${index}].markers[${markerIndex}].id`,
                    `repeats the marker ID ${marker.id}`,
                );
            }
            markerIds.add(marker.id);
        });
    });

    const order = tilesets.map((_, index) => index);
    order.sort((a, b) => tilesets[a]!.firstGid - tilesets[b]!.firstGid);
    for (let k = 1; k < order.length; k += 1) {
        const before = tilesets[order[k - 1]!]!;
        const index = order[k]!;
        if (tilesets[index]!.firstGid < before.firstGid + before.nextTileId) {
            fail(
                "field",
                `tilesets[${index}].firstGid`,
                `starts a span inside the span of the tileset ${quoted(before.name)}`,
            );
        }
    }
}

/** The even side of a rectangle that holds `size` pixels (FORMAT 4). */
function even(size: number): number {
    return size + (size % 2);
}

/**
 * Step 4 of FORMAT 3.8 for one tileset: its atlas against FORMAT 4. Returns, per tile ID
 * below `nextTileId`, 1 where the atlas has the tile's frame.
 */
function checkAtlas(
    tileset: TilemapTileset,
    path: string,
    atlases: Readonly<Record<string, unknown>>,
): Uint8Array {
    const { name } = tileset;
    // Typed on the name, so that a call narrows like `fail` does.
    const bad: (problem: string) => never = (problem) =>
        fail("atlas", path, `names an atlas that ${problem}`);
    if (!Object.hasOwn(atlases, name)) fail("atlas", path, `names an atlas that was not given`);
    const atlas = atlases[name];
    if (!isObject(atlas)) bad("is not an object");
    const own = (owner: Json, key: string, where: string): unknown => {
        if (!Object.hasOwn(owner, key)) bad(`has no member \`${at(where, key)}\``);
        return owner[key];
    };
    if (own(atlas, "image", "") !== `${name}.png`) bad(`does not have the image "${name}.png"`);
    const frames = own(atlas, "frames", "");
    const animations = own(atlas, "animations", "");
    if (!isObject(frames) || !isObject(animations)) bad("has no frames or animations object");

    const present = new Uint8Array(tileset.nextTileId);
    const prefix = `${name}-`;
    const expected: readonly [string, unknown][] = [
        ["w", even(tileset.tileWidth)],
        ["h", even(tileset.tileHeight)],
        ["sourceW", tileset.tileWidth],
        ["sourceH", tileset.tileHeight],
        ["offsetX", 0],
        ["offsetY", 0],
    ];
    for (const id of Object.keys(frames)) {
        const tile = id.startsWith(prefix) ? id.slice(prefix.length) : "";
        if (!TILE_ID.test(tile) || Number(tile) >= tileset.nextTileId) {
            bad(`has the frame ${quoted(id)}, which is no tile of the tileset`);
        }
        const where = `frames[${quoted(id)}]`;
        const frame = frames[id];
        if (!isObject(frame)) bad(`has a frame \`${where}\` that is not an object`);
        for (const [key, value] of expected) {
            if (own(frame, key, where) !== value) {
                bad(`has \`${at(where, key)}\` other than ${String(value)}`);
            }
        }
        const pivot = own(frame, "pivot", where);
        if (!Array.isArray(pivot) || pivot.length !== 2 || pivot[0] !== 0 || pivot[1] !== 1) {
            bad(`has \`${at(where, "pivot")}\` other than [0, 1]`);
        }
        present[Number(tile)] = 1;
    }
    for (const id of Object.keys(animations)) {
        const where = `animations[${quoted(id)}]`;
        if (!Object.hasOwn(frames, id)) bad(`has \`${where}\`, which names no tile's frame`);
        const animation = animations[id];
        if (!isObject(animation)) bad(`has an animation \`${where}\` that is not an object`);
        if (own(animation, "playback", where) !== "loop") {
            bad(`has \`${at(where, "playback")}\` other than "loop"`);
        }
        const entries = own(animation, "entries", where);
        if (!Array.isArray(entries)) bad(`has \`${at(where, "entries")}\` that is not an array`);
        const list: readonly unknown[] = entries;
        list.forEach((entry, index) => {
            const entryPath = `${at(where, "entries")}[${index}]`;
            if (!isObject(entry)) bad(`has \`${entryPath}\` that is not an object`);
            const frame = own(entry, "frame", entryPath);
            if (typeof frame !== "string" || !Object.hasOwn(frames, frame)) {
                bad(`has \`${at(entryPath, "frame")}\`, which names no frame`);
            }
        });
    }
    return present;
}

/** Step 4 of FORMAT 3.8: atlases, cells and tile data against the tiles that exist. */
function checkTiles(tilemap: Tilemap, atlases: Readonly<Record<string, unknown>>): void {
    const { tilesets } = tilemap;
    const present = tilesets.map((tileset, index) =>
        checkAtlas(tileset, `tilesets[${index}].atlas`, atlases),
    );

    // Tilesets by ascending `firstGid`; spans do not overlap (step 3).
    const order = tilesets.map((_, index) => index);
    order.sort((a, b) => tilesets[a]!.firstGid - tilesets[b]!.firstGid);
    const starts = order.map((index) => tilesets[index]!.firstGid);
    tilemap.layers.forEach((layer, layerIndex) => {
        if (layer.type !== "tile") return;
        const { data } = layer;
        for (let index = 0; index < data.length; index += 1) {
            const value = data[index]!;
            if (value === 0) continue;
            const path = `layers[${layerIndex}].data[${index}]`;
            if ((value & RESERVED_BIT) !== 0) fail("field", path, "has the reserved bit 28 set");
            const gid = value & GID_MASK;
            if (gid === 0) fail("field", path, "is an empty cell with a flag set");
            // The last span that starts at or below the GID.
            let low = 0;
            let high = starts.length - 1;
            while (low <= high) {
                const middle = (low + high) >> 1;
                if (starts[middle]! <= gid) low = middle + 1;
                else high = middle - 1;
            }
            const tilesetIndex = high < 0 ? -1 : order[high]!;
            const tileset = tilesets[tilesetIndex];
            if (tileset === undefined || gid - tileset.firstGid >= tileset.nextTileId) {
                fail("reference", path, `holds the GID ${gid}, which lies outside every span`);
            }
            if (present[tilesetIndex]![gid - tileset.firstGid] === 0) {
                fail(
                    "reference",
                    path,
                    `names the tile ${gid - tileset.firstGid} of the tileset ` +
                        `${quoted(tileset.name)}, which its atlas does not have`,
                );
            }
        }
    });

    tilesets.forEach((tileset, index) => {
        tileset.tiles.forEach((tile, tileIndex) => {
            if (present[index]![tile.id] === 0) {
                fail(
                    "reference",
                    `tilesets[${index}].tiles[${tileIndex}].id`,
                    `names the tile ${tile.id}, which the atlas does not have`,
                );
            }
        });
    });
}

function read(json: unknown, atlases: Readonly<Record<string, unknown>>): Tilemap {
    // Step 1: what the value is.
    if (!isObject(json)) fail("format", "", `must be an object, got ${shown(json)}`);
    const format = Object.hasOwn(json, "format") ? json.format : undefined;
    if (format !== TILEMAP_FORMAT) {
        fail("format", "format", `must be "${TILEMAP_FORMAT}", got ${shown(format)}`);
    }
    // Any integer of at least 1, however large: above the newest is `newer-version` (FORMAT 3.2).
    const version = integer(member(json, "version", ""), "version", 1, Infinity);
    if (version > TILEMAP_VERSION) {
        fail(
            "newer-version",
            "version",
            `is ${version}; this reader reads versions 1 to ${TILEMAP_VERSION}`,
        );
    }

    // Step 2: every member, in the order of the tables.
    const top = (key: string) => member(json, key, "");
    const generator = text(top("generator"), "generator");
    const project = slug(top("project"), "project");
    const name = slug(top("name"), "name");
    const title = text(top("title"), "title");
    const mapClass = text(top("class"), "class");
    const orientation = oneOf(top("orientation"), "orientation", ["orthogonal"] as const);
    const width = integer(top("width"), "width", 1, MAX_TILEMAP_SIDE);
    const height = integer(top("height"), "height", 1, MAX_TILEMAP_SIDE);
    if (width * height > MAX_TILEMAP_LAYER_CELLS) {
        fail(
            "limit",
            "height",
            `makes a map of ${width * height} cells; at most ${MAX_TILEMAP_LAYER_CELLS} are allowed`,
        );
    }
    const tileWidth = integer(top("tileWidth"), "tileWidth", 1, MAX_TILE_SIDE);
    const tileHeight = integer(top("tileHeight"), "tileHeight", 1, MAX_TILE_SIDE);
    const background = top("backgroundColor");
    const backgroundColor = background === null ? null : colour(background, "backgroundColor");
    const origin = (key: string) =>
        number(top(key), key, -MAX_PARALLAX_ORIGIN, MAX_PARALLAX_ORIGIN);
    const parallaxOriginX = origin("parallaxOriginX");
    const parallaxOriginY = origin("parallaxOriginY");

    const tilesetList = array(top("tilesets"), "tilesets", 0, MAX_TILEMAP_TILESETS, "limit");
    const groupList = array(top("groups"), "groups", 0, MAX_TILEMAP_LAYERS, "limit");
    const layerList = array(top("layers"), "layers", 1, MAX_TILEMAP_LAYERS, "limit");
    if (groupList.length + layerList.length > MAX_TILEMAP_LAYERS) {
        fail(
            "limit",
            "layers",
            `and \`groups\` hold ${groupList.length + layerList.length} items together; at ` +
                `most ${MAX_TILEMAP_LAYERS} are allowed`,
        );
    }
    const tilesets = tilesetList.map((tileset, index) =>
        readTileset(tileset, `tilesets[${index}]`),
    );
    const groups = groupList.map((group, index) => readGroup(group, `groups[${index}]`));
    const budget: LayerBudget = { cells: 0, markers: 0, points: { count: 0 } };
    const layers = layerList.map((layer, index) =>
        readLayer(layer, `layers[${index}]`, { width, height }, budget),
    );
    const properties = readProperties(top("properties"), "properties");

    // Step 3: cross-references.
    checkReferences(tilesets, groups, layers);

    const tilemap: Tilemap = {
        format: TILEMAP_FORMAT,
        version,
        generator,
        project,
        name,
        title,
        class: mapClass,
        orientation,
        width,
        height,
        tileWidth,
        tileHeight,
        backgroundColor,
        parallaxOriginX,
        parallaxOriginY,
        tilesets,
        groups,
        layers,
        properties,
    };
    // Step 4: tiles against the atlases.
    checkTiles(tilemap, atlases);
    return tilemap;
}

/**
 * Reads a parsed `ngne-tilemap` (FORMAT 3) with the atlases of its tilesets, each by tileset
 * name as `ngne-sprite-atlas` checked it. Checks, in order, and stops at the first problem:
 * 1. the value is an object of this `format`, of a `version` this reader knows;
 * 2. every member is present, of its type and in its range, counts before elements;
 * 3. groups, IDs and tileset spans;
 * 4. every tileset against its atlas (FORMAT 4), every cell and tile data against the tiles.
 *
 * `json` is untrusted: only own members are read, and a member called `__proto__` is data like
 * any other. The result is new and holds the members of the format and no other; each tile
 * layer's `data` is a new `Uint32Array`.
 *
 * Throws `TilemapError`, and nothing else.
 */
export function validateTilemap(
    json: unknown,
    atlases: Readonly<Record<string, unknown>>,
): Tilemap {
    try {
        return read(json, atlases);
    } catch (error) {
        if (error instanceof TilemapError) throw error;
        // A value that throws when it is read is not parsed JSON, and no tilemap either.
        throw new TilemapError("format", "", "The tilemap cannot be read.", { cause: error });
    }
}

/**
 * Reads a parsed `ngne-tilemap` with the parsed atlas JSON of its tilesets, by tileset name: the
 * checks of `validateTilemap`, atlases included, after migrating an older version to the newest
 * (version 1 is the only one so far, so nothing is migrated yet).
 *
 * Each call returns new objects; each tile layer's `data` is a new `Uint32Array` of cell values
 * that the game may change. The draw and data functions read the current arrays, so an edit
 * shows and collides at once; a game that wants the original keeps a copy (`data.slice()`).
 *
 * Throws `TilemapError`, and nothing else.
 */
export function readTilemap(json: unknown, atlases: Readonly<Record<string, unknown>>): Tilemap {
    const tilemap = validateTilemap(json, atlases);
    lookupOf(tilemap);
    try {
        drawStates.set(tilemap, prepareDraw(tilemap, atlases));
    } catch (error) {
        throw new TilemapError("atlas", "", "An atlas of the tilemap cannot be read.", {
            cause: error,
        });
    }
    return tilemap;
}

/** Where the files of a tileset's atlas are. */
export interface AtlasUrls {
    readonly json: string;
    readonly png: string;
}

/** The response of `fetch` as `loadTilemap` uses it. */
interface FetchedFile {
    readonly ok: boolean;
    readonly status: number;
    readonly headers: { get(name: string): string | null };
    text(): Promise<string>;
}

/** The number of bytes `text` takes in UTF-8. */
function utf8Size(text: string): number {
    let size = 0;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code < 0x80) size += 1;
        else if (code < 0x800) size += 2;
        else if (code >= 0xd800 && code < 0xdc00 && index + 1 < text.length) {
            const next = text.charCodeAt(index + 1);
            const pair = next >= 0xdc00 && next < 0xe000;
            size += pair ? 4 : 3;
            if (pair) index += 1;
        } else size += 3;
    }
    return size;
}

/**
 * Fetches a text file whole; refuses an HTTP status that is not ok, and a file above `limit`
 * bytes (by its declared length before reading it, then by its UTF-8 size).
 */
async function fetchText(
    url: string,
    signal: AbortSignal | undefined,
    limit: number,
): Promise<string> {
    const response: FetchedFile = await fetch(url, signal === undefined ? undefined : { signal });
    if (!response.ok) {
        throw new Error(`Loading ${url} failed with HTTP status ${response.status}.`);
    }
    const tooLarge = (size: number) =>
        new TilemapError(
            "limit",
            "",
            `The tilemap file holds ${size} bytes; at most ${limit} are allowed.`,
        );
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > limit) throw tooLarge(declared);
    const text = await response.text();
    // Only a file that may be too large is counted: UTF-8 never takes fewer bytes than UTF-16
    // code units, nor more than three per unit.
    if (text.length * 3 > limit) {
        const size = utf8Size(text);
        if (size > limit) throw tooLarge(size);
    }
    return text;
}

/** Parses JSON text; null when it is no JSON. */
function parseJson(text: string): { readonly value: unknown } | null {
    try {
        return { value: JSON.parse(text) as unknown };
    } catch {
        return null;
    }
}

/** The tileset names a parsed tilemap lists, as far as they can be read; the reader checks them. */
function listedTilesets(json: unknown): string[] {
    if (!isObject(json) || !Object.hasOwn(json, "tilesets")) return [];
    const list: unknown = json.tilesets;
    if (!Array.isArray(list) || list.length > MAX_TILEMAP_TILESETS) return [];
    const names: string[] = [];
    for (const item of list as readonly unknown[]) {
        if (!isObject(item) || !Object.hasOwn(item, "name")) continue;
        const name = item.name;
        if (typeof name === "string" && isSlug(name) && !names.includes(name)) names.push(name);
    }
    return names;
}

/**
 * Loads the tilemap `name` of this folder: fetches its JSON and the atlas JSON of its tilesets
 * through `TILEMAP_URLS` and `ATLAS_URLS`, then reads them with `readTilemap`. `signal` aborts
 * every request.
 *
 * Rejects with a `TilemapError` when a file is not a valid tilemap or atlas, or when the tilemap
 * file is above `MAX_TILEMAP_BYTES` (refused before it is parsed); with an `Error` for a name
 * the tables lack or an HTTP status that is not ok; and with what `fetch` rejects with when a
 * request fails or is aborted.
 */
export async function loadTilemap(name: TilemapName, signal?: AbortSignal): Promise<Tilemap> {
    const tilemapUrls: Readonly<Record<string, string | undefined>> = TILEMAP_URLS;
    const atlasUrls: Readonly<Record<string, AtlasUrls | undefined>> = ATLAS_URLS;
    const url = Object.hasOwn(tilemapUrls, name) ? tilemapUrls[name] : undefined;
    if (url === undefined) throw new Error(`This folder has no tilemap named ${quoted(name)}.`);
    const parsed = parseJson(await fetchText(url, signal, MAX_TILEMAP_BYTES));
    if (parsed === null) throw new TilemapError("format", "", "The tilemap is not JSON.");
    const atlases: Record<string, unknown> = {};
    await Promise.all(
        listedTilesets(parsed.value).map(async (tileset) => {
            const urls = Object.hasOwn(atlasUrls, tileset) ? atlasUrls[tileset] : undefined;
            if (urls === undefined) return;
            const atlas = parseJson(await fetchText(urls.json, signal, Infinity));
            // An atlas that is no JSON is reported by the reader as not an object.
            atlases[tileset] = atlas === null ? null : atlas.value;
        }),
    );
    return readTilemap(parsed.value, atlases);
}

/** The asset ID, and so the texture ID, of a tileset's or an image's PNG in this folder. */
function assetId(tilemap: Tilemap, name: string): string {
    return `ngne-tilemap:${tilemap.project}/${name}`;
}

/** The export name of an image layer's image: its file name without `.png`. */
function imageName(layer: ImageLayerData): string {
    return layer.image.slice(0, -".png".length);
}

/** Asset definitions by ID, made once per module: NGNE checks assets by identity. */
const assetDefinitions = new Map<string, unknown>();

/**
 * The image assets a scene needs to draw `tilemap`: one per tileset and one per image, in that
 * order, each with the ID `ngne-tilemap:<project>/<export name>` and the URL of its PNG in this
 * folder. `imageAsset` is the game's engine's `imageAsset`; it is called once per ID for the
 * life of the module, so every call returns the same objects.
 */
export function assetsFor<A>(
    tilemap: Tilemap,
    imageAsset: (id: string, url: string) => A,
): readonly A[] {
    const atlasUrls: Readonly<Record<string, AtlasUrls | undefined>> = ATLAS_URLS;
    const imageUrls: Readonly<Record<string, string | undefined>> = IMAGE_URLS;
    const assets: A[] = [];
    const listed = new Set<string>();
    const add = (name: string, url: string) => {
        const id = assetId(tilemap, name);
        if (listed.has(id)) return;
        listed.add(id);
        if (!assetDefinitions.has(id)) assetDefinitions.set(id, imageAsset(id, url));
        assets.push(assetDefinitions.get(id) as A);
    };
    for (const tileset of tilemap.tilesets) {
        const urls = Object.hasOwn(atlasUrls, tileset.name) ? atlasUrls[tileset.name] : undefined;
        add(tileset.name, urls?.png ?? `${tileset.name}.png`);
    }
    for (const layer of tilemap.layers) {
        if (layer.type !== "image") continue;
        const name = imageName(layer);
        const url = Object.hasOwn(imageUrls, name) ? imageUrls[name] : undefined;
        add(name, url ?? layer.image);
    }
    return assets;
}

/** A cell's tile: its tileset, its ID in the tileset and its orientation (FORMAT 1.2). */
export interface TileRef {
    readonly tileset: TilemapTileset;
    readonly id: number;
    readonly flipH: boolean;
    readonly flipV: boolean;
    readonly flipD: boolean;
}

/** A cell's tile with what its tileset says of it; a tile without tile data has none of it. */
export interface TileInfo extends TileRef {
    /** "" for none. */
    readonly class: string;
    readonly properties: readonly TilemapProperty[];
    /** In tile pixels, untransformed. */
    readonly collision: readonly TilemapShape[];
}

/** A collision shape in map pixels, with the cell and the tile it came from. */
export type CollisionShape = TilemapShape & {
    readonly cellX: number;
    readonly cellY: number;
    readonly tile: TileRef;
};

/** An axis-aligned rectangle in map pixels. */
export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** What the data functions computed for a tile layer, until its cells change. */
interface LayerCache {
    // By property name; by predicate in a WeakMap, so a predicate made anew per call is not kept.
    readonly grids: Map<string, Uint8Array>;
    readonly predicateGrids: WeakMap<(tile: TileInfo) => boolean, Uint8Array>;
    shapes: readonly CollisionShape[] | null;
    rects: readonly Rect[] | null;
}

/** How the cell values of a tilemap name tiles, and the caches of its layers. */
interface Lookup {
    /** Tilesets by ascending `firstGid`, and those `firstGid`s. */
    readonly order: readonly TilemapTileset[];
    readonly starts: readonly number[];
    /** Per entry of `order`: tile data by tile ID. */
    readonly tileData: readonly ReadonlyMap<number, TileData>[];
    /** The tile of each non-empty cell value met so far. */
    readonly tiles: Map<number, TileInfo | null>;
    readonly caches: Map<TileLayerData, LayerCache>;
}

const lookups = new WeakMap<Tilemap, Lookup>();

function lookupOf(tilemap: Tilemap): Lookup {
    let lookup = lookups.get(tilemap);
    if (lookup === undefined) {
        const order = [...tilemap.tilesets].sort((a, b) => a.firstGid - b.firstGid);
        lookup = {
            order,
            starts: order.map((tileset) => tileset.firstGid),
            tileData: order.map(
                (tileset) =>
                    new Map(tileset.tiles.map((tile): [number, TileData] => [tile.id, tile])),
            ),
            tiles: new Map(),
            caches: new Map(),
        };
        lookups.set(tilemap, lookup);
    }
    return lookup;
}

const NO_SHAPES: readonly TilemapShape[] = [];
const NO_PROPERTIES: readonly TilemapProperty[] = [];

/**
 * The tile a cell value names, or null for an empty cell and for a value that names no tile
 * (reserved bit set, flags without a GID, a GID outside every span), as a game's own write may.
 */
function tileOf(tilemap: Tilemap, value: number): TileInfo | null {
    const cell = value >>> 0;
    if (cell === 0) return null;
    const lookup = lookupOf(tilemap);
    const known = lookup.tiles.get(cell);
    if (known !== undefined) return known;
    let tile: TileInfo | null = null;
    const gid = cell & GID_MASK;
    if ((cell & RESERVED_BIT) === 0 && gid !== 0) {
        // The last span that starts at or below the GID.
        const { starts } = lookup;
        let low = 0;
        let high = starts.length - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (starts[middle]! <= gid) low = middle + 1;
            else high = middle - 1;
        }
        const tileset = lookup.order[high];
        if (tileset !== undefined && gid - tileset.firstGid < tileset.nextTileId) {
            const id = gid - tileset.firstGid;
            const data = lookup.tileData[high]!.get(id);
            tile = {
                tileset,
                id,
                flipH: cell >>> 31 === 1,
                flipV: ((cell >>> 30) & 1) === 1,
                flipD: ((cell >>> 29) & 1) === 1,
                class: data?.class ?? "",
                properties: data?.properties ?? NO_PROPERTIES,
                collision: data?.collision ?? NO_SHAPES,
            };
        }
    }
    lookup.tiles.set(cell, tile);
    return tile;
}

/** The index in `data` of the cell under the map pixel `x, y`, or -1 outside the map. */
function cellIndexAt(tilemap: Tilemap, layer: TileLayerData, x: number, y: number): number {
    const cellX = Math.floor((x - layer.offsetX) / tilemap.tileWidth);
    const cellY = Math.floor((y - layer.offsetY) / tilemap.tileHeight);
    if (!(cellX >= 0 && cellX < tilemap.width && cellY >= 0 && cellY < tilemap.height)) return -1;
    return cellY * tilemap.width + cellX;
}

function tileUnder(tilemap: Tilemap, layer: TileLayerData, x: number, y: number): TileInfo | null {
    const index = cellIndexAt(tilemap, layer, x, y);
    return index < 0 ? null : tileOf(tilemap, layer.data[index] ?? 0);
}

function cacheOf(tilemap: Tilemap, layer: TileLayerData): LayerCache {
    const { caches } = lookupOf(tilemap);
    let cache = caches.get(layer);
    if (cache === undefined) {
        cache = { grids: new Map(), predicateGrids: new WeakMap(), shapes: null, rects: null };
        caches.set(layer, cache);
    }
    return cache;
}

/**
 * The first layer named `name`, from the bottom (as Tiled's `Map::findLayer`); undefined for
 * none. Names are case-sensitive and need not be unique.
 */
export function findLayer(tilemap: Tilemap, name: string): TilemapLayer | undefined {
    return tilemap.layers.find((layer) => layer.name === name);
}

/**
 * The tile of the cell under the map pixel `x, y` of `layer` (parallax 1, the layer's offset
 * included), or null for an empty cell or a point outside the map. Every cell with the same
 * value gives the same object.
 */
export function tileAt(
    tilemap: Tilemap,
    layer: TileLayerData,
    x: number,
    y: number,
): TileRef | null {
    return tileUnder(tilemap, layer, x, y);
}

/** The class of the tile under the map pixel `x, y`; "" for none or no tile. */
export function classAt(tilemap: Tilemap, layer: TileLayerData, x: number, y: number): string {
    return tileUnder(tilemap, layer, x, y)?.class ?? "";
}

/** The value of the property `name` of the tile under the map pixel `x, y`, if it has one. */
export function propertyAt(
    tilemap: Tilemap,
    layer: TileLayerData,
    x: number,
    y: number,
    name: string,
): PropertyValue | undefined {
    const tile = tileUnder(tilemap, layer, x, y);
    return tile?.properties.find((property) => property.name === name)?.value;
}

/** Whether a property value counts as set: `true`, a non-zero number or a non-empty string. */
function isSet(value: PropertyValue | undefined): boolean {
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value !== "";
    return value === true;
}

/**
 * `width * height` bytes, row by row from the top-left as `data`: 1 where the cell's tile has
 * the property `select` set (`true`, a non-zero number or a non-empty string), or where the
 * predicate `select` holds; 0 elsewhere and for empty cells. The predicate is called once per
 * distinct cell value. Cached per layer and `select` until `setCell` or `invalidate`; the array
 * is shared, so copy it before changing it.
 */
export function grid(
    tilemap: Tilemap,
    layer: TileLayerData,
    select: string | ((tile: TileInfo) => boolean),
): Uint8Array {
    const cache = cacheOf(tilemap, layer);
    const cached =
        typeof select === "string" ? cache.grids.get(select) : cache.predicateGrids.get(select);
    if (cached !== undefined) return cached;
    const holds =
        typeof select === "string"
            ? (tile: TileInfo) =>
                  isSet(tile.properties.find((property) => property.name === select)?.value)
            : select;
    const count = tilemap.width * tilemap.height;
    const result = new Uint8Array(count);
    const verdicts = new Map<number, boolean>();
    for (let index = 0; index < count; index += 1) {
        const value = layer.data[index] ?? 0;
        if (value === 0) continue;
        let verdict = verdicts.get(value);
        if (verdict === undefined) {
            const tile = tileOf(tilemap, value);
            verdict = tile !== null && holds(tile);
            verdicts.set(value, verdict);
        }
        if (verdict) result[index] = 1;
    }
    if (typeof select === "string") cache.grids.set(select, result);
    else cache.predicateGrids.set(select, result);
    return result;
}

/**
 * Where the tile of a cell is drawn (FORMAT 1.3): the centre of its content in map pixels at
 * parallax 1, half its size, and its orientation as NGNE sprite values (FORMAT 1.2).
 */
interface Placement {
    readonly centreX: number;
    readonly centreY: number;
    readonly halfWidth: number;
    readonly halfHeight: number;
    readonly fx: number;
    readonly fy: number;
    /** theta is pi/2 (D set) rather than 0. */
    readonly turned: boolean;
}

function placementOf(
    tilemap: Tilemap,
    layer: TileLayerData,
    tile: TileRef,
    cellX: number,
    cellY: number,
): Placement {
    const { tileWidth, tileHeight, offsetX, offsetY } = tile.tileset;
    const boxWidth = tile.flipD ? tileHeight : tileWidth;
    const boxHeight = tile.flipD ? tileWidth : tileHeight;
    // With D set, Tiled draws at 90 degrees with H' = V and V' = not H (FORMAT 1.2).
    const mirrorX = tile.flipD ? tile.flipV : tile.flipH;
    const mirrorY = tile.flipD ? !tile.flipH : tile.flipV;
    return {
        centreX: cellX * tilemap.tileWidth + offsetX + boxWidth / 2 + layer.offsetX,
        centreY: (cellY + 1) * tilemap.tileHeight + offsetY - boxHeight / 2 + layer.offsetY,
        halfWidth: tileWidth / 2,
        halfHeight: tileHeight / 2,
        fx: mirrorX ? -1 : 1,
        fy: mirrorY ? -1 : 1,
        turned: tile.flipD,
    };
}

/** x of `R(theta) (fx a, fy b)`: where the offset `(a, b)` from the tile's centre lands. */
function turnedX(place: Placement, a: number, b: number): number {
    // `+ 0` turns -0 into 0.
    return (place.turned ? -place.fy * b : place.fx * a) + 0;
}

/** y of `R(theta) (fx a, fy b)`. */
function turnedY(place: Placement, a: number, b: number): number {
    return (place.turned ? place.fx * a : place.fy * b) + 0;
}

/** A shape in tile pixels, oriented about the tile's centre and placed, in map pixels. */
function placeShape(shape: TilemapShape, place: Placement): TilemapShape {
    const pointX = (x: number, y: number) =>
        place.centreX + turnedX(place, x - place.halfWidth, y - place.halfHeight);
    const pointY = (x: number, y: number) =>
        place.centreY + turnedY(place, x - place.halfWidth, y - place.halfHeight);
    switch (shape.shape) {
        case "rectangle":
        case "ellipse": {
            const x0 = pointX(shape.x, shape.y);
            const y0 = pointY(shape.x, shape.y);
            const x1 = pointX(shape.x + shape.width, shape.y + shape.height);
            const y1 = pointY(shape.x + shape.width, shape.y + shape.height);
            return {
                shape: shape.shape,
                x: Math.min(x0, x1),
                y: Math.min(y0, y1),
                width: Math.abs(x1 - x0),
                height: Math.abs(y1 - y0),
            };
        }
        case "point":
            return { shape: "point", x: pointX(shape.x, shape.y), y: pointY(shape.x, shape.y) };
        case "polygon":
        case "polyline":
            return {
                shape: shape.shape,
                x: pointX(shape.x, shape.y),
                y: pointY(shape.x, shape.y),
                points: shape.points.map(([a, b]): TilemapPoint => [
                    turnedX(place, a, b),
                    turnedY(place, a, b),
                ]),
            };
    }
}

/**
 * The collision shapes of every non-empty cell of `layer`, row by row from the top-left and in
 * each tile's order: oriented as the cell is, about the tile's centre, and placed as FORMAT 1.3
 * places the tile, in map pixels at parallax 1 with the layer's offset. Rectangles and ellipses
 * stay axis-aligned under every orientation. Cached per layer until `setCell` or `invalidate`.
 */
export function collisionShapes(tilemap: Tilemap, layer: TileLayerData): readonly CollisionShape[] {
    const cache = cacheOf(tilemap, layer);
    if (cache.shapes !== null) return cache.shapes;
    const shapes: CollisionShape[] = [];
    for (let cellY = 0; cellY < tilemap.height; cellY += 1) {
        for (let cellX = 0; cellX < tilemap.width; cellX += 1) {
            const tile = tileOf(tilemap, layer.data[cellY * tilemap.width + cellX] ?? 0);
            if (tile === null || tile.collision.length === 0) continue;
            const place = placementOf(tilemap, layer, tile, cellX, cellY);
            for (const shape of tile.collision) {
                shapes.push({ ...placeShape(shape, place), cellX, cellY, tile });
            }
        }
    }
    cache.shapes = shapes;
    return shapes;
}

/** Whether a tile's collision is exactly one rectangle covering the whole tile. */
function isSolid(tile: TileInfo): boolean {
    if (tile.collision.length !== 1) return false;
    const shape = tile.collision[0]!;
    return (
        shape.shape === "rectangle" &&
        shape.x === 0 &&
        shape.y === 0 &&
        shape.width === tile.tileset.tileWidth &&
        shape.height === tile.tileset.tileHeight
    );
}

interface GrowingRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * The cells of `layer` whose tile's collision is exactly one rectangle covering the whole tile,
 * merged into rectangles in map pixels: in each row, the drawn boxes of neighbouring cells that
 * meet edge to edge make one run; a run with the same x range as a rectangle that ends, in the
 * row above, where the run starts extends that rectangle down. Rectangles come in the order
 * they start, row by row from the top-left, so the result depends on the cells alone. Other
 * shapes are only in `collisionShapes`. Cached per layer until `setCell` or `invalidate`.
 */
export function collisionRects(tilemap: Tilemap, layer: TileLayerData): readonly Rect[] {
    const cache = cacheOf(tilemap, layer);
    if (cache.rects !== null) return cache.rects;
    const rects: GrowingRect[] = [];
    // The rectangles that took a run in the row above, by their left edge.
    let above = new Map<number, GrowingRect[]>();
    const runs: GrowingRect[] = [];
    for (let cellY = 0; cellY < tilemap.height; cellY += 1) {
        runs.length = 0;
        for (let cellX = 0; cellX < tilemap.width; cellX += 1) {
            const tile = tileOf(tilemap, layer.data[cellY * tilemap.width + cellX] ?? 0);
            if (tile === null || !isSolid(tile)) continue;
            const { tileWidth, tileHeight, offsetX, offsetY } = tile.tileset;
            const width = tile.flipD ? tileHeight : tileWidth;
            const height = tile.flipD ? tileWidth : tileHeight;
            const x = cellX * tilemap.tileWidth + offsetX + layer.offsetX;
            const y = (cellY + 1) * tilemap.tileHeight + offsetY + layer.offsetY - height;
            const run = runs[runs.length - 1];
            if (
                run !== undefined &&
                run.x + run.width === x &&
                run.y === y &&
                run.height === height
            ) {
                run.width += width;
            } else {
                runs.push({ x, y, width, height });
            }
        }
        const taken = new Map<number, GrowingRect[]>();
        for (const run of runs) {
            const candidates = above.get(run.x) ?? [];
            const index = candidates.findIndex(
                (rect) => rect.width === run.width && rect.y + rect.height === run.y,
            );
            let rect: GrowingRect;
            if (index >= 0) {
                rect = candidates.splice(index, 1)[0]!;
                rect.height += run.height;
            } else {
                rect = { ...run };
                rects.push(rect);
            }
            const list = taken.get(rect.x);
            if (list === undefined) taken.set(rect.x, [rect]);
            else list.push(rect);
        }
        above = taken;
    }
    cache.rects = rects;
    return rects;
}

/**
 * The markers of every marker layer, bottom to top and in each layer's order, with positions in
 * map pixels at parallax 1 (the layer's offset added). `filter` keeps those of layers named
 * `layer`, named `name` and of class `class`; each part given must match exactly.
 */
export function markers(
    tilemap: Tilemap,
    filter?: { readonly layer?: string; readonly name?: string; readonly class?: string },
): readonly TilemapMarker[] {
    const found: TilemapMarker[] = [];
    for (const layer of tilemap.layers) {
        if (layer.type !== "marker") continue;
        if (filter?.layer !== undefined && layer.name !== filter.layer) continue;
        for (const marker of layer.markers) {
            if (filter?.name !== undefined && marker.name !== filter.name) continue;
            if (filter?.class !== undefined && marker.class !== filter.class) continue;
            found.push(
                layer.offsetX === 0 && layer.offsetY === 0
                    ? marker
                    : { ...marker, x: marker.x + layer.offsetX, y: marker.y + layer.offsetY },
            );
        }
    }
    return found;
}

/**
 * Writes the cell value `value` (FORMAT 1.2) into the cell `cellX, cellY` of `layer`, in cells
 * as Tiled's `TileLayer.setTile` takes them, and drops the layer's cached `grid`,
 * `collisionShapes` and `collisionRects`. A cell outside the map is not written. A value with
 * the reserved bit 28 set, flags without a GID or a GID outside every span reads as an empty
 * cell.
 */
export function setCell(
    tilemap: Tilemap,
    layer: TileLayerData,
    cellX: number,
    cellY: number,
    value: number,
): void {
    if (!Number.isInteger(cellX) || !Number.isInteger(cellY)) return;
    if (cellX < 0 || cellY < 0 || cellX >= tilemap.width || cellY >= tilemap.height) return;
    layer.data[cellY * tilemap.width + cellX] = value;
    invalidate(tilemap, layer);
}

/** Drops the cached results of `layer`; call it after writing the layer's `data` directly. */
export function invalidate(tilemap: Tilemap, layer: TileLayerData): void {
    lookupOf(tilemap).caches.delete(layer);
}

/** What `drawTilemap` needs besides the frame, the tilemap and the camera. */
export interface DrawOptions {
    /**
     * The scene's own clock in milliseconds, so that pause and freeze follow the game. Animated
     * tiles show the frame at this time; all tiles share one clock from 0, as in Tiled.
     */
    readonly elapsedMs: number;
    /** Size of the view in world units, right and down from `camera`. */
    readonly viewWidth: number;
    readonly viewHeight: number;
    /**
     * The scene's assets: the `assets` map `setup` receives, or anything with `has(id)`. A
     * tileset or image whose texture it lacks is not drawn, and is reported once.
     */
    readonly assets: { has(id: string): boolean };
    /** World units per map pixel; default 1. Seams between tiles are avoided at whole numbers only. */
    readonly scale?: number;
    /** The engine `layer` of every quad; default 0. */
    readonly layer?: number;
    /**
     * The depth of the bottom map layer; default 0. Map layer `i` (its index in
     * `tilemap.layers`) is drawn at `depth + i`, so a sprite at `depth + i + 0.5` goes between
     * map layers `i` and `i + 1`.
     */
    readonly depth?: number;
    /** Multiplies the opacity of every layer, 0..1; default 1. */
    readonly alpha?: number;
    /** The `color` of every sprite, `0xRRGGBB` multiplied into the texture; default white. */
    readonly color?: number;
    /**
     * Which layers to draw, in place of the visible ones: called with each tile and image layer
     * and its index in `tilemap.layers`, bottom to top. Marker layers are not passed: they have
     * nothing to draw.
     */
    readonly layers?: (layer: TilemapLayer, index: number) => boolean;
    /** Where a texture missing from `assets` is reported; default `console.warn`. */
    readonly report?: (message: string) => void;
}

/** An animated tile: its entry in its tileset's `uv`, and its frames. */
interface DrawAnimation {
    readonly entry: number;
    /** Per frame, the time it ends within one pass, in milliseconds; the last is the pass. */
    readonly ends: Float64Array;
    /** Per frame, `u, v, uw, vh` of its rectangle. */
    readonly rects: Float64Array;
}

/** A tileset as `drawTilemap` draws it. */
interface DrawTileset {
    readonly name: string;
    /** The asset ID that is its texture's ID. */
    readonly texture: string;
    /** Given to the emitter; `uv` holds the current frame of each animated tile. */
    readonly emit: EmitTileset & { readonly uv: Float64Array };
    readonly animations: readonly DrawAnimation[];
}

/** What `drawTilemap` keeps per tilemap from one frame to the next. */
interface DrawState {
    /** False for a tilemap that `readTilemap` did not return: its atlases are unknown. */
    readonly read: boolean;
    readonly tilesets: readonly DrawTileset[];
    /** Per tileset, 1 while its texture is in the assets; the emitter holds those alone. */
    readonly available: Uint8Array;
    emitter: QuadEmitter | null;
    /** The clock the animated tiles show; NaN before the first frame. */
    elapsedMs: number;
    /** Per layer, its cells as the emitter reads them (null until drawn, and for other layers). */
    readonly cells: (FlatCells | null)[];
    /** Per layer, the texture of an image layer's image ("" for other layers). */
    readonly images: readonly string[];
    /** What has been reported, so that each problem is told once: missing textures by ID. */
    readonly reported: Set<string>;
    /** Image textures reported for needing too many copies. */
    readonly tooManyCopies: Set<string>;
    /** Reused for every layer, so that a frame allocates nothing. */
    readonly emitOptions: EmitLayerOptions;
}

const drawStates = new WeakMap<Tilemap, DrawState>();

/** The rectangle of a frame as fractions of its atlas image; false when it has none. */
function frameUv(
    frames: Json,
    id: string,
    width: number,
    height: number,
    out: Float64Array,
    at: number,
): boolean {
    const frame = Object.hasOwn(frames, id) ? frames[id] : undefined;
    if (!isObject(frame)) return false;
    const { x, y, w, h } = frame;
    if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof w !== "number" ||
        typeof h !== "number" ||
        !Number.isFinite(x + y + w + h)
    ) {
        return false;
    }
    out[at] = x / width;
    out[at + 1] = y / height;
    out[at + 2] = w / width;
    out[at + 3] = h / height;
    return true;
}

/**
 * The draw tables of a tileset from its atlas (FORMAT 4): per tile the even rectangle as
 * fractions of the image, and the frames of each animated tile. The atlases are given checked
 * (FORMAT 3.8); a value that is still unusable leaves its tile or animation out rather than
 * failing the draw.
 */
function drawTileset(tilemap: Tilemap, tileset: TilemapTileset, atlas: unknown): DrawTileset {
    const ids: number[] = [];
    const uvs: number[] = [];
    const animations: DrawAnimation[] = [];
    const rect = new Float64Array(4);
    const texture = assetId(tilemap, tileset.name);
    const owner = isObject(atlas) ? atlas : {};
    const { width, height, frames } = owner;
    const animated = isObject(owner.animations) ? owner.animations : {};
    if (
        typeof width === "number" &&
        typeof height === "number" &&
        width > 0 &&
        height > 0 &&
        Number.isFinite(width + height) &&
        isObject(frames)
    ) {
        // Frame IDs are `<name>-<tile ID>` and name tiles below `nextTileId` (checked).
        const prefix = `${tileset.name}-`;
        const entryOf = new Map<string, number>();
        for (const frame of Object.keys(frames)) {
            const tile = frame.startsWith(prefix) ? frame.slice(prefix.length) : "";
            if (!TILE_ID.test(tile) || Number(tile) >= tileset.nextTileId) continue;
            const id = Number(tile);
            if (!frameUv(frames, frame, width, height, rect, 0)) continue;
            entryOf.set(frame, ids.length);
            ids.push(id);
            uvs.push(rect[0]!, rect[1]!, rect[2]!, rect[3]!);
        }
        for (const frame of Object.keys(animated)) {
            const entry = entryOf.get(frame);
            const animation = animated[frame];
            const list = isObject(animation) ? animation.entries : undefined;
            if (entry === undefined || !Array.isArray(list) || list.length === 0) continue;
            const items: readonly unknown[] = list;
            const ends = new Float64Array(items.length);
            const rects = new Float64Array(items.length * 4);
            let end = 0;
            const usable = items.every((item, index) => {
                if (!isObject(item) || typeof item.frame !== "string") return false;
                const { ms } = item;
                if (typeof ms !== "number" || !(ms > 0) || !Number.isFinite(ms)) return false;
                end += ms;
                ends[index] = end;
                return frameUv(frames, item.frame, width, height, rects, index * 4);
            });
            if (usable) animations.push({ entry, ends, rects });
        }
    }
    return {
        name: tileset.name,
        texture,
        emit: {
            texture,
            tileWidth: tileset.tileWidth,
            tileHeight: tileset.tileHeight,
            offsetX: tileset.offsetX,
            offsetY: tileset.offsetY,
            key: tileset.firstGid,
            ids: Int32Array.from(ids),
            uv: Float64Array.from(uvs),
            span: tileset.nextTileId,
        },
        animations,
    };
}

function newDrawState(
    tilemap: Tilemap,
    read: boolean,
    tilesets: readonly DrawTileset[],
): DrawState {
    return {
        read,
        tilesets,
        available: new Uint8Array(tilesets.length),
        emitter: null,
        elapsedMs: Number.NaN,
        cells: tilemap.layers.map(() => null),
        images: tilemap.layers.map((layer) =>
            layer.type === "image" ? assetId(tilemap, imageName(layer)) : "",
        ),
        reported: new Set(),
        tooManyCopies: new Set(),
        emitOptions: {
            width: 0,
            height: 0,
            gridWidth: 0,
            gridHeight: 0,
            viewX: 0,
            viewY: 0,
            viewWidth: 0,
            viewHeight: 0,
            translateX: 0,
            translateY: 0,
            scale: 1,
            alpha: 1,
            color: WHITE,
            layer: 0,
            depth: 0,
        },
    };
}

function prepareDraw(tilemap: Tilemap, atlases: Readonly<Record<string, unknown>>): DrawState {
    return newDrawState(
        tilemap,
        true,
        tilemap.tilesets.map((tileset) =>
            drawTileset(
                tilemap,
                tileset,
                Object.hasOwn(atlases, tileset.name) ? atlases[tileset.name] : undefined,
            ),
        ),
    );
}

function drawStateOf(tilemap: Tilemap): DrawState {
    let state = drawStates.get(tilemap);
    if (state === undefined) {
        state = newDrawState(tilemap, false, []);
        drawStates.set(tilemap, state);
    }
    return state;
}

/** NGNE's default sprite colour. */
const WHITE = 0xffffff;

/** `value` when it is a finite number, otherwise `fallback`. */
function finite(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Tells `message` through `options.report` or `console.warn`; a report that throws is ignored. */
function tell(options: DrawOptions, message: string): void {
    try {
        const report: unknown = options.report;
        if (typeof report === "function") report(message);
        else console.warn(message);
    } catch {
        // Reporting must not make the draw throw.
    }
}

/** Tells `message` the first time `key` is reported for the tilemap of `state`. */
function tellOnce(state: DrawState, options: DrawOptions, key: string, message: string): void {
    if (state.reported.has(key)) return;
    state.reported.add(key);
    tell(options, message);
}

/** Whether the scene's assets hold the texture `id`; a broken `assets` holds nothing. */
function hasTexture(options: DrawOptions, id: string): boolean {
    const assets: unknown = options.assets;
    if (!isObject(assets) || typeof assets.has !== "function") return false;
    return (assets as { has(id: string): unknown }).has(id) === true;
}

/** The emitter of the tilesets whose textures are in the assets, built again when they change. */
function emitterOf(state: DrawState, tilemap: Tilemap, options: DrawOptions): QuadEmitter {
    const { tilesets, available } = state;
    let changed = false;
    for (let index = 0; index < tilesets.length; index += 1) {
        const tileset = tilesets[index]!;
        const has = hasTexture(options, tileset.texture) ? 1 : 0;
        if (has === 0 && !state.reported.has(tileset.texture)) {
            tellOnce(
                state,
                options,
                tileset.texture,
                `ngne-tilemap: the tilemap ${quoted(tilemap.name)} does not draw the tileset ` +
                    `${quoted(tileset.name)}: the scene's assets have no ${quoted(tileset.texture)}.`,
            );
        }
        if (available[index] !== has) {
            available[index] = has;
            changed = true;
        }
    }
    if (changed || state.emitter === null) {
        state.emitter = new QuadEmitter(
            "gid",
            tilesets.filter((_, index) => available[index] === 1).map((tileset) => tileset.emit),
        );
    }
    return state.emitter;
}

/** Writes the frame each animated tile shows at `elapsedMs` into its tileset's `uv`. */
function animate(state: DrawState, elapsedMs: number): void {
    if (elapsedMs === state.elapsedMs) return;
    state.elapsedMs = elapsedMs;
    const { tilesets } = state;
    for (let set = 0; set < tilesets.length; set += 1) {
        const { emit, animations } = tilesets[set]!;
        for (let index = 0; index < animations.length; index += 1) {
            const { entry, ends, rects } = animations[index]!;
            const pass = ends[ends.length - 1]!;
            // A span holds its start and not its end (sprite editor FORMAT 2.4).
            let time = elapsedMs % pass;
            if (time < 0) time += pass;
            let frame = 0;
            while (frame < ends.length - 1 && time >= ends[frame]!) frame += 1;
            const from = frame * 4;
            const to = entry * 4;
            emit.uv[to] = rects[from]!;
            emit.uv[to + 1] = rects[from + 1]!;
            emit.uv[to + 2] = rects[from + 2]!;
            emit.uv[to + 3] = rects[from + 3]!;
        }
    }
}

/** The cells of the tile layer at `index` as the emitter reads them: its current `data`. */
function cellsOf(
    state: DrawState,
    tilemap: Tilemap,
    index: number,
    layer: TileLayerData,
): FlatCells {
    let cells = state.cells[index] ?? null;
    if (cells === null || cells.data !== layer.data) {
        cells = new FlatCells(layer.data, tilemap.width, tilemap.height);
        state.cells[index] = cells;
    }
    return cells;
}

/** Most copies of one image a frame draws; a view that needs more draws none of them. */
const MAX_IMAGE_COPIES = 1_048_576;

/**
 * The image of an image layer with its top-left corner at the layer's shift; a repeated axis
 * as a row of copies covering the view. Positions in map pixels, as `drawLayers` gives them.
 * False when covering the view would take more than `MAX_IMAGE_COPIES` copies.
 */
function drawImage(
    frame: SpriteSink,
    sprite: SpriteLike,
    layer: ImageLayerData,
    shiftX: number,
    shiftY: number,
    view: { x: number; y: number; width: number; height: number },
    scale: number,
): boolean {
    const width = layer.imageWidth;
    const height = layer.imageHeight;
    let x0 = 0;
    let x1 = 0;
    let y0 = 0;
    let y1 = 0;
    if (layer.repeatX) {
        x0 = Math.floor((view.x - shiftX) / width);
        x1 = Math.ceil((view.x + view.width - shiftX) / width) - 1;
    } else if (shiftX + width <= view.x || shiftX >= view.x + view.width) {
        return true;
    }
    if (layer.repeatY) {
        y0 = Math.floor((view.y - shiftY) / height);
        y1 = Math.ceil((view.y + view.height - shiftY) / height) - 1;
    } else if (shiftY + height <= view.y || shiftY >= view.y + view.height) {
        return true;
    }
    if (!((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_IMAGE_COPIES)) return false;
    // The exported PNG has even sides, the extra column and row transparent (FORMAT 3.4, 5): the
    // whole PNG is drawn, so the quad's edges fall on whole pixels when the engine rounds its
    // centre, and its top-left corner stays on the image's.
    const evenWidth = width + (width % 2);
    const evenHeight = height + (height % 2);
    sprite.width = evenWidth * scale;
    sprite.height = evenHeight * scale;
    sprite.rotation = 0;
    sprite.u = 0;
    sprite.v = 0;
    sprite.uw = 1;
    sprite.vh = 1;
    for (let row = y0; row <= y1; row += 1) {
        for (let column = x0; column <= x1; column += 1) {
            sprite.x = (shiftX + column * width + evenWidth / 2) * scale;
            sprite.y = (shiftY + row * height + evenHeight / 2) * scale;
            frame.sprite(sprite);
        }
    }
    return true;
}

/** The view in map pixels; reused, as the frame allocates nothing. */
const VIEW = { x: 0, y: 0, width: 0, height: 0 };

function drawLayers(
    frame: SpriteSink,
    tilemap: Tilemap,
    camera: { readonly x: number; readonly y: number },
    options: DrawOptions,
    state: DrawState,
): void {
    if (!state.read && !state.reported.has("")) {
        tellOnce(
            state,
            options,
            "",
            `ngne-tilemap: the tilemap ${quoted(tilemap.name)} was not returned by readTilemap, ` +
                `so its tile layers are not drawn.`,
        );
    }
    const scale = finite(options.scale, 1);
    const viewWidth = finite(options.viewWidth, 0) / scale;
    const viewHeight = finite(options.viewHeight, 0) / scale;
    const viewX = finite(camera.x, Number.NaN) / scale;
    const viewY = finite(camera.y, Number.NaN) / scale;
    if (!(scale > 0) || !(viewWidth > 0) || !(viewHeight > 0)) return;
    if (!Number.isFinite(viewX) || !Number.isFinite(viewY)) return;
    // The centre of the view, which gives each layer's parallax shift (FORMAT 3.4).
    const centreX = viewX + viewWidth / 2 - tilemap.parallaxOriginX;
    const centreY = viewY + viewHeight / 2 - tilemap.parallaxOriginY;
    // A view too large for a number (a tiny scale) has no centre to draw around.
    if (!Number.isFinite(viewWidth + viewHeight + centreX + centreY)) return;
    const alpha = Math.min(Math.max(finite(options.alpha, 1), 0), 1);
    const color = finite(options.color, WHITE);
    const engineLayer = finite(options.layer, 0);
    const depth = finite(options.depth, 0);
    const accepts: unknown = options.layers;

    const emitter = emitterOf(state, tilemap, options);
    animate(state, finite(options.elapsedMs, 0));
    const sprite = emitter.sprite;
    const emit = state.emitOptions;
    emit.width = tilemap.width;
    emit.height = tilemap.height;
    emit.gridWidth = tilemap.tileWidth;
    emit.gridHeight = tilemap.tileHeight;
    emit.viewWidth = viewWidth;
    emit.viewHeight = viewHeight;
    emit.scale = scale;
    emit.color = color;
    emit.layer = engineLayer;
    VIEW.x = viewX;
    VIEW.y = viewY;
    VIEW.width = viewWidth;
    VIEW.height = viewHeight;

    const { layers } = tilemap;
    for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]!;
        if (layer.type === "marker") continue;
        const drawn =
            typeof accepts === "function"
                ? Boolean(
                      (accepts as (layer: TilemapLayer, index: number) => unknown)(layer, index),
                  )
                : layer.visible;
        if (!drawn) continue;
        const layerAlpha = (layer.opacity / 255) * alpha;
        if (!(layerAlpha > 0)) continue;
        const shiftX = layer.offsetX + centreX * (1 - layer.parallaxX);
        const shiftY = layer.offsetY + centreY * (1 - layer.parallaxY);
        if (!Number.isFinite(shiftX + shiftY)) continue;
        if (layer.type === "tile") {
            emit.viewX = viewX - shiftX;
            emit.viewY = viewY - shiftY;
            emit.translateX = shiftX;
            emit.translateY = shiftY;
            emit.alpha = layerAlpha;
            emit.depth = depth + index;
            emitter.emitLayer(frame, cellsOf(state, tilemap, index, layer), emit);
        } else {
            const texture = state.images[index] ?? "";
            if (!hasTexture(options, texture)) {
                if (state.reported.has(texture)) continue;
                tellOnce(
                    state,
                    options,
                    texture,
                    `ngne-tilemap: the tilemap ${quoted(tilemap.name)} does not draw the image ` +
                        `${quoted(layer.image)}: the scene's assets have no ${quoted(texture)}.`,
                );
                continue;
            }
            sprite.texture = texture;
            sprite.alpha = layerAlpha;
            sprite.color = color;
            sprite.layer = engineLayer;
            sprite.depth = depth + index;
            if (
                !drawImage(frame, sprite, layer, shiftX, shiftY, VIEW, scale) &&
                !state.tooManyCopies.has(texture)
            ) {
                state.tooManyCopies.add(texture);
                tell(
                    options,
                    `ngne-tilemap: the tilemap ${quoted(tilemap.name)} does not draw the image ` +
                        `${quoted(layer.image)}: covering the view would take more than ` +
                        `${MAX_IMAGE_COPIES} copies.`,
                );
            }
        }
    }
}

/**
 * Draws `tilemap` into `frame` for `scene.render` (SPEC 11.2): the visible tile and image
 * layers, or those `options.layers` accepts, bottom to top. Map layer `i` goes to the engine
 * `layer` `options.layer` at depth `options.depth + i`.
 *
 * World units are map pixels times `options.scale`. The view is `camera` plus
 * `options.viewWidth x options.viewHeight`, in world units; its centre gives each layer's
 * parallax shift, and only tiles that can show in it are drawn. Animated tiles show the frame
 * at `options.elapsedMs`. Each layer draws at its opacity times `options.alpha`, every sprite
 * with `options.color`. An image layer draws its image at the layer's shift, a repeated axis as
 * copies covering the view.
 *
 * Within a layer, quads come grouped by tileset, row by row, so the engine batches them; every
 * call of `frame.sprite` gets the same sprite object, changed in place. The tile layers' current
 * `data` is drawn, so a game's edits show at once.
 *
 * Never throws: a tileset or image whose texture `options.assets` lacks is skipped and reported
 * once per tilemap through `options.report` (default `console.warn`), as is anything else that
 * stops the draw.
 */
export function drawTilemap(
    frame: SpriteSink,
    tilemap: Tilemap,
    camera: { readonly x: number; readonly y: number },
    options: DrawOptions,
): void {
    let state: DrawState | null = null;
    try {
        state = drawStateOf(tilemap);
        drawLayers(frame, tilemap, camera, options, state);
    } catch (error) {
        let message = "ngne-tilemap: drawing a tilemap stopped";
        try {
            message += `: ${error instanceof Error ? error.message : String(error)}`;
        } catch {
            // An error that cannot be shown is reported without its text.
        }
        if (state === null) tell(options, message);
        else tellOnce(state, options, `error:${message}`, message);
    }
}

// The export folder's tables. The generator replaces this line and everything below it.

/** The export names of this folder's tilemaps. */
export type TilemapName = string;

/** The export names of this folder's tilesets. */
export type TilesetName = string;

/** Each tilemap's `.tilemap.json`, by export name. */
export const TILEMAP_URLS: Readonly<Record<TilemapName, string>> = {};

/** Each tileset's atlas, by export name. */
export const ATLAS_URLS: Readonly<Record<TilesetName, AtlasUrls>> = {};

/** Each image's `.png`, by export name. */
export const IMAGE_URLS: Readonly<Record<string, string>> = {};
