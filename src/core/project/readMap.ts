import { CellStore, FLAG_MASK, GID_MASK, RESERVED_BIT, SLOT_SHIFT } from "../cells";
import { effectiveValues } from "../model";
import {
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
} from "../model/limits";
import type { GroupLayer, Layer, LayerType, Marker, Project, ProjectMap, Tileset } from "../model";
import { MAX_CELL_VALUE, MAX_FIRST_GID, mapEntry } from "./format";
import { CellRows, JsonReader } from "./json";
import { readProperties, readShape } from "./values";
import type { ShapeRules } from "./values";

// `maps/<mapId>.json` (FORMAT §2.5), checked as step 4 of §2.9: layer and marker IDs unique and
// below their counters, `data` of the right length, `tilesets` and cell values against §1.2.

const MAP_MEMBERS = [
    "id",
    "name",
    "exportName",
    "class",
    "orientation",
    "width",
    "height",
    "tileWidth",
    "tileHeight",
    "backgroundColor",
    "parallaxOriginX",
    "parallaxOriginY",
    "nextLayerId",
    "nextMarkerId",
    "tilesets",
    "layers",
    "properties",
] as const;

const LAYER_MEMBERS = [
    "id",
    "type",
    "name",
    "class",
    "visible",
    "locked",
    "opacity",
    "offsetX",
    "offsetY",
    "parallaxX",
    "parallaxY",
    "properties",
] as const;

const TYPE_MEMBERS: Record<LayerType, readonly string[]> = {
    tile: ["data"],
    marker: ["color", "markers"],
    image: ["image", "repeatX", "repeatY"],
    group: ["layers"],
};

const LAYER_TYPES: readonly LayerType[] = ["tile", "marker", "image", "group"];

const MARKER_RULES: ShapeRules = {
    kinds: ["rectangle", "ellipse", "point", "polygon", "polyline"],
    position: MAX_MARKER_COORD,
    point: Infinity,
};

/** A tileset of the project as the map's GID table names it. */
interface TableEntry {
    firstGid: number;
    tileset: Tileset;
    /** One bit per tile ID below `nextTileId`: set for the tiles that exist. */
    tiles: Uint32Array;
}

/** The project as a map is checked against: the result of step 3 and the maps read so far. */
export interface MapContext {
    project: Project;
    /** Export names taken so far, with their owner (FORMAT §2.4). */
    exportNames: Map<string, string>;
}

/** One bit per tile ID of `tileset` that exists. */
function tileBits(tileset: Tileset): Uint32Array {
    const bits = new Uint32Array(Math.ceil(tileset.nextTileId / 32));
    for (const { id } of tileset.tiles) bits[id >>> 5]! |= 1 << (id & 31);
    return bits;
}

/** A layer whose type-specific members wait for the counts of the whole tree. */
interface PendingLayer {
    layer: Layer;
    member: Record<string, unknown>;
    path: string;
    ancestors: GroupLayer[];
    /** A tile layer's cells, once their count is checked. */
    data?: ArrayLike<unknown>;
}

class MapReader {
    readonly reader: JsonReader;
    readonly context: MapContext;
    readonly pending: PendingLayer[] = [];
    layerIds = new Set<number>();

    constructor(reader: JsonReader, context: MapContext) {
        this.reader = reader;
        this.context = context;
    }

