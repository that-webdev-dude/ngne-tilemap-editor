import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Command } from "../../core/history";
import { LayerEditError, setLayerValuesCommand } from "../../core/layers";
import type { LayerValues } from "../../core/layers";
import { MapEditError, setMapFieldsCommand } from "../../core/maps";
import {
    MarkerEditError,
    findMarker,
    moveMarkersCommand,
    renameMarkersCommand,
    resizeMarkerCommand,
    setMarkerClassCommand,
} from "../../core/markers";
import {
    MAX_LAYER_OFFSET,
    MAX_MARKER_COORD,
    MAX_PARALLAX,
    MAX_TILE_OFFSET,
    findLayer,
    shapeBox,
} from "../../core/model";
import type {
    Marker,
    Project,
    ProjectSession,
    Property,
    PropertyType,
    Tile,
} from "../../core/model";
import {
    PropertyEditError,
    addPropertyCommand,
    changePropertyTypeCommand,
    commonProperties,
    propertyNameProblem,
    propertyOwners,
    removePropertyCommand,
    renamePropertyCommand,
    setProjectFieldsCommand,
    setPropertyValueCommand,
    setTilesClassCommand,
} from "../../core/properties";
import type { CommonProperty, PropertyTarget } from "../../core/properties";
import { TilesetEditError, setTilesetFieldsCommand } from "../../core/tileset";
import type { TilesetFields } from "../../core/tileset";
import { selectedMarkerIds } from "../markers/markerSelection";
import { notices } from "../notices/notices";
import { sessionStore } from "../state/session";
import { tilesetRenameStore } from "../tilesets/edit/tilesetEdit";
import { selectedTiles, shownTileset, tilesetPanelStore } from "../tilesets/panel/tilesetPanel";
import { activeLayerId, activeMap } from "../tools/toolSets";
import { toolPipeline } from "../tools/appPipeline";

// The Properties panel (SPEC §9, DESIGN §8.3; TE-040): what it shows and the edits it makes.
//
// What is shown, as Tiled's Properties view follows its document's current object (v1.12.2):
// the selected markers of the active map, else the tiles selected in the Tilesets panel while
// the tiles have the focus, else the active layer, else the active map. The tiles take the
// focus when the Tilesets panel takes the keyboard focus or its selection changes, or from
// the tile menu's Properties; they lose it when the active map, the active layer or the marker
// selection changes, or the focus enters the Maps or Layers section (Tiled's
// `MapDocument::setCurrentObject` calls). The project and the shown tileset are shown from the
// panel's menu (Show Project Properties, Show Tileset Properties) until the selection changes.
//
// Every edit is one command on the history (SPEC §9); a refused one changes nothing and is
// reported in an error toast.

/** The project and the tileset, shown from the menu until the selection changes. */
export type PinnedSubject = "project" | "tileset";

export interface PropertiesPanelState {
    /** The Tilesets panel's selection is the selection (Tiled's tile as current object). */
    readonly tileFocus: boolean;
    /** Shown from the menu: what, and the selection it was chosen in (`selectionKey`). */
    readonly pinned: { readonly subject: PinnedSubject; readonly key: string } | null;
}

export const propertiesPanelStore = createStore<PropertiesPanelState>(() => ({
    tileFocus: false,
    pinned: null,
}));

export function usePropertiesPanel<Slice>(selector: (state: PropertiesPanelState) => Slice): Slice {
    return useStore(propertiesPanelStore, selector);
}

/** Whether the history can take a command now: not during a stroke. */
const historyIdle = (): boolean =>
    !sessionStore.getState().history.transaction && !toolPipeline.stroking;

/** The selected tiles of the shown tileset as a target; null without any. */
function tilesTarget(project: Project): PropertyTarget | null {
    const tileset = shownTileset(project, tilesetPanelStore.getState());
    if (!tileset) return null;
    const tiles = selectedTiles(tileset);
    if (tiles.length === 0) return null;
    return { kind: "tiles", tilesetId: tileset.id, tileIds: tiles.map((tile) => tile.id) };
}

