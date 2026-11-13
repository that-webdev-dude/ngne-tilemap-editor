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
// corrections on.
//
// Targets: in full tile mode the cell under the pointer; otherwise the index `brushIndexAt`
// picks, a corner given as its grid vertex (the `TOP_LEFT` of the vertex's cell), an edge as its
// cell and side. While an edge drag stays in the row or column of the target before it, the
// edge follows the direction of travel: the cell entered is painted on the side it was entered
// from.
//
// Steps: a single target paints that corner, edge or cell. A drag joins its target to the point
// painted before by a line without diagonal steps (corner and edge modes, in full tile mode
// too) and paints the points after that one; an edge mode drag paints at each cell the edge it
// crossed to get there, and at the target the target's edge. A line (Shift) paints from its
// start to the target, both included: without diagonal steps in corner and edge modes, with
// them in full tile mode; a mixed set's line is painted in full tile mode. Symmetry repaints
// every painted index turned 180° about the map's centre.

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

/** The grid vertex at corner `index` of cell `(x, y)`. */
function vertexOf(x: number, y: number, index: WangIndex): PixelPoint {
    const right = index === TOP_RIGHT || index === BOTTOM_RIGHT;
    const bottom = index === BOTTOM_LEFT || index === BOTTOM_RIGHT;
    return { x: right ? x + 1 : x, y: bottom ? y + 1 : y };
}

/**
 * The edge of `cell` an edge drag from `drag` paints when it stays in the drag's row or column:
 * the same edge in the same cell, else the side the cell was entered from. Null after a
 * diagonal move.
 */
function followedEdge(drag: BrushTarget, cell: PixelPoint): WangIndex | null {
    const { point, index } = drag;
    if (index === null || isCorner(index)) return null;
    if (cell.x === point.x && cell.y === point.y) return index;
    if (cell.y === point.y) return cell.x > point.x ? LEFT : RIGHT;
    if (cell.x === point.x) return cell.y > point.y ? TOP : BOTTOM;
    return null;
}

/** The edge of `to` crossed when moving to it from the side neighbour `from`. */
function crossedEdge(from: PixelPoint, to: PixelPoint): WangIndex {
    if (to.x > from.x) return LEFT;
    if (to.x < from.x) return RIGHT;
    return to.y > from.y ? TOP : BOTTOM;
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
    const cell = { x: Math.floor(cx), y: Math.floor(cy) };
    if (tileMode) return { point: cell, index: null };
    if (mode === "edge" && drag) {
        const followed = followedEdge(drag, cell);
        if (followed !== null) return { point: cell, index: followed };
    }
    const index = brushIndexAt(mode, cx - cell.x, cy - cell.y);
    if (index !== null && isCorner(index)) {
        return { point: vertexOf(cell.x, cell.y, index), index: TOP_LEFT };
    }
    return { point: cell, index };
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
    if (!tileMode && index !== null && isCorner(index)) {
        const vertex = vertexOf(point.x, point.y, index);
        return { point: { x: width - vertex.x, y: height - vertex.y }, index: TOP_LEFT };
    }
    return {
        point: { x: width - point.x - 1, y: height - point.y - 1 },
        index: index === null ? null : oppositeIndex(index),
    };
}

/** The points a step paints, in order, for targets that are points (vertices or cells). */
function stepPoints(step: BrushStep, to: PixelPoint, fullTile: boolean): PixelPoint[] {
    const { behaviour, from, mode } = step;
    if (!from || behaviour === "single") return [to];
    if (behaviour === "line") return pointsOnLine(from, to, !fullTile);
    // A drag joins corner and edge mode targets; the point painted before is left out.
    if (mode === "mixed") return [to];
    const joined = pointsOnLine(from, to, true).slice(1);
    return joined.length > 0 ? joined : [to];
}

/**
 * Paints an edge mode step: the target's edge, and on a drag or line each cell before it on the
 * way with the edge crossed to reach it. Returns the index painted last.
 */
function paintEdges(filler: TerrainFiller, step: BrushStep): WangIndex | null {
    const { behaviour, from, to, color } = step;
    const edge = to.index !== null && !isCorner(to.index) ? to.index : null;
    const path = from && behaviour !== "single" ? pointsOnLine(from, to.point, true) : [to.point];
    if (path.length === 1) {
        if (edge !== null) filler.setEdge(to.point.x, to.point.y, edge, color);
        return edge;
    }
    let last: WangIndex | null = null;
    for (let i = 1; i < path.length; i++) {
        const point = path[i]!;
        const final = i === path.length - 1;
        last = final && edge !== null ? edge : crossedEdge(path[i - 1]!, point);
        filler.setEdge(point.x, point.y, last, color);
    }
    return last;
}

/** Paints the step's targets on `filler`; returns the index the step ended on. */
function paintStep(filler: TerrainFiller, step: BrushStep): WangIndex | null {
    const { mode, tileMode, behaviour, to, color } = step;
    const fullTile = tileMode || (behaviour === "line" && mode === "mixed");
    if (fullTile) {
        for (const { x, y } of stepPoints(step, to.point, true)) filler.setFullTile(x, y, color);
        return to.index;
    }
    if (mode === "edge") return paintEdges(filler, step);
    if (mode === "corner") {
        const vertex = vertexOf(to.point.x, to.point.y, to.index ?? TOP_LEFT);
        for (const { x, y } of stepPoints(step, vertex, false)) filler.setCorner(x, y, color);
        return to.index;
    }
    // A mixed set's single target: a corner as its vertex, an edge with its cell, the middle
    // of a cell nothing.
    const { index, point } = to;
    if (index === null) return null;
    if (isCorner(index)) {
        const vertex = vertexOf(point.x, point.y, index);
        filler.setCorner(vertex.x, vertex.y, color);
    } else {
        filler.setEdge(point.x, point.y, index, color);
    }
    return index;
}

/** Runs one paint step of the brush on a filler with corrections on. */
export function brushStep(
    options: Omit<TerrainFillerOptions, "corrections">,
    step: BrushStep,
): BrushStepResult {
    const filler = new TerrainFiller({ ...options, corrections: true });
    const index = paintStep(filler, step);
    if (step.symmetry) filler.mirror();
    return { ...filler.apply(), index };
}
