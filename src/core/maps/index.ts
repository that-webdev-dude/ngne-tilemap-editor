// The map commands of SPEC §7.1: New Map, Duplicate, Rename, Delete, Move up or down (or to a
// place, by a drag) in the project's map list, and Map Properties.

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
