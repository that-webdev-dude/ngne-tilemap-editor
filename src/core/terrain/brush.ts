import type { TerrainSetType } from "../model";
import { pointsOnLine } from "../raster/line";
import type { PixelPoint } from "../raster/line";
import { TerrainFiller } from "./filler";
import type { TerrainFillResult, TerrainFillerOptions } from "./filler";
import { brushIndexAt } from "./pick";
import {
    BOTTOM,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
    LEFT,
    RIGHT,
    TOP,
    TOP_LEFT,
    TOP_RIGHT,
    isCorner,
} from "./wangId";
import type { WangIndex } from "./wangId";

// The terrain brush's painting (SPEC §5.3): Tiled's `WangBrush` (`src/tiled/wangbrush.cpp`, tag
// v1.12.2) on orthogonal fixed maps. `brushTargetAt` is its `mouseMoved` (where the pointer
// paints), `brushStep` its `updateBrush` and `updateBrushAt` (the constraints of one paint
// step, rotational symmetry, the filler with corrections on). The app's tool keeps the state
// between steps: the painting mode, the previous target of a drag and the start of a line.

/**
 * Where the brush paints: Tiled's `mPaintPoint` and `mWangIndex`. In corner mode, and for a
 * corner in mixed mode, `point` is a grid vertex (the top-left corner of cell `point`) and
 * `index` is `TOP_LEFT`; otherwise `point` is a cell and `index` one of its edges. `index` is
 * null at the centre of a mixed-mode cell, which paints nothing, and in full tile mode.
 */
export interface BrushTarget {
    readonly point: PixelPoint;
    readonly index: WangIndex | null;
}

/** How a paint step joins its points (Tiled's `BrushBehavior`). */
export type BrushBehaviour = "single" | "drag" | "line";

/** The edge a step from `from` to `to` crosses into `to`: Left when it moves right, and so on. */
function travelIndex(from: PixelPoint, to: PixelPoint, otherwise: WangIndex | null) {
    if (to.x > from.x) return LEFT;
    if (to.x < from.x) return RIGHT;
    if (to.y > from.y) return TOP;
    if (to.y < from.y) return BOTTOM;
    return otherwise;
}

/**
 * Where the brush paints with the pointer at `(cx, cy)`, in cells with their fraction
 * (Tiled's `mouseMoved` and `tilePositionChanged`). `mode` is the painting mode
 * (`effectiveTypeForColor`). In full tile mode it is the cell under the pointer. Corner mode
 * rounds to the nearest vertex; edge mode picks the edge by the cell's diagonals; mixed mode
 * uses the cell's 3 × 3 grid, its corners naming the vertex they touch (`brushIndexAt`).
 * `drag` is the target before this one while the button is held: in edge mode, a pointer
 * that stays in the same row or column keeps its edge, or takes the edge it crossed.
 */
export function brushTargetAt(
    mode: TerrainSetType,
    tileMode: boolean,
    cx: number,
    cy: number,
    drag: BrushTarget | null = null,
): BrushTarget {
    const x = Math.floor(cx);
    const y = Math.floor(cy);
    if (tileMode) return { point: { x, y }, index: null };
    const index = brushIndexAt(mode, cx - x, cy - y);
    if (mode === "edge" && drag && (x === drag.point.x || y === drag.point.y)) {
        return { point: { x, y }, index: travelIndex(drag.point, { x, y }, drag.index) };
    }
    if (mode === "edge" || index === null || !isCorner(index)) return { point: { x, y }, index };
    const dx = index === TOP_RIGHT || index === BOTTOM_RIGHT ? 1 : 0;
    const dy = index === BOTTOM_LEFT || index === BOTTOM_RIGHT ? 1 : 0;
    return { point: { x: x + dx, y: y + dy }, index: TOP_LEFT };
}

/** One paint step of the brush (Tiled's `updateBrush` followed by `doPaint`). */
export interface BrushStep {
    /** The painting mode: `effectiveTypeForColor` of the set and terrain. */
    readonly mode: TerrainSetType;
    /** Full tile mode (Tiled's `mIsTileMode`: the toggle, inverted while Ctrl is held). */
    readonly tileMode: boolean;
    readonly behaviour: BrushBehaviour;
    /**
     * For a drag, the point painted before (`mPrevPaintPoint`); for a line, its start
     * (`mLineStartPos`). Ignored for a single step.
     */
    readonly from: PixelPoint | null;
    readonly to: BrushTarget;
    /** The terrain, 0 to erase it. */
    readonly color: number;
    /** Rotational symmetry (Alt). */
    readonly symmetry: boolean;
}

export interface BrushStepResult extends TerrainFillResult {
    /**
     * The edge index after the step: in edge mode a step of several points takes the edge of
     * the direction it moved last (Tiled sets `mWangIndex` as it goes); otherwise `to.index`.
     */
    readonly index: WangIndex | null;
}

/**
 * Runs one paint step of the brush on the layer `options.back` holds: its constraints, the
 * symmetric ones with `symmetry`, and the filler with corrections on (SPEC §5.3). The result
 * is the cell patch to write and the invalid cells, which stay unchanged.
 */
export function brushStep(
    options: Omit<TerrainFillerOptions, "corrections">,
    step: BrushStep,
): BrushStepResult {
    const filler = new TerrainFiller({ ...options, corrections: true });
    const { mode, tileMode, behaviour, from, to, color } = step;
    const forceTile = tileMode || (behaviour === "line" && mode === "mixed");
    let index = to.index;

    const paintAt = (point: PixelPoint) => {
        // Tiled draws lines of a mixed set in full tile mode: thinner ones do not work there.
        if (forceTile) {
            filler.setFullTile(point.x, point.y, color);
            return;
        }
        if (index === null) return;
        if (mode === "corner" || (mode === "mixed" && isCorner(index))) {
            filler.setCorner(point.x, point.y, color);
        } else {
            filler.setEdge(point.x, point.y, index, color);
        }
    };

    let points: PixelPoint[] = [to.point];
    let ignoreFirst = false;
    if (behaviour === "line" && from) {
        points = pointsOnLine(from, to.point, !tileMode && mode !== "mixed");
    } else if (behaviour === "drag" && from && (mode !== "mixed" || tileMode)) {
        points = pointsOnLine(from, to.point, !tileMode);
        // The first point was painted by the step before.
        ignoreFirst = points.length > 1;
    }

    if (points.length > 1 && mode === "edge") {
        for (let i = 1; i < points.length; i++) {
            index = travelIndex(points[i - 1]!, points[i]!, index);
            paintAt(points[i]!);
        }
    } else {
        for (let i = ignoreFirst ? 1 : 0; i < points.length; i++) paintAt(points[i]!);
    }

    if (step.symmetry) filler.mirror();
    return { ...filler.apply(), index };
}

/**
 * The target `target` turned by 180° about the map's centre, as rotational symmetry paints
 * it: the vertex `(width − x, height − y)`, or the cell `(width − x − 1, height − y − 1)` with
 * the opposite edge.
 */
export function mirroredTarget(
    target: BrushTarget,
    tileMode: boolean,
    width: number,
    height: number,
): BrushTarget {
    const { point, index } = target;
    if (!tileMode && index === TOP_LEFT) {
        return { point: { x: width - point.x, y: height - point.y }, index };
    }
    return {
        point: { x: width - point.x - 1, y: height - point.y - 1 },
        index: index === null ? null : (((index + 4) % 8) as WangIndex),
    };
}
