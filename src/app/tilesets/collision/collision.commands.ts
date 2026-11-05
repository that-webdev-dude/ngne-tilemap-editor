import { appCommands } from "../../commands/appCommands";
import type { CommandSpec } from "../../commands/types";
import { sessionStore } from "../../state/session";
import { viewPreferences } from "../../view/viewPreferences";
import { tilesetPanelStore } from "../panel/tilesetPanel";
import { canEditCollision, editCollision } from "./collisionEditor";

// Tileset → Edit Collision… (DESIGN §5, §9) and View → Show Collision (DESIGN §4; TE-029). Edit
// Collision… takes the Tileset menu item planned for it and is listed in the tile menu of the
// Tilesets panel; a double click on a tile runs it. Show Collision is the `collision` view
// preference (SPEC §3): the same for every project and map, kept in `localStorage`, no history
// entry. As Show Grid, the title says what choosing it does.

/** The place of Edit Collision… in the Tilesets panel's tile menu (TE-030 and TE-040 add there). */
const TILE_MENU_ORDER = 100;

export const commands: CommandSpec[] = [
    {
        id: "tileset.editCollision",
        title: "Edit Collision…",
        enabled: canEditCollision,
        contextMenus: [{ menu: "tile", order: TILE_MENU_ORDER }],
        run: async () => void (await editCollision()),
    },
    {
        id: "view.collision",
        title: () => (viewPreferences.getState().collision ? "Hide Collision" : "Show Collision"),
        run: () => viewPreferences.getState().toggle("collision"),
    },
];

// Whether Edit Collision… is enabled follows the selection; the title of Show Collision the
// preference. An open menu is told.
let editable = canEditCollision();
const follow = () => {
    const next = canEditCollision();
    if (next === editable) return;
    editable = next;
    appCommands.refresh();
};
sessionStore.subscribe(follow);
tilesetPanelStore.subscribe(follow);
viewPreferences.subscribe((state, previous) => {
    if (state.collision !== previous.collision) appCommands.refresh();
});
