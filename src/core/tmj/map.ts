import { CellStore, cellValue } from "../cells";
import {
    DEFAULT_LAYER_NAME,
    DEFAULT_MARKER_COLOR,
    MAX_CELLS_PER_LAYER,
    MAX_CELLS_PER_MAP,
    MAX_GROUP_DEPTH,
    MAX_LAYERS,
    MAX_LAYER_ID,
    MAX_LAYER_OFFSET,
    MAX_MAP_SIDE,
    MAX_MARKERS,
    MAX_MARKER_COORD,
    MAX_MARKER_ID,
    MAX_MARKER_POINTS,
    MAX_PARALLAX,
    MAX_PARALLAX_ORIGIN,
    MAX_TILESETS,
    MAX_TILE_SIZE,
    createTileLayer,
    randomId,
    uniqueSlug,
    walkLayers,
} from "../model";
import type { IdGenerator, Layer, LayerBase, Marker, MarkerLayer, ProjectMap } from "../model";
import { decodeCells, readEncoding } from "./data";
import { TmjError } from "./errors";
import { decodeGid } from "./gid";
import { bool, int, num, objects, parseObject, str, tiledColor } from "./json";
import type { JsonObject } from "./json";
import { Templates, convertObject } from "./objects";
import type { TemplateReader } from "./objects";
import { convertProperties, readText } from "./properties";
import { TmjReporter } from "./report";
import type { TmjLocation, TmjReportEntry } from "./report";

// A Tiled map (`.tmj`, or JSON with `"type": "map"`) as a new project map (SPEC §13, BRIEF §7):
// its layers, cells, objects and properties. Tilesets are converted apart (TE-060): the map's
// cells name them by map-local slot, the index in the map's `tilesets` plus one, which the
// import rebinds to project slots. Nothing here touches a project.

export interface TmjMapOptions {
    /** The map's file name; the map is named after it without its extension. */
    readonly fileName: string;
    /** The text of a template (`.tj`) by its path as the map writes it. */
    readonly template?: TemplateReader;
    /** Export names the map's must differ from. */
    readonly takenExportNames?: Iterable<string>;
    readonly newId?: IdGenerator;
}

/** One tileset of the map's `tilesets`, as its cells use it. */
export interface TmjTilesetRef {
    /** The slot the map's cells use for it: its index in the map's `tilesets` plus one. */
    readonly slot: number;
    readonly firstGid: number;
    /** An external tileset's path as the map writes it; null when embedded. */
    readonly source: string | null;
    /** An embedded tileset's JSON (without `firstgid`); null when external. */
    readonly embedded: JsonObject | null;
    /** Tiled's local IDs of the tiles the cells use, ascending. */
    readonly usedTileIds: readonly number[];
}

/** An image an image layer shows; the layer's `imageId` is `id`. */
export interface TmjImageRef {
    readonly id: string;
    /** The image's path as the map writes it. */
    readonly path: string;
    /** The layer's `transparentcolor` as 0xRRGGBBAA (applied as a colour key), or null. */
    readonly transparentColor: number | null;
}

export interface TmjMapConversion {
    readonly map: ProjectMap;
    readonly tilesets: readonly TmjTilesetRef[];
    readonly images: readonly TmjImageRef[];
    /**
     * Cells every layer and marker moved by: the top-left used chunk of an infinite map becomes
     * cell (0, 0). (0, 0) for a fixed map.
     */
    readonly offset: { readonly x: number; readonly y: number };
    /** In conversion order; `groupReport` groups them by BRIEF §7 row. */
    readonly report: readonly TmjReportEntry[];
}

/** One rectangle of decoded cells: a fixed layer's data, or one chunk of an infinite layer. */
interface CellBlock {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly cells: Uint32Array;
}

interface Context {
    readonly tileWidth: number;
    readonly tileHeight: number;
    readonly width: number;
    readonly height: number;
    /** Cells moved by; pixels are this times the tile size. */
    readonly dx: number;
    readonly dy: number;
    readonly firstGids: readonly number[];
    readonly used: Set<number>[];
    readonly blocks: Map<JsonObject, CellBlock[]>;
    readonly images: TmjImageRef[];
    readonly imageIds: Map<string, string>;
    readonly templates: Templates;
    readonly report: TmjReporter;
    readonly newId: IdGenerator;
}

