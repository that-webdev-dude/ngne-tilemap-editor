import { CHUNK_BITS, CELL_INDEX_MASK, RESERVED_BIT, cellSlot, cellTileId } from "../cells";
import { isId, idKey } from "./ids";
import { effectiveValues, walkLayers } from "./layers";
import {
    MAX_ANIMATION_FRAMES,
    MAX_ANIMATION_FRAMES_PER_TILESET,
    MAX_CELLS_PER_LAYER,
    MAX_CELLS_PER_MAP,
    MAX_COLLISION_COORD,
    MAX_COLLISION_SHAPES,
    MAX_FILE_PROPERTY_LENGTH,
    MAX_FRAME_MS,
    MAX_GROUP_DEPTH,
    MAX_IMAGES,
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_SIDE,
    MAX_INT_PROPERTY,
    MAX_LAYERS,
    MAX_LAYER_ID,
    MAX_LAYER_OFFSET,
    MAX_MAPS,
    MAX_MAP_SIDE,
    MAX_MARKERS,
    MAX_MARKER_COORD,
    MAX_MARKER_ID,
    MAX_MARKER_POINTS,
    MAX_NEXT_TILE_ID,
    MAX_PARALLAX,
    MAX_PARALLAX_ORIGIN,
    MAX_PROPERTIES,
    MAX_SHAPE_POINTS,
    MAX_SLOT,
    MAX_SOURCE_INDEX,
    MAX_SOURCE_MARGIN,
    MAX_STRING_PROPERTY_LENGTH,
    MAX_TERRAINS,
    MAX_TERRAIN_SETS,
    MAX_TERRAIN_TILES,
    MAX_TEXT_LENGTH,
    MAX_TILESETS,
    MAX_TILESET_COLUMNS,
    MAX_TILESET_PIXELS,
    MAX_TILES_PER_PROJECT,
    MAX_TILES_PER_TILESET,
    MAX_TILE_ID,
    MAX_TILE_OFFSET,
    MAX_TILE_SIZE,
    MIN_POLYGON_POINTS,
    MIN_POLYLINE_POINTS,
} from "./limits";
import { isSlug } from "./slug";
import type {
    Layer,
    Project,
    ProjectMap,
    Property,
    Shape,
    TerrainSet,
    Tile,
    Tileset,
    TilesetSource,
} from "./types";

/**
 * The invariants of SPEC §2.1: the rules and limits of FORMAT §1 and §2, at least one map,
 * every cell names an existing tile, every animation frame and terrain tile names a tile of
 * its tileset, export names distinct, IDs never reused. `assertInvariants` checks them in
 * this order, project first, then each tileset, each image, each map.
 */
