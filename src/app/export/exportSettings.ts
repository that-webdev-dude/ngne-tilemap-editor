import type { StoreApi } from "zustand/vanilla";
import type { SessionState } from "../state/session";

// The export settings of the project (FORMAT §2.4 `exportSettings`): plain setters with no
// history entry that make the project dirty (SPEC §3). The history compares them with the
// settings of the last save (`History.dirty`); the store is told, so the tab's dirty mark,
// autosave and the commands follow.

/**
 * Sets the open project's Export on save. Returns whether it changed: false when no project is
 * open or it already had that value.
 */
export function setExportOnSave(sessions: StoreApi<SessionState>, on: boolean): boolean {
    const state = sessions.getState();
    if (!state.open) return false;
    const settings = state.session.project.exportSettings;
    if (settings.exportOnSave === on) return false;
    settings.exportOnSave = on;
    state.touch();
    return true;
}
