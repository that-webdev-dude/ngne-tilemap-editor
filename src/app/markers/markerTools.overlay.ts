import { shapeBox } from "../../core/model";
import type { ShapeBox } from "../../core/model";
import { cssColour } from "../overlay/draw";
import type { OverlayFrame, OverlayLayer } from "../overlay/types";
import { HANDLE_SIZE, handlePoints } from "../selection/transform/handles";
import { sessionStore } from "../state/session";
import { toolState } from "../tools/activeTool";
import { activeMap } from "../tools/toolSets";
import type { Point } from "../view/coordinates";
import { PIN_SIZE, traceShape } from "./markerDrawing";
import { editableMarkers, resizable } from "./markerGeometry";
import { markerPreview, subscribeMarkerPreview } from "./markerPreview";
import { drawMarkerPoints } from "./points/markerPointsDrawing";
import { subscribeChosenVertex } from "./points/markerVertex";
import {
    drawnShape,
    selectedMarkerIds,
    selectedMarkers,
    subscribeMarkerDraft,
} from "./markerSelection";

// What the marker tools draw over the markers (DESIGN §4; TE-038), in `--accent`:
//
//   - each selected marker's box, dashed 1 CSS px (a point's round its pin), where a drag puts it;
//   - with the select tool active, the 8 handles of a lone selected rectangle or ellipse
//     (`handles.ts`): squares of `HANDLE_SIZE` CSS px in `--bg-panel` with an accent edge;
//   - the select tool's rubber band, 1 px with a 10% fill;
//   - the marker a create tool is making: its outline, a polygon's or polyline's points as small
//     squares and a dashed segment to where the next point would go;
//   - with the Edit points tool active, the points of the selected polygons and polylines, the
//     chosen one filled (TE-039, `markerPointsDrawing.ts`).
//
// Above the markers (450) and the tile selection's ants (500), below the tile tools' previews
// (600), which a marker layer never shows.

export const MARKER_TOOLS_ORDER = 550;

/** Dash of selection boxes and of the next segment, CSS pixels. */
const DASH = 4;
/** The side of a point's square in a polygon in progress, CSS pixels. */
const VERTEX_SIZE = 5;
/** The band's fill alpha. */
const BAND_ALPHA = 0.1;

/**
 * Where each drawn marker of the active map is drawn from its position, by ID. Locked layers
 * count: a marker of a layer locked after it was selected keeps its box.
 */
function shiftsOf(frame: OverlayFrame): Map<number, Point> {
    const shifts = new Map<number, Point>();
    for (const entry of editableMarkers(frame.map, frame.mapping.frame.view, true)) {
        shifts.set(entry.marker.id, entry.shift);
    }
    return shifts;
}