export const INVARIANTS = {
    "project-id": "the project's ID is well-formed",
    "project-name": "the project's name is non-blank text",
    "project-export-name": "the project's export name is a slug",
    "export-settings": "exportSettings holds a boolean exportOnSave",
    "map-required": "the project has 1 to 256 maps",
    "tileset-count": "the project has at most 255 tilesets",
    "image-count": "the project has at most 256 images",
    "unique-ids":
        "the IDs of the project, its maps, tilesets and images are distinct, whatever their case",
    "unique-export-names": "the export names of maps, tilesets and images are distinct",
    "unique-slots": "every tileset has a slot 1..255 of its own",
    "property-list":
        "a property list is valid: at most 256, names non-blank and distinct, values of their type",
    "text-length": "a text is at most 255 UTF-16 code units",
    "tileset-name": "a tileset's name is non-blank text and its export name a slug",
    "tileset-tile-size": "a tileset's tile width and height are 1..256",
    "tileset-columns": "a tileset's columns are 1..8192 and its image at most 8192 px a side",
    "tileset-offset": "a tileset's tile offset is −4096..4096",
    "tileset-source": "a tileset's source is well-formed",
    "tileset-tile-count": "a tileset has 1 to 65 536 tiles",
    "tileset-pixels":
        "a tileset's pixels are its grid: columns × tileWidth by rows × tileHeight, 4 bytes a pixel",
    "tile-id": "every tile ID is 0..1 048 575 and unique in its tileset",
    "next-tile-id": "nextTileId is 1..1 048 576 and above every tile ID",
    "tile-source-key": "every tile's source key fits the tileset's source kind and is unique",
    "tile-fingerprint": "every tile's fingerprint is 64 lowercase hexadecimal digits",
    "tile-collision":
        "a tile has at most 64 collision shapes, each a rectangle, ellipse or polygon within −4096..4096",
    "tile-animation":
        "an animation has at most 1024 frames of 1..65 535 ms, each naming a tile of the tileset",
    "tileset-animation-count": "a tileset's animations hold at most 65 536 frames together",
    "terrain-set-count": "a tileset has at most 256 terrain sets",
    "terrain-set":
        "a terrain set is well-formed: non-blank name, 1 to 254 colours, at most 65 536 tiles",
    "terrain-tile":
        "every terrain colour icon and terrain tile names a tile of the tileset, once, with a wangId of its type",
    "tiles-per-project": "all tilesets together hold at most 262 144 tiles",
    "tileset-pixel-budget": "all tileset images together hold at most 64 MP",
    "image-name": "an image's name is non-blank text and its export name a slug",
    "image-pixels": "an image is 1..8192 px a side with 4 bytes a pixel",
    "image-pixel-budget": "all images together hold at most 64 MP",
    "map-name": "a map's name is non-blank text and its export name a slug",
    "map-orientation": 'a map is "orthogonal"',
    "map-size": "a map is 1..4096 cells a side and at most 1 048 576 cells",
    "map-tile-size": "a map's grid cell is 1..256 px a side",
    "map-background": "a map's background colour is null or 0xRRGGBBAA",
    "map-parallax-origin": "a map's parallax origin is within ±1 048 576",
    "map-layer-count": "a map has 1 to 256 layers, groups at most 16 deep",
    "layer-id": "every layer ID is 1..2 147 483 647 and unique in its map",
    "next-layer-id": "nextLayerId is 1..2 147 483 647 and above every layer ID",
    "layer-values":
        "a layer's opacity is an integer 0..255, offsets integers within ±1 048 576, parallax within ±100",
    "layer-effective-values": "a layer's effective offset and parallax stay within the ranges",
    "cell-count": "a tile layer has at most 1 048 576 cells and a map's tile layers 4 194 304",
    "cell-in-map": "every cell lies inside the map",
    "cell-tile-exists": "every cell names an existing tile of a tileset of the project",
    "marker-layer-color": "a marker layer's colour is 0xRRGGBBAA",
    "marker-id": "every marker ID is 1..2 147 483 647 and unique in its map",
    "next-marker-id": "nextMarkerId is 1..2 147 483 647 and above every marker ID",
    "marker-shape": "a marker is a valid shape within ±1 048 576",
    "marker-count": "a map has at most 16 384 markers with at most 262 144 points",
    "image-layer-image": "an image layer names an image of the project",
} as const;

export type InvariantName = keyof typeof INVARIANTS;

/** Thrown by `assertInvariants`. The message names the invariant, as does `invariant`. */
export class InvariantError extends Error {
    override readonly name = "InvariantError";
    readonly invariant: InvariantName;
    readonly detail: string;

    constructor(invariant: InvariantName, detail: string) {
        super(`Invariant "${invariant}" violated (${INVARIANTS[invariant]}): ${detail}`);
        this.invariant = invariant;
        this.detail = detail;
    }
}

function fail(invariant: InvariantName, detail: string): never {
    throw new InvariantError(invariant, detail);
}

const COLOUR_PATTERN = /^#[0-9a-fA-F]{8}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function isInt(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isNum(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isText(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_TEXT_LENGTH;
}

function isBlank(text: string): boolean {
    return text.trim() === "";
}

function isColour32(value: unknown): boolean {
    return isInt(value, 0, 0xffffffff);
}

/** Text of FORMAT §1.1; whether it may be blank is the caller's invariant. */
function checkText(value: unknown, what: string): void {
    if (typeof value !== "string") fail("text-length", `${what} is not a string`);
    if (value.length > MAX_TEXT_LENGTH) {
        fail("text-length", `${what} is ${value.length} code units long`);
    }
}

