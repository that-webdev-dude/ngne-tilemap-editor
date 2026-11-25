import { refreshCommands } from "../uiState";
import type { CommandSpec } from "../commands/commandTypes";
import { historySteps } from "../state/historySteps";
import { tilesetPanelStore } from "../tilesets/panel/tilesetPanel";
import {
    TERRAIN_MENU,
    TERRAIN_SET_MENU,
    TERRAIN_SET_NEW_MENU,
    addTerrainToSelectedSet,
    canAddTerrain,
    canAddTerrainSet,
    canMoveSelectedSet,
    canMoveSelectedTerrain,
    moveSelectedSet,
    moveSelectedTerrain,
    newTerrainSet,
    removeSelectedSet,
    removeSelectedTerrain,
    selectedSet,
    startTerrainRename,
    terrainEditable,
    terrainsPanelStore,
} from "./terrainsPanel";

// The commands of the Terrains panel (SPEC §5.1, DESIGN §8.6; TE-043), in three context menus
// the panel shows: the menu of its Add button (New Corner Set, New Edge Set, New Mixed Set, as
// Tiled's Terrain Sets view), the menu of a terrain set's row and the menu of a terrain's row.
// They act on the active tileset's selected set and terrain, which opening a row's menu
// selects; none runs during a stroke. A refusal (the only terrain of a set) is reported by the
// registry's toast.

const hasSet = () => terrainEditable() && selectedSet() !== null;

export const commands: CommandSpec[] = [
    {
        id: "terrain.newCornerSet",
        title: "New Corner Set",
        enabled: canAddTerrainSet,
        contextMenus: [{ menu: TERRAIN_SET_NEW_MENU, order: 100 }],
        run: () => {
            newTerrainSet("corner");
        },
    },
    {
        id: "terrain.newEdgeSet",
        title: "New Edge Set",
        enabled: canAddTerrainSet,
        contextMenus: [{ menu: TERRAIN_SET_NEW_MENU, order: 110 }],
        run: () => {
            newTerrainSet("edge");
        },
    },
    {
        id: "terrain.newMixedSet",
        title: "New Mixed Set",
        enabled: canAddTerrainSet,
        contextMenus: [{ menu: TERRAIN_SET_NEW_MENU, order: 120 }],
        run: () => {
            newTerrainSet("mixed");
        },
    },
    {
        id: "terrain.add",
        title: "Add Terrain",
        enabled: canAddTerrain,
        contextMenus: [{ menu: TERRAIN_SET_MENU, order: 100 }],
        run: () => {
            addTerrainToSelectedSet();
        },
    },
    {
        id: "terrain.renameSet",
        title: "Rename Terrain Set",
        enabled: hasSet,
        contextMenus: [{ menu: TERRAIN_SET_MENU, order: 200 }],
        run: () => {
            const selected = selectedSet();
            if (selected) startTerrainRename(selected.selection.set, null);
        },
    },
    {
        id: "terrain.moveSetUp",
        title: "Move Terrain Set Up",
        enabled: () => hasSet() && canMoveSelectedSet(-1),
        contextMenus: [{ menu: TERRAIN_SET_MENU, order: 300 }],
        run: () => {
            moveSelectedSet(-1);
        },
    },
    {
        id: "terrain.moveSetDown",
        title: "Move Terrain Set Down",
        enabled: () => hasSet() && canMoveSelectedSet(1),
        contextMenus: [{ menu: TERRAIN_SET_MENU, order: 310 }],
        run: () => {
            moveSelectedSet(1);
        },
    },
    {
        id: "terrain.removeSet",
        title: "Remove Terrain Set",
        enabled: hasSet,
        contextMenus: [{ menu: TERRAIN_SET_MENU, order: 400 }],
        run: () => {
            removeSelectedSet();
        },
    },
    {
        id: "terrain.rename",
        title: "Rename Terrain",
        enabled: hasSet,
        contextMenus: [{ menu: TERRAIN_MENU, order: 100 }],
        run: () => {
            const selected = selectedSet();
            if (selected) startTerrainRename(selected.selection.set, selected.selection.terrain);
        },
    },
    {
        id: "terrain.moveUp",
        title: "Move Terrain Up",
        enabled: () => hasSet() && canMoveSelectedTerrain(-1),
        contextMenus: [{ menu: TERRAIN_MENU, order: 200 }],
        run: () => {
            moveSelectedTerrain(-1);
        },
    },
    {
        id: "terrain.moveDown",
        title: "Move Terrain Down",
        enabled: () => hasSet() && canMoveSelectedTerrain(1),
        contextMenus: [{ menu: TERRAIN_MENU, order: 210 }],
        run: () => {
            moveSelectedTerrain(1);
        },
    },
    {
        id: "terrain.remove",
        title: "Remove Terrain",
        enabled: () => hasSet() && selectedSet()!.set.colors.length > 1,
        contextMenus: [{ menu: TERRAIN_MENU, order: 300 }],
        run: () => {
            removeSelectedTerrain();
        },
    },
];

// The enabled states follow the selection, the active tileset and the history; an open menu
// is told. Not the hover, which changes with every pointer move.
terrainsPanelStore.subscribe((state, previous) => {
    if (state.selections !== previous.selections) refreshCommands();
});
tilesetPanelStore.subscribe((state, previous) => {
    if (state.activeTilesetId !== previous.activeTilesetId) refreshCommands();
});
historySteps.subscribe(() => refreshCommands());
