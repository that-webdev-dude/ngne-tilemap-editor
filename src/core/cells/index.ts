export {
    CellConversionError,
    assignFirstGids,
    cellsToGids,
    createGidTable,
    gidToValue,
    gidsToCells,
    valueToGid,
} from "./gid";
export type { GidTable, GidTableEntry } from "./gid";
export {
    ORIENTATION,
    ROTATE_LEFT_MASK,
    ROTATE_RIGHT_MASK,
    compose,
    flipH,
    flipV,
    matrixOrientation,
    multiply,
    orientationMatrix,
    rotateLeft,
    rotateRight,
} from "./orientation";
export type { Matrix2 } from "./orientation";
export { transformCell, transformStamp } from "./stamp";
export type { Stamp, StampTransform } from "./stamp";
export { CELL_INDEX_MASK, CHUNK_BITS, CHUNK_SIZE, CellStore, MAX_COORD } from "./store";
export type { CellChunk, CellRect } from "./store";
export {
    FLAG_MASK,
    FLIP_D,
    FLIP_H,
    FLIP_V,
    GID_MASK,
    MAX_SLOT,
    MAX_TILE_ID,
    RESERVED_BIT,
    SLOT_SHIFT,
    cellOrientation,
    cellSlot,
    cellTileId,
    cellValue,
    isCellValue,
    withOrientation,
} from "./value";
export type { Orientation } from "./value";
