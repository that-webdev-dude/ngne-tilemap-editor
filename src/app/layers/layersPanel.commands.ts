import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { layersIdle } from "./layers";
import {
    canRenameLayer,
    layersPanelShown,
    layersPanelStore,
    openLayerProperties,
    startLayerRename,
    targetLayer,
} from "./layersPanel";

// The Layer menu's Rename Layer and Layer Properties… (DESIGN §5), which act in the Layers dock
// section (DESIGN §8.2; TE-035): Rename Layer turns the name of the focused row's layer, else of
// the active layer, into a field; F2 does it while the focus is in the Layers tree (DESIGN
// §10.3), not while it is in another panel, whose F2 renames its own item. Layer Properties…
// opens the layer properties popover beside the same layer's row. Both need the Layers section
// expanded, where the field and the popover are shown. The focused row is the tree's while the
// focus is in it (F2); from the menu or the palette the focus has left it, so they act on the
// active layer.

export const commands: CommandSpec[] = [
    {
        id: "layer.rename",
        title: "Rename Layer",
        shortcut: "F2",
        context: "panel",
        enabled: canRenameLayer,
        run: () => {
            const layer = targetLayer();
            if (layer) startLayerRename(layer.id);
        },
    },
    {
        id: "layer.properties",
        title: "Layer Properties…",
        enabled: () =>
            layersPanelShown() &&
            layersIdle() &&
            targetLayer() !== null &&
            layersPanelStore.getState().properties === null,
        run: () => {
            const layer = targetLayer();
            if (layer) openLayerProperties(layer.id);
        },
    },
];

// F2 follows the focus, the rename and the popover; an open menu is told.
layersPanelStore.subscribe(() => appCommands.refresh());