/**
 * What the selection shows (SPEC §9): the selected markers, else the selected tiles while they
 * have the focus, else the active layer, else the active map; null without a map.
 */
export function selectionTarget(
    session: ProjectSession,
    tileFocus: boolean,
): PropertyTarget | null {
    const map = activeMap(session);
    if (map) {
        const markerIds = selectedMarkerIds(session, map);
        if (markerIds.length > 0) return { kind: "markers", mapId: map.id, markerIds };
    }
    if (tileFocus) {
        const tiles = tilesTarget(session.project);
        if (tiles) return tiles;
    }
    if (!map) return null;
    const layerId = activeLayerId(session, map);
    if (findLayer(map, layerId)) return { kind: "layer", mapId: map.id, layerId };
    return { kind: "map", mapId: map.id };
}

/** A text naming the selection; a pin holds while it stays the same. */
export function selectionKey(session: ProjectSession, tileFocus: boolean): string {
    const target = selectionTarget(session, tileFocus);
    const tileset = shownTileset(session.project, tilesetPanelStore.getState());
    return JSON.stringify([target, tileset?.id ?? null]);
}

/** What the panel shows now: a pinned subject while the selection is unchanged, else it. */
export function shownTarget(
    session: ProjectSession = sessionStore.getState().session,
): PropertyTarget | null {
    const { tileFocus, pinned } = propertiesPanelStore.getState();
    if (pinned && pinned.key === selectionKey(session, tileFocus)) {
        if (pinned.subject === "project") return { kind: "project" };
        const tileset = shownTileset(session.project, tilesetPanelStore.getState());
        if (tileset) return { kind: "tileset", tilesetId: tileset.id };
    }
    return selectionTarget(session, tileFocus);
}

/** The header text of `target` (DESIGN §8.3): "Marker · exit", "3 tiles", "Layer · Ground". */
export function targetTitle(project: Project, target: PropertyTarget): string {
    const named = (kind: string, name: string) => (name === "" ? kind : `${kind} · ${name}`);
    switch (target.kind) {
        case "project":
            return named("Project", project.name);
        case "tileset":
        case "tiles": {
            const tileset = project.tilesets.find((each) => each.id === target.tilesetId);
            if (target.kind === "tileset") return named("Tileset", tileset?.name ?? "");
            const count = new Set(target.tileIds).size;
            return count === 1
                ? `Tile · ${tileset?.name ?? ""}#${target.tileIds[0]}`
                : `${count} tiles`;
        }
        case "map":
            return named("Map", project.maps.find((each) => each.id === target.mapId)?.name ?? "");
        case "layer": {
            const map = project.maps.find((each) => each.id === target.mapId);
            const layer = map ? findLayer(map, target.layerId)?.layer : undefined;
            return named("Layer", layer?.name ?? "");
        }
        case "markers": {
            const count = new Set(target.markerIds).size;
            if (count !== 1) return `${count} markers`;
            const map = project.maps.find((each) => each.id === target.mapId);
            const marker = map ? findMarker(map, target.markerIds[0]!)?.marker : undefined;
            return named("Marker", marker?.name ?? "");
        }
    }
}

/** The custom properties `target` shows: common to all its items (SPEC §9). */
export function targetProperties(project: Project, target: PropertyTarget): CommonProperty[] {
    try {
        return commonProperties(propertyOwners(project, target).map((owner) => owner.properties));
    } catch (error) {
        if (error instanceof PropertyEditError) return [];
        throw error;
    }
}

// ---------------------------------------------------------------------------------------------
// Focus and pins

/** Gives the tiles the focus, or takes it from them. */
export function setTileFocus(tileFocus: boolean): void {
    if (propertiesPanelStore.getState().tileFocus !== tileFocus) {
        propertiesPanelStore.setState({ tileFocus });
    }
}

/** Shows `subject` until the selection changes. */
export function pinSubject(subject: PinnedSubject): boolean {
    const { session } = sessionStore.getState();
    if (subject === "tileset" && !shownTileset(session.project, tilesetPanelStore.getState())) {
        return false;
    }
    const key = selectionKey(session, propertiesPanelStore.getState().tileFocus);
    propertiesPanelStore.setState({ pinned: { subject, key } });
    return true;
}

