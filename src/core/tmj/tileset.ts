import {
    MAX_ANIMATION_FRAMES,
    MAX_ANIMATION_FRAMES_PER_TILESET,
    MAX_COLLISION_SHAPES,
    MAX_FRAME_MS,
    MAX_IMAGE_SIDE,
    MAX_TERRAINS,
    MAX_TERRAIN_SETS,
    MAX_TERRAIN_TILES,
    MAX_TILE_ID,
    MAX_TILE_OFFSET,
    MAX_TILE_SIZE,
    MIN_FRAME_MS,
    collisionProblem,
    exportNames,
    randomId,
    uniqueSlug,
} from "../model";
import type {
    AnimationFrame,
    IdGenerator,
    PixelBuffer,
    Project,
    Shape,
    TerrainColor,
    TerrainSet,
    TerrainSetType,
    TerrainTile,
    Tile,
    Tileset,
} from "../model";
import { PngError, decodePng } from "../sprite/png";
import {
    TilesetImportError,
    checkLimits,
    checkPackability,
    gridCount,
    importGridPng,
    planGridPng,
    readPngSize,
    tilesetNameOf,
} from "../tileset";
import type { PngDecoder, TilesetShape } from "../tileset";
import { buildTileset, storedColumns, storedImage, storedOrigin } from "../tileset/build";
import { TmjError } from "./errors";
import {
    arr,
    formatColor,
    int,
    isObject,
    num,
    objects,
    parseObject,
    str,
    tiledColor,
} from "./json";
import type { JsonObject } from "./json";
import type { TmjTilesetRef } from "./map";
import { objectKind, readPoints } from "./objects";
import { baseName, folderOf, resolveTmjPath } from "./paths";
import { convertProperties, readText } from "./properties";
import { TmjReporter } from "./report";
import type { TmjLocation, TmjReportEntry } from "./report";
import { tsxToJson } from "./tsx";

// The tilesets of a Tiled map as project tilesets (SPEC §13 Tilesets, BRIEF §7): embedded,
// `.tsj` or `.tsx` (one conversion: a TSX is read into the TSJ's JSON first); image tilesets cut
// as TE-022 cuts a grid PNG, tile IDs Tiled's local IDs; image collections of one tile size as a
// `"collection"` tileset, mixed sizes refused; tile class, animations, collision and terrain sets
// kept, the rest reported; `transparentcolor` applied as a colour key. An external tileset
// already in the project (same file name, same tile fingerprints) is reused. Limits and
// packability are checked as TE-022 checks them, before pixels are decoded. Nothing here touches
// the project.

/** The files the map names, by their path from the map's folder (`resolveTmjPath`). */
export interface TmjFiles {
    /** A tileset's text; undefined when the file is missing. */
    readonly text: (path: string) => string | undefined;
    /** An image's bytes; undefined when the file is missing. */
    readonly bytes: (path: string) => Uint8Array | undefined;
}

export interface TmjTilesetOptions {
    /** The map's file name: the source file of an embedded image collection. */
    readonly fileName: string;
    readonly files: TmjFiles;
    /** Export names the new tilesets' must differ from besides the project's (the new map's). */
    readonly takenExportNames?: Iterable<string>;
    readonly decode?: PngDecoder;
    readonly newId?: IdGenerator;
}

export interface TmjTilesetConversion {
    /**
     * The tileset each slot of the converted map binds to, `slots[slot − 1]`: one of `added`, a
     * tileset of the project, reused, or null for a tileset without tiles that no cell uses,
     * dropped (reported).
     */
    readonly slots: readonly (Tileset | null)[];
    /** The new tilesets in the map's order; their `slot` is 0 until they are added. */
    readonly added: readonly Tileset[];
    /** In conversion order; `groupReport` groups them by BRIEF §7 row. */
    readonly report: readonly TmjReportEntry[];
}

/** A project without maps or tilesets: the per-tileset checks of TE-022 run against it. */
const NO_PROJECT: Project = {
    id: "",
    name: "",
    exportName: "",
    maps: [],
    tilesets: [],
    images: [],
    exportSettings: { exportOnSave: false },
    properties: [],
};

interface Context {
    readonly project: Project;
    readonly files: TmjFiles;
    readonly decode: PngDecoder;
    readonly newId: IdGenerator;
    readonly report: TmjReporter;
    /** The new tilesets so far. */
    readonly added: Tileset[];
}

