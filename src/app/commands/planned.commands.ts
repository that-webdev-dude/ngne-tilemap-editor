import type { MenuBarMenu, PlannedCommandSpec } from "./types";

/**
 * Menu items of commands that later tickets implement: the menus of DESIGN §5. Each is shown
 * disabled until a `CommandSpec` with the same id is registered from that ticket's own
 * `*.commands.ts` module; the command then takes over the item, its position included, and
 * adds its shortcut. A ticket that shapes a feature differently lists the ids it supersedes in
 * `replaces`.
 *
 * Orders are spaced by 10; the hundreds are the separator groups (the "·" of DESIGN §5).
 */
function menu(
    name: MenuBarMenu,
    groups: readonly (readonly [id: string, title: string])[][],
): PlannedCommandSpec[] {
    return groups.flatMap((group, groupIndex) =>
        group.map(([id, title], index) => ({
            id,
            title,
            menuPath: [name],
            menuOrder: (groupIndex + 1) * 100 + index * 10,
        })),
    );
}

export const plannedCommands: PlannedCommandSpec[] = [
    ...menu("File", [
        [
            ["file.newProject", "New Project…"],
            ["file.newMap", "New Map…"],
            ["file.open", "Open…"],
        ],
        [
            ["file.save", "Save"],
            ["file.saveAs", "Save As…"],
            ["file.revert", "Revert"],
        ],
        [
            ["file.importTileset", "Import Tileset…"],
            ["file.importTiledMap", "Import Tiled Map…"],
        ],
        [
            ["file.export", "Export…"],
            ["file.exportAgain", "Export Again"],
        ],
        [
            ["file.closeMap", "Close Map"],
            ["file.closeProject", "Close Project"],
        ],
    ]),
    // The Open Recent submenu sits after Open… (DESIGN §5); its items are the recent projects
    // (TE-047), which replace this placeholder.
    {
        id: "file.openRecent.none",
        title: "No Recent Projects",
        menuPath: ["File", "Open Recent"],
        menuOrder: 125,
    },
    // Group 1 of Edit is Undo and Redo (state/history.commands.ts).
    ...menu("Edit", [
        [],
        [
            ["edit.cut", "Cut"],
            ["edit.copy", "Copy"],
            ["edit.paste", "Paste"],
            ["edit.delete", "Delete"],
        ],
        [
            ["edit.commandPalette", "Command Palette…"],
            ["edit.shortcuts", "Keyboard Shortcuts…"],
            ["edit.preferences", "Preferences…"],
        ],
    ]),
    ...menu("Map", [
        [
            ["map.properties", "Map Properties…"],
            ["map.resize", "Resize / Offset Map…"],
            ["map.duplicate", "Duplicate Map"],
            ["map.delete", "Delete Map"],
        ],
        [
            ["map.previous", "Previous Map"],
            ["map.next", "Next Map"],
        ],
    ]),
    ...menu("Layer", [
        [
            ["layer.newTile", "New Tile Layer"],
            ["layer.newMarker", "New Marker Layer"],
            ["layer.newImage", "New Image Layer…"],
            ["layer.newGroup", "New Group"],
        ],
        [
            ["layer.group", "Group Layers"],
            ["layer.ungroup", "Ungroup"],
        ],
        [
            ["layer.duplicate", "Duplicate Layer"],
            ["layer.delete", "Delete Layer"],
            ["layer.rename", "Rename Layer"],
        ],
        [["layer.properties", "Layer Properties…"]],
        [
            ["layer.moveUp", "Move Layer Up"],
            ["layer.moveDown", "Move Layer Down"],
            ["layer.selectAbove", "Select Layer Above"],
            ["layer.selectBelow", "Select Layer Below"],
        ],
        [
            ["layer.toggleOthers", "Show/Hide Other Layers"],
            ["layer.lockOthers", "Lock/Unlock Other Layers"],
        ],
    ]),
    ...menu("Tileset", [
        [
            ["tileset.properties", "Tileset Properties…"],
            ["tileset.updateFromSource", "Update Tileset from Source…"],
            ["tileset.delete", "Delete Tileset"],
        ],
        [
            ["tileset.editCollision", "Edit Collision…"],
            ["tileset.editAnimation", "Edit Animation…"],
        ],
        [
            ["tileset.previous", "Previous Tileset"],
            ["tileset.next", "Next Tileset"],
        ],
        [
            ["stamp.flipHorizontal", "Flip Stamp Horizontally"],
            ["stamp.flipVertical", "Flip Stamp Vertically"],
            ["stamp.rotateRight", "Rotate Stamp Right"],
            ["stamp.rotateLeft", "Rotate Stamp Left"],
        ],
    ]),
    ...menu("Select", [
        [
            ["select.all", "Select All"],
            ["select.none", "Select None"],
            ["select.invert", "Invert Selection"],
        ],
    ]),
    ...menu("View", [
        [
            ["view.zoomIn", "Zoom In"],
            ["view.zoomOut", "Zoom Out"],
            ["view.fit", "Fit"],
            ["view.zoom100", "100%"],
        ],
        [
            ["view.grid", "Show Grid"],
            ["view.collision", "Show Collision"],
            ["view.highlightLayer", "Highlight Current Layer"],
        ],
        [["view.snap", "Snap to Grid"]],
        // Implemented by shell/bottomPanel.commands.ts (this ticket).
        [["view.bottomPanel", "Hide Bottom Panel"]],
        // Implemented by keymap/regions.commands.ts (this ticket).
        [
            ["focus.nextRegion", "Focus Next Region"],
            ["focus.previousRegion", "Focus Previous Region"],
        ],
    ]),
];