/** Shows the selection again (Show Selection). */
export function unpin(): void {
    if (propertiesPanelStore.getState().pinned) propertiesPanelStore.setState({ pinned: null });
}

/** Whether the panel shows a pinned subject now. */
export function pinnedSubject(): PinnedSubject | null {
    const target = shownTarget();
    return target?.kind === "project" || target?.kind === "tileset" ? target.kind : null;
}

// The signals of the tile focus (above). Each compares with what it saw last, so the session's
// many other changes (pans, zooms) leave the focus alone.
{
    const selectionOf = (session: ProjectSession) => {
        const map = activeMap(session);
        if (!map) return "";
        return JSON.stringify([
            map.id,
            activeLayerId(session, map),
            selectedMarkerIds(session, map),
        ]);
    };
    let lastSelection = selectionOf(sessionStore.getState().session);
    let lastSession = sessionStore.getState().session;
    sessionStore.subscribe(({ session }) => {
        const next = selectionOf(session);
        if (session !== lastSession) {
            // Another project: the panel starts afresh.
            lastSession = session;
            propertiesPanelStore.setState({ tileFocus: false, pinned: null });
        } else if (next !== lastSelection) {
            setTileFocus(false);
        }
        lastSelection = next;
    });
    tilesetPanelStore.subscribe((state, previous) => {
        // A selection made in the panel; the panel emptied for another project is none.
        if (state.selections !== previous.selections && Object.keys(state.selections).length > 0) {
            setTileFocus(true);
        }
    });
    tilesetRenameStore.subscribe((state, previous) => {
        if (state.panelFocused && !previous.panelFocused) setTileFocus(true);
    });
    // A pin ends at the first change of the selection: going back to the selection it was
    // made in does not show the pinned subject again.
    const dropStalePin = () => {
        const { pinned, tileFocus } = propertiesPanelStore.getState();
        if (pinned && pinned.key !== selectionKey(sessionStore.getState().session, tileFocus)) {
            propertiesPanelStore.setState({ pinned: null });
        }
    };
    sessionStore.subscribe(dropStalePin);
    tilesetPanelStore.subscribe(dropStalePin);
    propertiesPanelStore.subscribe(dropStalePin);
}

// ---------------------------------------------------------------------------------------------
// Edits

const EDIT_ERRORS = [
    PropertyEditError,
    LayerEditError,
    MapEditError,
    MarkerEditError,
    TilesetEditError,
] as const;

/**
 * Executes the command `make` builds for the shown target; returns whether a step was made. A
 * refusal changes nothing and is reported in an error toast.
 */
function edit(make: (project: Project, target: PropertyTarget) => Command | null): boolean {
    if (!historyIdle()) return false;
    const { session, history } = sessionStore.getState();
    const target = shownTarget(session);
    if (!target) return false;
    try {
        const command = make(session.project, target);
        if (!command) return false;
        history.execute(command);
        return true;
    } catch (error) {
        if (EDIT_ERRORS.some((kind) => error instanceof kind)) {
            notices.error((error as Error).message);
            return false;
        }
        throw error;
    }
}

/**
 * Why a property named `name` cannot be added to the shown items (Add popover); null when it
 * can.
 */
export function addPropertyProblem(name: string): string | null {
    const problem = propertyNameProblem(name);
    if (problem) return problem;
    const { session } = sessionStore.getState();
    const target = shownTarget(session);
    if (!target) return "Nothing is selected.";
    const taken = propertyOwners(session.project, target).some((owner) =>
        owner.properties.some((each) => each.name === name),
    );
    return taken ? `The property “${name}” exists.` : null;
}

/** Add (DESIGN §8.3): a property of `type` with the type's default value on every shown item. */
export function addProperty(name: string, type: PropertyType): boolean {
    return edit((project, target) => addPropertyCommand(project, target, name, type));
}

export function renameProperty(name: string, newName: string): boolean {
    if (newName === name) return false;
    return edit((project, target) => renamePropertyCommand(project, target, name, newName));
}

