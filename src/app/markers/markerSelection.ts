import type { StoreApi } from "zustand/vanilla";
import { deleteMarkersCommand } from "../../core/markers";
import type { Command } from "../../core/history";
import { createMapSession, effectiveValues, walkLayers } from "../../core/model";
import type { Marker, ProjectMap, ProjectSession, Shape } from "../../core/model";
import { setKeyContext } from "../keymap/contextState";
import { REFUSALS } from "../tools/paintTarget";
import { sessionStore } from "../state/session";
import type { SessionState } from "../state/session";
import { activeLayer, activeMap } from "../tools/toolSets";

// The marker selection of a map (SPEC §3, §8; TE-038): `MapSession.markerSelection`, the IDs of
// the selected markers. It is session state, as Tiled's object selection is: the select tool
// and the create tools set it with no history entry; the commands that add or remove markers
// keep it true and put it back on undo (core/markers).
//
// While a marker drag is in progress, the dragged markers are drawn where the drag puts them (a
// draft), and the history takes one command at the release (`markerDraft`).
//
// The `markers` key context (DESIGN §10.1) is on while the active layer is a marker layer and
// markers of the active map are selected (`followMarkerContext`).

/**
 * The markers of `map` by ID, the first of an ID in layer order (as `findMarker`). Built once per
 * lookup of a selection, so it costs the selection plus the markers, not their product: the
 * listeners of every pan look the selection up.
 */
function markersById(map: ProjectMap): Map<number, Marker> {
    const byId = new Map<number, Marker>();
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== "marker") continue;
        for (const marker of layer.markers) {
            if (!byId.has(marker.id)) byId.set(marker.id, marker);
        }
    }
    return byId;
}

/** The selected markers of `map` that exist, in selection order. */
export function selectedMarkers(session: ProjectSession, map: ProjectMap): Marker[] {
    const ids = session.perMap.get(map.id)?.markerSelection ?? [];
    if (ids.length === 0) return [];
    const byId = markersById(map);
    const out: Marker[] = [];
    for (const id of ids) {
        const marker = byId.get(id);
        if (marker) out.push(marker);
    }
    return out;
}

/** The IDs of the selected markers of `map` that exist, in selection order. */
export function selectedMarkerIds(session: ProjectSession, map: ProjectMap): number[] {
    return selectedMarkers(session, map).map((marker) => marker.id);
}

/**
 * Makes `ids` the marker selection of map `mapId` of `store`'s session (no history entry, as
 * Tiled's `setSelectedObjects`); listeners are told when it changed.
 */
export function setMarkerSelection(
    ids: readonly number[],
    mapId?: string,
    store: StoreApi<SessionState> = sessionStore,
): void {
    const { session } = store.getState();
    const map = mapId ? session.project.maps.find((each) => each.id === mapId) : activeMap(session);
    if (!map) return;
    let mapSession = session.perMap.get(map.id);
    if (!mapSession) {
        mapSession = createMapSession(map);
        session.perMap.set(map.id, mapSession);
    }
    const next = [...new Set(ids)];
    const same =
        next.length === mapSession.markerSelection.length &&
        next.every((id, k) => mapSession.markerSelection[k] === id);
    if (same) return;
    mapSession.markerSelection = next;
    store.getState().touch();
}

/** Whether the active layer is a marker layer and markers of the active map are selected. */
export function markersSelected(session: ProjectSession): boolean {
    const map = activeMap(session);
    return (
        map !== null &&
        activeLayer(session)?.type === "marker" &&
        selectedMarkerIds(session, map).length > 0
    );
}

/**
 * Why the selected markers of `map` may not be changed by a key or a menu command (nudge, Cut,
 * Delete, a chosen point's edits): one of them lies on a layer that is locked, itself or by a
 * group above it, as the layer of cells Cut and Delete refuse (SPEC §4.4, §8). A selection
 * outlives a lock made after it. Null when every one may be changed; Copy only reads.
 */
export function lockedSelectionRefusal(session: ProjectSession, map: ProjectMap): string | null {
    const ids = new Set(selectedMarkerIds(session, map));
    if (ids.size === 0) return null;
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type !== "marker" || !layer.markers.some((marker) => ids.has(marker.id))) {
            continue;
        }
        if (!effectiveValues(layer, ancestors).unlocked) return REFUSALS.locked;
    }
    return null;
}

/**
 * The command that deletes the selected markers of the active map (Delete, DESIGN §10.3), while
 * the `markers` context applies; null otherwise.
 */
export function deleteSelectedMarkersCommand(session: ProjectSession): Command | null {
    const map = activeMap(session);
    if (!map || !markersSelected(session)) return null;
    return deleteMarkersCommand(session.project, map.id, selectedMarkerIds(session, map));
}

/** Keeps the `markers` key context on the selection; returns the function that stops it. */
export function followMarkerContext(store: StoreApi<SessionState> = sessionStore): () => void {
    const update = () => setKeyContext("markers", markersSelected(store.getState().session));
    update();
    return store.subscribe(update);
}

// ---------------------------------------------------------------------------------------------
// The draft of a drag

/** Markers of a map drawn with other shapes while a drag is in progress. */
export interface MarkerDraft {
    readonly mapId: string;
    /** The shape each dragged marker is drawn with, by ID. */
    readonly shapes: ReadonlyMap<number, Shape>;
}

let draft: MarkerDraft | null = null;
let draftVersion = 0;
const draftListeners = new Set<() => void>();

/** The draft in progress, or null. */
export function markerDraft(): MarkerDraft | null {
    return draft;
}

/** Increases whenever the draft changes. */
export function markerDraftVersion(): number {
    return draftVersion;
}

/** Sets the draft (null ends it) and tells the listeners. */
export function setMarkerDraft(next: MarkerDraft | null): void {
    if (next === null && draft === null) return;
    draft = next;
    draftVersion += 1;
    for (const listener of [...draftListeners]) listener();
}

/** Calls `listener` when the draft changes; returns the function that stops it. */
export function subscribeMarkerDraft(listener: () => void): () => void {
    draftListeners.add(listener);
    return () => {
        draftListeners.delete(listener);
    };
}

/** The shape `marker` of map `mapId` is drawn with now: its draft's, or its own. */
export function drawnShape(marker: Marker, mapId: string): Shape {
    return (draft?.mapId === mapId ? draft.shapes.get(marker.id) : undefined) ?? marker;
}
