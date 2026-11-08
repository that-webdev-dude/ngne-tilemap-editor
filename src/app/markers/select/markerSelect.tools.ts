import { moveMarkersCommand, resizeMarkerCommand } from "../../../core/markers";
import { fitShape, moveShape } from "../../../core/model";
import type { Shape, ShapeBox } from "../../../core/model";
import { handlePoints, hitBox, scaleBox } from "../../selection/transform/handles";
import type { HandleId } from "../../selection/transform/handles";
import type { ToolContext, ToolModifiers, ToolPointer, ToolSpec } from "../../tools/types";
import type { Point } from "../../view/coordinates";
import { viewPreferences } from "../../view/viewPreferences";
import {
    alignOf,
    bandOf,
    editableMarkers,
    markerAt,
    markersInBand,
    resizable,
    snapPoint,
    snappedMove,
} from "../markerGeometry";
import type { EditableMarker } from "../markerGeometry";
import { clearMarkerPreview, setMarkerPreview } from "../markerPreview";
import { selectedMarkerIds, setMarkerDraft, setMarkerSelection } from "../markerSelection";
import {
    DRAG_DISTANCE_CSS,
    HIT_REACH_CSS,
    invertsSnap,
    runMarkerCommand,
    snapping,
    toolView,
} from "../markerToolSupport";
import type { ToolView } from "../markerToolSupport";

// The marker select tool (SPEC §8, DESIGN §6, §7; TE-038), Tiled's `ObjectSelectionTool`
// (checked at v1.12.2) for markers without rotation:
//
//   click a marker: it alone is selected; Shift (or Ctrl) click: it joins the selection, or
//     leaves it when it was in it
//   click where no marker is: the selection is cleared (kept with Shift)
//   drag from where no marker is, or with Shift: a rubber band; it selects the markers it touches
//     (with Alt: those it encloses), added to the selection with Shift or Ctrl
//   drag a marker: the selection moves, or the marker alone when it was not selected; the
//     least x and y of their positions snap to the grid (Snap to Grid, Ctrl inverts it)
//   drag one of the 8 handles of a selected rectangle or ellipse (alone in the selection): it is
//     resized; the dragged handle follows the pointer and snaps (Alt inverts it), Ctrl keeps the
//     aspect ratio; the sides go to whole pixels. A click on a handle changes nothing
//   right click or Escape during a drag: cancelled
//
// A drag (a move, a band or a resize) starts after the pointer moved `DRAG_DISTANCE_CSS`. A move or resize is one history
// entry at the release; the selection is session state, set with no entry. Markers are taken
// from every visible, unlocked marker layer (`markerGeometry.ts`). Delete is
// clipboard.commands.ts's `edit.delete`; the context bar is ui/markers/markerTools.contextbar.tsx.

type Drag =
    /** Pressed, not yet moved far enough to drag. */
    | { kind: "pending"; hit: EditableMarker | null }
    | { kind: "band"; add: boolean }
    | {
          kind: "move";
          /** The moved markers, as they were at the press. */
          markers: readonly EditableMarker[];
          align: Point;
      }
    | {
          kind: "resize";
          entry: EditableMarker;
          handle: HandleId;
          box: ShapeBox;
          /** From the press to the handle's point, layer pixels: the handle follows the pointer. */
          grab: Point;
          /** The pointer has moved far enough to drag; a click on a handle changes nothing. */
          dragging: boolean;
      };

interface Gesture {
    drag: Drag;
    /** Where the press was: client and map pixels. */
    readonly client: Point;
    readonly start: Point;
    readonly view: ToolView;
    /** The markers the tool may take, as at the press. */
    readonly entries: readonly EditableMarker[];
    /** The latest map position and modifiers. */
    position: Point;
    modifiers: Readonly<ToolModifiers>;
    /** Shift or Ctrl was held at the press. */
    readonly adding: boolean;
}

let gesture: Gesture | null = null;

/** The lone selected rectangle or ellipse of `entries`, which takes the handles; or null. */
export function handleTarget(
    entries: readonly EditableMarker[],
    selected: readonly number[],
): EditableMarker | null {
    if (selected.length !== 1) return null;
    const entry = entries.find(({ marker }) => marker.id === selected[0]);
    return entry && resizable(entry.marker) ? entry : null;
}

