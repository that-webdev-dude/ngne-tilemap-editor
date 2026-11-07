import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { LayerEditError, layerNameProblem } from "../../core/layers";
import type { Command } from "../../core/history";
import { findLayer } from "../../core/model";
import type { Layer, Project } from "../../core/model";
import { PANEL_SELECTOR } from "../keymap/environment";
import { notices } from "../notices/notices";
import { sessionStore } from "../state/session";
import {
    activeMap,
    currentLayer,
    layersIdle,
    moveLayerTo,
    renameLayer,
    selectLayer,
    setLayerValues,
} from "./layers";
import { dropPlace, layerPropertiesCommand, layerPropertiesValues } from "./layerTree";
import type { DropZone, LayerPropertiesValues } from "./layerTree";

// The state of the Layers dock section (DESIGN §8.2; TE-035) that commands read, and the edits
// it makes. Which groups are collapsed (per map), which row has the keyboard focus (F2 renames
// that layer, DESIGN §10.3), the rename in progress, and the draft of the layer properties
// popover. A double click or F2 turns a row's name into a field with the sprite editor's rename
// rules (its DESIGN §5.6): Enter or leaving the field applies the name, one undo step; Escape
// keeps the old one. A blank name is applied, as Tiled's layer names may be empty. The popover changes nothing until it closes; then its
// changed fields are one undo step (`layerPropertiesCommand`). A drag dropped on a row moves the
// layer as one undo step (`dropPlace`).

/** The draft of the layer properties popover. */
export interface LayerPropertiesDraft extends LayerPropertiesValues {
    readonly mapId: string;
    readonly layerId: number;
    /** Values of kind-specific fields (TE-036, TE-037) the user changed, by field id. */
    readonly extras: Readonly<Record<string, unknown>>;
}

export interface LayersPanelState {
    /** Collapsed groups, by map. */
    readonly collapsed: ReadonlyMap<string, ReadonlySet<number>>;
    /** The layer whose row has the keyboard focus; null while the focus is outside the tree. */
    readonly focusedId: number | null;
    /** The rename in progress: the layer and the text of its field; null when none is. */
    readonly renaming: { readonly id: number; readonly text: string } | null;
    /** The open layer properties popover; null when none is. */
    readonly properties: LayerPropertiesDraft | null;
    /** How many Layers panels are mounted (the dock section is expanded). */
    readonly mounted: number;
}

export const layersPanelStore = createStore<LayersPanelState>(() => ({
    collapsed: new Map(),
    focusedId: null,
    renaming: null,
    properties: null,
    mounted: 0,
}));

export function useLayersPanel<Slice>(selector: (state: LayersPanelState) => Slice): Slice {
    return useStore(layersPanelStore, selector);
}

const NO_GROUPS: ReadonlySet<number> = new Set();

/** The collapsed groups of map `mapId`. */
export function collapsedGroups(mapId: string): ReadonlySet<number> {
    return layersPanelStore.getState().collapsed.get(mapId) ?? NO_GROUPS;
}

/** Collapses (`true`) or expands group `id` of the active map. */
export function setGroupCollapsed(id: number, collapsed: boolean): void {
    const map = activeMap();
    if (!map) return;
    const groups = new Set(collapsedGroups(map.id));
    if (groups.has(id) === collapsed) return;
    if (collapsed) groups.add(id);
    else groups.delete(id);
    const all = new Map(layersPanelStore.getState().collapsed);
    all.set(map.id, groups);
    layersPanelStore.setState({ collapsed: all });
}

/** Expands the groups above layer `id` of the active map, so its row is shown. */
function reveal(id: number): void {
    const map = activeMap();
    const entry = map ? findLayer(map, id) : undefined;
    for (const group of entry?.ancestors ?? []) setGroupCollapsed(group.id, false);
}

/** Tells the app that a Layers panel was mounted (`true`) or unmounted. */
export function setLayersPanelMounted(mounted: boolean): void {
    const count = layersPanelStore.getState().mounted + (mounted ? 1 : -1);
    layersPanelStore.setState(
        count > 0
            ? { mounted: count }
            : { mounted: 0, focusedId: null, renaming: null, properties: null },
    );
}

