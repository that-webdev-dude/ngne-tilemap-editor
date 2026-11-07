// The layer commands of SPEC §7.2 and the D1 envelope check of a map (BRIEF D1).

export {
    LAYER_LABELS,
    LAYER_VALUE_KEYS,
    LayerEditError,
    adjacentLayer,
    checkLayerTree,
    deleteLayersCommand,
    duplicateLayersCommand,
    groupLayersCommand,
    groupName,
    layerNameProblem,
    layerOrder,
    layerValueProblems,
    moveLayerCommand,
    moveLayerToCommand,
    moveTarget,
    newLayerCommand,
    newLayerName,
    otherLayers,
    placeOf,
    setLayerValuesCommand,
    toggleOtherLayersCommand,
    ungroupCommand,
} from "./layerCommands";
export type { LayerEditErrorCode, LayerPlace, LayerValues, NewLayerKind } from "./layerCommands";
export { ENVELOPE, envelopeProblems } from "./envelope";
export type { EnvelopeProblem } from "./envelope";