/** A tileset's JSON and where it came from. */
interface Source {
    readonly json: JsonObject;
    /** Its file's path from the map's folder; null when embedded in the map. */
    readonly path: string | null;
    /** The folder its paths are relative to, from the map's folder. */
    readonly folder: string;
    /** As the project will name it: an external tileset after its file, else Tiled's name. */
    readonly name: string;
    readonly what: string;
    readonly where: TmjLocation;
}

/**
 * A colour key applied to `pixels` in place (SPEC §13): every opaque pixel of the colour's red,
 * green and blue becomes transparent, as Tiled masks the colour of `transparentColor.rgb()`.
 */
export function applyColorKey(pixels: PixelBuffer, color: number): void {
    const r = (color >>> 24) & 0xff;
    const g = (color >>> 16) & 0xff;
    const b = (color >>> 8) & 0xff;
    const { data } = pixels;
    for (let at = 0; at < data.length; at += 4) {
        if (data[at] === r && data[at + 1] === g && data[at + 2] === b && data[at + 3] === 255) {
            data.fill(0, at, at + 4);
        }
    }
}

/** A TE-022 or decoder refusal as the map's refusal. */
function refusal(error: unknown, path: string): unknown {
    if (error instanceof TilesetImportError) {
        const code = error.code === "limit" || error.code === "packability" ? "limit" : "format";
        return new TmjError(code, error.message);
    }
    if (error instanceof PngError) {
        return new TmjError("format", `The image ${path} cannot be read: ${error.message}`);
    }
    return error;
}

function guard<T>(path: string, run: () => T): T {
    try {
        return run();
    } catch (error) {
        throw refusal(error, path);
    }
}

async function guardAsync<T>(path: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        throw refusal(error, path);
    }
}

function readBytes(files: TmjFiles, path: string): Uint8Array {
    const bytes = files.bytes(path);
    if (bytes === undefined) {
        throw new TmjError("missing-file", `The image ${path} is missing.`, path);
    }
    return bytes;
}

/** The decoder with the tileset's or layer's colour key applied to what it returns. */
function keyed(decode: PngDecoder, color: number | null): PngDecoder {
    return async (bytes) => {
        const pixels = await decode(bytes);
        if (color !== null) applyColorKey(pixels, color);
        return pixels;
    };
}

/** Refuses a map whose tiles are above 256 px a side (SPEC §13). */
function checkTileSize(name: string, width: number, height: number): void {
    if (width < 1 || height < 1 || width > MAX_TILE_SIZE || height > MAX_TILE_SIZE) {
        throw new TmjError(
            "limit",
            `The tiles of tileset "${name}" are ${width} × ${height} px; tiles are 1 to ` +
                `${MAX_TILE_SIZE} px a side.`,
        );
    }
}

/** The project as it is with the new tilesets so far. */
function withAdded(context: Context): Project {
    return { ...context.project, tilesets: [...context.project.tilesets, ...context.added] };
}

/** Refuses a tileset of `shape` the project with the new tilesets so far has no room for. */
function checkRoom(context: Context, shape: TilesetShape): void {
    guard("", () => checkLimits(withAdded(context), shape));
}

/** What makes an external tileset the same as one of the project, besides its tiles. */
type Origin = Pick<Tileset, "name" | "source" | "tileWidth" | "tileHeight">;

/**
 * Whether a project tileset can be the external tileset that converts to `tileset`: the same
 * name (an external tileset is named after its file), source and tile size.
 */
function sameOrigin(candidate: Tileset, tileset: Origin): boolean {
    const { source } = candidate;
    return (
        candidate.name === tileset.name &&
        source.kind === tileset.source.kind &&
        source.fileName === tileset.source.fileName &&
        source.margin === tileset.source.margin &&
        source.spacing === tileset.source.spacing &&
        candidate.tileWidth === tileset.tileWidth &&
        candidate.tileHeight === tileset.tileHeight
    );
}

/**
 * What the file gives a tileset besides its pixels: tiles by ID with their fingerprints and
 * data, terrain sets, class, properties and offset.
 */
function dataOf(tileset: Tileset): string {
    const tiles = [...tileset.tiles]
        .sort((a, b) => a.id - b.id)
        .map((tile) => [
            tile.id,
            tile.fingerprint,
            tile.class,
            tile.properties,
            tile.collision,
            tile.animation,
        ]);
    const { terrainSets, offsetX, offsetY, properties } = tileset;
    return JSON.stringify([tiles, terrainSets, tileset.class, properties, offsetX, offsetY]);
}

