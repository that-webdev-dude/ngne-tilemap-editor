import type { TerrainSetType } from "../model";
import { lineCells } from "../raster/line";
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

// The terrain brush's targets and paint steps (SPEC §5.3).
//
// A target is what one position of the pointer paints: a vertex for a corner (held as the cell
// it is the top-left corner of, with index `TOP_LEFT`), a cell and one of its edges, or, in
// full tile mode, a cell. A step paints targets into one filler run with corrections:
//   - single: the target;
//   - drag: the targets between the point painted before and the new one, that point left out,
//     along a line without diagonal steps (in a mixed set the new target alone);
//   - line: the targets from the line's start to the new one, both ends included; corner and
//     edge lines take no diagonal steps, full tile lines may, and a mixed set's line is
//     painted in full tile mode.
// Each painted cell or vertex of a line or drag is painted with the new target's index.

/** Where the brush paints: a cell and its index, or a vertex (`TOP_LEFT` of its cell). */
export interface BrushTarget {
    readonly point: PixelPoint;
    readonly index: WangIndex | null;
}

/** A single press, a drag step, or a Shift line. */
export type BrushBehaviour = "single" | "drag" | "line";

/** One paint step. */
export interface BrushStep {
    /** Painting mode: the terrain's mode in its set (SPEC §5.3). */
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

/** A step's result and the index it ended on. */
export interface BrushStepResult extends TerrainFillResult {
    readonly index: WangIndex | null;
}

/** The vertex a corner index of a cell names, as the cell it is the top-left corner of. */
function cornerVertex(cell: PixelPoint, index: WangIndex): PixelPoint {
    const right = index === TOP_RIGHT || index === BOTTOM_RIGHT;
    const below = index === BOTTOM_LEFT || index === BOTTOM_RIGHT;
    return { x: cell.x + (right ? 1 : 0), y: cell.y + (below ? 1 : 0) };
}

/**
 * The edge of an edge drag that moved from `from` into the cell `cell` along its row or column:
 * the edge it crossed to come in. Null for a move that changed both row and column.
 */
function crossedEdge(from: PixelPoint, cell: PixelPoint): WangIndex | null {
    if (cell.y === from.y && cell.x !== from.x) return cell.x > from.x ? LEFT : RIGHT;
    if (cell.x === from.x && cell.y !== from.y) return cell.y > from.y ? TOP : BOTTOM;
    return null;
}

/**
 * The target under the pointer at fractional cell position `(cx, cy)`; `drag` is the target of
 * an edge drag in progress, whose edge follows the direction of travel.
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
    if (mode === "corner") {
        // The nearest vertex.
        return { point: { x: Math.floor(cx + 0.5), y: Math.floor(cy + 0.5) }, index: TOP_LEFT };
    }
    if (mode === "edge" && drag?.index != null && !isCorner(drag.index)) {
        if (cell.x === drag.point.x && cell.y === drag.point.y) return drag;
        const crossed = crossedEdge(drag.point, cell);
        if (crossed !== null) return { point: cell, index: crossed };
    }
    const index = brushIndexAt(mode, cx - cell.x, cy - cell.y);
    if (index !== null && isCorner(index)) {
        return { point: cornerVertex(cell, index), index: TOP_LEFT };
    }
    return { point: cell, index };
}

/** `target` turned 180° about the centre of a `width × height` map. */
export function mirroredTarget(
    target: BrushTarget,
    tileMode: boolean,
    width: number,
    height: number,
): BrushTarget {
    const { point, index } = target;
    if (!tileMode && index !== null && isCorner(index)) {
        // A vertex: the map's vertices run 0..width and 0..height.
        return { point: { x: width - point.x, y: height - point.y }, index: TOP_LEFT };
    }
    return {
        point: { x: width - 1 - point.x, y: height - 1 - point.y },
        index: tileMode || index === null ? null : oppositeIndex(index),
    };
}

/** Paints one full tile mode target into `filler`: a whole cell. */
function paintCell(filler: TerrainFiller, point: PixelPoint, color: number): void {
    filler.setFullTile(point.x, point.y, color);
}

/** Paints one target into `filler`: a vertex or an edge; nothing for no index. */
function paintIndex(
    filler: TerrainFiller,
    point: PixelPoint,
    index: WangIndex | null,
    color: number,
): void {
    if (index === null) return;
    if (isCorner(index)) filler.setCorner(point.x, point.y, color);
    else filler.setEdge(point.x, point.y, index, color);
}

/** The points a step paints, and whether it paints them in full tile mode. */
function stepPoints(step: BrushStep): { points: PixelPoint[]; tileMode: boolean } {
    const { behaviour, from, to, mode } = step;
    if (behaviour === "line" && from) {
        const tileMode = step.tileMode || mode === "mixed";
        return { points: lineCells(from, to.point, !tileMode), tileMode };
    }
    if (behaviour === "drag" && from && mode !== "mixed") {
        return { points: lineCells(from, to.point, true).slice(1), tileMode: step.tileMode };
    }
    return { points: [to.point], tileMode: step.tileMode };
}

/** Runs one paint step of the brush. */
export function brushStep(
    options: Omit<TerrainFillerOptions, "corrections">,
    step: BrushStep,
): BrushStepResult {
    const filler = new TerrainFiller({ ...options, corrections: true });
    const { points, tileMode } = stepPoints(step);
    const paint = tileMode
        ? (point: PixelPoint) => paintCell(filler, point, step.color)
        : (point: PixelPoint) => paintIndex(filler, point, step.to.index, step.color);
    for (const point of points) paint(point);
    if (step.symmetry) filler.mirror();
    const result = filler.apply();
    return { ...result, index: tileMode ? null : step.to.index };
}