/** Whether the Layers dock section is shown. */
export function layersPanelShown(): boolean {
    return layersPanelStore.getState().mounted > 0;
}

/** Tells the app which layer's row has the keyboard focus (null: the focus left the tree). */
export function setFocusedLayerRow(focusedId: number | null): void {
    if (layersPanelStore.getState().focusedId !== focusedId) {
        layersPanelStore.setState({ focusedId });
    }
}

/** The layer of the active map whose row has the focus; null when no row has it. */
export function focusedLayer(): number | null {
    const { focusedId } = layersPanelStore.getState();
    const map = activeMap();
    return focusedId !== null && map && findLayer(map, focusedId) ? focusedId : null;
}

/**
 * Whether the keyboard focus is in another panel (Maps list, Tilesets panel): F2 is that
 * panel's there, so Rename Layer's chord does not apply (DESIGN §10.3).
 */
function focusInOtherPanel(): boolean {
    if (typeof document === "undefined") return false;
    const focused = document.activeElement;
    return (
        focused !== null &&
        focused.closest(PANEL_SELECTOR) !== null &&
        focused.closest("[data-layers-panel]") === null
    );
}

/** The layer Rename Layer and Layer Properties… act on: the focused row's, else the active. */
export function targetLayer(): Layer | null {
    const id = focusedLayer();
    const map = activeMap();
    if (id !== null && map) return findLayer(map, id)?.layer ?? null;
    return currentLayer();
}

/** Whether Rename Layer can start now (`layer.rename`). */
export function canRenameLayer(): boolean {
    const { renaming, properties } = layersPanelStore.getState();
    return (
        layersPanelShown() &&
        layersIdle() &&
        renaming === null &&
        properties === null &&
        targetLayer() !== null &&
        !focusInOtherPanel()
    );
}

/** Starts renaming layer `id` of the active map in place. Returns false when it cannot. */
export function startLayerRename(id: number): boolean {
    const map = activeMap();
    const layer = map ? findLayer(map, id)?.layer : undefined;
    if (!layer || !layersIdle()) return false;
    reveal(id);
    layersPanelStore.setState({ renaming: { id, text: layer.name } });
    return true;
}

export function setLayerRenameText(text: string): void {
    const { renaming } = layersPanelStore.getState();
    if (renaming) layersPanelStore.setState({ renaming: { ...renaming, text } });
}

/** Ends the rename and keeps the old name. */
export function cancelLayerRename(): void {
    if (layersPanelStore.getState().renaming) layersPanelStore.setState({ renaming: null });
}

/**
 * Ends the rename and applies the typed name: one undo step when it differs from the name and
 * is a valid one (blank included, as in Tiled). Returns whether the name changed.
 */
export function applyLayerRename(): boolean {
    const { renaming } = layersPanelStore.getState();
    if (!renaming) return false;
    layersPanelStore.setState({ renaming: null });
    if (layerNameProblem(renaming.text) || !layersIdle()) return false;
    try {
        return renameLayer(renaming.text, renaming.id);
    } catch (error) {
        // Called from the field, not the registry: a refused name keeps the old one.
        if (error instanceof LayerEditError) return false;
        throw error;
    }
}

/** Makes layer `id` the active layer (a click on its row, Enter). */
export function activateLayer(id: number): boolean {
    return selectLayer(id);
}

/** Shows (`visible`) or locks (`locked`) layer `id` or the opposite: one undo step. */
export function toggleLayerFlag(id: number, flag: "visible" | "locked"): boolean {
    const map = activeMap();
    const layer = map ? findLayer(map, id)?.layer : undefined;
    if (!layer || !layersIdle()) return false;
    return setLayerValues({ [flag]: !layer[flag] }, [id]);
}

/**
 * Moves layer `id` to where a drop in `zone` of layer `targetId`'s row puts it: one undo step.
 * `expanded` says whether a target group's children count as shown (the default: as the panel
 * shows them). Returns false when the drop moves nothing; a move the limits refuse (groups 16
 * deep) is reported in an error toast with the project unchanged.
 */