/**
 * The project's tileset to reuse for `tileset`: the same origin, tile fingerprints and data, so
 * that reuse loses nothing the file holds (a grid PNG import of the same name is not the TSJ's
 * tileset when the TSJ adds collision, say).
 */
function reusable(project: Project, tileset: Tileset): Tileset | null {
    const data = dataOf(tileset);
    return (
        project.tilesets.find(
            (candidate) => sameOrigin(candidate, tileset) && dataOf(candidate) === data,
        ) ?? null
    );
}

/** Whether a project tileset may be reused for the source: it is external, of that origin. */
function mayReuse(context: Context, source: Source, origin: Origin): boolean {
    return (
        source.path !== null &&
        context.project.tilesets.some((tileset) => sameOrigin(tileset, origin))
    );
}

function readSource(
    ref: TmjTilesetRef,
    files: TmjFiles,
    index: number,
    report: TmjReporter,
): Source {
    if (ref.source === null) {
        const json = ref.embedded ?? {};
        const what = `Tileset ${index + 1}`;
        const name = readText(str(json, "name", "", what), "Name", {}, report).trim();
        const named = name === "" ? "Tileset" : name;
        return {
            json,
            path: null,
            folder: "",
            name: named,
            what: `Tileset "${named}"`,
            where: { tileset: named },
        };
    }
    const path = resolveTmjPath("", ref.source);
    const text = files.text(path);
    if (text === undefined) {
        throw new TmjError("missing-file", `The tileset ${path} is missing.`, path);
    }
    const what = `Tileset ${path}`;
    const json = text.trimStart().startsWith("<") ? tsxToJson(text, what) : parseObject(text, what);
    if (json.type !== undefined && json.type !== "tileset") {
        throw new TmjError("format", `${what} is not a Tiled tileset.`);
    }
    const name = tilesetNameOf(baseName(path));
    return { json, path, folder: folderOf(path), name, what, where: { tileset: name } };
}

/** An image tileset (Tiled's one image cut into a grid) as TE-022 imports a grid PNG. */
async function imageTileset(context: Context, source: Source): Promise<Tileset | null> {
    const { json, what } = source;
    const tileWidth = int(json, "tilewidth", 0, what);
    const tileHeight = int(json, "tileheight", 0, what);
    checkTileSize(source.name, tileWidth, tileHeight);
    const path = resolveTmjPath(source.folder, str(json, "image", "", what));
    const bytes = readBytes(context.files, path);
    const options = {
        fileName: baseName(path),
        tileWidth,
        tileHeight,
        margin: int(json, "margin", 0, what),
        spacing: int(json, "spacing", 0, what),
        newId: context.newId,
    };
    const size = guard(path, () => readPngSize(bytes));
    const columns = gridCount(size.width, tileWidth, options.margin, options.spacing);
    const rows = gridCount(size.height, tileHeight, options.margin, options.spacing);
    // Tiled opens a tileset whose image holds no whole tile; it is dropped (`convertOne`).
    if (columns === 0 || rows === 0) return null;
    const planned = guard(path, () => planGridPng(NO_PROJECT, size, options));
    const shape = { ...planned, name: source.name };
    const origin = {
        name: source.name,
        source: {
            kind: "image" as const,
            fileName: options.fileName,
            margin: options.margin,
            spacing: options.spacing,
        },
        tileWidth,
        tileHeight,
    };
    // A tileset that may be reused takes no room; its room is checked once it is not reused.
    if (!mayReuse(context, source, origin)) checkRoom(context, shape);
    const color = transparentColor(json, source, context.report);
    const decode = keyed(context.decode, color);
    const imported = await guardAsync(path, () =>
        importGridPng(NO_PROJECT, bytes, options, decode),
    );
    return imported.tileset;
}

