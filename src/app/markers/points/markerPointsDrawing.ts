import { cssColour } from "../../overlay/draw";
import type { OverlayFrame } from "../../overlay/types";
import { sessionStore } from "../../state/session";
import { toolState } from "../../tools/activeTool";
import { activeMap } from "../../tools/toolSets";
import { editableMarkers } from "../markerGeometry";
import { drawnShape, selectedMarkerIds } from "../markerSelection";
import { EDIT_POINTS_TOOL } from "./editPointsId";
import { chosenVertex } from "./markerVertex";

// The points of the Edit points tool (DESIGN §4; TE-039): with the tool active, each point of a
// selected polygon or polyline of the active map as a 5 CSS px square in `--bg-panel` with an
// `--accent` edge, the chosen point filled with `--accent`; where a drag puts them. The marker
// tools' overlay layer draws them over the selection's boxes (markerTools.overlay.ts) and
// redraws when the chosen point changes.

/** The side of a point's square, CSS pixels (DESIGN §4). */
export const VERTEX_SIZE = 5;

/** Draws the points of the Edit points tool on `frame`. */
export function drawMarkerPoints(frame: OverlayFrame): void {
    if (toolState.activeId() !== EDIT_POINTS_TOOL) return;
    const { context, map, mapping, theme } = frame;
    const { session } = sessionStore.getState();
    if (activeMap(session)?.id !== map.id) return;
    const selected = new Set(selectedMarkerIds(session, map));
    if (selected.size === 0) return;
    const chosen = chosenVertex(session);
    const { dpr } = mapping.frame;
    const side = VERTEX_SIZE * dpr;
    context.save();
    context.lineWidth = dpr;
    for (const { marker, shift } of editableMarkers(map, mapping.frame.view, true)) {
        if (!selected.has(marker.id)) continue;
        const shape = drawnShape(marker, map.id);
        if (shape.shape !== "polygon" && shape.shape !== "polyline") continue;
        shape.points.forEach(([px, py], index) => {
            const at = mapping.mapToDevice(shape.x + px + shift.x, shape.y + py + shift.y);
            const isChosen = chosen?.marker.id === marker.id && chosen.index === index;
            context.fillStyle = cssColour(isChosen ? theme.accent : theme.panel);
            context.strokeStyle = cssColour(theme.accent);
            const x = Math.round(at.x - side / 2) + 0.5;
            const y = Math.round(at.y - side / 2) + 0.5;
            context.fillRect(x, y, side - 1, side - 1);
            context.strokeRect(x, y, side - 1, side - 1);
        });
    }
    context.restore();
}
