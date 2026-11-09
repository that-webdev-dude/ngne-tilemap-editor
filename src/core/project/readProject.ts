import { idKey } from "../model";
import {
    MAX_ANIMATION_FRAMES,
    MAX_ANIMATION_FRAMES_PER_TILESET,
    MAX_COLLISION_COORD,
    MAX_COLLISION_SHAPES,
    MAX_FRAME_MS,
    MAX_IMAGES,
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_SIDE,
    MAX_MAPS,
    MAX_NEXT_TILE_ID,
    MAX_SOURCE_INDEX,
    MAX_SOURCE_MARGIN,
    MAX_TERRAINS,
    MAX_TERRAIN_SETS,
    MAX_TERRAIN_TILES,
    MAX_TILESETS,
    MAX_TILESET_COLUMNS,
    MAX_TILESET_PIXELS,
    MAX_TILES_PER_PROJECT,
    MAX_TILES_PER_TILESET,
    MAX_TILE_ID,
    MAX_TILE_OFFSET,
    MAX_TILE_SIZE,
    MIN_FRAME_MS,
} from "../model/limits";
import type {
    AnimationFrame,
    PixelBuffer,
    Project,
    ProjectImage,
    TerrainSet,
    TerrainSetType,
    Tile,
    TileSourceKey,
    Tileset,
    TilesetSource,
    TilesetSourceKind,
} from "../model";
import { ProjectError } from "./errors";
import { PROJECT_ENTRY } from "./format";
import { JsonReader } from "./json";
import { readProperties, readShape } from "./values";
import type { ShapeRules } from "./values";

// `project.json` (FORMAT §2.4), checked as step 3 of §2.9, and the pixel limits of step 5.

/** No pixels yet: step 6 reads them. Shared, never written to. */
const NO_PIXELS = new Uint8ClampedArray(0);

/**
 * What `project.json` holds: the project without its maps, every tileset and image with its
 * stated size and no pixels yet, and the map IDs in list order.
 */
export interface ProjectSkeleton {
    /** `maps` is empty; tilesets and images have `pixels.data` of length 0. */
    project: Project;
    mapIds: string[];
    /** Every ID of the project by `idKey`, with what owns it, for the maps to join. */
    ids: Map<string, string>;
}

const PROJECT_MEMBERS = [
    "id",
    "name",
    "exportName",
    "maps",
    "tilesets",
    "images",
    "exportSettings",
    "properties",
] as const;

const TILESET_MEMBERS = [
    "id",
    "name",
    "exportName",
    "class",
    "tileWidth",
    "tileHeight",
    "columns",
    "offsetX",
    "offsetY",
    "nextTileId",
    "source",
    "tiles",
    "terrainSets",
    "properties",
] as const;

const TILE_MEMBERS = [
    "id",
    "source",
    "fingerprint",
    "class",
    "collision",
    "animation",
    "properties",
] as const;

const SOURCE_KINDS: readonly TilesetSourceKind[] = ["image", "sprite", "atlas", "collection"];
const TERRAIN_TYPES: readonly TerrainSetType[] = ["corner", "edge", "mixed"];
const FINGERPRINT = /^[0-9a-f]{64}$/;

const COLLISION_RULES: ShapeRules = {
    kinds: ["rectangle", "ellipse", "polygon"],
    position: MAX_COLLISION_COORD,
    point: MAX_COLLISION_COORD,
};

function readSource(reader: JsonReader, value: unknown, path: string): TilesetSource {
    const member = reader.object(value, path, ["kind", "fileName", "margin", "spacing"]);
    const kind = reader.oneOf(member.kind, `${path}.kind`, SOURCE_KINDS);
    const max = kind === "image" || kind === "sprite" ? MAX_SOURCE_MARGIN : 0;
    return {
        kind,
        fileName: reader.text(member.fileName, `${path}.fileName`, true),
        margin: reader.integer(member.margin, `${path}.margin`, 0, max),
        spacing: reader.integer(member.spacing, `${path}.spacing`, 0, max),
    };
}

function readSourceKey(
    reader: JsonReader,
    value: unknown,
    path: string,
    kind: TilesetSourceKind,
): TileSourceKey | null {
    if (value === null) return null;
    const index = (item: unknown, at: string) => reader.integer(item, at, 0, MAX_SOURCE_INDEX);
    switch (kind) {
        case "image": {
            const key = reader.array(value, path, 2, 2);
            return [index(key[0], `${path}[0]`), index(key[1], `${path}[1]`)];
        }
        case "sprite": {
            const key = reader.array(value, path, 3, 3);
            return [
                reader.id(key[0], `${path}[0]`),
                index(key[1], `${path}[1]`),
                index(key[2], `${path}[2]`),
            ];
        }
        case "atlas": {
            const key = reader.string(value, path);
            if (key === "") reader.fail(path, "must not be empty");
            return key;
        }
        case "collection":
            return reader.text(value, path);
    }
}

