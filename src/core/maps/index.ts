// The map commands of SPEC §7.1: New Map, Duplicate, Rename, Delete and Move up or down in the
// project's map list.

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
} from "./mapCommands";
export type { MapEditErrorCode, NewMapValues } from "./mapCommands";