/** The shapes of a move by the pointer from `start` to `position`, by marker ID. */
function moved(context: ToolContext, current: Gesture, drag: Extract<Drag, { kind: "move" }>) {
    const offset = snappedMove(
        drag.align,
        current.position.x - current.start.x,
        current.position.y - current.start.y,
        context.map,
        snapping(invertsSnap(current.modifiers)),
    );
    const shapes = new Map<number, Shape>();
    for (const { marker } of drag.markers)
        shapes.set(marker.id, moveShape(marker, offset.x, offset.y));
    return { offset, shapes };
}

/**
 * The box of a resize by the pointer at `position` (Tiled's `ObjectSelectionTool`): the handle
 * moves with the pointer from where it was grabbed and snaps (Alt inverts it); Ctrl keeps the
 * aspect. The box's sides go to whole pixels, as every position the tools make (SPEC §8).
 */
function resizedBox(
    context: ToolContext,
    current: Gesture,
    drag: Extract<Drag, { kind: "resize" }>,
) {
    const local = {
        x: current.position.x - drag.entry.shift.x + drag.grab.x,
        y: current.position.y - drag.entry.shift.y + drag.grab.y,
    };
    const point = snapPoint(local, context.map, snapping(current.modifiers.alt));
    const box = scaleBox(drag.box, drag.handle, point, current.modifiers.ctrl);
    const left = Math.round(box.x);
    const top = Math.round(box.y);
    return {
        x: left,
        y: top,
        width: Math.round(box.x + box.width) - left,
        height: Math.round(box.y + box.height) - top,
    };
}

/** Shows what the drag in progress makes now. */
function show(context: ToolContext, current: Gesture): void {
    const { drag } = current;
    switch (drag.kind) {
        case "pending":
            return;
        case "band":
            setMarkerPreview({ band: bandOf(current.start, current.position) });
            return;
        case "move":
            setMarkerDraft({ mapId: context.map.id, shapes: moved(context, current, drag).shapes });
            return;
        case "resize": {
            if (!drag.dragging) return;
            const box = resizedBox(context, current, drag);
            setMarkerDraft({
                mapId: context.map.id,
                shapes: new Map([
                    [drag.entry.marker.id, fitShape(drag.entry.marker as Shape, box)],
                ]),
            });
        }
    }
}

/** A pending press became a drag: a move of the markers, or a rubber band. */
function beginDrag(context: ToolContext, current: Gesture, hit: EditableMarker | null): void {
    if (hit && !current.modifiers.shift) {
        let ids = selectedMarkerIds(context.session, context.map);
        if (!ids.includes(hit.marker.id)) {
            ids = [hit.marker.id];
            setMarkerSelection(ids, context.map.id);
        }
        const markers = current.entries.filter(({ marker }) => ids.includes(marker.id));
        current.drag = { kind: "move", markers, align: alignOf(markers.map((m) => m.marker))! };
        return;
    }
    current.drag = { kind: "band", add: current.adding };
}

function update(
    context: ToolContext,
    position: Point,
    modifiers: Readonly<ToolModifiers>,
    client?: Point,
) {
    const current = gesture;
    if (!current) return;
    current.position = position;
    current.modifiers = modifiers;
    const { drag } = current;
    if (drag.kind === "pending" || (drag.kind === "resize" && !drag.dragging)) {
        if (!client) return;
        const travel =
            Math.abs(client.x - current.client.x) + Math.abs(client.y - current.client.y);
        if (travel < DRAG_DISTANCE_CSS) return;
        if (drag.kind === "pending") beginDrag(context, current, drag.hit);
        else drag.dragging = true;
    }
    show(context, current);
}

function end(): void {
    gesture = null;
    setMarkerDraft(null);
    clearMarkerPreview();
}

/** A click with no drag: Tiled's selection rules. */
function click(context: ToolContext, current: Gesture, hit: EditableMarker | null): void {
    const ids = selectedMarkerIds(context.session, context.map);
    if (hit) {
        const id = hit.marker.id;
        if (current.adding) {
            setMarkerSelection(
                ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id],
                context.map.id,
            );
        } else setMarkerSelection([id], context.map.id);
    } else if (!current.modifiers.shift) setMarkerSelection([], context.map.id);
}