export function dropLayer(
    id: number,
    targetId: number,
    zone: DropZone,
    expanded?: boolean,
): boolean {
    const map = activeMap();
    if (!map || !layersIdle()) return false;
    expanded ??= !collapsedGroups(map.id).has(targetId);
    const place = dropPlace(map, id, targetId, zone, expanded);
    if (!place) return false;
    try {
        moveLayerTo(id, place.parentId, place.index);
    } catch (error) {
        if (error instanceof LayerEditError) {
            notices.error(error.message);
            return false;
        }
        throw error;
    }
    if (place.parentId !== null) setGroupCollapsed(place.parentId, false);
    return true;
}

/** Opens the layer properties popover on layer `id` of the active map. */
export function openLayerProperties(id: number): boolean {
    const map = activeMap();
    const layer = map ? findLayer(map, id)?.layer : undefined;
    if (!map || !layer || !layersIdle()) return false;
    reveal(id);
    layersPanelStore.setState({
        renaming: null,
        properties: { mapId: map.id, layerId: id, extras: {}, ...layerPropertiesValues(layer) },
    });
    return true;
}

/** Changes fields of the open popover's draft; nothing else changes until it closes. */
export function editLayerProperties(values: Partial<LayerPropertiesValues>): void {
    const { properties } = layersPanelStore.getState();
    if (properties) layersPanelStore.setState({ properties: { ...properties, ...values } });
}

/** Sets the value of a kind-specific field (`id`) in the open popover's draft. */
export function editLayerExtra(id: string, value: unknown): void {
    const { properties } = layersPanelStore.getState();
    if (properties) {
        layersPanelStore.setState({
            properties: { ...properties, extras: { ...properties.extras, [id]: value } },
        });
    }
}

/** Builds the commands of the kind-specific fields that changed in a draft (TE-036, TE-037). */
export type LayerExtraCommands = (
    project: Project,
    draft: LayerPropertiesDraft,
    layer: Layer,
) => Command[];

/**
 * Closes the popover: the draft's changed fields become one undo step (none when nothing
 * changed). While the history cannot take it (a stroke) the popover stays open. A value the
 * limits refuse when applied (an effective offset out of range) is reported in an error toast
 * and the project is unchanged. Returns whether a step was made.
 */
export function finishLayerProperties(extra?: LayerExtraCommands): boolean {
    const { properties } = layersPanelStore.getState();
    if (!properties) return false;
    if (!layersIdle()) return false;
    layersPanelStore.setState({ properties: null });
    const { session, history } = sessionStore.getState();
    const map = session.project.maps.find((each) => each.id === properties.mapId);
    const layer = map ? findLayer(map, properties.layerId)?.layer : undefined;
    if (!layer) return false;
    try {
        const command = layerPropertiesCommand(
            session.project,
            properties.mapId,
            properties.layerId,
            properties,
            extra?.(session.project, properties, layer) ?? [],
        );
        if (!command) return false;
        history.execute(command);
        return true;
    } catch (error) {
        if (error instanceof LayerEditError) {
            notices.error(error.message);
            return false;
        }
        throw error;
    }
}

// Another project, a map switch, or the layer gone (an undo of its New Layer): the rename and
// the popover end; a popover's draft is dropped, as its layer is no longer there to take it.
sessionStore.subscribe((state) => {
    const { renaming, properties, focusedId } = layersPanelStore.getState();
    const { session } = state;
    const map = session.project.maps.find((each) => each.id === session.activeMapId);
    const has = (id: number) => map !== undefined && findLayer(map, id) !== undefined;
    const changes: { -readonly [Key in keyof LayersPanelState]?: LayersPanelState[Key] } = {};
    if (renaming && !has(renaming.id)) changes.renaming = null;
    if (properties && (properties.mapId !== session.activeMapId || !has(properties.layerId))) {
        changes.properties = null;
    }
    if (focusedId !== null && !has(focusedId)) changes.focusedId = null;
    if (Object.keys(changes).length > 0) layersPanelStore.setState(changes);
});