function checkProperties(list: Property[], what: string): void {
    if (!Array.isArray(list) || list.length > MAX_PROPERTIES) {
        fail("property-list", `${what} has ${list?.length ?? "no"} properties`);
    }
    const names = new Set<string>();
    for (const property of list) {
        const { name, type, value } = property;
        if (typeof name !== "string" || !isText(name) || isBlank(name)) {
            fail(
                "property-list",
                `${what}: property name ${JSON.stringify(name)} is not non-blank text`,
            );
        }
        if (names.has(name)) fail("property-list", `${what}: property "${name}" repeats`);
        names.add(name);
        const valid =
            (type === "bool" && typeof value === "boolean") ||
            (type === "int" && isInt(value, -MAX_INT_PROPERTY, MAX_INT_PROPERTY)) ||
            (type === "float" && typeof value === "number" && Number.isFinite(value)) ||
            (type === "string" &&
                typeof value === "string" &&
                value.length <= MAX_STRING_PROPERTY_LENGTH) ||
            (type === "color" && typeof value === "string" && COLOUR_PATTERN.test(value)) ||
            (type === "file" &&
                typeof value === "string" &&
                value.length <= MAX_FILE_PROPERTY_LENGTH);
        if (!valid) {
            fail(
                "property-list",
                `${what}: property "${name}" of type "${type}" has an invalid value`,
            );
        }
    }
}

/** Whether a shape is well-formed with every coordinate within `±limit`. */
function shapeProblem(shape: Shape, limit: number, collision: boolean): string | null {
    if (!isNum(shape.x, -limit, limit) || !isNum(shape.y, -limit, limit)) {
        return `position (${shape.x}, ${shape.y}) is out of range`;
    }
    switch (shape.shape) {
        case "rectangle":
        case "ellipse":
            if (!isNum(shape.width, 0, 2 * limit) || !isNum(shape.height, 0, 2 * limit)) {
                return `size ${shape.width}×${shape.height} is not ≥ 0`;
            }
            return null;
        case "point":
            return collision ? "a point is no collision shape" : null;
        case "polygon":
        case "polyline": {
            if (shape.shape === "polyline" && collision) return "a polyline is no collision shape";
            const min = shape.shape === "polygon" ? MIN_POLYGON_POINTS : MIN_POLYLINE_POINTS;
            const points = shape.points;
            if (!Array.isArray(points) || points.length < min || points.length > MAX_SHAPE_POINTS) {
                return `${points?.length ?? "no"} points`;
            }
            for (const point of points) {
                if (
                    !Array.isArray(point) ||
                    point.length !== 2 ||
                    !isNum(point[0], -limit, limit) ||
                    !isNum(point[1], -limit, limit)
                ) {
                    return `point ${JSON.stringify(point)} is out of range`;
                }
            }
            return null;
        }
        default:
            return `unknown shape "${(shape as { shape: unknown }).shape}"`;
    }
}

function checkSource(source: TilesetSource, what: string): void {
    const kinds = ["image", "sprite", "atlas", "collection"];
    if (!source || !kinds.includes(source.kind)) {
        fail("tileset-source", `${what}: source kind "${source?.kind}"`);
    }
    if (
        typeof source.fileName !== "string" ||
        !isText(source.fileName) ||
        isBlank(source.fileName)
    ) {
        fail("tileset-source", `${what}: source file name is not non-blank text`);
    }
    const grid = source.kind === "image" || source.kind === "sprite";
    const max = grid ? MAX_SOURCE_MARGIN : 0;
    if (!isInt(source.margin, 0, max) || !isInt(source.spacing, 0, max)) {
        fail(
            "tileset-source",
            `${what}: margin ${source.margin} and spacing ${source.spacing} for kind "${source.kind}"`,
        );
    }
}

function sourceKeyProblem(key: Tile["sourceKey"], kind: TilesetSource["kind"]): string | null {
    if (key === null) return null;
    const index = (value: unknown) => isInt(value, 0, MAX_SOURCE_INDEX);
    switch (kind) {
        case "image":
            return Array.isArray(key) && key.length === 2 && index(key[0]) && index(key[1])
                ? null
                : "not [column, row]";
        case "sprite":
            return Array.isArray(key) &&
                key.length === 3 &&
                isId(key[0]) &&
                index(key[1]) &&
                index(key[2])
                ? null
                : "not [frameId, column, row]";
        case "atlas":
            return typeof key === "string" && key !== "" ? null : "not an atlas frame ID";
        case "collection":
            return typeof key === "string" && isText(key) && !isBlank(key)
                ? null
                : "not a file name";
    }
}

