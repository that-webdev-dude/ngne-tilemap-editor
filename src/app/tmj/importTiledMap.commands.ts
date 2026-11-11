import type { CommandSpec } from "../commands/types";
import { canImportTiledMap, importTiledMap } from "./importTiledMap";

// File → Import Tiled Map… (SPEC §13, DESIGN §5; TE-061). It takes the menu item planned for its
// id (commands/planned.commands.ts) and acts with no project open too (the empty state's action,
// `appCommands.ts`); DESIGN §10.3 gives it no key. An open menu and the empty state follow its
// `enabled` through the refreshes of the file workflows (`file.commands.ts`) and the tileset
// workflow (`tilesetWorkflow.commands.ts`).
export const commands: CommandSpec[] = [
    {
        id: "file.importTiledMap",
        title: "Import Tiled Map…",
        enabled: canImportTiledMap,
        run: async () => void (await importTiledMap()),
    },
];