/** One tile of an image collection: its image and the rectangle of it the tile shows. */
interface CollectionTile {
    readonly id: number;
    readonly path: string;
    readonly key: string;
    readonly bytes: Uint8Array;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** The tiles of a collection that have an image, and the highest tile ID it lists. */
function collectionTiles(
    context: Context,
    source: Source,
): { tiles: CollectionTile[]; highest: number } {
    const { json, what, where } = source;
    const tiles: CollectionTile[] = [];
    let highest = -1;
    const ids = new Set<number>();
    const keys = new Map<string, number>();
    for (const raw of objects(json, "tiles", what)) {
        const id = int(raw, "id", -1, what);
        if (id < 0 || id > MAX_TILE_ID) {
            throw new TmjError("limit", `${what} has tile ID ${id}; IDs are 0 to ${MAX_TILE_ID}.`);
        }
        if (ids.has(id)) throw new TmjError("format", `${what} lists tile ${id} twice.`);
        ids.add(id);
        // Tiled creates a listed tile with or without an image (`Tileset::findOrCreateTile`).
        highest = Math.max(highest, id);
        const image = str(raw, "image", "", what);
        if (image === "") {
            context.report.add("out-of-range", "Tile without an image dropped", {
                ...where,
                tile: id,
            });
            continue;
        }
        const path = resolveTmjPath(source.folder, image);
        const key = baseName(path);
        const other = keys.get(key);
        if (other !== undefined) {
            throw new TmjError(
                "format",
                `Tiles ${other} and ${id} of the image collection "${source.name}" both show ` +
                    `${key}; a collection tileset needs one image file per tile.`,
            );
        }
        keys.set(key, id);
        const bytes = readBytes(context.files, path);
        const size = guard(path, () => readPngSize(bytes));
        if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
            throw new TmjError(
                "limit",
                `The image ${path} is ${size.width} × ${size.height} px; a source image is at ` +
                    `most ${MAX_IMAGE_SIDE} px a side.`,
            );
        }
        const x = int(raw, "x", 0, what);
        const y = int(raw, "y", 0, what);
        const width = int(raw, "width", size.width - x, what);
        const height = int(raw, "height", size.height - y, what);
        if (x < 0 || y < 0 || width < 1 || height < 1) {
            throw new TmjError("format", `${what}: tile ${id} has an empty image rectangle.`);
        }
        if (x + width > size.width || y + height > size.height) {
            throw new TmjError("format", `${what}: tile ${id}'s rectangle lies outside ${path}.`);
        }
        tiles.push({ id, path, key, bytes, x, y, width, height });
    }
    return { tiles, highest };
}

/** An image collection of one tile size as a `"collection"` tileset (BRIEF §7). */
async function collectionTileset(
    context: Context,
    source: Source,
    fileName: string,
): Promise<Tileset | null> {
    const { tiles, highest } = collectionTiles(context, source);
    const first = tiles[0];
    // Tiled opens a collection without images; it is dropped (`convertOne`).
    if (first === undefined) return null;
    const sizes = [...new Set(tiles.map((tile) => `${tile.width} × ${tile.height}`))];
    if (sizes.length > 1) {
        throw new TmjError(
            "mixed-sizes",
            `The image collection "${source.name}" has tiles of ${sizes.join(", ")} px; only ` +
                "collections whose tiles are all one size can be imported.",
        );
    }
    const { width: tileWidth, height: tileHeight } = first;
    checkTileSize(source.name, tileWidth, tileHeight);
    const shape: TilesetShape = {
        name: source.name,
        tileCount: tiles.length,
        tileWidth,
        tileHeight,
        columns: storedColumns(tiles.length, tileWidth, tileHeight),
    };
    guard("", () => {
        checkLimits(NO_PROJECT, shape);
        checkPackability(shape, tiles.length);
    });
    const origin = {
        name: source.name,
        source: { kind: "collection" as const, fileName, margin: 0, spacing: 0 },
        tileWidth,
        tileHeight,
    };
    if (!mayReuse(context, source, origin)) checkRoom(context, shape);
    const decode = keyed(context.decode, transparentColor(source.json, source, context.report));
    const pixels = storedImage(shape);
    const row = tileWidth * 4;
    for (const [k, tile] of tiles.entries()) {
        const image = await guardAsync(tile.path, () => decode(tile.bytes));
        const to = storedOrigin(shape, k);
        for (let dy = 0; dy < tileHeight; dy++) {
            const from = ((tile.y + dy) * image.width + tile.x) * 4;
            pixels.data.set(
                image.data.subarray(from, from + row),
                ((to.y + dy) * pixels.width + to.x) * 4,
            );
        }
    }
    const tileset = buildTileset(
        NO_PROJECT,
        { fileName, newId: context.newId },
        origin.source,
        shape,
        pixels,
        tiles.map((tile) => tile.key),
    );
    for (const [k, tile] of tileset.tiles.entries()) tile.id = tiles[k]!.id;
    // Tiled's next tile ID: one above the highest ID it has read.
    tileset.nextTileId = highest + 1;
    return tileset;
}

