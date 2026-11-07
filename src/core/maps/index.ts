// The map commands of SPEC §7.1: New Map, Duplicate, Rename, Delete, Move up or down (or to a
// place, by a drag) in the project's map list, Map Properties and Resize / Offset Map.

export {
    MAP_LABELS,
    MapEditError,
    deleteMapCommand,
    duplicateMapCommand,
    mapNameProblem,
    mapOf,
    moveMapCommand,
    newMapCommand,
    newMapProblems,
    nextMapName,
    renameMapCommand,
    reorderMapCommand,
} from "./mapCommands";
export type { MapEditErrorCode, NewMapValues } from "./mapCommands";
export {
    MAP_FIELD_KEYS,
    MAP_FIELD_LABELS,
    mapFieldProblems,
    mapFields,
    mapPropertiesCommand,
    setMapFieldsCommand,
} from "./mapProperties";
export type { MapFields } from "./mapProperties";
export {
    RESIZE_ANCHORS,
    RESIZE_ANCHOR_COLUMNS,
    RESIZE_MAP_LABEL,
    anchorOffset,
    clampOffset,
    offsetRange,
    resizeMapCommand,
    resizeMapProblems,
    resizeSource,
} from "./resizeMap";
export type {
    OffsetRange,
    PixelExtent,
    ResizeAnchor,
    ResizeMapValues,
    ResizeSource,
} from "./resizeMap";
