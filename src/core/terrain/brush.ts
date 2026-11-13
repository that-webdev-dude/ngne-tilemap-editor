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
    oppositeIndex,
} from "./wangId";
import type { WangIndex } from "./wangId";

// One paint step of the terrain brush (SPEC §5.3) on the terrain filler of §5.2, with
// corrections on. A step paints a vertex (corner mode, and corners of a mixed set), an edge, or
// a whole tile with its shared neighbour indexes (full tile mode, and lines of a mixed set).
// Drags and lines join the previous point to the new one cell by cell, without diagonal steps
// where the mode needs neighbouring cells to share a side; in edge mode the painted edge
// follows the direction of travel. Symmetry repeats the constraints turned 180° about the map's
// centre.

/** Where the brush paints: a cell and its index, or a vertex (`TOP_LEFT` of its cell). */
export interface BrushTarget {
    readonly point: PixelPoint;
    readonly index: WangIndex | null;
}

/** How a step joins its target to the point before. */
export type BrushBehaviour = "single" | "drag" | "line";

/** One paint step. */
export interface BrushStep {
    /** Painting mode: the effective type of the terrain in its set. */
    readonly mode: TerrainSetType;
    /** Full tile mode. */
    readonly tileMode: boolean;
    readonly behaviour: BrushBehaviour;
    /** Drag: the point painted before; line: the line's start. */
    readonly from: PixelPoint | null;
    readonly to: BrushTarget;
    /** The terrain; 0 erases. */
    readonly color: number;
    /** Rotational symmetry. */
    readonly symmetry: boolean;
}

/** A step's fill result and the index it ended on. */
export interface BrushStepResult extends TerrainFillResult {
    readonly index: WangIndex | null;
}

/**
 * The edge through which a move from cell `a` to cell `b` enters `b`, the horizontal move
 * first; `fallback` when the cells are the same.
 */
function travelEdge(a: PixelPoint, b: PixelPoint, fallback: WangIndex | null): WangIndex | null {
    if (b.x > a.x) return LEFT;
    if (b.x < a.x) return RIGHT;
    if (b.y > a.y) return TOP;
    if (b.y < a.y) return BOTTOM;
    return fallback;
}

/**
 * The target under the pointer at fractional cell position `(cx, cy)`. During an edge drag
 * that stays in the row or column of `drag`, the edge follows the direction of travel.
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
    const point = { x, y };
    if (tileMode) return { point, index: null };
    const index = brushIndexAt(mode, cx - x, cy - y);
    if (mode === "edge" && drag && (drag.point.x === x || drag.point.y === y)) {
        return { point, index: travelEdge(drag.point, point, drag.index) };
    }
    if (mode === "edge" || index === null || !isCorner(index)) return { point, index };
    const right = index === TOP_RIGHT || index === BOTTOM_RIGHT;
    const bottom = index === BOTTOM_RIGHT || index === BOTTOM_LEFT;
    return { point: { x: right ? x + 1 : x, y: bottom ? y + 1 : y }, index: TOP_LEFT };
}

/** The points a step paints, and whether its first point was painted by the step before. */
function stepPoints(step: BrushStep): { points: PixelPoint[]; skipFirst: boolean } {
    const { behaviour, from, to, mode, tileMode } = step;
    if (behaviour === "line" && from) {
        return {
            points: pointsOnLine(from, to.point, !tileMode && mode !== "mixed"),
            skipFirst: false,
        };
    }
    if (behaviour === "drag" && from && (mode !== "mixed" || tileMode)) {
        const points = pointsOnLine(from, to.point, !tileMode);
        return { points, skipFirst: points.length > 1 };
    }
    return { points: [to.point], skipFirst: false };
}

/** Paints one point of a step at `index`. */
function paintAt(
    filler: TerrainFiller,
    step: BrushStep,
    forceTile: boolean,
    point: PixelPoint,
    index: WangIndex | null,
): void {
    const { x, y } = point;
    if (forceTile) filler.setFullTile(x, y, step.color);
    else if (index === null) return;
    else if (step.mode === "corner" || (step.mode === "mixed" && isCorner(index))) {
        filler.setCorner(x, y, step.color);
    } else filler.setEdge(x, y, index, step.color);
}

/** Runs one paint step of the brush on a filler with corrections on. */
export function brushStep(
    options: Omit<TerrainFillerOptions, "corrections">,
    step: BrushStep,
): BrushStepResult {
    const filler = new TerrainFiller({ ...options, corrections: true });
    const forceTile = step.tileMode || (step.behaviour === "line" && step.mode === "mixed");
    const { points, skipFirst } = stepPoints(step);
    let index = step.to.index;
    if (step.mode === "edge" && points.length > 1) {
        for (let k = 1; k < points.length; k++) {
            index = travelEdge(points[k - 1], points[k], index);
            paintAt(filler, step, forceTile, points[k], index);
        }
    } else {
        for (let k = skipFirst ? 1 : 0; k < points.length; k++) {
            paintAt(filler, step, forceTile, points[k], index);
        }
    }
    if (step.symmetry) filler.mirror();
    return { ...filler.apply(), index };
}

/**
 * `target` turned 180° about the map's centre: a vertex to the vertex `(width − x,
 * height − y)`, a cell to `(width − x − 1, height − y − 1)` with its index turned by 4.
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
        index: index === null ? null : oppositeIndex(index),
    };
}
