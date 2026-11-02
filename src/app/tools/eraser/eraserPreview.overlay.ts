import { fillRects } from "../../overlay/draw";
import type { OverlayFrame, OverlayLayer } from "../../overlay/types";
import { toolState } from "../activeTool";
import { toolPipeline } from "../appPipeline";
import { cellDeviceRect, clipToMap, outlineRects } from "../cellOutline";
import { eraserArea, eraserTool, subscribeEraser } from "./eraser.tools";

// The eraser's preview (DESIGN §4): while the eraser is the active tool, a 1 px `--danger`
// outline of the cells it would empty, the cell under the pointer or the rectangle of a right
// drag. Cut at the map's edge; nothing when the pointer is off the map, but for the part of a
// rectangle that lies in it.

function drawEraserPreview(frame: OverlayFrame): void {
    const tool = toolPipeline.strokeTool ?? toolState.active();
    const { cursor, map, mapping, context, theme } = frame;
    if (tool?.id !== eraserTool.id || !cursor) return;
    const dragging = toolPipeline.strokeTool === tool && toolPipeline.strokeButton === "secondary";
    if (!dragging && !mapping.contains(cursor.cell)) return;
    const inside = clipToMap(eraserArea(cursor.cell, dragging), map);
    if (!inside) return;
    fillRects(context, outlineRects(cellDeviceRect(mapping, inside)), theme.danger);
}

export const overlayLayers: OverlayLayer[] = [
    {
        id: "eraser-preview",
        order: 600,
        draw: drawEraserPreview,
        watch(redraw) {
            const stops = [toolState.subscribe(redraw), subscribeEraser(redraw)];
            return () => stops.forEach((stop) => stop());
        },
    },
];