function readAnimation(
    reader: JsonReader,
    value: unknown,
    path: string,
    tileIds: ReadonlySet<number>,
): AnimationFrame[] {
    const list = reader.array(value, path, 0, MAX_ANIMATION_FRAMES);
    return list.map((item, index) => {
        const at = `${path}[${index}]`;
        const member = reader.object(item, at, ["tile", "ms"]);
        const tile = reader.integer(member.tile, `${at}.tile`, 0, MAX_TILE_ID);
        if (!tileIds.has(tile))
            reader.fail(`${at}.tile`, `names tile ${tile}, which is not in the tileset`);
        return { tile, ms: reader.integer(member.ms, `${at}.ms`, MIN_FRAME_MS, MAX_FRAME_MS) };
    });
}

function readTerrainSet(
    reader: JsonReader,
    value: unknown,
    path: string,
    tileIds: ReadonlySet<number>,
): TerrainSet {
    const member = reader.object(value, path, ["name", "type", "colors", "tiles"]);
    const name = reader.text(member.name, `${path}.name`, true);
    const type = reader.oneOf(member.type, `${path}.type`, TERRAIN_TYPES);
    const colourList = reader.array(member.colors, `${path}.colors`, 1, MAX_TERRAINS);
    const tileOf = (item: unknown, at: string): number => {
        const tile = reader.integer(item, at, 0, MAX_TILE_ID);
        if (!tileIds.has(tile)) reader.fail(at, `names tile ${tile}, which is not in the tileset`);
        return tile;
    };
    const colors = colourList.map((item, index) => {
        const at = `${path}.colors[${index}]`;
        const colour = reader.object(item, at, ["name", "color", "tile"]);
        return {
            name: reader.text(colour.name, `${at}.name`, true),
            color: reader.colour(colour.color, `${at}.color`),
            tile: colour.tile === null ? null : tileOf(colour.tile, `${at}.tile`),
        };
    });
    const zeroes = type === "corner" ? [0, 2, 4, 6] : type === "edge" ? [1, 3, 5, 7] : [];
    const seen = new Set<number>();
    const tileList = reader.array(member.tiles, `${path}.tiles`, 0, MAX_TERRAIN_TILES);
    const tiles = tileList.map((item, index) => {
        const at = `${path}.tiles[${index}]`;
        const terrainTile = reader.object(item, at, ["tile", "wangId"]);
        const tile = tileOf(terrainTile.tile, `${at}.tile`);
        if (seen.has(tile)) reader.fail(`${at}.tile`, `lists tile ${tile} a second time`);
        seen.add(tile);
        const wang = reader.array(terrainTile.wangId, `${at}.wangId`, 8, 8);
        const wangId = wang.map((entry, slot) =>
            reader.integer(
                entry,
                `${at}.wangId[${slot}]`,
                0,
                zeroes.includes(slot) ? 0 : colors.length,
            ),
        );
        return { tile, wangId };
    });
    return { name, type, colors, tiles };
}

function readTile(
    reader: JsonReader,
    member: Record<(typeof TILE_MEMBERS)[number], unknown>,
    path: string,
    id: number,
    kind: TilesetSourceKind,
    tileIds: ReadonlySet<number>,
): Tile {
    const fingerprint = reader.string(member.fingerprint, `${path}.fingerprint`);
    if (!FINGERPRINT.test(fingerprint)) {
        reader.fail(`${path}.fingerprint`, "must be 64 lowercase hexadecimal digits");
    }
    const shapes = reader.array(member.collision, `${path}.collision`, 0, MAX_COLLISION_SHAPES);
    return {
        id,
        sourceKey: readSourceKey(reader, member.source, `${path}.source`, kind),
        fingerprint,
        class: reader.text(member.class, `${path}.class`),
        collision: shapes.map(
            (shape, index) =>
                readShape(reader, shape, `${path}.collision[${index}]`, COLLISION_RULES).shape,
        ),
        animation: readAnimation(reader, member.animation, `${path}.animation`, tileIds),
        properties: readProperties(reader, member.properties, `${path}.properties`),
    };
}