    /** The layer tree without its tile data and markers, depth first; counts and IDs checked. */
    layers(value: unknown, path: string, ancestors: GroupLayer[]): Layer[] {
        const reader = this.reader;
        const list = reader.array(value, path, 0, MAX_LAYERS);
        return list.map((item, index) => {
            const at = `${path}[${index}]`;
            if (this.pending.length >= MAX_LAYERS) {
                reader.fail(at, `is one layer more than the ${MAX_LAYERS} a map may have`);
            }
            const typeOf =
                typeof item === "object" && item !== null && !Array.isArray(item)
                    ? (item as Record<string, unknown>).type
                    : undefined;
            const type = reader.oneOf(typeOf, `${at}.type`, LAYER_TYPES);
            const member = reader.object(item, at, [...LAYER_MEMBERS, ...TYPE_MEMBERS[type]]);
            const id = reader.integer(member.id, `${at}.id`, 1, MAX_LAYER_ID);
            if (this.layerIds.has(id)) reader.fail(`${at}.id`, `repeats the layer ID ${id}`);
            this.layerIds.add(id);
            const base = {
                id,
                name: reader.text(member.name, `${at}.name`),
                class: reader.text(member.class, `${at}.class`),
                visible: reader.boolean(member.visible, `${at}.visible`),
                locked: reader.boolean(member.locked, `${at}.locked`),
                opacity: reader.integer(member.opacity, `${at}.opacity`, 0, 255),
                offsetX: reader.integer(
                    member.offsetX,
                    `${at}.offsetX`,
                    -MAX_LAYER_OFFSET,
                    MAX_LAYER_OFFSET,
                ),
                offsetY: reader.integer(
                    member.offsetY,
                    `${at}.offsetY`,
                    -MAX_LAYER_OFFSET,
                    MAX_LAYER_OFFSET,
                ),
                parallaxX: reader.number(
                    member.parallaxX,
                    `${at}.parallaxX`,
                    -MAX_PARALLAX,
                    MAX_PARALLAX,
                ),
                parallaxY: reader.number(
                    member.parallaxY,
                    `${at}.parallaxY`,
                    -MAX_PARALLAX,
                    MAX_PARALLAX,
                ),
                properties: readProperties(reader, member.properties, `${at}.properties`),
            };
            let layer: Layer;
            switch (type) {
                case "tile":
                    layer = { ...base, type, cells: new CellStore() };
                    break;
                case "marker":
                    layer = {
                        ...base,
                        type,
                        color: reader.colourNumber(member.color, `${at}.color`),
                        markers: [],
                    };
                    break;
                case "image": {
                    const imageId = reader.id(member.image, `${at}.image`);
                    if (!this.context.project.images.some((image) => image.id === imageId)) {
                        reader.fail(
                            `${at}.image`,
                            `names the image ${imageId}, which the project lacks`,
                        );
                    }
                    layer = {
                        ...base,
                        type,
                        imageId,
                        repeatX: reader.boolean(member.repeatX, `${at}.repeatX`),
                        repeatY: reader.boolean(member.repeatY, `${at}.repeatY`),
                    };
                    break;
                }
                case "group":
                    layer = { ...base, type, layers: [] };
                    break;
            }
            this.pending.push({ layer, member, path: at, ancestors });
            const effective = effectiveValues(layer, ancestors);
            if (
                Math.abs(effective.offsetX) > MAX_LAYER_OFFSET ||
                Math.abs(effective.offsetY) > MAX_LAYER_OFFSET ||
                Math.abs(effective.parallaxX) > MAX_PARALLAX ||
                Math.abs(effective.parallaxY) > MAX_PARALLAX
            ) {
                reader.fail(
                    at,
                    `has the effective offset (${effective.offsetX}, ${effective.offsetY}) and ` +
                        `parallax (${effective.parallaxX}, ${effective.parallaxY}); offsets stay ` +
                        `within ±${MAX_LAYER_OFFSET}, parallax within ±${MAX_PARALLAX}`,
                );
            }
            if (layer.type === "group") {
                if (ancestors.length + 1 > MAX_GROUP_DEPTH) {
                    reader.fail(
                        at,
                        `nests groups ${ancestors.length + 1} deep; at most ${MAX_GROUP_DEPTH} are allowed`,
                    );
                }
                layer.layers = this.layers(member.layers, `${at}.layers`, [...ancestors, layer]);
            }
            return layer;
        });
    }
}

function readTable(reader: JsonReader, value: unknown, project: Project): TableEntry[] {
    const list = reader.array(value, "tilesets", 0, MAX_TILESETS);
    const entries = list.map((item, index) => {
        const at = `tilesets[${index}]`;
        const ref = reader.object(item, at, ["tileset", "firstGid"]);
        const tilesetId = reader.id(ref.tileset, `${at}.tileset`);
        const tileset = project.tilesets.find((candidate) => candidate.id === tilesetId);
        if (tileset === undefined) {
            reader.fail(`${at}.tileset`, `names the tileset ${tilesetId}, which the project lacks`);
        }
        const firstGid = reader.integer(ref.firstGid, `${at}.firstGid`, 1, MAX_FIRST_GID);
        return { firstGid, tileset, tiles: new Uint32Array(0), at };
    });
    // Spans `firstGid .. firstGid + nextTileId − 1` do not overlap and stay within the GID bits.
    const sorted = [...entries].sort((a, b) => a.firstGid - b.firstGid);
    let end = 0;
    for (const entry of sorted) {
        if (entry.firstGid <= end) {
            reader.fail(`${entry.at}.firstGid`, `starts a span inside the span before it`);
        }
        end = entry.firstGid + entry.tileset.nextTileId - 1;
        if (end > GID_MASK) {
            reader.fail(`${entry.at}.firstGid`, `starts a span that ends past GID ${GID_MASK}`);
        }
    }
    return sorted.map(({ firstGid, tileset }) => ({
        firstGid,
        tileset,
        tiles: new Uint32Array(0),
    }));
}

