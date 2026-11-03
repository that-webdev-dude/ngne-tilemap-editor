// Tileset import (SPEC §6.1): sources turned into tilesets with stable tile IDs, source keys and
// fingerprints, and the command that adds one to the project.

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