function layerName(raw: JsonObject): string {
    return typeof raw.name === "string" ? raw.name : "";
}

function layerWhat(raw: JsonObject): string {
    return `Layer "${layerName(raw)}"`;
}

function locate(raw: JsonObject): TmjLocation {
    return { layer: { id: typeof raw.id === "number" ? raw.id : 0, name: layerName(raw) } };
}

/** Refuses a map that is not orthogonal, uses `zstd`, or nests or holds too many layers. */
function checkLayers(layers: readonly JsonObject[], depth: number, count: { n: number }): void {
    for (const layer of layers) {
        count.n += 1;
        if (count.n > MAX_LAYERS) {
            throw new TmjError("limit", `The map has more than ${MAX_LAYERS} layers.`);
        }
        const what = layerWhat(layer);
        if (layer.type === "tilelayer") {
            readEncoding(
                str(layer, "encoding", "csv", what),
                str(layer, "compression", "", what),
                what,
            );
        } else if (layer.type === "group") {
            if (depth + 1 > MAX_GROUP_DEPTH) {
                throw new TmjError("limit", `Groups nest more than ${MAX_GROUP_DEPTH} deep.`);
            }
            checkLayers(objects(layer, "layers", what), depth + 1, count);
        } else if (layer.type !== "objectgroup" && layer.type !== "imagelayer") {
            throw new TmjError("format", `${what} has unknown type ${String(layer.type)}.`);
        }
    }
}

function* tileLayers(layers: readonly JsonObject[]): Generator<JsonObject> {
    for (const layer of layers) {
        if (layer.type === "tilelayer") yield layer;
        else if (layer.type === "group") yield* tileLayers(objects(layer, "layers", ""));
    }
}

function checkCells(width: number, height: number, tileLayerCount: number): void {
    if (width < 1 || height < 1 || width > MAX_MAP_SIDE || height > MAX_MAP_SIDE) {
        throw new TmjError(
            "limit",
            `A map is 1 to ${MAX_MAP_SIDE} cells on each side; this one is ${width} × ${height}.`,
        );
    }
    if (width * height > MAX_CELLS_PER_LAYER) {
        throw new TmjError("limit", `A map has at most ${MAX_CELLS_PER_LAYER} cells.`);
    }
    if (width * height * tileLayerCount > MAX_CELLS_PER_MAP) {
        throw new TmjError(
            "limit",
            `The tile layers of a map hold at most ${MAX_CELLS_PER_MAP} cells in all.`,
        );
    }
}

/** Decodes every tile layer's cells: the layer's data, or its chunks. */
function decodeBlocks(
    layers: readonly JsonObject[],
    infinite: boolean,
): Map<JsonObject, CellBlock[]> {
    const blocks = new Map<JsonObject, CellBlock[]>();
    let total = 0;
    const decode = (source: JsonObject, layer: JsonObject, what: string): CellBlock => {
        const width = int(source, "width", 0, what);
        const height = int(source, "height", 0, what);
        if (width < 0 || height < 0 || width * height > MAX_CELLS_PER_LAYER) {
            throw new TmjError("limit", `${what} has more than ${MAX_CELLS_PER_LAYER} cells.`);
        }
        total += width * height;
        if (total > MAX_CELLS_PER_MAP) {
            throw new TmjError(
                "limit",
                `The tile layers of a map hold at most ${MAX_CELLS_PER_MAP} cells in all.`,
            );
        }
        const { encoding, compression } = readEncoding(
            str(layer, "encoding", "csv", what),
            str(layer, "compression", "", what),
            what,
        );
        const cells = decodeCells(source.data, width * height, encoding, compression, what);
        const x = infinite ? int(source, "x", 0, what) : 0;
        const y = infinite ? int(source, "y", 0, what) : 0;
        return { x, y, width, height, cells };
    };
    for (const layer of tileLayers(layers)) {
        const what = layerWhat(layer);
        const list = infinite
            ? objects(layer, "chunks", what).map((chunk, index) =>
                  decode(chunk, layer, `${what}, chunk ${index + 1}`),
              )
            : [decode(layer, layer, what)];
        blocks.set(layer, list);
    }
    return blocks;
}