function transparentColor(json: JsonObject, source: Source, report: TmjReporter): number | null {
    const text = str(json, "transparentcolor", "", source.what);
    if (text === "") return null;
    const color = tiledColor(text);
    if (color === null) {
        report.add("out-of-range", `Transparent colour ${text} dropped`, source.where);
    }
    return color;
}

/** The collision shapes of a tile from its `objectgroup` (SPEC §13). */
function readCollision(raw: JsonObject, at: TmjLocation, report: TmjReporter, what: string) {
    const group = raw.objectgroup;
    const shapes: Shape[] = [];
    if (group === undefined) return shapes;
    if (!isObject(group)) throw new TmjError("format", `${what}: "objectgroup" is not an object.`);
    for (const object of objects(group, "objects", what)) {
        const name = str(object, "name", "", what);
        const here: TmjLocation = {
            ...at,
            object: { id: typeof object.id === "number" ? object.id : 0, name },
        };
        if (object.template !== undefined) {
            report.add("collision-shapes", "Template instance dropped", here);
            continue;
        }
        const kind = objectKind(object);
        if (kind !== "rectangle" && kind !== "ellipse" && kind !== "polygon") {
            const label = kind === "point" ? "Point" : kind === "polyline" ? "Polyline" : kind;
            report.add("collision-shapes", `${label} dropped`, here);
            continue;
        }
        const x = num(object, "x", 0, what);
        const y = num(object, "y", 0, what);
        let shape: Shape;
        if (kind === "polygon") {
            const points = readPoints(object.polygon);
            if (points === null) {
                report.add("out-of-range", "Shape dropped: its points are malformed", here);
                continue;
            }
            shape = { shape: "polygon", x, y, points };
        } else {
            const width = num(object, "width", 0, what);
            const height = num(object, "height", 0, what);
            shape = { shape: kind, x, y, width, height };
        }
        const problem = collisionProblem([shape]);
        if (problem !== null) {
            report.add("out-of-range", `Shape dropped: ${problem}`, here);
            continue;
        }
        if (shapes.length === MAX_COLLISION_SHAPES) {
            report.add("out-of-range", `Shape dropped: more than ${MAX_COLLISION_SHAPES}`, here);
            continue;
        }
        const rotation = num(object, "rotation", 0, what);
        if (rotation !== 0) report.add("collision-shapes", `Rotation ${rotation}° dropped`, here);
        if (name !== "") report.add("collision-shapes", `Name "${name}" dropped`, here);
        const className = str(object, "type", str(object, "class", "", what), what);
        if (className !== "") report.add("collision-shapes", `Class "${className}" dropped`, here);
        const properties = arr(object, "properties", what).length;
        if (properties > 0) {
            report.add("collision-shapes", "Properties dropped", here, properties);
        }
        shapes.push(shape);
    }
    return shapes;
}

/** A tile's animation (SPEC §13), or null when it names a tile the tileset does not have. */
function readAnimation(
    raw: JsonObject,
    ids: ReadonlySet<number>,
    at: TmjLocation,
    report: TmjReporter,
    what: string,
): AnimationFrame[] {
    const frames: AnimationFrame[] = [];
    let clamped = 0;
    for (const frame of objects(raw, "animation", what)) {
        const tile = int(frame, "tileid", -1, what);
        if (!ids.has(tile)) {
            report.add("out-of-range", `Animation dropped: frame tile ${tile} does not exist`, at);
            return [];
        }
        const duration = int(frame, "duration", 0, what);
        const ms = Math.min(MAX_FRAME_MS, Math.max(MIN_FRAME_MS, duration));
        if (ms !== duration) clamped += 1;
        frames.push({ tile, ms });
    }
    if (clamped > 0) {
        report.add(
            "out-of-range",
            `Frame durations clamped to ${MIN_FRAME_MS}..${MAX_FRAME_MS} ms`,
            at,
            clamped,
        );
    }
    if (frames.length > MAX_ANIMATION_FRAMES) {
        report.add(
            "out-of-range",
            `Animation cut to ${MAX_ANIMATION_FRAMES} frames`,
            at,
            frames.length - MAX_ANIMATION_FRAMES,
        );
        frames.length = MAX_ANIMATION_FRAMES;
    }
    return frames;
}

