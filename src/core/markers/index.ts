// The marker commands of SPEC §8 (TE-037).

export {
    MARKER_LABELS,
    MarkerEditError,
    addMarkerCommand,
    deleteMarkersCommand,
    findMarker,
    markerLayerColorCommand,
    markerLayerOf,
    markerShapeProblem,
    moveMarkersCommand,
    renameMarkersCommand,
    resizeMarkerCommand,
    setMarkerClassCommand,
    setMarkerPointsCommand,
} from "./markerCommands";
export type {
    AddMarkerCommand,
    MarkerEditErrorCode,
    MarkerPlace,
    NewMarker,
} from "./markerCommands";
