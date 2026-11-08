import { setMarkerPointsCommand } from "../../../core/markers";
import { movePolygonPoint } from "../../../core/model";
import type { ShapePoint } from "../../../core/model";
import { hitEdge, hitVertex } from "../../tilesets/collision/collisionTools";
import type { ToolContext, ToolModifiers, ToolSpec } from "../../tools/types";
import type { Point } from "../../view/coordinates";
import { viewPreferences } from "../../view/viewPreferences";
import { editableMarkers, markerAt, snapPoint } from "../markerGeometry";
import type { EditableMarker } from "../markerGeometry";
import { selectedMarkerIds, setMarkerDraft, setMarkerSelection } from "../markerSelection";
import {
    DRAG_DISTANCE_CSS,
    HIT_REACH_CSS,
    invertsSnap,
    runMarkerCommand,
    snapping,
    toolView,
} from "../markerToolSupport";
import { EDIT_POINTS_TOOL } from "./editPointsId";
import { chosenVertex, isPath, setChosenVertex } from "./markerVertex";
import type { PathMarker } from "./markerVertex";

// The Edit points tool (O; SPEC §8, DESIGN §4, §6, §10.4; TE-039), Tiled's `EditPolygonTool`
// (checked at v1.12.2) for one point at a time. The points of the selected polygons and
// polylines show as 5 px squares (markerPointsDrawing.ts, drawn by markerTools.overlay.ts).
//
//   press on a point of a selected polygon or polyline: it becomes the chosen point; a drag
//     moves it, placed as the tools place positions (snapped to the grid with Snap to Grid,
//     Ctrl inverts it; else whole pixels): one entry at the release
//   double click on an edge of a selected polygon or polyline, away from its points: a point is
//     inserted there, on the nearest whole pixel, and chosen: one entry
//   any other click: selects as the select tool's click does (a marker alone; Shift or Ctrl adds
//     it or takes it out; where no marker is, the selection is cleared, kept with Shift); the
//     chosen point is let go, and where no marker is a chosen point alone is let go (Tiled
//     clears its selected points before the objects). The tool moves no marker and draws no
//     rubber band.
//   Delete removes the chosen point, the arrows nudge it 1 px and Shift+arrows one cell
//     (markerNudge.commands.ts, clipboard.commands.ts); a polygon keeps 3 points, a polyline 2.
//
// A point is reached within `HIT_REACH_CSS` of it, as the collision editor's points are. Right
// click or Escape during a drag cancels it. Every edit is one "Edit Marker Points" entry.

/** Two presses within this many milliseconds, and `DRAG_DISTANCE_CSS` apart, are a double click. */
export const DOUBLE_CLICK_MS = 500;

/** A polygon or polyline the tool may edit, with where its layer is drawn. */
type PathEntry = EditableMarker & { readonly marker: PathMarker };

type Drag =
    /** A press on a point: a drag moves it. */
    | {
          kind: "vertex";
          entry: PathEntry;
          index: number;
          /** From the press to the point, layer pixels: the point follows the pointer. */
          grab: Point;
          dragging: boolean;
      }
    /** A press elsewhere: a click at the release. */
    | { kind: "click"; hit: EditableMarker | null };

interface Gesture {
    readonly drag: Drag;
    readonly client: Point;
    position: Point;
    modifiers: Readonly<ToolModifiers>;
}

let gesture: Gesture | null = null;
/** The last primary press: when and where, for a double click. */
let lastPress: { time: number; client: Point } | null = null;

/** The selected polygons and polylines of `entries`, topmost first. */
function selectedPaths(entries: readonly EditableMarker[], selected: readonly number[]) {
    const out: PathEntry[] = [];
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]!;
        if (isPath(entry.marker) && selected.includes(entry.marker.id)) {
            out.push(entry as PathEntry);
        }
    }
    return out;
}

/** The absolute layer position the dragged point goes to now, placed. */
function placedPoint(
    context: ToolContext,
    current: Gesture,
    drag: Extract<Drag, { kind: "vertex" }>,
): ShapePoint {
    const local = {
        x: current.position.x - drag.entry.shift.x + drag.grab.x,
        y: current.position.y - drag.entry.shift.y + drag.grab.y,
    };
    const at = snapPoint(local, context.map, snapping(invertsSnap(current.modifiers)));
    return [at.x, at.y];
}

function update(
    context: ToolContext,
    position: Point,
    modifiers: Readonly<ToolModifiers>,
    client?: Point,
): void {
    const current = gesture;
    if (current?.drag.kind !== "vertex") return;
    const { drag } = current;
    current.position = position;
    current.modifiers = modifiers;
    if (!drag.dragging) {
        if (!client) return;
        const travel =
            Math.abs(client.x - current.client.x) + Math.abs(client.y - current.client.y);
        if (travel < DRAG_DISTANCE_CSS) return;
        drag.dragging = true;
    }
    const marker = drag.entry.marker;
    setMarkerDraft({
        mapId: context.map.id,
        shapes: new Map([
            [marker.id, movePolygonPoint(marker, drag.index, placedPoint(context, current, drag))],
        ]),
    });
}

function end(): void {
    gesture = null;
    setMarkerDraft(null);
}

