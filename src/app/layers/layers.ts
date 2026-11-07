import {
    adjacentLayer,
    deleteLayersCommand,
    duplicateLayersCommand,
    groupLayersCommand,
    moveLayerCommand,
    moveLayerToCommand,
    moveTarget,
    newLayerCommand,
    otherLayers,
    setLayerValuesCommand,
    toggleOtherLayersCommand,
    ungroupCommand,
} from "../../core/layers";
import type { Command } from "../../core/history";
import type { LayerValues, NewLayerKind } from "../../core/layers";
import { MAX_LAYERS, createMapSession, findLayer, walkLayers } from "../../core/model";
import type { Layer, ProjectMap } from "../../core/model";
import { sessionStore } from "../state/session";
import { tabsAvailable } from "../tabs/tabs";
import { activeLayerId, activeMap as activeMapOf } from "../tools/toolSets";

// The layer commands of the app (SPEC §7.2; TE-034) on the app's history. They act on the
// active map, and on its active layer unless a layer is named: the Layers panel (TE-035) names
// the layers it acts on. A refused command throws its `LayerEditError` with the project
// unchanged; the command registry reports it in an error toast. Select Layer Above and Below
// change the active layer, which is session state and not a history step (Tiled's current layer).

/** The active map; null when no map is shown. */
export function activeMap(): ProjectMap | null {
    return activeMapOf(sessionStore.getState().session);
}

/** The active map's active layer; null when there is none. */
export function currentLayer(): Layer | null {
    const map = activeMap();
    if (!map) return null;
    return findLayer(map, activeLayerId(sessionStore.getState().session, map))?.layer ?? null;
}

/** Whether the history can take a layer command now: a map is shown and no stroke is open. */
export function layersIdle(): boolean {
    return activeMap() !== null && tabsAvailable();
}

/** The layers of the active map, groups included. */
export function layerCount(): number {
    const map = activeMap();
    return map ? [...walkLayers(map.layers)].length : 0;
}

/** Whether a layer can be added to the active map: fewer than 256 layers. */
export function canAddLayer(): boolean {
    return layersIdle() && layerCount() < MAX_LAYERS;
}

function execute(command: Command): void {
    sessionStore.getState().history.execute(command);
}

/** The IDs to act on: `ids` when given, else the active layer's. */
function chosen(ids?: readonly number[]): number[] {
    if (ids) return [...ids];
    const layer = currentLayer();
    return layer ? [layer.id] : [];
}

/**
 * Adds a layer of `kind` above the active layer of the active map and makes it active. Returns
 * its ID, or null without a map.
 */
export function newLayer(kind: NewLayerKind): number | null {
    const map = activeMap();
    if (!map) return null;
    execute(newLayerCommand(map.id, kind));
    return activeLayerId(sessionStore.getState().session, map);
}

/** Group Layers: wraps the layers (the active one by default) in a new group. */
export function groupLayers(ids?: readonly number[]): boolean {
    const map = activeMap();
    const layers = chosen(ids);
    if (!map || layers.length === 0) return false;
    execute(groupLayersCommand(map.id, layers));
    return true;
}

/** Whether Ungroup can act on the active layer: it is a group or inside one. */
export function canUngroup(): boolean {
    const map = activeMap();
    const layer = currentLayer();
    if (!map || !layer) return false;
    return layer.type === "group" || findLayer(map, layer.id)!.ancestors.length > 0;
}

/** Ungroup: the layers' groups (the active layer's by default) give up their children. */
export function ungroup(ids?: readonly number[]): boolean {
    const map = activeMap();
    const layers = chosen(ids);
    if (!map || layers.length === 0) return false;
    execute(ungroupCommand(map.id, layers));
    return true;
}

/** Duplicates the layers (the active one by default); the copy becomes active. */
export function duplicateLayers(ids?: readonly number[]): boolean {
    const map = activeMap();
    const layers = chosen(ids);
    if (!map || layers.length === 0) return false;
    execute(duplicateLayersCommand(sessionStore.getState().session.project, map.id, layers));
    return true;
}

/** Whether the active layer can be deleted: the map keeps another layer outside it. */
export function canDeleteLayer(): boolean {
    const map = activeMap();
    const layer = currentLayer();
    if (!map || !layer) return false;
    const inside = layer.type === "group" ? [...walkLayers(layer.layers)].length : 0;
    return layerCount() - 1 - inside > 0;
}