/**
 * The cells of a tile layer: the `data` array of a parsed entry, or the writer's own `CellRows`
 * when it checks the map it is about to write (JSON never parses to one).
 */
function cellsOf(reader: JsonReader, value: unknown, path: string): ArrayLike<unknown> {
    return value instanceof CellRows ? value.data : reader.array(value, path);
}

/** The table entry whose span holds `gid`, or undefined. */
function entryOf(table: readonly TableEntry[], gid: number): TableEntry | undefined {
    let low = 0;
    let high = table.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (table[mid]!.firstGid <= gid) low = mid + 1;
        else high = mid - 1;
    }
    const entry = table[high];
    return entry !== undefined && gid - entry.firstGid < entry.tileset.nextTileId
        ? entry
        : undefined;
}

/**
 * Converts a tile layer's `data` (already of length `width × height`) to in-memory values,
 * checking each cell against FORMAT §1.2; then builds its store. Returns the store.
 */
function readCells(
    reader: JsonReader,
    data: ArrayLike<unknown>,
    path: string,
    width: number,
    table: readonly TableEntry[],
): CellStore {
    const values = new Uint32Array(data.length);
    for (let index = 0; index < data.length; index += 1) {
        const cell = data[index];
        if (cell === 0) continue;
        const at = () => `${path}[${index}] (cell ${index % width}, ${Math.floor(index / width)})`;
        if (
            typeof cell !== "number" ||
            !Number.isInteger(cell) ||
            cell < 0 ||
            cell > MAX_CELL_VALUE
        ) {
            reader.fail(at(), `must be an integer from 0 to ${MAX_CELL_VALUE}`);
        }
        if ((cell & RESERVED_BIT) !== 0) reader.fail(at(), "sets the reserved bit 28");
        const gid = cell & GID_MASK;
        if (gid === 0) reader.fail(at(), "sets a flag on an empty cell");
        const entry = entryOf(table, gid);
        if (entry === undefined) reader.fail(at(), `is GID ${gid}, in the span of no tileset`);
        if (entry.tiles.length === 0) entry.tiles = tileBits(entry.tileset);
        const tileId = gid - entry.firstGid;
        if ((entry.tiles[tileId >>> 5]! & (1 << (tileId & 31))) === 0) {
            reader.fail(
                at(),
                `names tile ${tileId} of tileset ${entry.tileset.id}, which it lacks`,
            );
        }
        values[index] = ((cell & FLAG_MASK) | (entry.tileset.slot << SLOT_SHIFT) | tileId) >>> 0;
    }
    const store = new CellStore();
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index]!;
        if (value !== 0) store.set(index % width, Math.floor(index / width), value);
    }
    return store;
}

/**
 * Checks a parsed, migrated `maps/<mapId>.json` against FORMAT §2.5 and §1.2 (§2.9 step 4) and
 * returns the map with its cells as in-memory values (slots of `context.project`). Adds the
 * map's export name to `context.exportNames`. Throws `ProjectError` "invalid-map".
 */
