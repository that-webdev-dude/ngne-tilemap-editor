import { Circle } from "lucide-react";
import type { CellRect, Stamp } from "../../../core/cells";
import { ellipseRegion, rectRegion } from "../../../core/fill";
import type { ProjectMap } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster/line";
import { clipToMap } from "../cellOutline";
import { spanRect } from "../eraser/eraser.tools";
import { withCapture } from "../stamp/capture";
import { currentStamp } from "../stamp/currentStamp";
import { stampIsEmpty } from "../stamp/placement";
import { STAMP_TRANSFORM_ACTIONS } from "../stamp/stamp.tools";
import type { ToolModifiers, ToolSpec } from "../types";
import { FILL_MODE_OPTION, paintPlan } from "./fillPlan";
import type { FillPlan } from "./fillPlan";

// The shape fill (SPEC §4.3), Tiled's `ShapeFillTool` (`src/tiled/shapefilltool.cpp`, checked
// at v1.12.2) in its Tile fill mode, as two variants of one rail slot (DESIGN §6): Rectangle
// (U, the slot planned in `planned.tools.ts`) and Ellipse (Shift+U); U pressed again switches
// between them, as does the context bar's Rectangle / Ellipse choice. The overlay preview is
// `fillPreview.overlay.ts`.
//
//   press, drag: the shape from the pressed cell to the pointer's (`QRect::span`), previewed
//   Shift: a square or a circle, the shorter side's length both ways
//   Alt: centred on the pressed cell
//   release: fills the rectangle, or the ellipse inscribed in it (Tiled's `ellipseRegion`),
//     with the stamp tiled from the shape's top-left (`TileFill`), one history entry
//   right click or Escape during the drag: cancelled, nothing filled
//
// The modifiers count as they are at each sample and at the release. A right drag that is not
// part of a left one captures a stamp (`capture.ts`).

export type FillShape = "rectangle" | "ellipse";

/** The drag in progress: the pressed cell and the stamp of the press. */
interface ShapeDrag {
    readonly shape: FillShape;
    readonly start: PixelPoint;
    readonly stamp: Stamp;
}

let drag: ShapeDrag | null = null;
const listeners = new Set<() => void>();
const changed = () => {
    for (const listener of [...listeners]) listener();
};

/** Calls `listener` when a drag began or ended. */
export function subscribeShapeFill(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * The rectangle of a drag from `start` to `end` with `modifiers` (Tiled's
 * `updateFillOverlay`): Shift makes it square with the shorter side, Alt centres it on `start`.
 */
export function shapeArea(
    start: PixelPoint,
    end: PixelPoint,
    modifiers: Pick<ToolModifiers, "shift" | "alt">,
): CellRect {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    if (modifiers.shift) {
        const side = Math.min(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx) * side;
        dy = Math.sign(dy) * side;
    }
    const from = modifiers.alt ? { x: start.x - dx, y: start.y - dy } : start;
    return spanRect(from, { x: start.x + dx, y: start.y + dy });
}

/**
 * The fill of `shape` over `area` in `map`: its cells inside the map, the stamp tiled from the
 * whole shape's top-left (outside the map, too). Null when no cell is inside the map.
 */
export function shapePlan(
    shape: FillShape,
    area: CellRect,
    map: Pick<ProjectMap, "width" | "height">,
    stamp: Stamp,
): FillPlan | null {
    const clip = clipToMap(area, map);
    if (!clip) return null;
    // Both shapes touch every side of the area: its top-left is theirs.
    const region = shape === "rectangle" ? rectRegion(clip) : ellipseRegion(area, clip);
    if (region.length === 0) return null;
    return { region, origin: { x: area.x, y: area.y }, stamp };
}

/**
 * The fill the drag in progress makes if it is released on `cell` with `modifiers` held; null
 * while no drag is in progress or it fills nothing.
 */
export function shapeDragPlan(
    map: Pick<ProjectMap, "width" | "height">,
    cell: PixelPoint,
    modifiers: Pick<ToolModifiers, "shift" | "alt">,
): FillPlan | null {
    const current = drag;
    if (!current) return null;
    return shapePlan(current.shape, shapeArea(current.start, cell, modifiers), map, current.stamp);
}

function shapeFillTool(
    shape: FillShape,
    spec: Pick<ToolSpec, "id" | "label" | "variantLabel" | "variantOf" | "shortcut" | "icon">,
): ToolSpec {
    return withCapture({
        ...spec,
        paints: true,
        hint: "Shift: square · Alt: from the centre · Right click, Esc: cancel",
        options: [FILL_MODE_OPTION],
        actions: STAMP_TRANSFORM_ACTIONS,
        onDown(context, pointer) {
            // A drag whose commit was refused ended without `onCommit` or `onCancel`.
            drag = null;
            if (!context.paint || pointer.button !== "primary") return;
            const stamp = currentStamp();
            if (!stamp || stampIsEmpty(stamp)) {
                context.feedback("No stamp");
                return;
            }
            drag = { shape, start: pointer.cell, stamp };
            changed();
        },
        onUp(context, pointer) {
            const { paint } = context;
            const plan = paint && shapeDragPlan(paint.map, pointer.cell, pointer.modifiers);
            if (paint && plan) paintPlan(paint, plan);
        },
        onCommit() {
            drag = null;
            changed();
        },
        onCancel() {
            drag = null;
            changed();
        },
    });
}

export const rectangleFillTool = shapeFillTool("rectangle", {
    id: "shapeFill",
    label: "Rectangle Fill",
    variantLabel: "Rectangle",
});

export const ellipseFillTool = shapeFillTool("ellipse", {
    id: "shapeFillEllipse",
    label: "Ellipse Fill",
    variantLabel: "Ellipse",
    variantOf: "shapeFill",
    shortcut: "Shift+U",
    icon: Circle,
});

export const tools: ToolSpec[] = [rectangleFillTool, ellipseFillTool];
