import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Command } from "../../../core/history";
import type { Tileset } from "../../../core/model";
import {
    TilesetEditError,
    deleteTilesetCommand,
    moveTilesetCommand,
    renameTilesetCommand,
    tilesetFieldProblems,
} from "../../../core/tileset";
import { sessionStore } from "../../state/session";
import { toolPipeline } from "../../tools/appPipeline";
import { shownTileset, tilesetPanel, tilesetPanelStore } from "../panel/tilesetPanel";

// The tileset commands of the app (SPEC §6.2; TE-026) act on the tileset the Tilesets panel
// shows, as Tiled's act on the current tileset of its tileset dock. A refused command (a delete
// while a map uses the tileset) changes nothing and throws its `TilesetEditError`, which the
// command registry reports in an error toast ("Delete Tileset failed: “Terrain” is used by the
// map “Map 1”.").
// F2 renames the shown tileset in place in the panel, as the sprite editor renames a layer
// (its DESIGN §5.6): Enter or leaving the field applies the name, one undo step; Escape, or a
// blank name, keeps the old one.

/** The context menu of a tileset tab in the Tilesets panel (`CommandSpec.contextMenus`). */
export const TILESET_MENU = "tileset";

/** Whether the history can take a command now: not during a stroke. */
export const historyIdle = (): boolean =>
    !sessionStore.getState().history.transaction && !toolPipeline.stroking;

/** The tileset the Tilesets panel shows; null without any. */
export function currentTileset(): Tileset | null {
    return shownTileset(sessionStore.getState().session.project, tilesetPanelStore.getState());
}

/**
 * Executes `command` on the app's history; returns true. A refusal throws `TilesetEditError`
 * with the project unchanged.
 */
export function runTilesetCommand(command: Command): boolean {
    sessionStore.getState().history.execute(command);
    return true;
}

/** Whether the shown tileset has a neighbour `delta` places along the list. */
export function canMoveCurrentTileset(delta: -1 | 1): boolean {
    const tileset = currentTileset();
    if (!tileset) return false;
    const { tilesets } = sessionStore.getState().session.project;
    return tilesets[tilesets.indexOf(tileset) + delta] !== undefined;
}

/** Moves the shown tileset one place left or right in the list; its tab stays shown. */
export function moveCurrentTileset(delta: -1 | 1): boolean {
    const tileset = currentTileset();
    if (!tileset) return false;
    // Shown by default as the first tab: pinned, so the move does not show the one that
    // takes its place.
    tilesetPanel.showTileset(tileset.id);
    return runTilesetCommand(moveTilesetCommand(tileset.id, delta));
}

/** Deletes the shown tileset; refused, naming the maps, while a map uses it. */
export function deleteCurrentTileset(): boolean {
    const tileset = currentTileset();
    if (!tileset) return false;
    const { project } = sessionStore.getState().session;
    return runTilesetCommand(deleteTilesetCommand(project, tileset.id));
}

export interface TilesetRenameState {
    /** The rename in progress: the tileset and the text of its field; null when none is. */
    readonly renaming: { readonly id: string; readonly text: string } | null;
    /** Whether the focus is inside the Tilesets panel, where F2 renames (DESIGN §10.3). */
    readonly panelFocused: boolean;
}

export const tilesetRenameStore = createStore<TilesetRenameState>(() => ({
    renaming: null,
    panelFocused: false,
}));

export function useTilesetRename<Slice>(selector: (state: TilesetRenameState) => Slice): Slice {
    return useStore(tilesetRenameStore, selector);
}

/** Tells the app whether the focus is inside the Tilesets panel. */
export function setTilesetPanelFocused(panelFocused: boolean): void {
    if (tilesetRenameStore.getState().panelFocused !== panelFocused) {
        tilesetRenameStore.setState({ panelFocused });
    }
}

/** Starts renaming the shown tileset in place. */
export function startTilesetRename(): boolean {
    const tileset = currentTileset();
    if (!tileset) return false;
    tilesetRenameStore.setState({ renaming: { id: tileset.id, text: tileset.name } });
    return true;
}

export function setTilesetRenameText(text: string): void {
    const { renaming } = tilesetRenameStore.getState();
    if (renaming) tilesetRenameStore.setState({ renaming: { ...renaming, text } });
}

/** Ends the rename and keeps the old name. */
export function cancelTilesetRename(): void {
    if (tilesetRenameStore.getState().renaming) tilesetRenameStore.setState({ renaming: null });
}

/**
 * Ends the rename and applies the typed name: one undo step when it differs from the name and
 * is a valid one; a blank name keeps the old one. Returns whether the name changed.
 */
export function applyTilesetRename(): boolean {
    const { renaming } = tilesetRenameStore.getState();
    if (!renaming) return false;
    tilesetRenameStore.setState({ renaming: null });
    const { project } = sessionStore.getState().session;
    const tileset = project.tilesets.find((each) => each.id === renaming.id);
    if (!tileset || renaming.text === tileset.name || !historyIdle()) return false;
    if (tilesetFieldProblems(project, tileset.id, { name: renaming.text }).name) return false;
    try {
        return runTilesetCommand(renameTilesetCommand(tileset.id, renaming.text));
    } catch (error) {
        // Called from the field, not the registry: a refused name keeps the old one.
        if (error instanceof TilesetEditError) return false;
        throw error;
    }
}

// Another project, or the renamed tileset gone (an undo of its import): the rename ends.
sessionStore.subscribe((state) => {
    const { renaming } = tilesetRenameStore.getState();
    if (renaming && !state.session.project.tilesets.some((each) => each.id === renaming.id)) {
        tilesetRenameStore.setState({ renaming: null });
    }
});