function checkTerrainSet(set: TerrainSet, tileIds: Set<number>, what: string): void {
    checkText(set.name, `${what} name`);
    if (isBlank(set.name)) fail("terrain-set", `${what}: blank name`);
    if (!["corner", "edge", "mixed"].includes(set.type)) {
        fail("terrain-set", `${what}: type "${set.type}"`);
    }
    if (!Array.isArray(set.colors) || set.colors.length < 1 || set.colors.length > MAX_TERRAINS) {
        fail("terrain-set", `${what} has ${set.colors?.length ?? "no"} colours`);
    }
    if (!Array.isArray(set.tiles) || set.tiles.length > MAX_TERRAIN_TILES) {
        fail("terrain-set", `${what} has ${set.tiles?.length ?? "no"} tiles`);
    }
    set.colors.forEach((color, index) => {
        checkText(color.name, `${what} colour ${index} name`);
        if (isBlank(color.name)) fail("terrain-set", `${what} colour ${index}: blank name`);
        if (typeof color.color !== "string" || !COLOUR_PATTERN.test(color.color)) {
            fail("terrain-set", `${what} colour ${index}: colour "${color.color}"`);
        }
        if (color.tile !== null && !tileIds.has(color.tile)) {
            fail("terrain-tile", `${what} colour ${index} names tile ${color.tile}`);
        }
    });
    const zeroes = set.type === "corner" ? [0, 2, 4, 6] : set.type === "edge" ? [1, 3, 5, 7] : [];
    const seen = new Set<number>();
    for (const terrainTile of set.tiles) {
        if (!tileIds.has(terrainTile.tile)) {
            fail("terrain-tile", `${what} names tile ${terrainTile.tile}`);
        }
        if (seen.has(terrainTile.tile)) {
            fail("terrain-tile", `${what} lists tile ${terrainTile.tile} twice`);
        }
        seen.add(terrainTile.tile);
        const wang = terrainTile.wangId;
        if (!Array.isArray(wang) || wang.length !== 8) {
            fail(
                "terrain-tile",
                `${what} tile ${terrainTile.tile}: wangId has ${wang?.length} entries`,
            );
        }
        wang.forEach((value, index) => {
            const max = zeroes.includes(index) ? 0 : set.colors.length;
            if (!isInt(value, 0, max)) {
                fail(
                    "terrain-tile",
                    `${what} tile ${terrainTile.tile}: wangId[${index}] is ${value} for type "${set.type}"`,
                );
            }
        });
    }
}

