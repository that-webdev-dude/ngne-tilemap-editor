import { MAX_MAPS } from "../../core/model";
import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { sessionStore } from "../state/session";
import { editMapProperties, newMapFromDialog } from "./mapDialogs";
import { activeMap, canMoveMap, deleteMap, duplicateMap, mapsIdle, moveMap } from "./maps";
import { MAP_MENU, focusedMap, mapsPanelStore, startMapRename } from "./mapsPanel";

// The map commands of the menus and the command palette (SPEC §7.1; DESIGN §5): Map
// Properties…, Duplicate Map and Delete Map act on the active map, as Tiled's map commands act
// on the current document; a row's menu in the Maps panel (context menu "map", DESIGN §8.1)
// lists the same three, and opening it shows the row's map, as the menu of a tileset tab shows
// that tileset (DESIGN §8.5). Delete is disabled for the last map of the project. Move Map Up
// and Move Map Down change the project's map list; they have no menu item (DESIGN §5) and run
// from the command palette. New Map… (Ctrl+Alt+M, also from a text field) opens its dialog;
// F2 renames the map of the focused row of the Maps panel (DESIGN §10.3).

const hasActive = () => activeMap() !== null && mapsIdle();

export const commands: CommandSpec[] = [
    {
        id: "file.newMap",
        title: "New Map…",
        shortcut: "Ctrl+Alt+M",
        context: ["global", "text"],
        enabled: () => mapsIdle() && sessionStore.getState().session.project.maps.length < MAX_MAPS,
        run: async () => void (await newMapFromDialog()),
    },
    {
        id: "map.properties",
        title: "Map Properties…",
        enabled: hasActive,
        contextMenus: [{ menu: MAP_MENU, order: 100 }],
        run: async () => void (await editMapProperties()),
    },
    {
        id: "map.duplicate",
        title: "Duplicate Map",
        enabled: hasActive,
        contextMenus: [{ menu: MAP_MENU, order: 200 }],
        run: () => void duplicateMap(),
    },
    {
        id: "map.delete",
        title: "Delete Map",
        enabled: () => hasActive() && sessionStore.getState().session.project.maps.length > 1,
        contextMenus: [{ menu: MAP_MENU, order: 210 }],
        run: () => void deleteMap(),
    },
    {
        id: "map.rename",
        title: "Rename Map",
        shortcut: "F2",
        context: "panel",
        enabled: () => focusedMap() !== null && mapsIdle() && !mapsPanelStore.getState().renaming,
        run: () => {
            const id = focusedMap();
            if (id !== null) startMapRename(id);
        },
    },
    {
        id: "map.moveUp",
        title: "Move Map Up",
        enabled: () => mapsIdle() && canMoveMap(activeMap()?.id, -1),
        run: () => void moveMap(-1),
    },
    {
        id: "map.moveDown",
        title: "Move Map Down",
        enabled: () => mapsIdle() && canMoveMap(activeMap()?.id, 1),
        run: () => void moveMap(1),
    },
];

// F2 follows the focus and the rename; an open menu is told.
mapsPanelStore.subscribe(() => appCommands.refresh());
