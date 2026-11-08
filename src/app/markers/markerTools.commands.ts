import type { CommandSpec } from "../commands/types";
import { viewPreferences } from "../view/viewPreferences";
import { followMarkerContext } from "./markerSelection";

// View → Snap to Grid (SPEC §3, §8; TE-038), bound to the `snap` view preference: on by default,
// the same for every project and map, kept in `localStorage`, no history entry. It takes the item
// planned for it (commands/planned.commands.ts); the marker tools' context bar toggles the same
// preference (ui/markers/markerTools.contextbar.tsx) and shows whether it is on. The item keeps
// DESIGN §5's title: a menu item of the registry has no checked state.
//
// This module also switches the `markers` key context (DESIGN §10.1) with the marker selection
// of a marker layer: Delete removes the selected markers then (clipboard.commands.ts) and the
// layer arrows of the canvas give way (layers.commands.ts).

export const commands: CommandSpec[] = [
    {
        id: "view.snap",
        title: "Snap to Grid",
        run: () => viewPreferences.getState().toggle("snap"),
    },
];

followMarkerContext();