/** The bounds of the chunks holding at least one tile, or null when none does. */
function usedBounds(
    blocks: Map<JsonObject, CellBlock[]>,
): { x: number; y: number; right: number; bottom: number } | null {
    let bounds: { x: number; y: number; right: number; bottom: number } | null = null;
    for (const list of blocks.values()) {
        for (const block of list) {
            if (!block.cells.some((cell) => (cell & 0x0fffffff) !== 0)) continue;
            const right = block.x + block.width;
            const bottom = block.y + block.height;
            bounds = bounds
                ? {
                      x: Math.min(bounds.x, block.x),
                      y: Math.min(bounds.y, block.y),
                      right: Math.max(bounds.right, right),
                      bottom: Math.max(bounds.bottom, bottom),
                  }
                : { x: block.x, y: block.y, right, bottom };
        }
    }
    return bounds;
}

/** The common members of a layer (FORMAT §2.5 Layer). `shift` moves an image layer's offset. */
function convertBase(
    raw: JsonObject,
    context: Context,
    shift: { x: number; y: number } = { x: 0, y: 0 },
): LayerBase {
    const what = layerWhat(raw);
    const where = locate(raw);
    const { report } = context;
    const id = raw.id;
    const opacityRaw = num(raw, "opacity", 1, what);
    const opacity = Math.round(255 * Math.min(1, Math.max(0, opacityRaw)));
    if (opacityRaw < 0 || opacityRaw > 1) {
        report.add("out-of-range", `Opacity ${opacityRaw} clamped to ${opacity / 255}`, where);
    }
    const offsetXRaw = num(raw, "offsetx", 0, what);
    const offsetYRaw = num(raw, "offsety", 0, what);
    let offsetX = Math.round(offsetXRaw);
    let offsetY = Math.round(offsetYRaw);
    if (offsetX !== offsetXRaw || offsetY !== offsetYRaw) {
        report.add(
            "layer-offsets",
            `Offset (${offsetXRaw}, ${offsetYRaw}) rounded to (${offsetX}, ${offsetY})`,
            where,
        );
    }
    offsetX += shift.x;
    offsetY += shift.y;
    const clampedX = Math.min(MAX_LAYER_OFFSET, Math.max(-MAX_LAYER_OFFSET, offsetX));
    const clampedY = Math.min(MAX_LAYER_OFFSET, Math.max(-MAX_LAYER_OFFSET, offsetY));
    if (clampedX !== offsetX || clampedY !== offsetY) {
        report.add(
            "out-of-range",
            `Offset (${offsetX}, ${offsetY}) clamped to (${clampedX}, ${clampedY})`,
            where,
        );
    }
    const parallax = (key: string): number => {
        const value = num(raw, key, 1, what);
        const clamped = Math.min(MAX_PARALLAX, Math.max(-MAX_PARALLAX, value));
        if (clamped !== value) {
            report.add("out-of-range", `Parallax ${value} clamped to ${clamped}`, where);
        }
        return clamped;
    };
    const tint = str(raw, "tintcolor", "", what);
    if (tint !== "") report.add("tint-blend", `Tint ${tint} dropped`, where);
    const mode = str(raw, "mode", "normal", what);
    if (mode !== "normal") report.add("tint-blend", `Blend mode ${mode} dropped`, where);
    return {
        // Tiled's number as it is; `assignIds` replaces one out of range and reports it.
        id: typeof id === "number" ? id : 0,
        name: readText(str(raw, "name", "", what), "Name", where, report),
        class: readText(str(raw, "class", "", what), "Class", where, report),
        visible: bool(raw, "visible", true, what),
        locked: bool(raw, "locked", false, what),
        opacity,
        offsetX: clampedX,
        offsetY: clampedY,
        parallaxX: parallax("parallaxx"),
        parallaxY: parallax("parallaxy"),
        properties: convertProperties(raw, where, report, what),
    };
}