/** Deletes the layers (the active one by default), without asking: undo restores them. */
export function deleteLayers(ids?: readonly number[]): boolean {
    const map = activeMap();
    const layers = chosen(ids);
    if (!map || layers.length === 0) return false;
    execute(deleteLayersCommand(sessionStore.getState().session.project, map.id, layers));
    return true;
}

/**
 * Sets `values` on the layers (the active one by default); one history entry. Returns false,
 * with no entry, when every value is already what it would be set to.
 */
export function setLayerValues(values: Partial<LayerValues>, ids?: readonly number[]): boolean {
    const map = activeMap();
    const layers = chosen(ids);
    if (!map || layers.length === 0) return false;
    const unchanged = layers.every((id) => {
        const layer = findLayer(map, id)?.layer;
        return (
            layer !== undefined &&
            (Object.keys(values) as (keyof LayerValues)[]).every(
                (key) => values[key] === undefined || layer[key] === values[key],
            )
        );
    });
    if (unchanged) return false;
    execute(setLayerValuesCommand(sessionStore.getState().session.project, map.id, layers, values));
    return true;
}

/** Renames layer `id` (the active layer by default). */
export function renameLayer(name: string, id?: number): boolean {
    return setLayerValues({ name }, id === undefined ? undefined : [id]);
}

/** Whether the active layer can move one step up (`1`) or down (`-1`). */
export function canMoveLayer(step: -1 | 1): boolean {
    const map = activeMap();
    const layer = currentLayer();
    return map !== null && layer !== null && moveTarget(map, layer.id, step) !== null;
}

/** Move Layer Up (`1`) or Down (`-1`), into and out of groups as Tiled. */
export function moveLayer(step: -1 | 1, id = currentLayer()?.id): boolean {
    const map = activeMap();
    if (!map || id === undefined) return false;
    execute(moveLayerCommand(map.id, id, step));
    return true;
}

/** Moves layer `id` into group `parentId` (null: the top of the map) at `index`: a drag. */
export function moveLayerTo(id: number, parentId: number | null, index: number): boolean {
    const map = activeMap();
    if (!map) return false;
    execute(moveLayerToCommand(map.id, id, parentId, index));
    return true;
}

/** Whether the active layer has a layer above (`1`) or below (`-1`) it to select. */
export function canSelectLayer(step: -1 | 1): boolean {
    const map = activeMap();
    const layer = currentLayer();
    return map !== null && layer !== null && adjacentLayer(map, layer.id, step) !== null;
}

/** Makes layer `id` of the active map the active layer: session state, no history entry. */
export function selectLayer(id: number): boolean {
    const state = sessionStore.getState();
    const map = activeMap();
    if (!map || !findLayer(map, id)) return false;
    let mapSession = state.session.perMap.get(map.id);
    if (!mapSession) {
        mapSession = createMapSession(map);
        state.session.perMap.set(map.id, mapSession);
    }
    if (mapSession.activeLayerId === id) return false;
    mapSession.activeLayerId = id;
    state.touch();
    return true;
}

/** Select Layer Above (`1`) or Below (`-1`), in Tiled's layer order (groups after children). */
export function selectAdjacentLayer(step: -1 | 1): boolean {
    const map = activeMap();
    const layer = currentLayer();
    if (!map || !layer) return false;
    const next = adjacentLayer(map, layer.id, step);
    return next !== null && selectLayer(next.id);
}

/** Whether the active layer has other layers for Show/Hide and Lock/Unlock Other Layers. */
export function hasOtherLayers(): boolean {
    const map = activeMap();
    const layer = currentLayer();
    return map !== null && layer !== null && otherLayers(map, [layer.id]).length > 0;
}

/** Show/Hide (`"visible"`) or Lock/Unlock (`"locked"`) Other Layers of the active layer. */
export function toggleOtherLayers(flag: "visible" | "locked", ids?: readonly number[]): boolean {
    const map = activeMap();
    const layers = chosen(ids);
    if (!map || layers.length === 0) return false;
    const command = toggleOtherLayersCommand(
        sessionStore.getState().session.project,
        map.id,
        layers,
        flag,
    );
    if (!command) return false;
    execute(command);
    return true;
}
