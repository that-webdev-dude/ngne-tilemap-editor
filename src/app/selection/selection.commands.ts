import type { Command } from "../../core/history";
import type { ProjectSession } from "../../core/model";
import {
    invertSelectionCommand,
    selectAllCommand,
    selectNoneCommand,
    tileSelectionOf,
} from "../../core/selection";
import type { CommandSpec } from "../commands/types";
import { activeHistory, sessionStore } from "../state/session";
import { toolState } from "../tools/activeTool";
import { toolPipeline } from "../tools/appPipeline";
import { activeMap, offersTool } from "../tools/toolSets";

// Select All, Select None and Invert Selection (SPEC §4.4, DESIGN §5, §10.3; TE-020): Ctrl+A,
// Ctrl+D and Ctrl+I in the `global` context, on the active map's tile selection. They take the
// items planned for them in the Select menu (commands/planned.commands.ts). Each is one
// undoable step; a step that would leave the same cells selected records nothing. While a
// stroke is in progress the history takes no command, so they are disabled then, as undo and
// redo are.
//
// Escape with a tile tool active and no stroke or gesture in progress clears the selection
// (Tiled 1.12, DESIGN §10.3); with one in progress `tool.cancel` takes the key.

/** The active map's id when its history can take a command now. */
function idleMapId(): string | null {
    const { session, history } = sessionStore.getState();
    if (history.transaction || toolPipeline.stroking) return null;
    return activeMap(session)?.id ?? null;
}

function runOnActive(make: (session: ProjectSession, mapId: string) => Command | null): void {
    const mapId = idleMapId();
    if (mapId === null) return;
    const command = make(sessionStore.getState().session, mapId);
    if (command) activeHistory().execute(command);
}

/** Whether the active map has a tile selection. */
function hasSelection(): boolean {
    const mapId = idleMapId();
    return mapId !== null && tileSelectionOf(sessionStore.getState().session, mapId) !== null;
}

/** Whether the active tool is a tile tool: one of the tile layer's set and not of every set. */
function tileToolActive(): boolean {
    const tool = toolState.active();
    return (
        toolState.kind() === "tile" &&
        tool !== null &&
        offersTool(tool, "tile") &&
        !offersTool(tool, "marker")
    );
}

export const commands: CommandSpec[] = [
    {
        id: "select.all",
        title: "Select All",
        shortcut: "Ctrl+A",
        enabled: () => idleMapId() !== null,
        run: () => runOnActive(selectAllCommand),
    },
    {
        id: "select.none",
        title: "Select None",
        shortcut: "Ctrl+D",
        enabled: hasSelection,
        run: () => runOnActive(selectNoneCommand),
    },
    {
        id: "select.invert",
        title: "Invert Selection",
        shortcut: "Ctrl+I",
        enabled: () => idleMapId() !== null,
        run: () => runOnActive(invertSelectionCommand),
    },
    {
        id: "select.clear",
        title: "Clear Tile Selection",
        shortcut: "Escape",
        context: "canvas",
        enabled: () => tileToolActive() && hasSelection(),
        run: () => runOnActive(selectNoneCommand),
    },
];
