import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { sessionStore } from "../state/session";
import { viewPreferences } from "../view/viewPreferences";
import { watchEnvelope } from "./envelopeWarning";
import {
    canAddLayer,
    canDeleteLayer,
    canMoveLayer,
    canSelectLayer,
    canUngroup,
    currentLayer,
    deleteLayers,
    duplicateLayers,
    groupLayers,
    hasOtherLayers,
    layersIdle,
    moveLayer,
    newLayer,
    selectAdjacentLayer,
    toggleOtherLayers,
    ungroup,
} from "./layers";

// The layer commands of the Layer menu (DESIGN §5; SPEC §7.2), on the active layer of the active
// map, as Tiled's layer actions act on the current layer. Keys are DESIGN §10.3: Shift+N new tile
// layer, Ctrl+Shift+D duplicate, Ctrl+Shift+↑/↓ move, ↑/↓ select the layer above or below while
// the viewport has focus (a native key's `canvas` binding acts only there) and no markers are
// selected (the `markers` context takes the arrows then). Rename Layer and Layer Properties…
// need the Layers panel and its popover (TE-035), New Image Layer… the image layers (TE-036):
// their menu items stay planned.
//
// Highlight Current Layer (Shift+H) is a view preference (SPEC §3), as Show Grid: its title says
// what choosing it does.

const hasLayer = () => layersIdle() && currentLayer() !== null;

const noMarkerSelection = () => {
    const { session } = sessionStore.getState();
    return (session.perMap.get(session.activeMapId)?.markerSelection.length ?? 0) === 0;
};

export const commands: CommandSpec[] = [
    {
        id: "layer.newTile",
        title: "New Tile Layer",
        shortcut: "Shift+N",
        enabled: canAddLayer,
        run: () => void newLayer("tile"),
    },
    {
        id: "layer.newMarker",
        title: "New Marker Layer",
        enabled: canAddLayer,
        run: () => void newLayer("marker"),
    },
    {
        id: "layer.newGroup",
        title: "New Group",
        enabled: canAddLayer,
        run: () => void newLayer("group"),
    },
    {
        id: "layer.group",
        title: "Group Layers",
        enabled: () => hasLayer() && canAddLayer(),
        run: () => void groupLayers(),
    },
    {
        id: "layer.ungroup",
        title: "Ungroup",
        enabled: () => layersIdle() && canUngroup(),
        run: () => void ungroup(),
    },
    {
        id: "layer.duplicate",
        title: "Duplicate Layer",
        shortcut: "Ctrl+Shift+D",
        enabled: () => hasLayer() && canAddLayer(),
        run: () => void duplicateLayers(),
    },
    {
        id: "layer.delete",
        title: "Delete Layer",
        enabled: () => layersIdle() && canDeleteLayer(),
        run: () => void deleteLayers(),
    },
    {
        id: "layer.moveUp",
        title: "Move Layer Up",
        shortcut: "Ctrl+Shift+ArrowUp",
        enabled: () => layersIdle() && canMoveLayer(1),
        run: () => void moveLayer(1),
    },
    {
        id: "layer.moveDown",
        title: "Move Layer Down",
        shortcut: "Ctrl+Shift+ArrowDown",
        enabled: () => layersIdle() && canMoveLayer(-1),
        run: () => void moveLayer(-1),
    },
    {
        id: "layer.selectAbove",
        title: "Select Layer Above",
        shortcut: "ArrowUp",
        context: "canvas",
        enabled: () => layersIdle() && noMarkerSelection() && canSelectLayer(1),
        run: () => void selectAdjacentLayer(1),
    },
    {
        id: "layer.selectBelow",
        title: "Select Layer Below",
        shortcut: "ArrowDown",
        context: "canvas",
        enabled: () => layersIdle() && noMarkerSelection() && canSelectLayer(-1),
        run: () => void selectAdjacentLayer(-1),
    },
    {
        id: "layer.toggleOthers",
        title: "Show/Hide Other Layers",
        enabled: () => layersIdle() && hasOtherLayers(),
        run: () => void toggleOtherLayers("visible"),
    },
    {
        id: "layer.lockOthers",
        title: "Lock/Unlock Other Layers",
        enabled: () => layersIdle() && hasOtherLayers(),
        run: () => void toggleOtherLayers("locked"),
    },
    {
        id: "view.highlightLayer",
        title: () =>
            viewPreferences.getState().highlightLayer
                ? "Stop Highlighting Current Layer"
                : "Highlight Current Layer",
        shortcut: "Shift+H",
        context: "canvas",
        run: () => viewPreferences.getState().toggle("highlightLayer"),
    },
];

// The title of Highlight Current Layer follows the preference; an open View menu is told.
viewPreferences.subscribe(() => appCommands.refresh());

// The D1 envelope warning, once per map (SPEC §7.2).
watchEnvelope(sessionStore);