function readTileset(reader: JsonReader, value: unknown, path: string, slot: number): Tileset {
    const member = reader.object(value, path, TILESET_MEMBERS);
    const tileWidth = reader.integer(member.tileWidth, `${path}.tileWidth`, 1, MAX_TILE_SIZE);
    const tileHeight = reader.integer(member.tileHeight, `${path}.tileHeight`, 1, MAX_TILE_SIZE);
    const columns = reader.integer(member.columns, `${path}.columns`, 1, MAX_TILESET_COLUMNS);
    if (columns * tileWidth > MAX_IMAGE_SIDE) {
        reader.fail(
            `${path}.columns`,
            `makes an image ${columns * tileWidth} px wide; at most ${MAX_IMAGE_SIDE} are allowed`,
        );
    }
    const source = readSource(reader, member.source, `${path}.source`);
    const nextTileId = reader.integer(member.nextTileId, `${path}.nextTileId`, 1, MAX_NEXT_TILE_ID);
    const tileList = reader.array(member.tiles, `${path}.tiles`, 1, MAX_TILES_PER_TILESET);
    const rows = Math.ceil(tileList.length / columns);
    if (rows * tileHeight > MAX_IMAGE_SIDE) {
        reader.fail(
            `${path}.tiles`,
            `make an image ${rows * tileHeight} px high; at most ${MAX_IMAGE_SIDE} are allowed`,
        );
    }

    // Tile IDs first: animations and terrains name tiles anywhere in the list.
    const tileIds = new Set<number>();
    const members = tileList.map((item, index) => {
        const at = `${path}.tiles[${index}]`;
        const tile = reader.object(item, at, TILE_MEMBERS);
        const id = reader.integer(tile.id, `${at}.id`, 0, MAX_TILE_ID);
        if (tileIds.has(id)) reader.fail(`${at}.id`, `repeats the tile ID ${id}`);
        if (id >= nextTileId) {
            reader.fail(`${at}.id`, `is ${id}, not below the tileset's nextTileId ${nextTileId}`);
        }
        tileIds.add(id);
        return { tile, id, at };
    });
    let frames = 0;
    const sourceKeys = new Set<string>();
    const tiles = members.map(({ tile, id, at }) => {
        const read = readTile(reader, tile, at, id, source.kind, tileIds);
        if (read.sourceKey !== null) {
            const key = JSON.stringify(read.sourceKey);
            if (sourceKeys.has(key)) reader.fail(`${at}.source`, `repeats the source key ${key}`);
            sourceKeys.add(key);
        }
        frames += read.animation.length;
        if (frames > MAX_ANIMATION_FRAMES_PER_TILESET) {
            reader.fail(
                `${path}.tiles`,
                `hold more than ${MAX_ANIMATION_FRAMES_PER_TILESET} animation frames together`,
            );
        }
        return read;
    });
    const sets = reader.array(member.terrainSets, `${path}.terrainSets`, 0, MAX_TERRAIN_SETS);
    return {
        id: reader.id(member.id, `${path}.id`),
        name: reader.text(member.name, `${path}.name`, true),
        exportName: reader.slug(member.exportName, `${path}.exportName`),
        class: reader.text(member.class, `${path}.class`),
        slot,
        tileWidth,
        tileHeight,
        offsetX: reader.integer(
            member.offsetX,
            `${path}.offsetX`,
            -MAX_TILE_OFFSET,
            MAX_TILE_OFFSET,
        ),
        offsetY: reader.integer(
            member.offsetY,
            `${path}.offsetY`,
            -MAX_TILE_OFFSET,
            MAX_TILE_OFFSET,
        ),
        columns,
        pixels: { width: columns * tileWidth, height: rows * tileHeight, data: NO_PIXELS },
        nextTileId,
        source,
        tiles,
        terrainSets: sets.map((set, index) =>
            readTerrainSet(reader, set, `${path}.terrainSets[${index}]`, tileIds),
        ),
        properties: readProperties(reader, member.properties, `${path}.properties`),
    };
}

function readImage(reader: JsonReader, value: unknown, path: string): ProjectImage {
    const member = reader.object(value, path, ["id", "name", "exportName", "width", "height"]);
    return {
        id: reader.id(member.id, `${path}.id`),
        name: reader.text(member.name, `${path}.name`, true),
        exportName: reader.slug(member.exportName, `${path}.exportName`),
        pixels: {
            width: reader.integer(member.width, `${path}.width`, 1, MAX_IMAGE_SIDE),
            height: reader.integer(member.height, `${path}.height`, 1, MAX_IMAGE_SIDE),
            data: NO_PIXELS,
        },
    };
}

/**
 * Checks a parsed, migrated `project.json` against FORMAT §2.4 (§2.9 step 3): no member missing
 * or unknown, each of its type and range, IDs and slugs well-formed and distinct as required,
 * tile IDs unique and below `nextTileId`, every tile reference inside its tileset, `wangId`
 * values within the set, counts within §2.8. Tilesets get slots 1, 2, … in list order (SPEC
 * §2.2). Throws `ProjectError` "invalid-project".
 */
