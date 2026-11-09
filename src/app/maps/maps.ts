import {
    deleteMapCommand,
    duplicateMapCommand,
    moveMapCommand,
    newMapCommand,
    nextMapName,
    renameMapCommand,
} from "../../core/maps";
import type { NewMapValues } from "../../core/maps";
import {
    DEFAULT_MAP_HEIGHT,
    DEFAULT_MAP_WIDTH,
    DEFAULT_TILE_HEIGHT,
    DEFAULT_TILE_WIDTH,
} from "../../core/model";
import type { ProjectMap } from "../../core/model";
import { sessionStore } from "../state/session";
import { successorTab, tabsAvailable } from "../tabs/tabs";
import { canNavigate, fitActiveView } from "../view/viewNavigation";
import { viewportSize } from "../view/viewportSize";

// The map commands of the app (SPEC §7.1; TE-031) on the app's history. New Map takes its size
// and tile size from the last new map (64 × 64 cells of 16 × 16 px at first), kept for the
// session; New Map and Duplicate show the map they add, fitted (the Fit of View) the first time
// it is shown once the viewport has a size. Later tab switches keep the view it was left with.
// A refused command (Delete of the last map, a value out of range) throws its `MapEditError`
// with the project unchanged; the command registry reports it in an error toast.

/** The size and tile size of the last new map. */
let lastNewMap: Omit<NewMapValues, "name"> = {
    width: DEFAULT_MAP_WIDTH,
    height: DEFAULT_MAP_HEIGHT,
    tileWidth: DEFAULT_TILE_WIDTH,
    tileHeight: DEFAULT_TILE_HEIGHT,
};

/** Maps added by New Map or Duplicate that have not been fitted yet. */
const unfitted = new Set<string>();

/** Fits the active map when it is shown for the first time and the viewport has a size. */
function fitFirstShown(): void {
    const id = sessionStore.getState().session.activeMapId;
    if (!unfitted.has(id) || !canNavigate()) return;
    unfitted.delete(id);
    fitActiveView();
}

sessionStore.subscribe(fitFirstShown);
viewportSize.subscribe(fitFirstShown);

/** The values New Map starts from: the next free "Map n" and the last new map's sizes. */
export function newMapDefaults(): NewMapValues {
    return { name: nextMapName(sessionStore.getState().session.project), ...lastNewMap };
}

/** The active map; null when no map is shown. */
export function activeMap(): ProjectMap | null {
    const { session } = sessionStore.getState();
    return session.project.maps.find((map) => map.id === session.activeMapId) ?? null;
}

/** Whether the history can take a map command now: not during a stroke. */
export const mapsIdle = tabsAvailable;

/**
 * Fits map `id` the first time it is shown once the viewport has a size: a map New Map or
 * Duplicate added, or the first map of a new project (TE-047).
 */
export function fitWhenShown(id: string): void {
    unfitted.add(id);
    fitFirstShown();
}

/** Shows the map `id` that New Map or Duplicate added, fitted once the viewport has a size. */
function showAdded(id: string): string {
    fitWhenShown(id);
    return id;
}

/**
 * New Map (SPEC §7.1): adds a map with one tile layer and shows it; the values not given are
 * `newMapDefaults()`. Returns the new map's ID.
 */
export function newMap(values: Partial<NewMapValues> = {}): string {
    const { session, history } = sessionStore.getState();
    const full = { ...newMapDefaults(), ...values };
    const command = newMapCommand(session.project, full);
    history.execute(command);
    lastNewMap = {
        width: full.width,
        height: full.height,
        tileWidth: full.tileWidth,
        tileHeight: full.tileHeight,
    };
    return showAdded(command.touched.mapId!);
}

/** Duplicates map `id` (the active map by default) and shows the copy. Returns its ID. */
export function duplicateMap(id = activeMap()?.id): string | null {
    if (id === undefined) return null;
    const { session, history } = sessionStore.getState();
    const command = duplicateMapCommand(session.project, id);
    history.execute(command);
    return showAdded(command.touched.mapId!);
}

/**
 * Deletes map `id` (the active map by default), without asking: undo restores it (SPEC §7.1,
 * SUITE §4). When it is the active map, the tab that takes its place is shown.
 */
export function deleteMap(id = activeMap()?.id): boolean {
    if (id === undefined) return false;
    const { session, history } = sessionStore.getState();
    history.execute(deleteMapCommand(session.project, id, successorTab(id)));
    return true;
}

/** Renames map `id`; one history entry. Returns false when `name` is its name already. */
export function renameMap(id: string, name: string): boolean {
    const { session, history } = sessionStore.getState();
    if (session.project.maps.find((map) => map.id === id)?.name === name) return false;
    history.execute(renameMapCommand(id, name));
    return true;
}

/** Whether map `id` has a neighbour `delta` places along the project's map list. */
export function canMoveMap(id: string | undefined, delta: -1 | 1): boolean {
    const { maps } = sessionStore.getState().session.project;
    const index = maps.findIndex((map) => map.id === id);
    return index >= 0 && maps[index + delta] !== undefined;
}

/** Moves map `id` (the active map by default) one place up or down in the map list. */
export function moveMap(delta: -1 | 1, id = activeMap()?.id): boolean {
    if (id === undefined) return false;
    sessionStore.getState().history.execute(moveMapCommand(id, delta));
    return true;
}
