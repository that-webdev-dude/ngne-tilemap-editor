export {
    analyzeTerrainSet,
    effectiveTypeForColor,
    missingCombinations,
    terrainAnalysis,
    transitionPenalty,
    wangIdOfCell,
} from "./analysis";
export type { TerrainAnalysis, TerrainCombination } from "./analysis";
export { TerrainFiller } from "./filler";
export type { TerrainBack, TerrainCell, TerrainFillResult, TerrainFillerOptions } from "./filler";
export { TerrainEditError } from "./errors";
export type { TerrainEditErrorCode } from "./errors";
export { applyTerrainFill } from "./patch";
export { brushIndexAt } from "./pick";
export { clockSeed, xorshift32 } from "./random";
export type { Random } from "./random";
export {
    DEFAULT_TERRAIN_COLOURS,
    NEW_TERRAIN_SET_NAME,
    TERRAIN_LABELS,
    addTerrainCommand,
    addTerrainSetCommand,
    assignTerrainCommand,
    defaultTerrainColour,
    defaultTerrainName,
    moveTerrainCommand,
    moveTerrainSetCommand,
    removeTerrainCommand,
    removeTerrainSetCommand,
    renameTerrainSetCommand,
    setTerrainFieldCommand,
    setTerrainSetTypeCommand,
    terrainNameProblem,
    tileWangId,
} from "./terrainCommands";
export type { TerrainFields, TerrainTarget } from "./terrainCommands";
export {
    AROUND,
    BOTTOM,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
    INDEX_MASK,
    LEFT,
    ORIENTATION_SOURCES,
    RIGHT,
    TOP,
    TOP_LEFT,
    TOP_RIGHT,
    WANG_INDEXES,
    indexByGrid,
    isCorner,
    nextIndex,
    oppositeIndex,
    orientWangId,
    previousIndex,
    typeUsesIndex,
} from "./wangId";
export type { WangIndex } from "./wangId";
