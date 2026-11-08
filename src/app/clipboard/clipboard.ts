import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Stamp } from "../../core/cells";
import type { NewMarker } from "../../core/markers";
import { hasTiles, withoutRemovedTiles } from "../../core/model";
import type { Marker } from "../../core/model";
import { sessionStore } from "../state/session";
import { onTilesetChange } from "../tilesets/tilesetChanges";

// The editor's clipboard (SPEC §4.4; TE-021): the app's own, not the system's, one for the
// window and so shared by every map of the project. It holds tileset slots and tile IDs, which
// belong to the project: it loses its cells on tiles a change removes (SPEC §4.2), and clearing
// it when another project opens is TE-047's. It holds cells or markers (TE-039), the last copy
// wins (SPEC §8): copying markers drops the cells and copying cells drops the markers.

/** The cells the clipboard holds: a stamp whose empty cells were not selected. */
export type ClipboardContent = { readonly kind: "cells"; readonly stamp: Stamp };

export interface ClipboardState {
    /** The cells, or null while none were copied last. */
    readonly content: ClipboardContent | null;
    /**
     * The markers, or null while none were copied last: each its geometry (positions in its
     * layer's coordinates), name, class and properties, without an ID (a paste gives new ones).
     * At most one of `content` and `markers` is set.
     */
    readonly markers: readonly NewMarker[] | null;
}

/** A store of a clipboard. The app has one (`clipboardStore`); tests may create their own. */
export function createClipboardStore(): StoreApi<ClipboardState> {
    return createStore<ClipboardState>(() => ({ content: null, markers: null }));
}

export const clipboardStore = createClipboardStore();

/** The app's clipboard cells, or null. */
export function clipboardContent(): ClipboardContent | null {
    return clipboardStore.getState().content;
}

/** The app's clipboard markers, or null. */
export function clipboardMarkers(): readonly NewMarker[] | null {
    return clipboardStore.getState().markers;
}

/** Puts `stamp` on the app's clipboard as cells; later changes of its array do not reach it. */
export function copyCellsToClipboard(stamp: Stamp): void {
    const { width, height, cells } = stamp;
    clipboardStore.setState({
        content: { kind: "cells", stamp: { width, height, cells: Uint32Array.from(cells) } },
        markers: null,
    });
}

/**
 * Puts copies of `markers` on the app's clipboard, without their IDs, in the order given; later
 * changes of the markers do not reach it.
 */
export function copyMarkersToClipboard(markers: readonly Marker[]): void {
    const copies = markers.map((marker) => {
        const copy: Partial<Marker> = structuredClone(marker);
        delete copy.id;
        return copy as NewMarker;
    });
    clipboardStore.setState({ content: null, markers: copies });
}

// A removed tileset or tile: its cells leave the clipboard, and cells left all empty are none.
onTilesetChange(sessionStore, (project) => {
    const content = clipboardContent();
    if (!content) return;
    const kept = withoutRemovedTiles(content.stamp, project);
    if (kept === content.stamp) return;
    clipboardStore.setState({ content: hasTiles(kept) ? { kind: "cells", stamp: kept } : null });
});
