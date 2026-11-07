import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { MapEditError, mapNameProblem, reorderMapCommand } from "../../core/maps";
import { sessionStore } from "../state/session";
import { mapsIdle, renameMap } from "./maps";

// The state of the Maps dock section (DESIGN §8.1; TE-032) that commands read: which row has the
// keyboard focus (F2 renames that map, DESIGN §10.3) and the rename in progress. A double click
// or F2 turns the row's name into a field, with the sprite editor's rename rules (its DESIGN
// §5.6): Enter or leaving the field applies the name (one undo step); Escape, or a blank name,
// keeps the old one. A drag reorders the map list as one undo step.

/** The context menu of a row of the Maps panel (`CommandSpec.contextMenus`). */
export const MAP_MENU = "map";

export interface MapsPanelState {
    /** The rename in progress: the map and the text of its field; null when none is. */
    readonly renaming: { readonly id: string; readonly text: string } | null;
    /** The map whose row has the keyboard focus; null while the focus is outside the list. */
    readonly focusedId: string | null;
}

export const mapsPanelStore = createStore<MapsPanelState>(() => ({
    renaming: null,
    focusedId: null,
}));

export function useMapsPanel<Slice>(selector: (state: MapsPanelState) => Slice): Slice {
    return useStore(mapsPanelStore, selector);
}

/** Tells the app which map's row has the keyboard focus (null: the focus left the list). */
export function setFocusedMapRow(focusedId: string | null): void {
    if (mapsPanelStore.getState().focusedId !== focusedId) mapsPanelStore.setState({ focusedId });
}

/** The map the panel's row with the focus shows; null when no row has it. */
export function focusedMap(): string | null {
    const { focusedId } = mapsPanelStore.getState();
    const { maps } = sessionStore.getState().session.project;
    return focusedId !== null && maps.some((map) => map.id === focusedId) ? focusedId : null;
}

/** Starts renaming map `id` in place. Returns false for an unknown map or during a stroke. */
export function startMapRename(id: string): boolean {
    const map = sessionStore.getState().session.project.maps.find((each) => each.id === id);
    if (!map || !mapsIdle()) return false;
    mapsPanelStore.setState({ renaming: { id, text: map.name } });
    return true;
}

export function setMapRenameText(text: string): void {
    const { renaming } = mapsPanelStore.getState();
    if (renaming) mapsPanelStore.setState({ renaming: { ...renaming, text } });
}

/** Ends the rename and keeps the old name. */
export function cancelMapRename(): void {
    if (mapsPanelStore.getState().renaming) mapsPanelStore.setState({ renaming: null });
}

/**
 * Ends the rename and applies the typed name: one undo step when it differs from the name and
 * is a valid one; a blank name keeps the old one. Returns whether the name changed.
 */
export function applyMapRename(): boolean {
    const { renaming } = mapsPanelStore.getState();
    if (!renaming) return false;
    mapsPanelStore.setState({ renaming: null });
    if (mapNameProblem(renaming.text) || !mapsIdle()) return false;
    try {
        return renameMap(renaming.id, renaming.text);
    } catch (error) {
        // Called from the field, not the registry: a refused name keeps the old one.
        if (error instanceof MapEditError) return false;
        throw error;
    }
}

/**
 * Moves map `id` to place `index` of the map list (a drag in the panel): one undo step.
 * Returns false when it is there already, the place is outside the list, or during a stroke.
 */
export function reorderMap(id: string, index: number): boolean {
    const { session, history } = sessionStore.getState();
    const { maps } = session.project;
    const from = maps.findIndex((map) => map.id === id);
    if (from < 0 || index === from || index < 0 || index >= maps.length || !mapsIdle()) {
        return false;
    }
    history.execute(reorderMapCommand(session.project, id, index));
    return true;
}

// Another project, or the map gone (an undo of its New Map): the rename ends.
sessionStore.subscribe((state) => {
    const { renaming } = mapsPanelStore.getState();
    if (renaming && !state.session.project.maps.some((map) => map.id === renaming.id)) {
        mapsPanelStore.setState({ renaming: null });
    }
});
