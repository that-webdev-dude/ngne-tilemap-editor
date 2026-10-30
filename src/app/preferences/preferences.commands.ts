import type { CommandSpec } from "../commands/types";
import { surfaces } from "../surfaces/surfaces";

// DESIGN §10.3 lists no key for the Preferences dialog. The command takes the menu item planned
// for its id (commands/planned.commands.ts).
export const commands: CommandSpec[] = [
    {
        id: "edit.preferences",
        title: "Preferences…",
        run: () => surfaces.open("preferences"),
    },
];