function convertTileLayer(raw: JsonObject, context: Context): Layer {
    const base = convertBase(raw, context);
    const where = locate(raw);
    const cells = new CellStore();
    let bit28 = 0;
    let outside = 0;
    for (const block of context.blocks.get(raw) ?? []) {
        for (let index = 0; index < block.cells.length; index += 1) {
            const decoded = decodeGid(block.cells[index]!, context.firstGids);
            if (decoded.kind === "empty") continue;
            const x = block.x + (index % block.width) + context.dx;
            const y = block.y + Math.floor(index / block.width) + context.dy;
            if (decoded.kind === "invalid") {
                throw new TmjError(
                    "gid",
                    `${layerWhat(raw)}: GID ${decoded.gid} at cell (${x}, ${y}) names no tile ` +
                        "of the map's tilesets.",
                );
            }
            if (x < 0 || y < 0 || x >= context.width || y >= context.height) {
                outside += 1;
                continue;
            }
            if (decoded.bit28) bit28 += 1;
            context.used[decoded.tileset]!.add(decoded.tileId);
            cells.set(x, y, cellValue(decoded.tileset + 1, decoded.tileId, decoded.orientation));
        }
    }
    if (bit28 > 0) {
        context.report.add(
            "gid-flip-bits",
            "Bit 28 cleared (hexagonal 120° rotation)",
            where,
            bit28,
        );
    }
    if (outside > 0) {
        context.report.add("out-of-range", "Cells outside the map dropped", where, outside);
    }
    return { ...base, type: "tile", cells };
}

function convertObjectLayer(raw: JsonObject, context: Context): MarkerLayer {
    const base = convertBase(raw, context);
    const what = layerWhat(raw);
    const where = locate(raw);
    const colorText = str(raw, "color", "", what);
    let color = DEFAULT_MARKER_COLOR;
    if (colorText !== "") {
        const parsed = tiledColor(colorText);
        if (parsed === null) {
            context.report.add(
                "out-of-range",
                `Colour ${colorText} replaced by the default`,
                where,
            );
        } else {
            color = parsed;
        }
    }
    const layer = where.layer!;
    const markers: Marker[] = [];
    const objectContext = { layer, templates: context.templates, report: context.report };
    const dx = context.dx * context.tileWidth;
    const dy = context.dy * context.tileHeight;
    for (const [index, object] of objects(raw, "objects", what).entries()) {
        const marker = convertObject(object, objectContext, `${what}, object ${index + 1}`);
        if (marker === null) continue;
        const moved = { ...marker, x: marker.x + dx, y: marker.y + dy };
        if ((dx !== 0 || dy !== 0) && !markerInRange(moved)) {
            context.report.add(
                "out-of-range",
                "Object dropped: out of range after the infinite-map offset",
                { layer, object: { id: marker.id, name: marker.name } },
            );
            continue;
        }
        markers.push(moved);
    }
    return { ...base, type: "marker", color, markers };
}

function convertLayer(raw: JsonObject, context: Context): Layer | null {
    const what = layerWhat(raw);
    switch (raw.type) {
        case "tilelayer":
            return convertTileLayer(raw, context);
        case "objectgroup":
            return convertObjectLayer(raw, context);
        case "imagelayer": {
            const path = str(raw, "image", "", what);
            if (path === "") {
                context.report.add(
                    "out-of-range",
                    "Image layer without an image dropped",
                    locate(raw),
                );
                return null;
            }
            const shift = {
                x: context.dx * context.tileWidth,
                y: context.dy * context.tileHeight,
            };
            const base = convertBase(raw, context, shift);
            const transparentColor = readColor(
                str(raw, "transparentcolor", "", what),
                "Transparent colour",
                locate(raw),
                context.report,
            );
            const key = `${path}\n${transparentColor ?? ""}`;
            let imageId = context.imageIds.get(key);
            if (imageId === undefined) {
                imageId = context.newId();
                context.imageIds.set(key, imageId);
                context.images.push({ id: imageId, path, transparentColor });
            }
            return {
                ...base,
                type: "image",
                imageId,
                repeatX: bool(raw, "repeatx", false, what),
                repeatY: bool(raw, "repeaty", false, what),
            };
        }
        default: {
            const base = convertBase(raw, context);
            const layers = objects(raw, "layers", what)
                .map((child) => convertLayer(child, context))
                .filter((child): child is Layer => child !== null);
            return { ...base, type: "group", layers };
        }
    }
}

