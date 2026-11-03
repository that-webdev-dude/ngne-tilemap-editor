import type { CommandSpec } from "../../commands/types";
import { importTileset, importingTileset } from "./importTileset";

// File → Import Tileset… (SPEC §6.1, DESIGN §5; TE-024). It takes the menu item planned for its
// id (commands/planned.commands.ts); DESIGN §10.3 gives it no key.
export const commands: CommandSpec[] = [
    {
        id: "file.importTileset",
        title: "Import Tileset…",
        enabled: () => !importingTileset(),
        run: async () => void (await importTileset()),
    },
];