export const markerSelectTool: ToolSpec = {
    id: "markerSelect",
    label: "Select",
    hint: "Shift: add or band · Ctrl: snap while moving, aspect while resizing · Alt: snap while resizing, enclosed band",
    cursor: "default",
    onDown(context, pointer) {
        end();
        if (pointer.button !== "primary") return;
        const view = toolView(context);
        const entries = editableMarkers(context.map, view.centre);
        const selected = selectedMarkerIds(context.session, context.map);
        const base = {
            client: pointer.client,
            start: pointer.position,
            view,
            entries,
            position: pointer.position,
            modifiers: pointer.modifiers,
            adding: pointer.modifiers.shift || pointer.modifiers.ctrl,
        };
        const target = handleTarget(entries, selected);
        if (target && resizable(target.marker)) {
            const local = {
                x: pointer.position.x - target.shift.x,
                y: pointer.position.y - target.shift.y,
            };
            const box = {
                x: target.marker.x,
                y: target.marker.y,
                width: target.marker.width,
                height: target.marker.height,
            };
            const hit = hitBox(box, local, view.scale, view.dpr);
            if (hit.kind === "handle") {
                const at = handlePoints(box).find((each) => each.id === hit.handle)!.point;
                const grab = { x: at.x - local.x, y: at.y - local.y };
                gesture = {
                    ...base,
                    drag: {
                        kind: "resize",
                        entry: target,
                        handle: hit.handle,
                        box,
                        grab,
                        dragging: false,
                    },
                };
                return;
            }
        }
        const prefer = viewPreferences.getState().highlightLayer ? context.layerId : null;
        const hit = markerAt(
            entries,
            pointer.position,
            HIT_REACH_CSS * view.cssPixel,
            view.cssPixel,
            prefer,
        );
        gesture = { ...base, drag: { kind: "pending", hit } };
    },
    onMove(context, pointer: ToolPointer) {
        update(context, pointer.position, pointer.modifiers, pointer.client);
    },
    onKey(context, key) {
        // A modifier pressed or released mid-drag changes the snapping or the aspect at once.
        if (gesture && ["Shift", "Ctrl", "Alt"].includes(key.key)) {
            update(context, gesture.position, key.modifiers);
        }
        return false;
    },
    onUp(context, pointer) {
        const current = gesture;
        if (!current) return;
        update(context, pointer.position, pointer.modifiers, pointer.client);
        const { drag } = current;
        end();
        switch (drag.kind) {
            case "pending":
                click(context, current, drag.hit);
                return;
            case "band": {
                const band = bandOf(current.start, current.position);
                const taken = markersInBand(current.entries, band, current.modifiers.alt).map(
                    ({ marker }) => marker.id,
                );
                const ids = drag.add
                    ? [...selectedMarkerIds(context.session, context.map), ...taken]
                    : taken;
                setMarkerSelection(ids, context.map.id);
                return;
            }
            case "move": {
                const { offset } = moved(context, current, drag);
                if (offset.x === 0 && offset.y === 0) return;
                const ids = drag.markers.map(({ marker }) => marker.id);
                runMarkerCommand(context, () =>
                    moveMarkersCommand(
                        context.session.project,
                        context.map.id,
                        ids,
                        offset.x,
                        offset.y,
                    ),
                );
                return;
            }
            case "resize": {
                if (!drag.dragging) return;
                const box = resizedBox(context, current, drag);
                if (
                    box.x === drag.box.x &&
                    box.y === drag.box.y &&
                    box.width === drag.box.width &&
                    box.height === drag.box.height
                ) {
                    return;
                }
                runMarkerCommand(context, () =>
                    resizeMarkerCommand(
                        context.session.project,
                        context.map.id,
                        drag.entry.marker.id,
                        box,
                    ),
                );
            }
        }
    },
    onCancel() {
        end();
    },
};

export const tools: ToolSpec[] = [markerSelectTool];
