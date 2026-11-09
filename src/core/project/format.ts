// Names, version and limits of the `.ngtilemap` project file, version 1 (FORMAT §2). A value
// changed here is a change of the format: it needs a new version and a migration (§2.10).

export {
    MAX_ANIMATION_FRAMES,
    MAX_ANIMATION_FRAMES_PER_TILESET,
    MAX_CELLS_PER_LAYER,
    MAX_CELLS_PER_MAP,
    MAX_COLLISION_SHAPES,
    MAX_GROUP_DEPTH,
    MAX_ID_LENGTH,
    MAX_IMAGES,
    MAX_IMAGE_PIXELS,
    MAX_LAYERS,
    MAX_MAPS,
    MAX_MAP_SIDE,
    MAX_MARKERS,
    MAX_MARKER_POINTS,
    MAX_PROPERTIES,
    MAX_SHAPE_POINTS,
    MAX_SLUG_LENGTH,
    MAX_TERRAINS,
    MAX_TERRAIN_SETS,
    MAX_TEXT_LENGTH,
    MAX_TILESETS,
    MAX_TILESET_PIXELS,
    MAX_TILES_PER_PROJECT,
    MAX_TILES_PER_TILESET,
    MAX_TILE_ID,
} from "../model/limits";

/** Extension of a project file, with its dot. */
export const PROJECT_FILE_EXTENSION = ".ngtilemap";

/** Media type of a project file. */
export const PROJECT_MEDIA_TYPE = "application/x-ngtilemap";

/** `format` of `manifest.json`. */
export const PROJECT_FORMAT = "ngne-tilemap-project";

/** The version written, and the newest one read. */
export const PROJECT_VERSION = 1;

/** `generator` of `manifest.json`: name and version of this writer (FORMAT §2.3). */
export const PROJECT_GENERATOR = "ngne-tilemap-editor 1.0.0";

export const MANIFEST_ENTRY = "manifest.json";
export const PROJECT_ENTRY = "project.json";

export function mapEntry(mapId: string): string {
    return `maps/${mapId}.json`;
}

export function tilesetEntry(tilesetId: string): string {
    return `tilesets/${tilesetId}.png`;
}

export function imageEntry(imageId: string): string {
    return `images/${imageId}.png`;
}

export function thumbnailEntry(mapId: string): string {
    return `thumbs/${mapId}.png`;
}

// --- size limits of FORMAT §2.8, uncompressed --------------------------------------------------

export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_PROJECT_JSON_BYTES = 64 * 1024 * 1024;
export const MAX_MAP_JSON_BYTES = 64 * 1024 * 1024;

/** What a PNG entry may hold beyond its scanlines: framing and ancillary chunks. */
export const PNG_OVERHEAD_BYTES = 65_536;

/** Largest PNG entry of an image of this size: `height × (4 × width + 1) + 65 536` bytes. */
export function maxPngBytes(width: number, height: number): number {
    return height * (4 * width + 1) + PNG_OVERHEAD_BYTES;
}

/** All entries together. */
export const MAX_CONTENT_BYTES = 2 * 1024 * 1024 * 1024;

// --- value ranges of FORMAT §2.4 and §2.5 ---------------------------------------------------------

/** Largest `firstGid` of a map's TilesetRef. */
export const MAX_FIRST_GID = 268_435_455;
/** Largest cell value: an unsigned 32-bit integer. */
export const MAX_CELL_VALUE = 0xffff_ffff;
