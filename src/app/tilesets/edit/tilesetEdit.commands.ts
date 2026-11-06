import { appCommands } from "../../commands/appCommands";
import type { CommandSpec } from "../../commands/types";
import { tilesetWorkflowBusy } from "../tilesetWorkflow";
import {
    canMoveCurrentTileset,
    currentTileset,
    deleteCurrentTileset,
    historyIdle,
    moveCurrentTileset,
    startTilesetRename,
    TILESET_MENU,
    tilesetRenameStore,
} from "./tilesetEdit";
import { editTilesetProperties } from "./tilesetProperties";

// The tileset commands (SPEC §6.2, DESIGN §5; TE-026). Tileset Properties… and Delete Tileset
// take the Tileset menu items planned for their ids; the menu of a tileset tab in the Tilesets
// panel (context menu "tileset") lists them with Move Tileset Left and Right, which DESIGN §5
// leaves out of the menu bar. F2 renames the shown tileset while the focus is in the panel
// (DESIGN §10.3). All act on the tileset the panel shows; none runs during a stroke.

const editable = () => currentTileset() !== null && historyIdle();

export const commands: CommandSpec[] = [
    {
        id: "tileset.properties",
        title: "Tileset Properties…",
        enabled: () => editable() && !tilesetWorkflowBusy(),
        contextMenus: [{ menu: TILESET_MENU, order: 100 }],
        run: async () => void (await editTilesetProperties()),
    },
    {
        id: "tileset.rename",
        title: "Rename Tileset",
        shortcut: "F2",
        context: "panel",
        enabled: () =>
            editable() &&
            tilesetRenameStore.getState().panelFocused &&
            !tilesetRenameStore.getState().renaming,
        run: () => void startTilesetRename(),
    },
    {
        id: "tileset.moveLeft",
        title: "Move Tileset Left",
        enabled: () => editable() && canMoveCurrentTileset(-1),
        contextMenus: [{ menu: TILESET_MENU, order: 200 }],
        run: () => void moveCurrentTileset(-1),
    },
    {
        id: "tileset.moveRight",
        title: "Move Tileset Right",
        enabled: () => editable() && canMoveCurrentTileset(1),
        contextMenus: [{ menu: TILESET_MENU, order: 210 }],
        run: () => void moveCurrentTileset(1),
    },
    {
        id: "tileset.delete",
        title: "Delete Tileset",
        enabled: editable,
        contextMenus: [{ menu: TILESET_MENU, order: 300 }],
        run: () => void deleteCurrentTileset(),
    },
];

// F2 follows the focus and the rename; an open menu is told.
tilesetRenameStore.subscribe(() => appCommands.refresh());
