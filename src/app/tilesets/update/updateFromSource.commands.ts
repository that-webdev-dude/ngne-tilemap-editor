import type { CommandSpec } from "../../commands/types";
import { TILESET_MENU } from "../edit/tilesetEdit";
import { canUpdateCurrentTileset, updateCurrentTileset } from "./updateFromSource";

// Tileset → Update Tileset from Source… (SPEC §6.3, DESIGN §5; TE-028). It takes the menu item
// planned for its id and is listed in the menu of a tileset tab after Tileset Properties…, as
// in the menu bar; DESIGN §10.3 gives it no key. It acts on the tileset the panel shows, of any
// source kind (a `"collection"` tileset's since TE-062).
export const commands: CommandSpec[] = [
    {
        id: "tileset.updateFromSource",
        title: "Update Tileset from Source…",
        enabled: canUpdateCurrentTileset,
        contextMenus: [{ menu: TILESET_MENU, order: 110 }],
        run: async () => void (await updateCurrentTileset()),
    },
];
