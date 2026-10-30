import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

/**
 * Editor state of the bottom panel (DESIGN §2), outside the project and not undoable: whether
 * the panel is shown. Tab (viewport focused) and View → Hide Bottom Panel toggle it; the panel
 * is shown again at every start, as the sprite editor's timeline.
 */
export interface BottomPanelState {
    visible: boolean;
}

export const bottomPanelStore: StoreApi<BottomPanelState> = createStore<BottomPanelState>(() => ({
    visible: true,
}));

export function useBottomPanel<Slice>(selector: (state: BottomPanelState) => Slice): Slice {
    return useStore(bottomPanelStore, selector);
}

/** Shows or hides the bottom panel. */
export function setBottomPanelVisible(visible: boolean): void {
    if (bottomPanelStore.getState().visible !== visible) bottomPanelStore.setState({ visible });
}