export function readMapJson(value: unknown, mapId: string, context: MapContext): ProjectMap {
    const entry = mapEntry(mapId);
    const reader = new JsonReader("invalid-map", entry);
    const member = reader.object(value, "", MAP_MEMBERS);
    const id = reader.id(member.id, "id");
    if (id !== mapId) reader.fail("id", `is ${id}; the project lists this map as ${mapId}`);
    const exportName = reader.slug(member.exportName, "exportName");
    const owner = context.exportNames.get(exportName);
    if (owner !== undefined) {
        reader.fail("exportName", `is the export name of ${owner} as well`);
    }
    context.exportNames.set(exportName, entry);
    reader.oneOf(member.orientation, "orientation", ["orthogonal"]);
    const width = reader.integer(member.width, "width", 1, MAX_MAP_SIDE);
    const height = reader.integer(member.height, "height", 1, MAX_MAP_SIDE);
    if (width * height > MAX_CELLS_PER_LAYER) {
        reader.fail(
            "height",
            `makes ${width * height} cells a layer; at most ${MAX_CELLS_PER_LAYER} are allowed`,
        );
    }
    const map: ProjectMap = {
        id,
        name: reader.text(member.name, "name", true),
        exportName,
        class: reader.text(member.class, "class"),
        orientation: "orthogonal",
        width,
        height,
        tileWidth: reader.integer(member.tileWidth, "tileWidth", 1, MAX_TILE_SIZE),
        tileHeight: reader.integer(member.tileHeight, "tileHeight", 1, MAX_TILE_SIZE),
        backgroundColor:
            member.backgroundColor === null
                ? null
                : reader.colourNumber(member.backgroundColor, "backgroundColor"),
        parallaxOriginX: reader.number(
            member.parallaxOriginX,
            "parallaxOriginX",
            -MAX_PARALLAX_ORIGIN,
            MAX_PARALLAX_ORIGIN,
        ),
        parallaxOriginY: reader.number(
            member.parallaxOriginY,
            "parallaxOriginY",
            -MAX_PARALLAX_ORIGIN,
            MAX_PARALLAX_ORIGIN,
        ),
        nextLayerId: reader.integer(member.nextLayerId, "nextLayerId", 1, MAX_LAYER_ID),
        nextMarkerId: reader.integer(member.nextMarkerId, "nextMarkerId", 1, MAX_MARKER_ID),
        layers: [],
        properties: readProperties(reader, member.properties, "properties"),
    };
    const table = readTable(reader, member.tilesets, context.project);

    const tree = new MapReader(reader, context);
    map.layers = tree.layers(member.layers, "layers", []);
    if (tree.pending.length === 0) reader.fail("layers", "holds no layer; a map has at least one");
    for (const layerId of tree.layerIds) {
        if (layerId >= map.nextLayerId) {
            reader.fail("nextLayerId", `is ${map.nextLayerId}, not above the layer ID ${layerId}`);
        }
    }

    // Counts of the whole map before any marker or cell is read.
    let markerCount = 0;
    let pointCount = 0;
    for (const pending of tree.pending) {
        const { layer, member: layerMember, path } = pending;
        if (layer.type === "tile") {
            const data = cellsOf(reader, layerMember.data, `${path}.data`);
            pending.data = data;
            if (data.length !== width * height) {
                reader.fail(
                    `${path}.data`,
                    `holds ${data.length} cells; the map has ${width * height}`,
                );
            }
        } else if (layer.type === "marker") {
            const markers = reader.array(layerMember.markers, `${path}.markers`);
            markerCount += markers.length;
            for (const marker of markers) {
                const points = (marker as { points?: unknown } | null)?.points;
                if (Array.isArray(points)) pointCount += points.length;
            }
            if (markerCount > MAX_MARKERS) {
                reader.fail(`${path}.markers`, `make more than ${MAX_MARKERS} markers in the map`);
            }
            if (pointCount > MAX_MARKER_POINTS) {
                reader.fail(
                    `${path}.markers`,
                    `make more than ${MAX_MARKER_POINTS} marker points in the map`,
                );
            }
        }
    }
    // Non-empty cells of all tile layers, counted before a store is built (FORMAT §2.8, as the
    // editor counts them: SPEC §3, `core/model/cellLimit.ts`).
    let cellCount = 0;
    for (const { layer, path, data = [] } of tree.pending) {
        if (layer.type !== "tile") continue;
        for (let index = 0; index < data.length; index += 1) if (data[index] !== 0) cellCount += 1;
        if (cellCount > MAX_CELLS_PER_MAP) {
            reader.fail(
                `${path}.data`,
                `make more than ${MAX_CELLS_PER_MAP} cells in the map's tile layers`,
            );
        }
    }

    const markerIds = new Set<number>();
    for (const { layer, member: layerMember, path, data = [] } of tree.pending) {
        if (layer.type === "tile") {
            layer.cells = readCells(reader, data, `${path}.data`, width, table);
        } else if (layer.type === "marker") {
            layer.markers = (layerMember.markers as unknown[]).map((item, index) => {
                const at = `${path}.markers[${index}]`;
                const { shape, members } = readShape(reader, item, at, MARKER_RULES, [
                    "id",
                    "name",
                    "class",
                    "properties",
                ]);
                const markerId = reader.integer(members.id, `${at}.id`, 1, MAX_MARKER_ID);
                if (markerIds.has(markerId))
                    reader.fail(`${at}.id`, `repeats the marker ID ${markerId}`);
                if (markerId >= map.nextMarkerId) {
                    reader.fail(
                        `${at}.id`,
                        `is ${markerId}, not below nextMarkerId ${map.nextMarkerId}`,
                    );
                }
                markerIds.add(markerId);
                const marker: Marker = {
                    ...shape,
                    id: markerId,
                    name: reader.text(members.name, `${at}.name`),
                    class: reader.text(members.class, `${at}.class`),
                    properties: readProperties(reader, members.properties, `${at}.properties`),
                };
                return marker;
            });
        }
    }
    return map;
}
