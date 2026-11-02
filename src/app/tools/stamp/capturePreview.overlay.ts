import { fillRects } from "../../overlay/draw";
import type { OverlayFrame, OverlayLayer } from "../../overlay/types";
import { toolPipeline } from "../appPipeline";
import { cellDeviceRect, clipToMap, outlineRects } from "../cellOutline";
import { captureArea, subscribeCapture } from "./capture";

// The preview of a capture in progress (SPEC §4.2, Tiled's brush outline of the captured
// area): a 1 px `--accent` outline of its rectangle, cut at the map's edge, drawn while a right
// drag of a tool with capture is held. The stamp preview gives way to it.

function drawCapturePreview(frame: OverlayFrame): void {
    const { cursor, map, mapping, context, theme } = frame;
    if (!cursor || toolPipeline.strokeButton !== "secondary") return;
    const area = captureArea(cursor.cell);
    const inside = area && clipToMap(area, map);
    if (!inside) return;
    fillRects(context, outlineRects(cellDeviceRect(mapping, inside)), theme.accent);
}

export const overlayLayers: OverlayLayer[] = [
    {
        id: "capture-preview",
        order: 600,
        draw: drawCapturePreview,
        watch(redraw) {
            return subscribeCapture(redraw);
        },
    },
];