/** Class, probability, properties, collision and animation of the tiles Tiled lists. */
function readTileData(tileset: Tileset, source: Source, report: TmjReporter): void {
    const { json, what, where } = source;
    const byId = new Map(tileset.tiles.map((tile) => [tile.id, tile]));
    const ids = new Set(byId.keys());
    let frames = 0;
    for (const raw of objects(json, "tiles", what)) {
        const id = int(raw, "id", -1, what);
        const at: TmjLocation = { ...where, tile: id };
        const tile: Tile | undefined = byId.get(id);
        if (tile === undefined) {
            // A collection tile without an image is reported where it is dropped.
            if (tileset.source.kind === "image") {
                report.add("out-of-range", "Tile data dropped: the image has no such tile", at);
            }
            continue;
        }
        tile.class = readText(
            str(raw, "type", str(raw, "class", "", what), what),
            "Class",
            at,
            report,
        );
        const probability = num(raw, "probability", 1, what);
        if (probability !== 1) {
            report.add("terrain-probability", `Tile probability ${probability} dropped`, at);
        }
        tile.properties = convertProperties(raw, at, report, what);
        tile.collision = readCollision(raw, at, report, what);
        const animation = readAnimation(raw, ids, at, report, what);
        if (frames + animation.length > MAX_ANIMATION_FRAMES_PER_TILESET) {
            report.add(
                "out-of-range",
                `Animation dropped: the tileset's animations hold at most ` +
                    `${MAX_ANIMATION_FRAMES_PER_TILESET} frames`,
                at,
            );
            continue;
        }
        frames += animation.length;
        tile.animation = animation;
    }
}

const WANG_TYPES: readonly string[] = ["corner", "edge", "mixed"];

/** Reports a terrain set's or terrain's class and properties, which are dropped. */
function reportExtras(raw: JsonObject, at: TmjLocation, label: string, report: TmjReporter): void {
    const className = str(raw, "class", "", label);
    if (className !== "") report.add("terrain-sets", `${label}: class "${className}" dropped`, at);
    const properties = arr(raw, "properties", label).length;
    if (properties > 0) {
        report.add("terrain-sets", `${label}: properties dropped`, at, properties);
    }
}

function readColors(
    raw: JsonObject,
    ids: ReadonlySet<number>,
    at: TmjLocation,
    report: TmjReporter,
    what: string,
): TerrainColor[] {
    return objects(raw, "colors", what).map((color, index): TerrainColor => {
        const blank = `Terrain ${index + 1}`;
        const name = readText(str(color, "name", "", what), "Terrain name", at, report);
        const label = `Terrain "${name.trim() === "" ? blank : name}"`;
        if (name.trim() === "") report.add("out-of-range", `${label}: blank name replaced`, at);
        const text = str(color, "color", "", what);
        let value = tiledColor(text);
        if (value === null) {
            report.add("out-of-range", `${label}: colour ${text} replaced by black`, at);
            value = 0x000000ff;
        }
        const tileId = int(color, "tile", -1, what);
        const tile = ids.has(tileId) ? tileId : null;
        if (tileId !== -1 && tile === null) {
            report.add("out-of-range", `${label}: icon tile ${tileId} dropped`, at);
        }
        const probability = num(color, "probability", 1, what);
        if (probability !== 1) {
            report.add("terrain-probability", `${label}: probability ${probability} dropped`, at);
        }
        reportExtras(color, at, label, report);
        return { name: name.trim() === "" ? blank : name, color: formatColor(value), tile };
    });
}