export function changePropertyType(name: string, type: PropertyType): boolean {
    return edit((project, target) => {
        const current = targetProperties(project, target).find((each) => each.name === name);
        if (current?.type === type) return null;
        return changePropertyTypeCommand(project, target, name, type);
    });
}

/** Sets property `name` to `value` on every shown item (SPEC §9: editing sets it on all). */
export function setPropertyValue(
    name: string,
    type: PropertyType,
    value: Property["value"],
): boolean {
    return edit((project, target) => setPropertyValueCommand(project, target, name, type, value));
}

export function removeProperty(name: string): boolean {
    return edit((project, target) => removePropertyCommand(project, target, name));
}

// ---------------------------------------------------------------------------------------------
// Built-in fields

/** A built-in field of the shown items (DESIGN §8.3: name, class, and the kind's own fields). */
export type BuiltinField =
    | {
          key: string;
          label: string;
          kind: "text";
          value: string;
          mixed: boolean;
      }
    | {
          key: string;
          label: string;
          kind: "number";
          value: number;
          mixed: boolean;
          min: number;
          max: number;
          /** Whole numbers only. */
          integer: boolean;
      }
    | { key: string; label: string; kind: "readonly"; value: string };

const text = (key: string, label: string, values: readonly string[]): BuiltinField => ({
    key,
    label,
    kind: "text",
    value: values[0] ?? "",
    mixed: values.some((value) => value !== values[0]),
});

const num = (
    key: string,
    label: string,
    value: number,
    range: { min: number; max: number; integer?: boolean },
): BuiltinField => ({
    key,
    label,
    kind: "number",
    value,
    mixed: false,
    min: range.min,
    max: range.max,
    integer: range.integer ?? false,
});

const shown = (key: string, label: string, value: string): BuiltinField => ({
    key,
    label,
    kind: "readonly",
    value,
});

const SHAPE_NAMES = {
    rectangle: "Rectangle",
    ellipse: "Ellipse",
    point: "Point",
    polygon: "Polygon",
    polyline: "Polyline",
} as const;

const LAYER_TYPE_NAMES = {
    tile: "Tile layer",
    marker: "Marker layer",
    image: "Image layer",
    group: "Group",
} as const;

/** The built-in fields of `target` in `project`, in panel order. */
export function builtinFields(project: Project, target: PropertyTarget): BuiltinField[] {
    switch (target.kind) {
        case "project":
            return [
                text("name", "Name", [project.name]),
                text("exportName", "Export name", [project.exportName]),
            ];
        case "tileset": {
            const tileset = project.tilesets.find((each) => each.id === target.tilesetId);
            if (!tileset) return [];
            const offset = { min: -MAX_TILE_OFFSET, max: MAX_TILE_OFFSET, integer: true };
            return [
                text("name", "Name", [tileset.name]),
                text("exportName", "Export name", [tileset.exportName]),
                text("class", "Class", [tileset.class]),
                shown("tileSize", "Tile size", `${tileset.tileWidth} × ${tileset.tileHeight}`),
                num("offsetX", "Offset X", tileset.offsetX, offset),
                num("offsetY", "Offset Y", tileset.offsetY, offset),
            ];
        }
        case "tiles": {
            const tiles = propertyOwners(project, target) as Tile[];
            const fields: BuiltinField[] = [];
            if (tiles.length === 1) fields.push(shown("id", "ID", String(tiles[0]!.id)));
            fields.push(
                text(
                    "class",
                    "Class",
                    tiles.map((tile) => tile.class),
                ),
            );
            return fields;
        }
        case "map": {
            const map = project.maps.find((each) => each.id === target.mapId);
            if (!map) return [];
            return [
                text("name", "Name", [map.name]),
                text("exportName", "Export name", [map.exportName]),
                text("class", "Class", [map.class]),
                shown("size", "Size", `${map.width} × ${map.height} cells`),
                shown("tileSize", "Tile size", `${map.tileWidth} × ${map.tileHeight}`),
            ];
        }
        case "layer": {
            const map = project.maps.find((each) => each.id === target.mapId);
            const layer = map ? findLayer(map, target.layerId)?.layer : undefined;
            if (!layer) return [];
            const offset = { min: -MAX_LAYER_OFFSET, max: MAX_LAYER_OFFSET };
            const parallax = { min: -MAX_PARALLAX, max: MAX_PARALLAX };
            return [
                text("name", "Name", [layer.name]),
                text("class", "Class", [layer.class]),
                shown("type", "Type", LAYER_TYPE_NAMES[layer.type]),
                num("opacity", "Opacity", layer.opacity, { min: 0, max: 255, integer: true }),
                num("offsetX", "Offset X", layer.offsetX, offset),
                num("offsetY", "Offset Y", layer.offsetY, offset),
                num("parallaxX", "Parallax X", layer.parallaxX, parallax),
                num("parallaxY", "Parallax Y", layer.parallaxY, parallax),
            ];
        }
        case "markers": {
            const markers = markersOf(project, target);
            const fields = [
                text(
                    "name",
                    "Name",
                    markers.map((marker) => marker.name),
                ),
                text(
                    "class",
                    "Class",
                    markers.map((marker) => marker.class),
                ),
            ];
            const [marker] = markers;
            if (markers.length !== 1 || !marker) return fields;
            const coord = { min: -MAX_MARKER_COORD, max: MAX_MARKER_COORD };
            fields.push(
                shown("shape", "Shape", SHAPE_NAMES[marker.shape]),
                num("x", "X", marker.x, coord),
                num("y", "Y", marker.y, coord),
            );
            if (marker.shape === "rectangle" || marker.shape === "ellipse") {
                const size = { min: 0, max: 2 * MAX_MARKER_COORD };
                fields.push(
                    num("width", "Width", marker.width, size),
                    num("height", "Height", marker.height, size),
                );
            }
            return fields;
        }
    }
}

