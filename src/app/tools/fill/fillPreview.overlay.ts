import { regionBounds } from "../../../core/fill";
import { tileSelectionOf } from "../../../core/selection";
import { fillRects } from "../../overlay/draw";
import type { OverlayFrame, OverlayLayer } from "../../overlay/types";
import { sessionStore } from "../../state/session";
import { toolState } from "../activeTool";
import { toolPipeline } from "../appPipeline";
import { cellDeviceRect, clipToMap, outlineRects } from "../cellOutline";
import { heldModifiers, subscribeHeldModifiers } from "../heldModifiers";
import { subscribeCapture } from "../stamp/capture";
import { currentStampStore } from "../stamp/currentStamp";
import { STAMP_PREVIEW_ALPHA } from "../stamp/stampPreview.overlay";
import { drawStamp, subscribeStampImage } from "../stamp/stampImage";
import { activeLayerId } from "../toolSets";
import { bucketPlan, bucketTool, subscribeBucket } from "./bucket.tools";
import { subscribeBrushTerrain } from "../terrain/brushTerrain";
import { fillModeOf, selectedPlan } from "./fillPlan";
import type { FillPlan } from "./fillPlan";
import {
    ellipseFillTool,
    rectangleFillTool,
    shapeDragPlan,
    subscribeShapeFill,
} from "./shapeFill.tools";

// The preview of the bucket and the shape fill (DESIGN §4: fill tools preview their region as
// the stamp brush its stamp): the stamp tiled (in Terrain mode, the tiles the terrain fill
// resolved, as Tiled previews its `wangFill`) over the cells the fill would write at 60%
// opacity, the empty stamp cells clear, and the bounding box of those cells outlined 1 px in
// `--accent`. The bucket shows the region of the cell under the pointer (the whole selection or
// layer with Shift or Whole selection) until it is pressed; the shape fill the part of the
// shape of its drag inside the tile selection, and the cell under the pointer before one. A capture in progress shows its rectangle instead
// (`capturePreview.overlay.ts`).

/** Draws `plan` over the map: its spans filled with the tiled stamp, then its outline. */
function drawPlan(frame: OverlayFrame, plan: FillPlan): void {
    const { map, mapping, context, theme } = frame;
    const bounds = regionBounds(plan.region);
    if (!bounds) return;
    // The stamp tiled from the origin over the bounding box, clipped to the spans: only the
    // rows on screen.
    context.save();
    context.beginPath();
    const top = mapping.deviceToCell(0, 0).y;
    const bottom = mapping.deviceToCell(frame.size.width, frame.size.height).y;
    for (const span of plan.region) {
        if (span.y < top || span.y > bottom) continue;
        const rect = { x: span.start, y: span.y, width: span.end - span.start, height: 1 };
        const device = cellDeviceRect(mapping, rect);
        context.rect(device.x, device.y, device.width, device.height);
    }
    context.clip();
    context.globalAlpha = STAMP_PREVIEW_ALPHA;
    const project = sessionStore.getState().session.project;
    drawStamp(frame, project, plan.stamp, [{ origin: plan.origin, area: bounds }]);
    context.restore();
    const inside = clipToMap(bounds, map);
    if (inside) fillRects(context, outlineRects(cellDeviceRect(mapping, inside)), theme.accent);
}

function drawFillPreview(frame: OverlayFrame): void {
    const tool = toolPipeline.strokeTool ?? toolState.active();
    const { cursor, map, mapping, context, theme } = frame;
    if (!cursor || toolPipeline.strokeButton === "secondary") return;
    const pressed = toolPipeline.strokeTool === tool && toolPipeline.strokeButton === "primary";
    if (tool?.id === bucketTool.id) {
        if (pressed || !mapping.contains(cursor.cell)) return;
        const { session } = sessionStore.getState();
        const options = toolState.options(tool);
        const whole = heldModifiers().shift || options.wholeSelection === true;
        const layerId = activeLayerId(session, map);
        const plan = bucketPlan(map, layerId, cursor.cell, whole, fillModeOf(options));
        if (plan) drawPlan(frame, plan);
        return;
    }
    if (tool?.id !== rectangleFillTool.id && tool?.id !== ellipseFillTool.id) return;
    if (pressed) {
        const plan = shapeDragPlan(map, cursor.cell, heldModifiers());
        const selection = tileSelectionOf(sessionStore.getState().session, map.id);
        const shown = plan && selection ? selectedPlan(plan, selection) : plan;
        if (shown) drawPlan(frame, shown);
        return;
    }
    if (!mapping.contains(cursor.cell)) return;
    const cell = { x: cursor.cell.x, y: cursor.cell.y, width: 1, height: 1 };
    fillRects(context, outlineRects(cellDeviceRect(mapping, cell)), theme.accent);
}

export const overlayLayers: OverlayLayer[] = [
    {
        id: "fill-preview",
        order: 600,
        draw: drawFillPreview,
        // The stamp, the tool and its options, a press or a drag beginning or ending, a capture, the
        // modifiers (Shift fills the whole selection or layer, or squares the shape), the brush's
        // terrain set (Terrain mode), the layer's
        // cells, the tile selection and the stamp's chunks still to make.
        watch(redraw) {
            const stops = [
                currentStampStore.subscribe(redraw),
                subscribeStampImage(redraw),
                toolState.subscribe(redraw),
                subscribeBucket(redraw),
                subscribeShapeFill(redraw),
                subscribeCapture(redraw),
                subscribeHeldModifiers(redraw),
                subscribeBrushTerrain(redraw),
                sessionStore.subscribe(redraw),
            ];
            return () => stops.forEach((stop) => stop());
        },
    },
];