function readWangTiles(
    raw: JsonObject,
    type: TerrainSetType,
    colorCount: number,
    ids: ReadonlySet<number>,
    at: TmjLocation,
    report: TmjReporter,
    what: string,
): TerrainTile[] {
    const tiles: TerrainTile[] = [];
    const seen = new Set<number>();
    for (const entry of objects(raw, "wangtiles", what)) {
        const tile = int(entry, "tileid", -1, what);
        const here: TmjLocation = { ...at, tile };
        const wangId = arr(entry, "wangid", what);
        const valid =
            wangId.length === 8 &&
            wangId.every((v) => typeof v === "number" && Number.isInteger(v) && v >= 0);
        if (!ids.has(tile) || seen.has(tile) || !valid) {
            const why = !ids.has(tile)
                ? "no such tile"
                : seen.has(tile)
                  ? "listed twice"
                  : "bad wangid";
            report.add("out-of-range", `Terrain tile dropped: ${why}`, here);
            continue;
        }
        // Tiled reads a wang ID through its set's type mask (`WangSet::typeMask`).
        const masked = (wangId as number[]).map((value, index) =>
            (type === "corner" && index % 2 === 0) || (type === "edge" && index % 2 === 1)
                ? 0
                : value,
        );
        if (masked.some((value) => value > colorCount)) {
            report.add(
                "out-of-range",
                "Terrain tile dropped: it names no terrain of the set",
                here,
            );
            continue;
        }
        if (tiles.length === MAX_TERRAIN_TILES) {
            report.add(
                "out-of-range",
                `Terrain tile dropped: more than ${MAX_TERRAIN_TILES}`,
                here,
            );
            continue;
        }
        seen.add(tile);
        tiles.push({ tile, wangId: masked });
    }
    return tiles;
}

/** Wang sets as terrain sets (SPEC §13): colours and tiles kept, the rest reported. */
function readTerrainSets(tileset: Tileset, source: Source, report: TmjReporter): TerrainSet[] {
    const { json, what, where } = source;
    const ids = new Set(tileset.tiles.map((tile) => tile.id));
    const sets: TerrainSet[] = [];
    for (const [index, raw] of objects(json, "wangsets", what).entries()) {
        const rawName = readText(str(raw, "name", "", what), "Terrain set name", where, report);
        const name = rawName.trim() === "" ? `Terrain set ${index + 1}` : rawName;
        const at: TmjLocation = { ...where, terrainSet: name };
        if (rawName.trim() === "") report.add("out-of-range", "Blank name replaced", at);
        const type = str(raw, "type", "corner", what);
        if (!WANG_TYPES.includes(type)) {
            report.add("out-of-range", `Terrain set dropped: type ${type} is unknown`, at);
            continue;
        }
        if (sets.length === MAX_TERRAIN_SETS) {
            report.add("out-of-range", `Terrain set dropped: more than ${MAX_TERRAIN_SETS}`, at);
            continue;
        }
        const colors = readColors(raw, ids, at, report, what);
        if (colors.length < 1 || colors.length > MAX_TERRAINS) {
            report.add(
                "out-of-range",
                `Terrain set dropped: it has ${colors.length} terrains, not 1 to ${MAX_TERRAINS}`,
                at,
            );
            continue;
        }
        reportExtras(raw, at, "Terrain set", report);
        const setType = type as TerrainSetType;
        const tiles = readWangTiles(raw, setType, colors.length, ids, at, report, what);
        sets.push({ name, type: setType, colors, tiles });
    }
    return sets;
}

/** The members of the tileset itself: class, properties, offset and what is dropped. */
function readTilesetData(tileset: Tileset, source: Source, report: TmjReporter): void {
    const { json, what, where } = source;
    tileset.class = readText(str(json, "class", "", what), "Class", where, report);
    tileset.properties = convertProperties(json, where, report, what);
    const offset = json.tileoffset;
    if (offset !== undefined) {
        if (!isObject(offset))
            throw new TmjError("format", `${what}: "tileoffset" is not an object.`);
        const read = (key: string): number => {
            const value = int(offset, key, 0, what);
            const clamped = Math.min(MAX_TILE_OFFSET, Math.max(-MAX_TILE_OFFSET, value));
            if (clamped !== value) {
                report.add(
                    "out-of-range",
                    `Tile offset ${key} ${value} clamped to ${clamped}`,
                    where,
                );
            }
            return clamped;
        };
        tileset.offsetX = read("x");
        tileset.offsetY = read("y");
    }
    const transformations = json.transformations;
    if (isObject(transformations)) {
        const allowed = (["hflip", "vflip", "rotate"] as const).filter(
            (key) => transformations[key] === true,
        );
        if (allowed.length > 0) {
            report.add(
                "terrain-probability",
                `Terrain-set transformations dropped (${allowed.join(", ")})`,
                where,
            );
        }
    }
    if (str(json, "tilerendersize", "tile", what) === "grid") {
        report.add(
            "tile-render-size",
            "Tile render size Grid dropped: tiles draw at tile size",
            where,
        );
    }
}

