import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { Stamp } from "../../../core/cells";
import { hasTiles, withoutRemovedTiles } from "../../../core/model";
import { sessionStore } from "../../state/session";
import { onTilesetChange } from "../../tilesets/tilesetChanges";

// The current stamp (SPEC §4.2): a rectangle of cell values, empty cells allowed, that the
// stamp brush paints and the rail and the overlay preview. Later tickets feed it: the Tilesets
// panel (TE-025), capture (TE-018) and the clipboard (TE-021); until then code sets it. Its
// values hold tileset slots, which belong to one project: it is cleared when another project
// takes the window, as the clipboard is (SPEC §4.4), and loses its cells on tiles a change
// removes (SPEC §4.2).

export interface CurrentStampState {
    /** The stamp, or null while there is none: the stamp brush paints nothing. */
    readonly stamp: Stamp | null;
}

/** A store of a current stamp. The app has one (`currentStampStore`); tests create their own. */
export function createCurrentStampStore(): StoreApi<CurrentStampState> {
    return createStore<CurrentStampState>(() => ({ stamp: null }));
}

export const currentStampStore = createCurrentStampStore();

/** The current stamp of the app, or null. */
export function currentStamp(): Stamp | null {
    return currentStampStore.getState().stamp;
}

/**
 * Makes `stamp` the current stamp of the app (null for none). Throws `RangeError` when its
 * cells are not `width × height` values; the stamp is kept, so a later change of the caller's
 * array does not reach it.
 */
export function setCurrentStamp(stamp: Stamp | null): void {
    if (stamp) {
        const { width, height, cells } = stamp;
        const whole = Number.isInteger(width) && Number.isInteger(height);
        if (!whole || width < 1 || height < 1 || cells.length !== width * height) {
            throw new RangeError(`A ${width}x${height} stamp needs ${width * height} cells.`);
        }
        stamp = { width, height, cells: Uint32Array.from(cells) };
    }
    currentStampStore.setState({ stamp });
}

// Another project in the window: its tilesets have other slots.
let project = sessionStore.getState().session.project;
sessionStore.subscribe((state) => {
    if (state.session.project === project) return;
    project = state.session.project;
    if (currentStamp()) setCurrentStamp(null);
});

// A removed tileset or tile: its cells leave the stamp, and a stamp left empty is no stamp.
onTilesetChange(sessionStore, (changed) => {
    const stamp = currentStamp();
    if (!stamp) return;
    const kept = withoutRemovedTiles(stamp, changed);
    if (kept !== stamp) currentStampStore.setState({ stamp: hasTiles(kept) ? kept : null });
});
