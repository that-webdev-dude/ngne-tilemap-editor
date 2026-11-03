// Tileset import (SPEC §6.1): sources turned into tilesets with stable tile IDs, source keys and
// fingerprints, and the command that adds one to the project. The tileset commands of SPEC §6.2:
// rename, export name, class, tile offset, move, delete.

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
