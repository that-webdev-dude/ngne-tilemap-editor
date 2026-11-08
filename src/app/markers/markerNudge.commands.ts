import { MarkerEditError, moveMarkersCommand } from "../../core/markers";
import type { Command } from "../../core/history";
import type { CommandSpec } from "../commands/types";
import { activeHistory, sessionStore } from "../state/session";
import { toolPipeline } from "../tools/appPipeline";
import { activeMap } from "../tools/toolSets";
import { markerFeedback as feedback } from "./markerFeedback";
import { lockedSelectionRefusal, markersSelected, selectedMarkerIds } from "./markerSelection";
import { chosenVertex, nudgeVertexCommand } from "./points/markerVertex";

// Nudge (SPEC §8, DESIGN §10.3, §10.4; TE-039): the arrows move the selected markers 1 px and
// Shift+arrows one cell (the map's tile width or height), in the `markers` context: a marker
// layer active and markers selected. With the Edit points tool active and a point chosen, they
// move that point instead (the keyboard alternative of dragging it). Each press is one entry,
// "Move Marker(s)" or "Edit Marker Points"; a move past FORMAT's coordinate range changes
// nothing and the status bar says why, as does a selected marker on a locked layer
// (`lockedSelectionRefusal`). The commands have no menu item: the keys are their way in.

type Direction = "Left" | "Right" | "Up" | "Down";

const STEPS: Record<Direction, [number, number]> = {
    Left: [-1, 0],
    Right: [1, 0],
    Up: [0, -1],
    Down: [0, 1],
};

/** Whether the history can take a command now. */
const historyIdle = () => !sessionStore.getState().history.transaction && !toolPipeline.stroking;

/** The command of a nudge one step `(sx, sy)`, by a pixel or (`cell`) by a cell; null for none. */
export function nudgeCommand(sx: number, sy: number, cell: boolean): Command | null {
    const { session } = sessionStore.getState();
    const map = activeMap(session);
    if (!map || !markersSelected(session)) return null;
    const dx = sx * (cell ? map.tileWidth : 1);
    const dy = sy * (cell ? map.tileHeight : 1);
    if (chosenVertex(session)) return nudgeVertexCommand(session, dx, dy);
    return moveMarkersCommand(session.project, map.id, selectedMarkerIds(session, map), dx, dy);
}

function nudge(sx: number, sy: number, cell: boolean): void {
    if (!historyIdle()) return;
    const { session } = sessionStore.getState();
    const map = activeMap(session);
    const refusal = map && lockedSelectionRefusal(session, map);
    if (refusal) return feedback(refusal);
    try {
        const command = nudgeCommand(sx, sy, cell);
        if (command) activeHistory().execute(command);
    } catch (error) {
        if (error instanceof MarkerEditError) {
            feedback(error.message);
            return;
        }
        throw error;
    }
}

const enabled = () => historyIdle() && markersSelected(sessionStore.getState().session);

export const commands: CommandSpec[] = (Object.keys(STEPS) as Direction[]).flatMap(
    (direction): CommandSpec[] => {
        const [sx, sy] = STEPS[direction];
        return [
            {
                id: `markers.nudge${direction}`,
                title: `Nudge ${direction}`,
                shortcut: `Arrow${direction}`,
                context: "markers",
                enabled,
                run: () => nudge(sx, sy, false),
            },
            {
                id: `markers.nudge${direction}Cell`,
                title: `Nudge ${direction} by a Cell`,
                shortcut: `Shift+Arrow${direction}`,
                context: "markers",
                enabled,
                run: () => nudge(sx, sy, true),
            },
        ];
    },
);
