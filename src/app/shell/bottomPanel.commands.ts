import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { bottomPanelStore, setBottomPanelVisible } from "./bottomPanel";

// DESIGN §10.3: Tab toggles the bottom panel while the viewport itself has focus (a native key
// acts in `canvas` only there; elsewhere Tab moves the focus). It takes the View menu item
// planned for it (DESIGN §5) and, as the other View toggles, is titled by what it will do.

export const commands: CommandSpec[] = [
    {
        id: "view.bottomPanel",
        title: () =>
            bottomPanelStore.getState().visible ? "Hide Bottom Panel" : "Show Bottom Panel",
        shortcut: "Tab",
        context: "canvas",
        run: () => setBottomPanelVisible(!bottomPanelStore.getState().visible),
    },
];

// The title follows the store; an open View menu is told of the change.
bottomPanelStore.subscribe(() => appCommands.refresh());
