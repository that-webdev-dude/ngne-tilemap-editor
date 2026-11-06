import type { CommandSpec } from "../commands/types";
import { sessionStore } from "../state/session";
import { activateMap, closeMapTab, mapTabsStore, neighbourTab, tabsAvailable } from "./tabs";

// Commands of the map tabs (SPEC §7.1; DESIGN §5, §10.3): Close Map (Alt+W, also from a text
// field, as the sprite editor's Close) in the File menu; Previous Map and Next Map in the Map
// menu, without a key as the sprite editor's Previous and Next Document (Ctrl+Tab and
// Ctrl+PageDown belong to the browser). In the tab strip itself the arrow keys move between
// tabs (ui/tabs/MapTabs.tsx).

function step(by: number): void {
    const id = neighbourTab(by);
    if (id !== null) activateMap(id);
}

const canStep = (by: number) => () => neighbourTab(by) !== null && tabsAvailable();

function activeOpen(): string | null {
    const id = sessionStore.getState().session.activeMapId;
    return mapTabsStore.getState().open.includes(id) ? id : null;
}

export const commands: CommandSpec[] = [
    {
        id: "file.closeMap",
        title: "Close Map",
        shortcut: "Alt+W",
        context: ["global", "text"],
        enabled: () => activeOpen() !== null && tabsAvailable(),
        run: () => {
            const id = activeOpen();
            if (id !== null) closeMapTab(id);
        },
    },
    {
        id: "map.previous",
        title: "Previous Map",
        enabled: canStep(-1),
        run: () => step(-1),
    },
    {
        id: "map.next",
        title: "Next Map",
        enabled: canStep(1),
        run: () => step(1),
    },
];
