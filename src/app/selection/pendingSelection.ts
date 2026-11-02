import type { Region } from "../../core/model";
import { combineSelection } from "../../core/selection";
import type { SelectionMode } from "../../core/selection";

// The selection a selection tool's gesture would leave, while it is in progress (TE-020): the
// rectangle select's drag, the magic wand's and the select same tile's press. The ants show it
// in place of the map's selection until the release records it, as Tiled previews its
// selection tools' region and applies it at the release; a cancel drops it and the map's
// selection shows again. Not part of the session: a change of map or layer cancels the
// gesture (`pipeline.ts`). The gesture keeps its shape and mode, and what it would leave is
// combined with the map's selection as it is now, so an undo during the drag shows at once.

/** A gesture on map `mapId`: its shape and the mode it combines with the selection by. */
export interface PendingSelection {
    readonly mapId: string;
    readonly shape: Region;
    readonly mode: SelectionMode;
}

let pending: PendingSelection | null = null;
const listeners = new Set<() => void>();

/** The pending gesture, or null while no selection gesture is in progress. */
export function pendingSelection(): PendingSelection | null {
    return pending;
}

/** Sets (or with null, drops) the pending gesture. */
export function setPendingSelection(next: PendingSelection | null): void {
    if (next === pending) return;
    pending = next;
    for (const listener of [...listeners]) listener();
}

/** Calls `listener` when the pending gesture changed; returns the function that stops it. */
export function subscribePendingSelection(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The last combination made, kept while its inputs are the same objects. */
let combined: {
    current: Region | null;
    gesture: PendingSelection;
    result: Region | null;
} | null = null;

/**
 * What `gesture` would leave over `current`, the map's selection now: the same object again
 * while both are the same, so the ants keep their ring.
 */
export function pendingResult(current: Region | null, gesture: PendingSelection): Region | null {
    if (combined && combined.current === current && combined.gesture === gesture) {
        return combined.result;
    }
    const result = combineSelection(current, gesture.shape, gesture.mode);
    combined = { current, gesture, result };
    return result;
}