/**
 * Gives every layer (`kind` "layer") or marker an ID that is valid and unique in the map: the
 * first holder of an ID keeps it, the others take new ones from `next` up. Returns the next ID.
 */
function assignIds<T extends { id: number; name: string }>(
    items: readonly { item: T; where: TmjLocation; original: number }[],
    next: number,
    label: string,
    max: number,
    report: TmjReporter,
): number {
    const taken = new Set<number>();
    const pending: (typeof items)[number][] = [];
    let highest = 0;
    for (const entry of items) {
        const { id } = entry.item;
        if (!Number.isInteger(id) || id < 1 || id > max || taken.has(id)) {
            pending.push(entry);
        } else {
            taken.add(id);
            highest = Math.max(highest, id);
        }
    }
    // The next ID is above every ID and itself at most `max` (FORMAT §2.5).
    let id = Math.max(next, highest + 1, 1);
    for (const entry of pending) {
        if (id >= max) throw new TmjError("limit", `${label} IDs run past ${max}.`);
        report.add("out-of-range", `${label} ID ${entry.original} replaced by ${id}`, entry.where);
        entry.item.id = id;
        id += 1;
    }
    if (id > max) throw new TmjError("limit", `${label} IDs run past ${max}.`);
    return id;
}

/** A colour of the map or a layer; text that is no colour is dropped and reported. */
function readColor(
    text: string,
    label: string,
    where: TmjLocation,
    report: TmjReporter,
): number | null {
    if (text === "") return null;
    const color = tiledColor(text);
    if (color === null) report.add("out-of-range", `${label} ${text} dropped`, where);
    return color;
}

/** Whether every coordinate of a marker is inside FORMAT §2.5's range. */
function markerInRange(marker: Marker): boolean {
    const ok = (value: number): boolean => Math.abs(value) <= MAX_MARKER_COORD;
    if (!ok(marker.x) || !ok(marker.y)) return false;
    if (marker.shape === "rectangle" || marker.shape === "ellipse") {
        return ok(marker.x + marker.width) && ok(marker.y + marker.height);
    }
    if (marker.shape === "polygon" || marker.shape === "polyline") {
        return marker.points.every(([px, py]) => ok(marker.x + px) && ok(marker.y + py));
    }
    return true;
}

/**
 * Keeps each layer's effective offset and parallax (its own under its groups, FORMAT §2.5)
 * inside the ranges: a layer whose effective value falls outside has its own value changed so
 * the effective one is the nearest in range, and reported. Groups come before their children.
 */
function clampEffective(layers: readonly Layer[], report: TmjReporter): void {
    for (const { layer, ancestors } of walkLayers(layers)) {
        const where: TmjLocation = { layer: { id: layer.id, name: layer.name } };
        const offset = (key: "offsetX" | "offsetY"): void => {
            const above = ancestors.reduce((sum, group) => sum + group[key], 0);
            const effective = above + layer[key];
            const clamped = Math.min(MAX_LAYER_OFFSET, Math.max(-MAX_LAYER_OFFSET, effective));
            if (clamped === effective) return;
            report.add(
                "out-of-range",
                `Effective offset ${effective} clamped to ${clamped}`,
                where,
                1,
            );
            layer[key] = clamped - above;
        };
        const parallax = (key: "parallaxX" | "parallaxY"): void => {
            const above = ancestors.reduce((product, group) => product * group[key], 1);
            const effective = above * layer[key];
            if (Math.abs(effective) <= MAX_PARALLAX) return;
            const clamped = Math.sign(effective) * MAX_PARALLAX;
            report.add(
                "out-of-range",
                `Effective parallax ${effective} clamped to ${clamped}`,
                where,
            );
            layer[key] = clamped / above;
        };
        offset("offsetX");
        offset("offsetY");
        parallax("parallaxX");
        parallax("parallaxY");
    }
}

