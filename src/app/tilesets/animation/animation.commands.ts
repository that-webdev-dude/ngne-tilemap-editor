import { appCommands } from "../../commands/appCommands";
import type { CommandSpec } from "../../commands/types";
import { sessionStore } from "../../state/session";
import { tilesetPanelStore } from "../panel/tilesetPanel";
import { canEditAnimation, editAnimation } from "./animationEditor";

// Tileset → Edit Animation… (DESIGN §5, §9; TE-030). It takes the Tileset menu item planned
// for it and is listed in the tile menu of the Tilesets panel after Edit Collision… (DESIGN
// §8.5: Edit Collision…, Edit Animation…, Properties).

/** The place of Edit Animation… in the Tilesets panel's tile menu (Edit Collision… is 100). */
const TILE_MENU_ORDER = 200;

export const commands: CommandSpec[] = [
    {
        id: "tileset.editAnimation",
        title: "Edit Animation…",
        enabled: canEditAnimation,
        contextMenus: [{ menu: "tile", order: TILE_MENU_ORDER }],
        run: async () => void (await editAnimation()),
    },
];

// Whether Edit Animation… is enabled follows the selection; an open menu is told.
let editable = canEditAnimation();
const follow = () => {
    const next = canEditAnimation();
    if (next === editable) return;
    editable = next;
    appCommands.refresh();
};
sessionStore.subscribe(follow);
tilesetPanelStore.subscribe(follow);