export function readProjectJson(value: unknown): ProjectSkeleton {
    const reader = new JsonReader("invalid-project", PROJECT_ENTRY);
    const member = reader.object(value, "", PROJECT_MEMBERS);
    const id = reader.id(member.id, "id");
    const mapList = reader.array(member.maps, "maps", 1, MAX_MAPS);
    const tilesetList = reader.array(member.tilesets, "tilesets", 0, MAX_TILESETS);
    const imageList = reader.array(member.images, "images", 0, MAX_IMAGES);

    // Every tile counts towards the project's limit before any tile is read.
    let tileCount = 0;
    tilesetList.forEach((tileset, index) => {
        const tiles = (tileset as { tiles?: unknown } | null)?.tiles;
        if (Array.isArray(tiles)) tileCount += tiles.length;
        if (tileCount > MAX_TILES_PER_PROJECT) {
            reader.fail(
                "tilesets",
                `hold more than ${MAX_TILES_PER_PROJECT} tiles together (at tileset ${index})`,
            );
        }
    });

    const ids = new Map<string, string>();
    const claim = (key: string, owner: string, path: string) => {
        const other = ids.get(idKey(key));
        if (other !== undefined) {
            reader.fail(path, `is the ID ${JSON.stringify(key)} of ${other} as well`);
        }
        ids.set(idKey(key), owner);
    };
    claim(id, "the project", "id");

    const mapIds = mapList.map((item, index) => {
        const at = `maps[${index}]`;
        const ref = reader.object(item, at, ["id"]);
        const mapId = reader.id(ref.id, `${at}.id`);
        claim(mapId, at, `${at}.id`);
        return mapId;
    });
    const exportNames = new Map<string, string>();
    const claimName = (name: string, owner: string, path: string) => {
        const other = exportNames.get(name);
        if (other !== undefined) reader.fail(path, `is the export name of ${other} as well`);
        exportNames.set(name, owner);
    };
    const tilesets = tilesetList.map((item, index) => {
        const at = `tilesets[${index}]`;
        const tileset = readTileset(reader, item, at, index + 1);
        claim(tileset.id, at, `${at}.id`);
        claimName(tileset.exportName, at, `${at}.exportName`);
        return tileset;
    });
    const images = imageList.map((item, index) => {
        const at = `images[${index}]`;
        const image = readImage(reader, item, at);
        claim(image.id, at, `${at}.id`);
        claimName(image.exportName, at, `${at}.exportName`);
        return image;
    });
    const settings = reader.object(member.exportSettings, "exportSettings", ["exportOnSave"]);
    return {
        project: {
            id,
            name: reader.text(member.name, "name", true),
            exportName: reader.slug(member.exportName, "exportName"),
            maps: [],
            tilesets,
            images,
            exportSettings: {
                exportOnSave: reader.boolean(settings.exportOnSave, "exportSettings.exportOnSave"),
            },
            properties: readProperties(reader, member.properties, "properties"),
        },
        mapIds,
        ids,
    };
}

/** Export names of the project's tilesets and images, for the maps to join (FORMAT §2.4). */
export function takenExportNames(project: Project): Map<string, string> {
    const names = new Map<string, string>();
    project.tilesets.forEach((tileset, index) =>
        names.set(tileset.exportName, `tilesets[${index}]`),
    );
    project.images.forEach((image, index) => names.set(image.exportName, `images[${index}]`));
    return names;
}

function pixelsOf(buffers: readonly PixelBuffer[]): number {
    return buffers.reduce((sum, { width, height }) => sum + width * height, 0);
}

/**
 * The pixel limits of FORMAT §2.8 from the stated sizes (§2.9 step 5): all tileset images
 * together, and all images together, at most 64 MP. Throws `ProjectError` "too-large".
 */
export function assertPixelLimits(project: Project): void {
    const tilesetPixels = pixelsOf(project.tilesets.map((tileset) => tileset.pixels));
    if (tilesetPixels > MAX_TILESET_PIXELS) {
        throw new ProjectError(
            "too-large",
            `The tileset images of the project hold ${tilesetPixels} pixels; the limit is ` +
                `${MAX_TILESET_PIXELS}.`,
            { entry: PROJECT_ENTRY },
        );
    }
    const imagePixels = pixelsOf(project.images.map((image) => image.pixels));
    if (imagePixels > MAX_IMAGE_PIXELS) {
        throw new ProjectError(
            "too-large",
            `The images of the project hold ${imagePixels} pixels; the limit is ` +
                `${MAX_IMAGE_PIXELS}.`,
            { entry: PROJECT_ENTRY },
        );
    }
}