/** The map's name: its file's name without folders and extension. */
function nameOf(fileName: string): string {
    const base = fileName.split(/[\\/]/).pop() ?? "";
    const dot = base.lastIndexOf(".");
    const name = dot > 0 ? base.slice(0, dot) : base;
    return name.trim() === "" ? "Map" : name;
}

/**
 * Converts a Tiled map. Throws `TmjError` when the map is refused: not orthogonal, `zstd` data,
 * a cell naming no tileset, a missing template, a limit of FORMAT §2.5 or §2.8, or malformed.
 */
export function convertTmjMap(text: string, options: TmjMapOptions): TmjMapConversion {
    const raw = parseObject(text, "The map");
    const what = "The map";
    if (raw.type !== "map") throw new TmjError("format", "The file is not a Tiled map.");
    const orientation = str(raw, "orientation", "orthogonal", what);
    if (orientation !== "orthogonal") {
        throw new TmjError(
            "orientation",
            `Only orthogonal maps can be imported; this map is ${orientation}.`,
        );
    }
    const rawLayers = objects(raw, "layers", what);
    checkLayers(rawLayers, 0, { n: 0 });

    const tileWidth = int(raw, "tilewidth", 0, what);
    const tileHeight = int(raw, "tileheight", 0, what);
    if (
        tileWidth < 1 ||
        tileHeight < 1 ||
        tileWidth > MAX_TILE_SIZE ||
        tileHeight > MAX_TILE_SIZE
    ) {
        throw new TmjError(
            "limit",
            `Tiles are 1 to ${MAX_TILE_SIZE} px on each side; this map's are ` +
                `${tileWidth} × ${tileHeight}.`,
        );
    }

    const tilesetsRaw = objects(raw, "tilesets", what);
    if (tilesetsRaw.length > MAX_TILESETS) {
        throw new TmjError("limit", `A map uses at most ${MAX_TILESETS} tilesets.`);
    }
    const firstGids: number[] = [];
    for (const [index, tileset] of tilesetsRaw.entries()) {
        const firstGid = int(tileset, "firstgid", 0, `Tileset ${index + 1}`);
        if (firstGid < 1 || firstGid <= (firstGids.at(-1) ?? 0) || firstGid > 0x0fffffff) {
            throw new TmjError(
                "format",
                `Tileset ${index + 1} has firstgid ${firstGid} out of order.`,
            );
        }
        firstGids.push(firstGid);
    }

    const infinite = bool(raw, "infinite", false, what);
    const tileLayerCount = [...tileLayers(rawLayers)].length;
    let width = int(raw, "width", 0, what);
    let height = int(raw, "height", 0, what);
    if (!infinite) checkCells(width, height, tileLayerCount);
    const blocks = decodeBlocks(rawLayers, infinite);
    const report = new TmjReporter();
    let dx = 0;
    let dy = 0;
    if (infinite) {
        const bounds = usedBounds(blocks);
        if (bounds) {
            dx = -bounds.x;
            dy = -bounds.y;
            width = bounds.right - bounds.x;
            height = bounds.bottom - bounds.y;
        } else {
            width = Math.max(1, width);
            height = Math.max(1, height);
        }
        checkCells(width, height, tileLayerCount);
        report.add(
            "infinite-map",
            `Converted to a fixed ${width} × ${height} map over the used chunks; every layer ` +
                `and marker moved by (${dx}, ${dy}) cells`,
            {},
        );
    }

    const renderOrder = str(raw, "renderorder", "right-down", what);
    if (renderOrder !== "right-down") {
        report.add("render-order", `Render order ${renderOrder} drawn right-down`, {});
    }
    const mapClass = readText(str(raw, "class", "", what), "Class", {}, report);
    const mapProperties = convertProperties(raw, {}, report, what);

    const newId = options.newId ?? randomId;
    const context: Context = {
        tileWidth,
        tileHeight,
        width,
        height,
        dx,
        dy,
        firstGids,
        used: tilesetsRaw.map(() => new Set<number>()),
        blocks,
        images: [],
        imageIds: new Map(),
        templates: new Templates(options.template),
        report,
        newId,
    };
    const mapId = newId();
    const layers = rawLayers
        .map((layer) => convertLayer(layer, context))
        .filter((layer): layer is Layer => layer !== null);

    const layerEntries = [...walkLayers(layers)].map(({ layer }) => ({
        item: layer,
        where: { layer: { id: layer.id, name: layer.name } },
        original: layer.id,
    }));
    const markerEntries = layerEntries.flatMap(({ item: layer }) =>
        layer.type === "marker"
            ? layer.markers.map((marker) => ({
                  item: marker,
                  where: {
                      layer: { id: layer.id, name: layer.name },
                      object: { id: marker.id, name: marker.name },
                  },
                  original: marker.id,
              }))
            : [],
    );
    const points = markerEntries.reduce(
        (sum, { item }) => sum + ("points" in item ? item.points.length : 0),
        0,
    );
    if (markerEntries.length > MAX_MARKERS || points > MAX_MARKER_POINTS) {
        throw new TmjError(
            "limit",
            `A map has at most ${MAX_MARKERS} markers with ${MAX_MARKER_POINTS} points in all.`,
        );
    }
    let nextLayerId = assignIds(
        layerEntries,
        int(raw, "nextlayerid", 1, what),
        "Layer",
        MAX_LAYER_ID,
        report,
    );
    const nextMarkerId = assignIds(
        markerEntries,
        int(raw, "nextobjectid", 1, what),
        "Object",
        MAX_MARKER_ID,
        report,
    );
    clampEffective(layers, report);
    if (layers.length === 0) {
        report.add("out-of-range", "The map has no layers; an empty tile layer added", {});
        layers.push(createTileLayer(nextLayerId, DEFAULT_LAYER_NAME));
        nextLayerId += 1;
    }

    const parallaxOrigin = (key: string, shift: number): number => {
        const value = num(raw, key, 0, what) + shift;
        const clamped = Math.min(MAX_PARALLAX_ORIGIN, Math.max(-MAX_PARALLAX_ORIGIN, value));
        if (clamped !== value) {
            report.add("out-of-range", `Parallax origin ${value} clamped to ${clamped}`, {});
        }
        return clamped;
    };
    const backgroundColor = readColor(
        str(raw, "backgroundcolor", "", what),
        "Background colour",
        {},
        report,
    );
    const name = readText(nameOf(options.fileName), "Name", {}, report);
    const map: ProjectMap = {
        id: mapId,
        name,
        exportName: uniqueSlug(name, options.takenExportNames ?? [], "map"),
        class: mapClass,
        orientation: "orthogonal",
        width,
        height,
        tileWidth,
        tileHeight,
        backgroundColor,
        parallaxOriginX: parallaxOrigin("parallaxoriginx", dx * tileWidth),
        parallaxOriginY: parallaxOrigin("parallaxoriginy", dy * tileHeight),
        nextLayerId,
        nextMarkerId,
        layers,
        properties: mapProperties,
    };

    const tilesets = tilesetsRaw.map((tileset, index): TmjTilesetRef => {
        const source = tileset.source;
        let embedded: JsonObject | null = null;
        if (typeof source !== "string") {
            embedded = { ...tileset };
            delete embedded.firstgid;
        }
        return {
            slot: index + 1,
            firstGid: firstGids[index]!,
            source: typeof source === "string" ? source : null,
            embedded,
            usedTileIds: [...context.used[index]!].sort((a, b) => a - b),
        };
    });

    return {
        map,
        tilesets,
        images: context.images,
        offset: { x: dx, y: dy },
        report: report.entries,
    };
}
