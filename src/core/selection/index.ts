// The tile selection of SPEC §3 and §4.4 (TE-020): cell masks with their rectangle (the model's
// `Region`), the operations replace, add, subtract, intersect, invert, all and none, the
// boundary as edge segments for the marching ants, and the commands that change
// `MapSession.tileSelection` through the history.

export { selectionBoundary } from "./boundary";
export type { HorizontalEdge, OuterCorner, SelectionBoundary, VerticalEdge } from "./boundary";
export {
    invertSelectionCommand,
    selectAllCommand,
    selectCommand,
    selectNoneCommand,
    setSelectionCommand,
    tileSelectionOf,
} from "./commands";
export {
    copyMask,
    createMask,
    maskBounds,
    maskHas,
    maskSize,
    maskSpans,
    masksEqual,
    rectMask,
    selectionOf,
    selectionsEqual,
    setMaskCell,
    setMaskRun,
    spansMask,
} from "./mask";
export {
    combineSelection,
    fullMask,
    intersectMask,
    invertMask,
    invertSelection,
    selectAll,
    subtractMask,
    unionMask,
} from "./operations";
export type { SelectionMode } from "./operations";
