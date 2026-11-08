import { appCommands } from "../commands/appCommands";
import type { CommandSpec } from "../commands/types";
import { sessionStore } from "../state/session";
import { selectedTiles, shownTileset, tilesetPanelStore } from "../tilesets/panel/tilesetPanel";
import {
    pinSubject,
    pinnedSubject,
    propertiesPanelStore,
    setTileFocus,
    unpin,
} from "./propertiesPanel";

// The commands of the Properties panel (SPEC §9, DESIGN §8.3; TE-040). The panel's menu (the
// context menu "properties", in its header) shows the project or the shown tileset until the
// selection changes, or the selection again; the tile menu's Properties (DESIGN §8.5) shows the
// selected tiles. Each expands the Properties section when it is collapsed.

/** The context menu of the panel's header (`CommandSpec.contextMenus`). */
export const PROPERTIES_MENU = "properties";

/** The place of Properties in the Tilesets panel's tile menu, after the tile editors. */
const TILE_MENU_ORDER = 300;

/** Expands the Properties section of the dock when it is collapsed. */
function revealPanel(): void {
    const toggle = document.querySelector<HTMLButtonElement>(
        '[data-dock-panel="properties"] .dock-section__toggle[aria-expanded="false"]',
    );
    toggle?.click();
}

function hasTileset(): boolean {
    const { project } = sessionStore.getState().session;
    return shownTileset(project, tilesetPanelStore.getState()) !== null;
}

function hasSelectedTiles(): boolean {
    const { project } = sessionStore.getState().session;
    const tileset = shownTileset(project, tilesetPanelStore.getState());
    return tileset !== null && selectedTiles(tileset).length > 0;
}

export const commands: CommandSpec[] = [
    {
        id: "properties.showSelection",
        title: "Show Selection Properties",
        enabled: () => pinnedSubject() !== null,
        contextMenus: [{ menu: PROPERTIES_MENU, order: 100 }],
        run: () => {
            unpin();
            revealPanel();
        },
    },
    {
        id: "properties.showProject",
        title: "Show Project Properties",
        contextMenus: [{ menu: PROPERTIES_MENU, order: 200 }],
        run: () => {
            if (pinSubject("project")) revealPanel();
        },
    },
    {
        id: "properties.showTileset",
        title: "Show Tileset Properties",
        enabled: hasTileset,
        contextMenus: [{ menu: PROPERTIES_MENU, order: 210 }],
        run: () => {
            if (pinSubject("tileset")) revealPanel();
        },
    },
    {
        id: "properties.showTiles",
        title: "Properties",
        enabled: hasSelectedTiles,
        contextMenus: [{ menu: "tile", order: TILE_MENU_ORDER }],
        run: () => {
            setTileFocus(true);
            unpin();
            revealPanel();
        },
    },
];

// Whether the commands are enabled follows the selection and the pin; an open menu is told.
let last = "";
const follow = () => {
    const next = JSON.stringify([pinnedSubject(), hasTileset(), hasSelectedTiles()]);
    if (next === last) return;
    last = next;
    appCommands.refresh();
};
sessionStore.subscribe(follow);
tilesetPanelStore.subscribe(follow);
propertiesPanelStore.subscribe(follow);
