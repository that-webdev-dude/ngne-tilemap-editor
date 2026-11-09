// The runtime of an exported tilemap (SPEC 11): the reader of `ngne-tilemap` version 1
// (FORMAT 3.8) and its error. The export copies this file into `ngne-tilemap.ts` behind a
// header (TE-053), and the editor imports it as code, so editor and games carry one reader.
// That is why the file:
// - has no import: the generated module stands alone, and `src/core` stays free of the engine;
// - uses nothing but ECMAScript 2022: no DOM global, no engine type;
// - compiles under `strict`, `exactOptionalPropertyTypes`, `noUnusedLocals` and
//   `noUnusedParameters` (SPEC 11.4);
// - is ASCII, comments included, as every text file of an export is.
// The comments are read by the users of an exported runtime.

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
    const base = name
        .split(".")[0]!
        .replace(/ +$/, "")
        .replace(/[A-Z]/g, (c) => c.toLowerCase());
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
