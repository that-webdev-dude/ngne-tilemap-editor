import type { CommandSpec } from "../commands/commandTypes";
import { editorUi } from "../editorUi";

// DESIGN §10.3 lists no key for the Preferences dialog. The command takes the menu item planned
// for its id (commands/planned.commands.ts). It opens the instance's surface `preferences` and
// reads the instance only when it runs, after `editorUi.ts`, which loads this module, is built.
export const commands: CommandSpec[] = [
    {
        id: "edit.preferences",
        title: "Preferences…",
        run: () => editorUi.surfaces.open("preferences"),
    },
];