function checkTileset(tileset: Tileset, index: number): Set<number> {
    const what = `tileset ${index} ("${tileset.id}")`;
    checkText(tileset.name, `${what} name`);
    if (isBlank(tileset.name) || !isSlug(tileset.exportName)) {
        fail(
            "tileset-name",
            `${what}: name "${tileset.name}", export name "${tileset.exportName}"`,
        );
    }
    checkText(tileset.class, `${what} class`);
    checkProperties(tileset.properties, what);
    const { tileWidth, tileHeight, columns } = tileset;
    if (!isInt(tileWidth, 1, MAX_TILE_SIZE) || !isInt(tileHeight, 1, MAX_TILE_SIZE)) {
        fail("tileset-tile-size", `${what}: ${tileWidth}×${tileHeight}`);
    }
    if (
        !isInt(tileset.offsetX, -MAX_TILE_OFFSET, MAX_TILE_OFFSET) ||
        !isInt(tileset.offsetY, -MAX_TILE_OFFSET, MAX_TILE_OFFSET)
    ) {
        fail("tileset-offset", `${what}: (${tileset.offsetX}, ${tileset.offsetY})`);
    }
    checkSource(tileset.source, what);
    if (
        !Array.isArray(tileset.tiles) ||
        tileset.tiles.length < 1 ||
        tileset.tiles.length > MAX_TILES_PER_TILESET
    ) {
        fail("tileset-tile-count", `${what} has ${tileset.tiles?.length ?? "no"} tiles`);
    }
    const rows = Math.ceil(tileset.tiles.length / columns);
    if (
        !isInt(columns, 1, MAX_TILESET_COLUMNS) ||
        columns * tileWidth > MAX_IMAGE_SIDE ||
        rows * tileHeight > MAX_IMAGE_SIDE
    ) {
        fail(
            "tileset-columns",
            `${what}: ${columns} columns of ${tileWidth} px, ${rows} rows of ${tileHeight} px`,
        );
    }
    const { pixels } = tileset;
    const width = columns * tileWidth;
    const height = rows * tileHeight;
    if (
        !pixels ||
        pixels.width !== width ||
        pixels.height !== height ||
        !(pixels.data instanceof Uint8ClampedArray) ||
        pixels.data.length !== width * height * 4
    ) {
        fail(
            "tileset-pixels",
            `${what}: pixels ${pixels?.width}×${pixels?.height} with ${pixels?.data?.length} bytes; the grid is ${width}×${height}`,
        );
    }

    const tileIds = new Set<number>();
    const sourceKeys = new Set<string>();
    let frames = 0;
    for (const tile of tileset.tiles) {
        if (!isInt(tile.id, 0, MAX_TILE_ID) || tileIds.has(tile.id)) {
            fail("tile-id", `${what}: tile ID ${tile.id}`);
        }
        tileIds.add(tile.id);
    }
    if (
        !isInt(tileset.nextTileId, 1, MAX_NEXT_TILE_ID) ||
        Math.max(...tileIds) >= tileset.nextTileId
    ) {
        fail(
            "next-tile-id",
            `${what}: nextTileId ${tileset.nextTileId}, highest tile ID ${Math.max(...tileIds)}`,
        );
    }
    for (const tile of tileset.tiles) {
        const tileWhat = `${what} tile ${tile.id}`;
        const keyProblem = sourceKeyProblem(tile.sourceKey, tileset.source.kind);
        if (keyProblem !== null) {
            fail(
                "tile-source-key",
                `${tileWhat}: ${JSON.stringify(tile.sourceKey)} is ${keyProblem}`,
            );
        }
        if (tile.sourceKey !== null) {
            const key = JSON.stringify(tile.sourceKey);
            if (sourceKeys.has(key))
                fail("tile-source-key", `${tileWhat}: source key ${key} repeats`);
            sourceKeys.add(key);
        }
        if (typeof tile.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(tile.fingerprint)) {
            fail("tile-fingerprint", `${tileWhat}: "${tile.fingerprint}"`);
        }
        checkText(tile.class, `${tileWhat} class`);
        checkProperties(tile.properties, tileWhat);
        if (!Array.isArray(tile.collision) || tile.collision.length > MAX_COLLISION_SHAPES) {
            fail("tile-collision", `${tileWhat} has ${tile.collision?.length ?? "no"} shapes`);
        }
        for (const shape of tile.collision) {
            const problem = shapeProblem(shape, MAX_COLLISION_COORD, true);
            if (problem !== null) fail("tile-collision", `${tileWhat}: ${problem}`);
        }
        if (!Array.isArray(tile.animation) || tile.animation.length > MAX_ANIMATION_FRAMES) {
            fail("tile-animation", `${tileWhat} has ${tile.animation?.length ?? "no"} frames`);
        }
        for (const frame of tile.animation) {
            if (!tileIds.has(frame.tile))
                fail("tile-animation", `${tileWhat} names tile ${frame.tile}`);
            if (!isInt(frame.ms, 1, MAX_FRAME_MS))
                fail("tile-animation", `${tileWhat}: frame of ${frame.ms} ms`);
        }
        frames += tile.animation.length;
    }
    if (frames > MAX_ANIMATION_FRAMES_PER_TILESET) {
        fail("tileset-animation-count", `${what} has ${frames} animation frames`);
    }
    if (!Array.isArray(tileset.terrainSets) || tileset.terrainSets.length > MAX_TERRAIN_SETS) {
        fail(
            "terrain-set-count",
            `${what} has ${tileset.terrainSets?.length ?? "no"} terrain sets`,
        );
    }
    tileset.terrainSets.forEach((set, setIndex) => {
        checkTerrainSet(set, tileIds, `${what} terrain set ${setIndex}`);
    });
    return tileIds;
}

function checkLayerValues(layer: Layer, what: string): void {
    checkText(layer.name, `${what} name`);
    checkText(layer.class, `${what} class`);
    checkProperties(layer.properties, what);
    if (
        typeof layer.visible !== "boolean" ||
        typeof layer.locked !== "boolean" ||
        !isInt(layer.opacity, 0, 255) ||
        !isInt(layer.offsetX, -MAX_LAYER_OFFSET, MAX_LAYER_OFFSET) ||
        !isInt(layer.offsetY, -MAX_LAYER_OFFSET, MAX_LAYER_OFFSET) ||
        !isNum(layer.parallaxX, -MAX_PARALLAX, MAX_PARALLAX) ||
        !isNum(layer.parallaxY, -MAX_PARALLAX, MAX_PARALLAX)
    ) {
        fail(
            "layer-values",
            `${what}: visible ${layer.visible}, locked ${layer.locked}, opacity ${layer.opacity}, ` +
                `offset (${layer.offsetX}, ${layer.offsetY}), parallax (${layer.parallaxX}, ${layer.parallaxY})`,
        );
    }
}

