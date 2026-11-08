import type { Shape } from "../../core/model";
import type { Point } from "../view/coordinates";
import type { Band } from "./markerGeometry";

// What the marker tools show on the overlay while they work (TE-038; drawn by
// `markerTools.overlay.ts`): the select tool's rubber band, and the marker a create tool is
// making. Plain state with listeners, set by the tools only.

export interface MarkerPreview {
    /** The rubber band of the select tool, map pixels; null when none. */
    readonly band: Band | null;
    /** The marker a create tool is making, in its layer's coordinates; null when none. */
    readonly creating: {
        /** The shape so far: a polygon or polyline with its points placed so far. */
        readonly shape: Shape;
        /** Where the pointer would place the next point of a polygon or polyline. */
        readonly next: Point | null;
        /** Map pixels the target layer is drawn from its markers' positions. */
        readonly shift: Point;
    } | null;
}

const EMPTY: MarkerPreview = { band: null, creating: null };

let preview: MarkerPreview = EMPTY;
const listeners = new Set<() => void>();

export function markerPreview(): MarkerPreview {
    return preview;
}

/** Changes part of the preview and tells the listeners. */
export function setMarkerPreview(change: Partial<MarkerPreview>): void {
    preview = { ...preview, ...change };
    for (const listener of [...listeners]) listener();
}

/** Clears the preview. */
export function clearMarkerPreview(): void {
    if (preview === EMPTY) return;
    preview = EMPTY;
    for (const listener of [...listeners]) listener();
}

export function subscribeMarkerPreview(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
