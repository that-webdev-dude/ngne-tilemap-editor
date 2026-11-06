// The count and range limits of FORMAT §1 and §2.8 that the model's invariants check. The
// `.ngtilemap` reader and writer (TE-046, `src/core/project`) share these; the entry size
// limits of §2.8 are theirs alone. `MAX_TILE_ID` and `MAX_SLOT` are the cell store's.

import { MAX_SLOT, MAX_TILE_ID } from "../cells";

export { MAX_SLOT, MAX_TILE_ID };

export const MAX_TEXT_LENGTH = 255;
export const MAX_ID_LENGTH = 64;
export const MAX_SLUG_LENGTH = 64;
export const MAX_STRING_PROPERTY_LENGTH = 65_535;
export const MAX_FILE_PROPERTY_LENGTH = 1024;
export const MAX_INT_PROPERTY = Number.MAX_SAFE_INTEGER;

export const MAX_MAPS = 256;
export const MAX_TILESETS = 255;
export const MAX_IMAGES = 256;
export const MAX_PROPERTIES = 256;

export const MAX_TILE_SIZE = 256;
export const MAX_IMAGE_SIDE = 8192;
export const MAX_TILESET_COLUMNS = 8192;
export const MAX_TILE_OFFSET = 4096;
export const MAX_TILES_PER_TILESET = 65_536;
export const MAX_TILES_PER_PROJECT = 262_144;
export const MAX_NEXT_TILE_ID = MAX_TILE_ID + 1;
export const MAX_SOURCE_INDEX = 65_535;
export const MAX_SOURCE_MARGIN = 4096;
export const MAX_TILESET_PIXELS = 67_108_864;
export const MAX_IMAGE_PIXELS = 67_108_864;

export const MAX_COLLISION_SHAPES = 64;
export const MAX_SHAPE_POINTS = 1024;
export const MIN_POLYGON_POINTS = 3;
export const MIN_POLYLINE_POINTS = 2;
export const MAX_COLLISION_COORD = 4096;
export const MAX_ANIMATION_FRAMES = 1024;
export const MAX_ANIMATION_FRAMES_PER_TILESET = 65_536;
/** The fewest and most milliseconds a frame shows (FORMAT §2.4). */
export const MIN_FRAME_MS = 1;
export const MAX_FRAME_MS = 65_535;

export const MAX_TERRAIN_SETS = 256;
export const MAX_TERRAINS = 254;
export const MAX_TERRAIN_TILES = 65_536;

export const MAX_MAP_SIDE = 4096;
export const MAX_CELLS_PER_LAYER = 1_048_576;
export const MAX_CELLS_PER_MAP = 4_194_304;
export const MAX_PARALLAX_ORIGIN = 1_048_576;
export const MAX_LAYERS = 256;
export const MAX_GROUP_DEPTH = 16;
export const MAX_LAYER_ID = 2_147_483_647;
export const MAX_MARKER_ID = 2_147_483_647;
export const MAX_LAYER_OFFSET = 1_048_576;
export const MAX_PARALLAX = 100;
export const MAX_MARKERS = 16_384;
export const MAX_MARKER_POINTS = 262_144;
export const MAX_MARKER_COORD = 1_048_576;
