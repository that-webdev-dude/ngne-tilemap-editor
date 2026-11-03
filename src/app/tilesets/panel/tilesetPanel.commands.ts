import { appCommands } from "../../commands/appCommands";
import type { CommandSpec } from "../../commands/types";
import { sessionStore } from "../../state/session";
import { shownTileset, tilesetPanel, tilesetPanelStore } from "./tilesetPanel";

// Tileset → Previous Tileset and Next Tileset (DESIGN §5), Tiled's `[` and `]` (DESIGN §10.3):
// the Tilesets panel shows the tab before or after its own; as Tiled's `TilesetDock` (v1.12.2)
// they stop at the ends, where they are disabled. They take the menu items planned for their
// ids; both act from the viewport and from the panels.

export const commands: CommandSpec[] = [
    {
        id: "tileset.previous",
        title: "Previous Tileset",
        shortcut: "[",
        context: ["canvas", "panel"],
        enabled: () => tilesetPanel.canCycleTileset(-1),
        run: () => tilesetPanel.cycleTileset(-1),
    },
    {
        id: "tileset.next",
        title: "Next Tileset",
        shortcut: "]",
        context: ["canvas", "panel"],
        enabled: () => tilesetPanel.canCycleTileset(1),
        run: () => tilesetPanel.cycleTileset(1),
    },
];

// Whether they are enabled follows the tabs and the tab shown; an open Tileset menu is told.
const position = () => {
    const { project } = sessionStore.getState().session;
    const shown = shownTileset(project, tilesetPanelStore.getState());
    return `${project.tilesets.length}:${shown ? project.tilesets.indexOf(shown) : -1}`;
};
let last = position();
const follow = () => {
    const next = position();
    if (next === last) return;
    last = next;
    appCommands.refresh();
};
sessionStore.subscribe(follow);
tilesetPanelStore.subscribe(follow);
