import type { CellRect } from "../../../core/cells";
import { fillRects } from "../../overlay/draw";
import type { OverlayFrame, OverlayLayer } from "../../overlay/types";
import { sessionStore } from "../../state/session";
import { toolState } from "../activeTool";
import { toolPipeline } from "../appPipeline";
import { cellDeviceRect, clipToMap, outlineRects } from "../cellOutline";
import { heldModifiers, subscribeHeldModifiers } from "../heldModifiers";
import { captureArea, subscribeCapture } from "./capture";
import { currentStamp, currentStampStore } from "./currentStamp";
import { stampIsEmpty, stampOrigin } from "./placement";
import { brushPlacements, stampTool, subscribeStampBrush } from "./stamp.tools";
import { stampCanvas } from "./stampImage";

// The stamp brush's preview (DESIGN §4): while the brush is the active tool and the pointer is
// over a cell of the map, the stamp's tiles at 60% opacity over the cells each placement would
// paint, each placement's rectangle outlined 1 px in `--accent`; a line or an ellipse shows all
// its placements. Cut at the map's edge; nothing when the pointer is off the map, and nothing
// without a stamp. Where a press would paint nothing (a line's start not set yet) the cell
// under the pointer is outlined alone. A capture in progress shows its rectangle instead
// (`capturePreview.overlay.ts`).

/** The opacity of the preview's tiles (DESIGN §4). */
export const STAMP_PREVIEW_ALPHA = 0.6;

function drawStampPreview(frame: OverlayFrame): void {
    const tool = toolPipeline.strokeTool ?? toolState.active();
    const { cursor, map, mapping, context, theme } = frame;
    if (tool?.id !== stampTool.id || !cursor || !mapping.contains(cursor.cell)) return;
    if (captureArea(cursor.cell)) return;
    const stamp = currentStamp();
    if (!stamp || stampIsEmpty(stamp)) return;
    const pressed = toolPipeline.strokeTool === tool && toolPipeline.strokeButton === "primary";
    const placements = brushPlacements(map.id, cursor.cell, heldModifiers(), pressed);
    const outlines: CellRect[] = [];
    const area = cellDeviceRect(mapping, { x: 0, y: 0, width: map.width, height: map.height });
    context.beginPath();
    context.rect(area.x, area.y, area.width, area.height);
    context.clip();
    if (placements.length > 0) {
        const image = stampCanvas(sessionStore.getState().session.project, map, stamp);
        context.globalAlpha = STAMP_PREVIEW_ALPHA;
        context.imageSmoothingEnabled = false;
        for (const point of placements) {
            const origin = stampOrigin(stamp, point);
            const rect = { ...origin, width: stamp.width, height: stamp.height };
            const device = cellDeviceRect(mapping, rect);
            context.drawImage(image, device.x, device.y, device.width, device.height);
            outlines.push(rect);
        }
        context.globalAlpha = 1;
    } else {
        outlines.push({ x: cursor.cell.x, y: cursor.cell.y, width: 1, height: 1 });
    }
    const sides = outlines.flatMap((rect) => {
        const inside = clipToMap(rect, map);
        return inside ? outlineRects(cellDeviceRect(mapping, inside)) : [];
    });
    fillRects(context, sides, theme.accent);
}

export const overlayLayers: OverlayLayer[] = [
    {
        id: "stamp-preview",
        order: 600,
        draw: drawStampPreview,
        // The stamp, the tool, a stroke beginning or ending, the modifiers (Shift draws a
        // line) and the project's tilesets.
        watch(redraw) {
            const stops = [
                currentStampStore.subscribe(redraw),
                toolState.subscribe(redraw),
                subscribeStampBrush(redraw),
                subscribeCapture(redraw),
                subscribeHeldModifiers(redraw),
                sessionStore.subscribe(redraw),
            ];
            return () => stops.forEach((stop) => stop());
        },
    },
];
