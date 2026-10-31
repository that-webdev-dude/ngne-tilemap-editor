import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { viewPreferences } from "../view/viewPreferences";

// Show Grid of the View menu (TE-014), bound to the `grid` view preference (SPEC §3): the same
// for every project and map, kept in `localStorage`, no history entry, the project stays
// clean. It takes the item planned for it (commands/planned.commands.ts); Ctrl+G is Tiled's
// key (DESIGN §10.3). The overlay follows the preference (grid.overlay.ts).
//
// A menu item of the registry has no checked state, so the title says what choosing it does
// ("Show Grid", "Hide Grid"); the registry refreshes when the preference changes.

export const commands: CommandSpec[] = [
    {
        id: "view.grid",
        title: () => (viewPreferences.getState().grid ? "Hide Grid" : "Show Grid"),
        shortcut: "Ctrl+G",
        run: () => viewPreferences.getState().toggle("grid"),
    },
];

// The title follows the preference; an open View menu is told of the change.
viewPreferences.subscribe(() => appCommands.refresh());
