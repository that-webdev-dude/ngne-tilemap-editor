import { MarkerEditError, moveMarkersCommand, resizeMarkerCommand } from "../../core/markers";
import type { ShapeBox } from "../../core/model";
import { notices } from "../notices/notices";
import { sessionStore } from "../state/session";
import { toolPipeline } from "../tools/appPipeline";
import { activeMap } from "../tools/toolSets";
import { resizable, selectionBox } from "./markerGeometry";
import { markerFeedback } from "./markerFeedback";
import { drawnShape, lockedSelectionRefusal, selectedMarkers } from "./markerSelection";

// The X, Y, W and H fields of the marker select tool's context bar (DESIGN §7; TE-038): the box
// of the selection, in map pixels, and the commands an edit of them makes. X and Y move the
// selection (one entry); W and H resize a lone selected rectangle or ellipse (one entry) and are
// disabled otherwise, as its handles are absent. While a selected marker's layer is locked an
// edit is refused and the status bar says so (SPEC §8; TE-039). The context bar (ui/markers)
// calls these; it builds no command itself.

export type MarkerBoxField = "x" | "y" | "width" | "height";

/** What the fields show: the selection's box, and whether W and H can be edited. */
export interface MarkerBoxFields {
    readonly box: ShapeBox;
    readonly sizable: boolean;
}

/** The fields of the active map's marker selection; null without one. */
export function markerBoxFields(): MarkerBoxFields | null {
    const { session } = sessionStore.getState();
    const map = activeMap(session);
    if (!map) return null;
    const markers = selectedMarkers(session, map);
    const box = selectionBox(markers.map((marker) => drawnShape(marker, map.id)));
    if (!box) return null;
    return { box, sizable: markers.length === 1 && resizable(markers[0]!) };
}

/**
 * Sets one field of the selection's box to `value`: X and Y move every selected marker, W and H
 * resize a lone rectangle or ellipse from its top-left. A value the markers refuse (FORMAT
 * limits) changes nothing and is reported as an error toast; a selection on a locked layer
 * changes nothing and the status bar says so.
 */
export function setMarkerBoxField(field: MarkerBoxField, value: number): void {
    const { session, history } = sessionStore.getState();
    const map = activeMap(session);
    if (!map || history.transaction || toolPipeline.stroking || !Number.isFinite(value)) {
        return;
    }
    const markers = selectedMarkers(session, map);
    const box = selectionBox(markers);
    if (!box) return;
    const refusal = lockedSelectionRefusal(session, map);
    if (refusal) return markerFeedback(refusal);
    try {
        if (field === "x" || field === "y") {
            const dx = field === "x" ? value - box.x : 0;
            const dy = field === "y" ? value - box.y : 0;
            if (dx === 0 && dy === 0) return;
            const ids = markers.map((marker) => marker.id);
            history.execute(moveMarkersCommand(session.project, map.id, ids, dx, dy));
            return;
        }
        const marker = markers[0]!;
        if (markers.length !== 1 || !resizable(marker) || value < 0) return;
        if (box[field] === value) return;
        history.execute(
            resizeMarkerCommand(session.project, map.id, marker.id, { ...box, [field]: value }),
        );
    } catch (error) {
        if (error instanceof MarkerEditError) {
            notices.error(error.message);
            return;
        }
        throw error;
    }
}