function checkMap(
    map: ProjectMap,
    index: number,
    tilesBySlot: ReadonlyMap<number, Set<number>>,
    imageIds: ReadonlySet<string>,
): void {
    const what = `map ${index} ("${map.id}")`;
    checkText(map.name, `${what} name`);
    if (isBlank(map.name) || !isSlug(map.exportName)) {
        fail("map-name", `${what}: name "${map.name}", export name "${map.exportName}"`);
    }
    checkText(map.class, `${what} class`);
    checkProperties(map.properties, what);
    if (map.orientation !== "orthogonal") fail("map-orientation", `${what}: "${map.orientation}"`);
    const { width, height } = map;
    if (
        !isInt(width, 1, MAX_MAP_SIDE) ||
        !isInt(height, 1, MAX_MAP_SIDE) ||
        width * height > MAX_CELLS_PER_LAYER
    ) {
        fail("map-size", `${what}: ${width}×${height}`);
    }
    if (!isInt(map.tileWidth, 1, MAX_TILE_SIZE) || !isInt(map.tileHeight, 1, MAX_TILE_SIZE)) {
        fail("map-tile-size", `${what}: ${map.tileWidth}×${map.tileHeight}`);
    }
    if (map.backgroundColor !== null && !isColour32(map.backgroundColor)) {
        fail("map-background", `${what}: ${map.backgroundColor}`);
    }
    if (
        !isNum(map.parallaxOriginX, -MAX_PARALLAX_ORIGIN, MAX_PARALLAX_ORIGIN) ||
        !isNum(map.parallaxOriginY, -MAX_PARALLAX_ORIGIN, MAX_PARALLAX_ORIGIN)
    ) {
        fail("map-parallax-origin", `${what}: (${map.parallaxOriginX}, ${map.parallaxOriginY})`);
    }

    const entries = [...walkLayers(map.layers)];
    if (entries.length < 1 || entries.length > MAX_LAYERS) {
        fail("map-layer-count", `${what} has ${entries.length} layers`);
    }
    for (const { layer, ancestors } of entries) {
        if (layer.type === "group" && ancestors.length + 1 > MAX_GROUP_DEPTH) {
            fail("map-layer-count", `${what}: group ${layer.id} is ${ancestors.length + 1} deep`);
        }
    }
    const layerIds = new Set<number>();
    const markerIds = new Set<number>();
    let cells = 0;
    let markers = 0;
    let points = 0;
    for (const { layer, ancestors } of entries) {
        const layerWhat = `${what} layer ${layer.id}`;
        if (!isInt(layer.id, 1, MAX_LAYER_ID) || layerIds.has(layer.id)) {
            fail("layer-id", `${layerWhat}: ID ${layer.id}`);
        }
        layerIds.add(layer.id);
        checkLayerValues(layer, layerWhat);
        const effective = effectiveValues(layer, ancestors);
        if (
            !isNum(effective.offsetX, -MAX_LAYER_OFFSET, MAX_LAYER_OFFSET) ||
            !isNum(effective.offsetY, -MAX_LAYER_OFFSET, MAX_LAYER_OFFSET) ||
            !isNum(effective.parallaxX, -MAX_PARALLAX, MAX_PARALLAX) ||
            !isNum(effective.parallaxY, -MAX_PARALLAX, MAX_PARALLAX)
        ) {
            fail(
                "layer-effective-values",
                `${layerWhat}: effective offset (${effective.offsetX}, ${effective.offsetY}), ` +
                    `parallax (${effective.parallaxX}, ${effective.parallaxY})`,
            );
        }
        switch (layer.type) {
            case "tile": {
                const store = layer.cells;
                if (store.count > MAX_CELLS_PER_LAYER) {
                    fail("cell-count", `${layerWhat} has ${store.count} cells`);
                }
                cells += store.count;
                // Chunks outside the map are never visited; a cell there shows as a count
                // the visited cells do not reach.
                let inside = 0;
                for (const chunk of store.chunksIn({ x: 0, y: 0, width, height })) {
                    const ox = chunk.cx << CHUNK_BITS;
                    const oy = chunk.cy << CHUNK_BITS;
                    for (let i = 0; i < chunk.cells.length; i += 1) {
                        const value = chunk.cells[i]!;
                        if (value === 0) continue;
                        const x = ox + (i & CELL_INDEX_MASK);
                        const y = oy + (i >> CHUNK_BITS);
                        if (x >= width || y >= height) continue;
                        inside += 1;
                        const tiles = tilesBySlot.get(cellSlot(value));
                        if (
                            (value & RESERVED_BIT) !== 0 ||
                            tiles === undefined ||
                            !tiles.has(cellTileId(value))
                        ) {
                            fail(
                                "cell-tile-exists",
                                `${layerWhat}: cell (${x}, ${y}) value 0x${value.toString(16)} ` +
                                    `names slot ${cellSlot(value)} tile ${cellTileId(value)}`,
                            );
                        }
                    }
                }
                if (inside !== store.count) {
                    fail(
                        "cell-in-map",
                        `${layerWhat}: ${store.count - inside} cells lie outside ${width}×${height}`,
                    );
                }
                break;
            }
            case "marker": {
                if (!isColour32(layer.color))
                    fail("marker-layer-color", `${layerWhat}: ${layer.color}`);
                if (!Array.isArray(layer.markers))
                    fail("marker-count", `${layerWhat}: no marker list`);
                for (const marker of layer.markers) {
                    const markerWhat = `${layerWhat} marker ${marker.id}`;
                    if (!isInt(marker.id, 1, MAX_MARKER_ID) || markerIds.has(marker.id)) {
                        fail("marker-id", `${markerWhat}: ID ${marker.id}`);
                    }
                    markerIds.add(marker.id);
                    checkText(marker.name, `${markerWhat} name`);
                    checkText(marker.class, `${markerWhat} class`);
                    checkProperties(marker.properties, markerWhat);
                    const problem = shapeProblem(marker, MAX_MARKER_COORD, false);
                    if (problem !== null) fail("marker-shape", `${markerWhat}: ${problem}`);
                    markers += 1;
                    if (marker.shape === "polygon" || marker.shape === "polyline") {
                        points += marker.points.length;
                    }
                }
                break;
            }
            case "image":
                if (!imageIds.has(layer.imageId)) {
                    fail("image-layer-image", `${layerWhat} names image "${layer.imageId}"`);
                }
                if (typeof layer.repeatX !== "boolean" || typeof layer.repeatY !== "boolean") {
                    fail("layer-values", `${layerWhat}: repeat ${layer.repeatX}, ${layer.repeatY}`);
                }
                break;
            case "group":
                break;
        }
    }
    if (cells > MAX_CELLS_PER_MAP)
        fail("cell-count", `${what} has ${cells} cells in its tile layers`);
    if (markers > MAX_MARKERS || points > MAX_MARKER_POINTS) {
        fail("marker-count", `${what} has ${markers} markers with ${points} points`);
    }
    if (!isInt(map.nextLayerId, 1, MAX_LAYER_ID) || Math.max(...layerIds) >= map.nextLayerId) {
        fail(
            "next-layer-id",
            `${what}: nextLayerId ${map.nextLayerId}, highest layer ID ${Math.max(...layerIds)}`,
        );
    }
    const highestMarker = markerIds.size === 0 ? 0 : Math.max(...markerIds);
    if (!isInt(map.nextMarkerId, 1, MAX_MARKER_ID) || highestMarker >= map.nextMarkerId) {
        fail(
            "next-marker-id",
            `${what}: nextMarkerId ${map.nextMarkerId}, highest marker ID ${highestMarker}`,
        );
    }
}

