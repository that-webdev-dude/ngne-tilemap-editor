// `ngne-tilemap` version 1 (FORMAT §3): `tilemapFor` writes one map, `validateTilemap` reads
// one. The reader, its types and the limits of §3.6 live in the runtime (`core/runtime/
// runtime.ts`), so the editor and the games it exports for read with the same code.

export { TilemapError } from "./errors";
export type { TilemapErrorCode } from "./errors";
export {
    MAX_TILEMAP_BYTES,
    MAX_TILEMAP_CELLS,
    MAX_TILEMAP_COLLISION_SHAPES,
    MAX_TILEMAP_LAYERS,
    MAX_TILEMAP_LAYER_CELLS,
    MAX_TILEMAP_MARKERS,
    MAX_TILEMAP_MARKER_POINTS,
    MAX_TILEMAP_PROPERTIES,
    MAX_TILEMAP_SHAPE_POINTS,
    MAX_TILEMAP_SIDE,
    MAX_TILEMAP_TILESETS,
    TILEMAP_FORMAT,
    TILEMAP_VERSION,
    validateTilemap,
} from "../runtime/runtime";
export type {
    ImageLayerData,
    MarkerLayerData,
    PropertyValue,
    TileData,
    TileLayerData,
    Tilemap,
    TilemapGroup,
    TilemapLayer,
    TilemapMarker,
    TilemapPoint,
    TilemapProperty,
    TilemapShape,
    TilemapTileset,
} from "../runtime/runtime";
export { tilemapFor } from "./tilemapFor";
