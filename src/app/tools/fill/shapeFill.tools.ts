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
import type { Region } from "../../../core/fill";
import type { TerrainAnalysis } from "../../../core/terrain";
import { sessionStore } from "../../state/session";
import { brushSource } from "../terrain/brushSource";
import { FILL_MODE_OPTION, fillModeOf, paintPlan } from "./fillPlan";
import type { FillPlan } from "./fillPlan";
import { terrainFillPlan } from "./terrainFill";

// The shape fill (SPEC §4.3), Tiled's `ShapeFillTool` (`src/tiled/shapefilltool.cpp`, checked
// at v1.12.2) in its Tile and Terrain fill modes (Terrain: `terrainFill.ts`), as two variants of one rail slot (DESIGN §6): Rectangle
// (U, the slot planned in `planned.tools.ts`) and Ellipse (Shift+U); U pressed again switches
// between them, as does the context bar's Rectangle / Ellipse choice. The overlay preview is
// `fillPreview.overlay.ts`.
//
//   press, drag: the shape from the pressed cell to the pointer's (`QRect::span`), previewed
//   Shift: a square or a circle, the shorter side's length both ways
//   Alt: centred on the pressed cell
//   release: fills the rectangle, or the ellipse inscribed in it (Tiled's `ellipseRegion`),
//     with the stamp tiled from the shape's top-left (`TileFill`), or in Terrain mode with the
//     tiles of the brush's terrain set that match the cells around it (`wangFill`), one
//     history entry
//   right click or Escape during the drag: cancelled, nothing filled
//
// The modifiers count as they are at each sample and at the release. A right drag that is not
// part of a left one captures a stamp (`capture.ts`).

export type FillShape = "rectangle" | "ellipse";

/**
 * The drag in progress: the pressed cell and, by the fill mode of the press, its stamp or the
 * brush's terrain set with the layer it fills.
 */
interface ShapeDrag {
    readonly shape: FillShape;
    readonly start: PixelPoint;
    readonly fill:
        | { readonly mode: "tile"; readonly stamp: Stamp }
        | {
              readonly mode: "terrain";
              readonly analysis: TerrainAnalysis;
              readonly layerId: number;
          };
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
    const region = shapeRegion(shape, area, map);
    // Both shapes touch every side of the area: its top-left is theirs.
    return region ? { region, origin: { x: area.x, y: area.y }, stamp } : null;
}

/** The cells of `shape` over `area` inside the map; null when there are none. */
function shapeRegion(
    shape: FillShape,
    area: CellRect,
    map: Pick<ProjectMap, "width" | "height">,
): Region | null {
    const clip = clipToMap(area, map);
    if (!clip) return null;
    const region = shape === "rectangle" ? rectRegion(clip) : ellipseRegion(area, clip);
    return region.length > 0 ? region : null;
}

/**
 * The fill the drag in progress makes if it is released on `cell` of `map` with `modifiers`
 * held; null while no drag is in progress or it fills nothing. In Terrain mode the filler is
 * given the whole shape inside the map, as Tiled's `wangFill`; the tile selection clips what
 * is written (SPEC §4.1).
 */
export function shapeDragPlan(
    map: ProjectMap,
    cell: PixelPoint,
    modifiers: Pick<ToolModifiers, "shift" | "alt">,
): FillPlan | null {
    const current = drag;
    if (!current) return null;
    const area = shapeArea(current.start, cell, modifiers);
    const { fill } = current;
    if (fill.mode === "tile") return shapePlan(current.shape, area, map, fill.stamp);
    const region = shapeRegion(current.shape, area, map);
    if (!region) return null;
    const { session, revision } = sessionStore.getState();
    return terrainFillPlan(session, revision, map, fill.layerId, fill.analysis, region);
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
            const { paint } = context;
            if (!paint || pointer.button !== "primary") return;
            if (fillModeOf(context.options) === "terrain") {
                const brush = brushSource.current();
                if (!brush) {
                    context.feedback("No terrain set");
                    return;
                }
                const { analysis } = brush;
                const fill = { mode: "terrain" as const, analysis, layerId: paint.layerId };
                drag = { shape, start: pointer.cell, fill };
            } else {
                const stamp = currentStamp();
                if (!stamp || stampIsEmpty(stamp)) {
                    context.feedback("No stamp");
                    return;
                }
                drag = { shape, start: pointer.cell, fill: { mode: "tile", stamp } };
            }
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
