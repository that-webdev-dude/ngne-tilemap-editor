import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { createMapSession } from "../../core/model";
import { sessionStore } from "../state/session";
import type { SessionState } from "../state/session";
import { toolPipeline } from "../tools/appPipeline";

// Map tabs (SPEC §3, §7.1; DESIGN §2): the open maps of the project, in the order of their tabs.
// The sprite editor's document tabs hold documents; these hold maps of the one project, whose
// history is shared. Closing a tab hides its map: it stays in the project with its session
// (view, active layer, selections), which comes back when the map is shown again. The active
// map is always open: a map that becomes active by any route (a command, undo, a tab, a panel)
// gets its tab. A map that leaves the project loses its tab, and gets it back at the same place
// when undo restores it.
//
// The tab order is the strip's own, changed by dragging a tab, as the sprite editor orders its
// tabs; the project's map list (Move Map Up / Down) is a separate order.

export interface MapTabsState {
    /** IDs of the open maps, in tab order. */
    readonly open: readonly string[];
}

/** The map tabs of the app. */
export const mapTabsStore: StoreApi<MapTabsState> = createStore<MapTabsState>(() => ({
    open: [],
}));

export function useMapTabs<Slice>(selector: (state: MapTabsState) => Slice): Slice {
    return useStore(mapTabsStore, selector);
}

/**
 * Keeps `tabs` in step with the project of `sessions`: a new project opens its active map
 * alone; tabs of maps that left the project close, and come back where they were when the map
 * returns as the active one; the active map is always open. Returns the function that stops it.
 */
export function followSession(
    sessions: StoreApi<SessionState>,
    tabs: StoreApi<MapTabsState>,
): () => void {
    let history = sessions.getState().history;
    /** Tab positions of maps that left the project, by map ID. */
    const removedAt = new Map<string, number>();

    const reset = (state: SessionState) => {
        removedAt.clear();
        const { activeMapId, project } = state.session;
        const open = project.maps.some((map) => map.id === activeMapId) ? [activeMapId] : [];
        tabs.setState({ open });
    };

    const reconcile = (state: SessionState) => {
        if (state.history !== history) {
            history = state.history;
            reset(state);
            return;
        }
        const { project, activeMapId } = state.session;
        const ids = new Set(project.maps.map((map) => map.id));
        const open = tabs.getState().open;
        let next: string[] | null = null;
        if (open.some((id) => !ids.has(id))) {
            next = [];
            open.forEach((id, index) => {
                if (ids.has(id)) next!.push(id);
                else removedAt.set(id, index);
            });
        }
        for (const id of removedAt.keys()) {
            if (ids.has(id) && id !== activeMapId) removedAt.delete(id);
        }
        if (ids.has(activeMapId) && !(next ?? open).includes(activeMapId)) {
            next = [...(next ?? open)];
            const at = removedAt.get(activeMapId);
            removedAt.delete(activeMapId);
            if (at === undefined) next.push(activeMapId);
            else next.splice(Math.min(at, next.length), 0, activeMapId);
        }
        if (next) tabs.setState({ open: next });
    };

    reset(sessions.getState());
    return sessions.subscribe(reconcile);
}

/** Whether tabs can be switched and closed now: not during a stroke or an open gesture. */
export function tabsAvailable(): boolean {
    return !sessionStore.getState().history.transaction && !toolPipeline.stroking;
}

/**
 * Makes map `id` the active one, opening its tab when it is closed. Its session (view, active
 * layer, selections) is the one it had. Nothing changes during a stroke. Returns whether `id`
 * is the active map now.
 */
export function activateMap(id: string): boolean {
    const { session, touch } = sessionStore.getState();
    if (session.activeMapId === id) return true;
    const map = session.project.maps.find((each) => each.id === id);
    if (!map || !tabsAvailable()) return false;
    if (!session.perMap.has(id)) session.perMap.set(id, createMapSession(map));
    session.activeMapId = id;
    touch();
    return true;
}

/**
 * Before undo or redo of a step for map `mapId` (`History.undoMapId`, `redoMapId`): shows that
 * map first, so a change is never undone out of sight (SPEC §3). Returns whether the step may
 * run: true for a step of no map, of the active map, or of a map the step itself brings back
 * (the undo of Delete Map); false when the map could not be shown.
 */
export function showMapOfStep(mapId: string | null | undefined): boolean {
    if (mapId === null || mapId === undefined) return true;
    const { session } = sessionStore.getState();
    if (session.activeMapId === mapId) return true;
    if (!session.project.maps.some((map) => map.id === mapId)) return true;
    return activateMap(mapId);
}

/** The open map `step` tabs after the active one, wrapping around; null with fewer than two. */
export function neighbourTab(step: number): string | null {
    const { open } = mapTabsStore.getState();
    if (open.length < 2) return null;
    const index = open.indexOf(sessionStore.getState().session.activeMapId);
    if (index < 0) return null;
    return open[(((index + step) % open.length) + open.length) % open.length] ?? null;
}

/** The tab that takes the place of map `id`'s when that one goes: the next, else the previous. */
export function successorTab(id: string): string | undefined {
    const { open } = mapTabsStore.getState();
    const index = open.indexOf(id);
    if (index < 0) return undefined;
    return open[index + 1] ?? open[index - 1];
}

/**
 * Closes the tab of map `id`: the map stays in the project, hidden (SPEC §7.1). When it is the
 * active map, the tab that takes its place becomes active; with no tab left, no map is shown.
 * Returns whether the tab was closed.
 */
export function closeMapTab(id: string): boolean {
    const { open } = mapTabsStore.getState();
    if (!open.includes(id) || !tabsAvailable()) return false;
    const { session, touch } = sessionStore.getState();
    const next = successorTab(id) ?? "";
    mapTabsStore.setState({ open: open.filter((each) => each !== id) });
    if (session.activeMapId === id) {
        session.activeMapId = next;
        touch();
    }
    return true;
}

/** Moves the tab of map `id` to `index` (pointer drag or keyboard reorder). */
export function moveMapTab(id: string, index: number): void {
    const { open } = mapTabsStore.getState();
    const from = open.indexOf(id);
    const to = Math.max(0, Math.min(index, open.length - 1));
    if (from < 0 || from === to) return;
    const next = open.filter((each) => each !== id);
    next.splice(to, 0, id);
    mapTabsStore.setState({ open: next });
}

followSession(sessionStore, mapTabsStore);