/**
 * A click: the select tool's selection rules; the chosen point is let go. Where no marker is, a
 * chosen point alone is let go and the selection kept (Tiled clears the selected points first).
 */
function click(context: ToolContext, hit: EditableMarker | null, modifiers: ToolModifiers): void {
    const hadPoint = chosenVertex(context.session) !== null;
    setChosenVertex(null);
    if (!hit && hadPoint) return;
    const ids = selectedMarkerIds(context.session, context.map);
    if (hit) {
        const id = hit.marker.id;
        if (modifiers.shift || modifiers.ctrl) {
            setMarkerSelection(
                ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id],
                context.map.id,
            );
        } else setMarkerSelection([id], context.map.id);
    } else if (!modifiers.shift) setMarkerSelection([], context.map.id);
}

/**
 * Inserts a point on the edge of a selected polygon or polyline under a double click at `at`
 * (map pixels); returns whether an edge was there.
 */
function insertOnEdge(
    context: ToolContext,
    paths: readonly PathEntry[],
    at: Point,
    reach: number,
): boolean {
    for (const entry of paths) {
        const local: ShapePoint = [at.x - entry.shift.x, at.y - entry.shift.y];
        const edge = hitEdge(entry.marker, local, reach);
        if (!edge) continue;
        const { marker } = entry;
        const point: ShapePoint = [
            Math.round(edge.at[0]) - marker.x + 0,
            Math.round(edge.at[1]) - marker.y + 0,
        ];
        const points = marker.points.map(([px, py]): ShapePoint => [px, py]);
        points.splice(edge.after + 1, 0, point);
        const command = runMarkerCommand(context, () =>
            setMarkerPointsCommand(context.session.project, context.map.id, marker.id, points),
        );
        if (command) {
            setChosenVertex({ mapId: context.map.id, markerId: marker.id, index: edge.after + 1 });
        }
        return true;
    }
    return false;
}

export const editPointsTool: ToolSpec = {
    id: EDIT_POINTS_TOOL,
    label: "Edit Points",
    hint: "Drag a point to move it · Double click an edge: add a point · Delete: remove the chosen point · Arrows: nudge it · Ctrl: snap",
    cursor: "default",
    onDown(context, pointer) {
        end();
        if (pointer.button !== "primary") return;
        const previous = lastPress;
        lastPress = { time: pointer.time, client: pointer.client };
        const double =
            previous !== null &&
            pointer.time - previous.time <= DOUBLE_CLICK_MS &&
            Math.abs(pointer.client.x - previous.client.x) +
                Math.abs(pointer.client.y - previous.client.y) <
                DRAG_DISTANCE_CSS;
        const view = toolView(context);
        const reach = HIT_REACH_CSS * view.cssPixel;
        const entries = editableMarkers(context.map, view.centre);
        const paths = selectedPaths(entries, selectedMarkerIds(context.session, context.map));
        const base = {
            client: pointer.client,
            position: pointer.position,
            modifiers: pointer.modifiers,
        };
        for (const entry of paths) {
            const local: ShapePoint = [
                pointer.position.x - entry.shift.x,
                pointer.position.y - entry.shift.y,
            ];
            const index = hitVertex(entry.marker, local, reach);
            if (index < 0) continue;
            setChosenVertex({ mapId: context.map.id, markerId: entry.marker.id, index });
            const [px, py] = entry.marker.points[index]!;
            const grab = { x: entry.marker.x + px - local[0], y: entry.marker.y + py - local[1] };
            gesture = { ...base, drag: { kind: "vertex", entry, index, grab, dragging: false } };
            return;
        }
        if (double && insertOnEdge(context, paths, pointer.position, reach)) {
            // The second press of the double click made the point; its release is no click.
            lastPress = null;
            return;
        }
        const prefer = viewPreferences.getState().highlightLayer ? context.layerId : null;
        const hit = markerAt(entries, pointer.position, reach, view.cssPixel, prefer);
        gesture = { ...base, drag: { kind: "click", hit } };
    },
    onMove(context, pointer) {
        update(context, pointer.position, pointer.modifiers, pointer.client);
    },
    onKey(context, key) {
        // Ctrl pressed or released mid-drag changes the snapping at once.
        if (gesture && key.key === "Ctrl") update(context, gesture.position, key.modifiers);
        return false;
    },
    onUp(context, pointer) {
        const current = gesture;
        if (!current) return;
        update(context, pointer.position, pointer.modifiers, pointer.client);
        end();
        const { drag } = current;
        if (drag.kind === "click") {
            click(context, drag.hit, pointer.modifiers);
            return;
        }
        if (!drag.dragging) return;
        const { marker } = drag.entry;
        const { index } = drag;
        const moved = movePolygonPoint(marker, index, placedPoint(context, current, drag));
        const [ox, oy] = marker.points[index]!;
        const [nx, ny] = moved.points[index]!;
        if (ox === nx && oy === ny) return;
        runMarkerCommand(context, () =>
            setMarkerPointsCommand(
                context.session.project,
                context.map.id,
                marker.id,
                moved.points,
            ),
        );
    },
    onCancel() {
        end();
    },
};

export const tools: ToolSpec[] = [editPointsTool];