/** Refuses a map whose cells name a tile the tileset does not have. */
function checkUsed(tileset: Tileset, ref: TmjTilesetRef, name: string): void {
    const ids = new Set(tileset.tiles.map((tile) => tile.id));
    const missing = ref.usedTileIds.find((id) => !ids.has(id));
    if (missing !== undefined) {
        throw new TmjError(
            "gid",
            `The map uses tile ${missing} of tileset "${name}", which has no such tile.`,
        );
    }
}

async function convertOne(
    context: Context,
    ref: TmjTilesetRef,
    index: number,
    mapFileName: string,
): Promise<Tileset | null> {
    const source = readSource(ref, context.files, index, context.report);
    const image = str(source.json, "image", "", source.what);
    const tileset =
        image === ""
            ? await collectionTileset(context, source, baseName(source.path ?? mapFileName))
            : await imageTileset(context, source);
    if (tileset === null) {
        // FORMAT §2.4 holds no tileset without tiles; one that no cell uses is left out.
        const used = ref.usedTileIds[0];
        if (used !== undefined) {
            throw new TmjError(
                "gid",
                `The map uses tile ${used} of tileset "${source.name}", which has no tiles.`,
            );
        }
        context.report.add("out-of-range", "Tileset without tiles dropped", source.where);
        return null;
    }
    checkUsed(tileset, ref, source.name);
    tileset.name = source.name;
    readTilesetData(tileset, source, context.report);
    readTileData(tileset, source, context.report);
    tileset.terrainSets = readTerrainSets(tileset, source, context.report);
    return tileset;
}

/**
 * Converts the tilesets a converted map names (`convertTmjMap`'s `tilesets`). Rejects with
 * `TmjError` when the map is refused: a file missing, a tileset malformed, an image collection
 * of mixed sizes, tiles above 256 px, a limit of FORMAT §2.8 or packability, or a cell naming a
 * tile its tileset does not have.
 */
export async function convertTmjTilesets(
    project: Project,
    refs: readonly TmjTilesetRef[],
    options: TmjTilesetOptions,
): Promise<TmjTilesetConversion> {
    const report = new TmjReporter();
    const context: Context = {
        project,
        files: options.files,
        decode: options.decode ?? decodePng,
        newId: options.newId ?? randomId,
        report,
        added: [],
    };
    const taken = [...exportNames(project), ...(options.takenExportNames ?? [])];
    const slots: (Tileset | null)[] = [];
    for (const [index, ref] of refs.entries()) {
        const reported = report.entries.length;
        const tileset = await convertOne(context, ref, index, options.fileName);
        if (tileset === null) {
            slots.push(null);
            continue;
        }
        const reused = ref.source === null ? null : reusable(project, tileset);
        if (reused) {
            // Nothing of the file is imported, so nothing of it is dropped or changed either.
            report.entries.length = reported;
            slots.push(reused);
            continue;
        }
        checkRoom(context, {
            name: tileset.name,
            tileCount: tileset.tiles.length,
            tileWidth: tileset.tileWidth,
            tileHeight: tileset.tileHeight,
            columns: tileset.columns,
        });
        tileset.exportName = uniqueSlug(
            tileset.name,
            [...taken, ...context.added.map((added) => added.exportName)],
            "tileset",
        );
        context.added.push(tileset);
        slots.push(tileset);
    }
    return { slots, added: context.added, report: report.entries };
}

/**
 * The pixels of an image layer's image (`convertTmjMap`'s `images`) with its `transparentcolor`
 * applied as a colour key (SPEC §13). Its size is checked from the PNG's header before it is
 * decoded. Rejects with `TmjError`.
 */
export async function tmjImagePixels(
    bytes: Uint8Array,
    transparentColor: number | null,
    path: string,
    decode: PngDecoder = decodePng,
): Promise<PixelBuffer> {
    const { width, height } = guard(path, () => readPngSize(bytes));
    if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
        throw new TmjError(
            "limit",
            `The image ${path} is ${width} × ${height} px; an image is at most ${MAX_IMAGE_SIDE} ` +
                "px a side.",
        );
    }
    return guardAsync(path, () => keyed(decode, transparentColor)(bytes));
}