function markersOf(project: Project, target: PropertyTarget & { kind: "markers" }) {
    try {
        return propertyOwners(project, target) as Marker[];
    } catch (error) {
        if (error instanceof PropertyEditError) return [];
        throw error;
    }
}

/** The command that sets built-in field `key` of `target` to `value`; null when unchanged. */
function builtinCommand(
    project: Project,
    target: PropertyTarget,
    key: string,
    value: string | number,
): Command | null {
    switch (target.kind) {
        case "project":
            return project[key as "name" | "exportName"] === value
                ? null
                : setProjectFieldsCommand({ [key]: value });
        case "tileset": {
            const tileset = project.tilesets.find((each) => each.id === target.tilesetId);
            if (!tileset || tileset[key as keyof TilesetFields] === value) return null;
            return setTilesetFieldsCommand(target.tilesetId, { [key]: value });
        }
        case "tiles":
            return setTilesClassCommand(project, target.tilesetId, target.tileIds, value as string);
        case "map": {
            const map = project.maps.find((each) => each.id === target.mapId);
            if (!map || map[key as "name" | "exportName" | "class"] === value) return null;
            return setMapFieldsCommand(target.mapId, { [key]: value });
        }
        case "layer":
            return setLayerValuesCommand(project, target.mapId, [target.layerId], {
                [key]: value,
            } as Partial<LayerValues>);
        case "markers": {
            const ids = target.markerIds;
            if (key === "name")
                return renameMarkersCommand(project, target.mapId, ids, value as string);
            if (key === "class") {
                return setMarkerClassCommand(project, target.mapId, ids, value as string);
            }
            const [marker] = markersOf(project, target);
            if (!marker) return null;
            const amount = value as number;
            if (key === "x" || key === "y") {
                const dx = key === "x" ? amount - marker.x : 0;
                const dy = key === "y" ? amount - marker.y : 0;
                if (dx === 0 && dy === 0) return null;
                return moveMarkersCommand(project, target.mapId, [marker.id], dx, dy);
            }
            const box = shapeBox(marker);
            if (box[key as "width" | "height"] === amount) return null;
            return resizeMarkerCommand(project, target.mapId, marker.id, { ...box, [key]: amount });
        }
    }
}

/** Sets built-in field `key` of the shown items to `value`, one undo step. */
export function setBuiltinField(key: string, value: string | number): boolean {
    return edit((project, target) => builtinCommand(project, target, key, value));
}
