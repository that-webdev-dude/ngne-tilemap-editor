import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Stamp } from "../../core/cells";

// The editor's clipboard (SPEC §4.4; TE-021): the app's own, not the system's, one for the
// window and so shared by every map of the project. It holds tileset slots and tile IDs, which
// belong to the project; clearing it when another project opens is TE-047's. Markers join it in
// TE-039: it holds cells or markers, the last copy wins (SPEC §8).

/** What the clipboard holds: cells, as a stamp whose empty cells were not selected. */
export type ClipboardContent = { readonly kind: "cells"; readonly stamp: Stamp };

export interface ClipboardState {
    /** The content, or null while nothing was copied. */
    readonly content: ClipboardContent | null;
}

/** A store of a clipboard. The app has one (`clipboardStore`); tests may create their own. */
export function createClipboardStore(): StoreApi<ClipboardState> {
    return createStore<ClipboardState>(() => ({ content: null }));
}

export const clipboardStore = createClipboardStore();

/** The app's clipboard content, or null. */
export function clipboardContent(): ClipboardContent | null {
    return clipboardStore.getState().content;
}

/** Puts `stamp` on the app's clipboard as cells; later changes of its array do not reach it. */
export function copyCellsToClipboard(stamp: Stamp): void {
    const { width, height, cells } = stamp;
    clipboardStore.setState({
        content: { kind: "cells", stamp: { width, height, cells: Uint32Array.from(cells) } },
    });
}
