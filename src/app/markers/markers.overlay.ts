import type { OverlayLayer } from "../overlay/types";
import { historySteps } from "../state/historySteps";
import { drawMarkers } from "./markerDrawing";

// The markers of the active map on the overlay (SPEC §8, DESIGN §4; TE-037; how they look and
// what they cost: `markerDrawing.ts`). Above the cell grid (300) and the collision outlines (400),
// below the tile selection's ants (500) and the tool previews (600). Markers change only through
// the history, so a step of it (or a new project) asks for a redraw and tells the drawing its
// paths are out of date; the view and the active map are the overlay's own redraw keys.

/** Above the cell grid and the collision outlines, below the selection and the previews. */
export const MARKERS_ORDER = 450;

export const overlayLayers: OverlayLayer[] = [
    {
        id: "markers",
        order: MARKERS_ORDER,
        draw: (frame) => drawMarkers(frame, historySteps.getState().step),
        watch: (redraw) => historySteps.subscribe(redraw),
    },
];