/**
 * Throws an `InvariantError` for the first violated invariant of `INVARIANTS`; returns
 * normally when the project satisfies all of them.
 */
export function assertInvariants(project: Project): void {
    if (!isId(project.id)) fail("project-id", `"${project.id}"`);
    checkText(project.name, "project name");
    if (isBlank(project.name)) fail("project-name", `"${project.name}"`);
    if (!isSlug(project.exportName)) fail("project-export-name", `"${project.exportName}"`);
    if (typeof project.exportSettings?.exportOnSave !== "boolean") {
        fail("export-settings", `exportOnSave is ${project.exportSettings?.exportOnSave}`);
    }
    checkProperties(project.properties, "project");
    if (!Array.isArray(project.maps) || project.maps.length < 1 || project.maps.length > MAX_MAPS) {
        fail("map-required", `${project.maps?.length ?? "no"} maps`);
    }
    if (!Array.isArray(project.tilesets) || project.tilesets.length > MAX_TILESETS) {
        fail("tileset-count", `${project.tilesets?.length ?? "no"} tilesets`);
    }
    if (!Array.isArray(project.images) || project.images.length > MAX_IMAGES) {
        fail("image-count", `${project.images?.length ?? "no"} images`);
    }

    // One namespace for the IDs of the project, maps, tilesets and images, whatever the case.
    const owners = new Map<string, string>();
    const claim = (id: string, owner: string) => {
        if (!isId(id)) fail("unique-ids", `${owner} has the malformed ID "${id}"`);
        const other = owners.get(idKey(id));
        if (other !== undefined) fail("unique-ids", `ID "${id}" is used by ${other} and ${owner}`);
        owners.set(idKey(id), owner);
    };
    claim(project.id, "the project");
    project.maps.forEach((map, index) => claim(map.id, `map ${index}`));
    project.tilesets.forEach((tileset, index) => claim(tileset.id, `tileset ${index}`));
    project.images.forEach((image, index) => claim(image.id, `image ${index}`));

    const exportOwners = new Map<string, string>();
    const claimName = (name: string, owner: string) => {
        const key = typeof name === "string" ? name.toLowerCase() : "";
        const other = exportOwners.get(key);
        if (other !== undefined) {
            fail("unique-export-names", `export name "${name}" is used by ${other} and ${owner}`);
        }
        exportOwners.set(key, owner);
    };
    project.maps.forEach((map, index) => claimName(map.exportName, `map ${index}`));
    project.tilesets.forEach((tileset, index) => claimName(tileset.exportName, `tileset ${index}`));
    project.images.forEach((image, index) => claimName(image.exportName, `image ${index}`));

    const tilesBySlot = new Map<number, Set<number>>();
    project.tilesets.forEach((tileset, index) => {
        if (!isInt(tileset.slot, 1, MAX_SLOT) || tilesBySlot.has(tileset.slot)) {
            fail("unique-slots", `tileset ${index} has slot ${tileset.slot}`);
        }
        tilesBySlot.set(tileset.slot, new Set());
    });

    let tiles = 0;
    let tilesetPixels = 0;
    project.tilesets.forEach((tileset, index) => {
        tilesBySlot.set(tileset.slot, checkTileset(tileset, index));
        tiles += tileset.tiles.length;
        tilesetPixels += tileset.pixels.width * tileset.pixels.height;
    });
    if (tiles > MAX_TILES_PER_PROJECT) fail("tiles-per-project", `${tiles} tiles`);
    if (tilesetPixels > MAX_TILESET_PIXELS) fail("tileset-pixel-budget", `${tilesetPixels} pixels`);

    let imagePixels = 0;
    const imageIds = new Set<string>();
    project.images.forEach((image, index) => {
        const what = `image ${index} ("${image.id}")`;
        checkText(image.name, `${what} name`);
        if (isBlank(image.name) || !isSlug(image.exportName)) {
            fail("image-name", `${what}: name "${image.name}", export name "${image.exportName}"`);
        }
        const { pixels } = image;
        if (
            !pixels ||
            !isInt(pixels.width, 1, MAX_IMAGE_SIDE) ||
            !isInt(pixels.height, 1, MAX_IMAGE_SIDE) ||
            !(pixels.data instanceof Uint8ClampedArray) ||
            pixels.data.length !== pixels.width * pixels.height * 4
        ) {
            fail(
                "image-pixels",
                `${what}: ${pixels?.width}×${pixels?.height} with ${pixels?.data?.length} bytes`,
            );
        }
        imagePixels += pixels.width * pixels.height;
        imageIds.add(image.id);
    });
    if (imagePixels > MAX_IMAGE_PIXELS) fail("image-pixel-budget", `${imagePixels} pixels`);

    project.maps.forEach((map, index) => checkMap(map, index, tilesBySlot, imageIds));
}