/** A device rectangle of a box of map pixels moved by `shift`. */
function deviceBox(frame: OverlayFrame, box: ShapeBox, shift: Point) {
    const a = frame.mapping.mapToDevice(box.x + shift.x, box.y + shift.y);
    const b = frame.mapping.mapToDevice(box.x + box.width + shift.x, box.y + box.height + shift.y);
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

function drawSelection(frame: OverlayFrame): void {
    const { context, map, mapping, theme } = frame;
    const { session } = sessionStore.getState();
    if (activeMap(session)?.id !== map.id) return;
    const ids = selectedMarkerIds(session, map);
    if (ids.length === 0) return;
    const { dpr } = mapping.frame;
    const shifts = shiftsOf(frame);
    context.save();
    context.lineWidth = dpr;
    context.strokeStyle = cssColour(theme.accent);
    context.setLineDash([DASH * dpr, DASH * dpr]);
    context.beginPath();
    for (const marker of selectedMarkers(session, map)) {
        const shift = shifts.get(marker.id);
        if (!shift) continue;
        const shape = drawnShape(marker, map.id);
        let rect = deviceBox(frame, shapeBox(shape), shift);
        if (shape.shape === "point") {
            // Round the pin: its tip at the bottom middle.
            const width = (PIN_SIZE * 2) / 3 + 4;
            const height = PIN_SIZE + 4;
            rect = {
                x: rect.x - (width / 2) * dpr,
                y: rect.y - (height - 4) * dpr,
                width: width * dpr,
                height: height * dpr,
            };
        }
        context.rect(
            Math.round(rect.x) + 0.5,
            Math.round(rect.y) + 0.5,
            Math.round(rect.width),
            Math.round(rect.height),
        );
    }
    context.stroke();
    context.restore();

    // Handles of a lone selected rectangle or ellipse, with the select tool.
    const lone = selectedMarkers(session, map);
    if (toolState.activeId() !== "markerSelect" || lone.length !== 1) return;
    const shape = drawnShape(lone[0]!, map.id);
    const shift = shifts.get(lone[0]!.id);
    if (!resizable(shape) || !shift) return;
    const side = HANDLE_SIZE * dpr;
    context.save();
    context.lineWidth = dpr;
    context.fillStyle = cssColour(theme.panel);
    context.strokeStyle = cssColour(theme.accent);
    context.beginPath();
    for (const { point } of handlePoints(shapeBox(shape))) {
        const at = mapping.mapToDevice(point.x + shift.x, point.y + shift.y);
        context.rect(
            Math.round(at.x - side / 2) + 0.5,
            Math.round(at.y - side / 2) + 0.5,
            side - 1,
            side - 1,
        );
    }
    context.fill();
    context.stroke();
    context.restore();
}

function drawPreview(frame: OverlayFrame): void {
    const { context, mapping, theme } = frame;
    const { band, creating } = markerPreview();
    const { dpr } = mapping.frame;
    if (band) {
        const rect = deviceBox(frame, band, { x: 0, y: 0 });
        context.save();
        context.fillStyle = cssColour(theme.accent, BAND_ALPHA);
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
        context.lineWidth = dpr;
        context.strokeStyle = cssColour(theme.accent);
        context.strokeRect(
            Math.round(rect.x) + 0.5,
            Math.round(rect.y) + 0.5,
            Math.round(rect.width),
            Math.round(rect.height),
        );
        context.restore();
    }
    if (!creating) return;
    const { shape, next, shift } = creating;
    context.save();
    context.lineWidth = 1.5 * dpr;
    context.lineJoin = "round";
    context.strokeStyle = cssColour(theme.accent);
    context.fillStyle = cssColour(theme.accent);
    const scale = mapping.scale;
    const origin = mapping.mapToDevice(shift.x, shift.y);
    if (shape.shape === "point") {
        const at = mapping.mapToDevice(shape.x + shift.x, shape.y + shift.y);
        const size = VERTEX_SIZE * dpr;
        context.fillRect(at.x - size / 2, at.y - size / 2, size, size);
    } else {
        context.beginPath();
        context.save();
        context.setTransform(scale, 0, 0, scale, origin.x, origin.y);
        traceShape(context, shape);
        context.restore();
        context.stroke();
    }
    if ((shape.shape === "polygon" || shape.shape === "polyline") && shape.points.length > 0) {
        const size = VERTEX_SIZE * dpr;
        for (const [px, py] of shape.points) {
            const at = mapping.mapToDevice(shape.x + px + shift.x, shape.y + py + shift.y);
            context.fillRect(at.x - size / 2, at.y - size / 2, size, size);
        }
        if (next) {
            const [lx, ly] = shape.points[shape.points.length - 1]!;
            const from = mapping.mapToDevice(shape.x + lx + shift.x, shape.y + ly + shift.y);
            const to = mapping.mapToDevice(next.x + shift.x, next.y + shift.y);
            context.setLineDash([DASH * dpr, DASH * dpr]);
            context.lineWidth = dpr;
            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.stroke();
        }
    }
    context.restore();
}

export const overlayLayers: OverlayLayer[] = [
    {
        id: "marker-tools",
        order: MARKER_TOOLS_ORDER,
        draw(frame) {
            drawSelection(frame);
            drawMarkerPoints(frame);
            drawPreview(frame);
        },
        // The selection (session state), a drag's draft, the tools' previews, the chosen point,
        // the active tool.
        watch(redraw) {
            const stops = [
                sessionStore.subscribe(redraw),
                subscribeMarkerDraft(redraw),
                subscribeMarkerPreview(redraw),
                subscribeChosenVertex(redraw),
                toolState.subscribe(redraw),
            ];
            return () => stops.forEach((stop) => stop());
        },
    },
];
