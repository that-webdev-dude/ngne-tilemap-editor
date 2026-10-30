import { createStore } from "zustand/vanilla";

/**
 * The two keymap contexts of DESIGN §10.1 that follow editor state instead of focus. The
 * feature that owns the state switches its context on and off: the polygon and polyline
 * marker tools, the collision polygon, the shape fill and the terrain line for `gesture`; the
 * marker selection of a marker layer for `markers`.
 */
export interface KeyContextState {
    /** A multi-click gesture is in progress. */
    gesture: boolean;
    /** The active layer is a marker layer and markers are selected. */
    markers: boolean;
}

export const keyContextStore = createStore<KeyContextState>(() => ({
    gesture: false,
    markers: false,
}));

export function setKeyContext(context: keyof KeyContextState, active: boolean): void {
    if (keyContextStore.getState()[context] !== active) {
        keyContextStore.setState({ [context]: active });
    }
}
