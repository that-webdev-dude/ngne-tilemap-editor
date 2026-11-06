// Tileset import (SPEC §6.1): sources turned into tilesets with stable tile IDs, source keys and
// fingerprints, and the command that adds one to the project. The tileset commands of SPEC §6.2:
// rename, export name, class, tile offset, move, delete. Update tileset from source (SPEC §6.3):
// the source re-read, its entries matched to the tiles, and the undoable apply. The collision
// and animation editors' commands (SPEC §6.4).

export { IMPORT_TILESET_LABEL, addTilesetCommand } from "./addTileset";
export { importAtlas, planAtlas, readAtlasJson, readAtlasOutline } from "./atlas";
export type { AtlasAnimationOutline, AtlasFrameOutline, AtlasOutline, AtlasPlan } from "./atlas";
export { tilesetNameOf } from "./build";
export type { TilesetImport, TilesetImportOptions, TilesetImportWarning } from "./build";
export { TilesetImportError } from "./errors";
export type { TilesetImportErrorCode } from "./errors";
export { tileFingerprint } from "./fingerprint";
export { gridCount, importGridPng, planGridPng } from "./gridPng";
export type { GridOptions, GridPngOptions, PngDecoder } from "./gridPng";
export { readPngSize } from "./pngSize";
export { checkLimits, checkPackability, storedSize } from "./room";
export type { TilesetShape } from "./room";
export { sha256Hex } from "./sha256";
export {
    importSprite,
    importSpriteDocument,
    planSprite,
    readSprite,
    readSpriteOutline,
    spriteFramePixels,
    spriteGridDefaults,
} from "./sprite";
export type { SpriteDoc, SpriteImportOptions, SpriteReader } from "./sprite";
export { TilesetEditError } from "./errors";
export type { TilesetEditErrorCode } from "./errors";
export {
    TILESET_FIELD_KEYS,
    TILESET_LABELS,
    deleteTilesetCommand,
    mapsUsingTileset,
    moveTilesetCommand,
    renameTilesetCommand,
    setTileOffsetCommand,
    setTilesetClassCommand,
    setTilesetExportNameCommand,
    setTilesetFieldsCommand,
    tilesetFieldProblems,
    tilesetPropertiesCommand,
} from "./tilesetCommands";
export type { TilesetFields } from "./tilesetCommands";
export { COLLISION_LABELS, collisionCommand, setCollisionCommand } from "./collisionCommands";
export type { CollisionEdit } from "./collisionCommands";
export { ANIMATION_LABELS, animationCommand, setAnimationCommand } from "./animationCommands";
export type { AnimationEdit } from "./animationCommands";
export { TilesetUpdateError } from "./errors";
export type { TilesetUpdateErrorCode } from "./errors";
export { matchTiles } from "./updateMatch";
export type {
    AmbiguousTile,
    TileMatch,
    TileMatchKind,
    UpdateMatch,
    UpdateSummary,
} from "./updateMatch";
export { UPDATE_FROM_SOURCE_LABEL, updateFromSourceCommand } from "./updateApply";
export type { TileResolution } from "./updateApply";
export { readUpdateSource, tileBytes } from "./updateSource";
export { tileUsage } from "./updateUsage";
export type { MapUsage } from "./updateUsage";
export type {
    SourceAnimation,
    SourceEntry,
    SourceTiles,
    UpdateSourceFiles,
    UpdateSourceReaders,
} from "./updateSource";
