import type { Orientation } from "../cells";
import {
    MAX_COLLISION_COORD,
    MAX_COLLISION_SHAPES,
    MAX_SHAPE_POINTS,
    MIN_POLYGON_POINTS,
} from "./limits";
import type { Shape, ShapePoint } from "./types";

// Geometry of the shapes of FORMAT §1.5: their boxes, moving and resizing them, the points of a
// polygon, and a tile's collision shapes as the tile is drawn in one of the 8 orientations of
// FORMAT §1.2. Pure functions on plain values; none changes its argument.

/** An axis-aligned rectangle in pixels. */
export interface ShapeBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A deep copy of `shape`. */
export function cloneShape<S extends Shape>(shape: S): S {
    return "points" in shape
        ? { ...shape, points: shape.points.map(([x, y]) => [x, y] as ShapePoint) }
        : { ...shape };
}

/** Deep copies of `shapes`. */
export function cloneShapes(shapes: readonly Shape[]): Shape[] {
    return shapes.map(cloneShape);
}

/** Whether two shape lists are equal member by member. */
export function shapesEqual(a: readonly Shape[], b: readonly Shape[]): boolean {
    return a.length === b.length && a.every((shape, index) => shapeEqual(shape, b[index]!));
}

function shapeEqual(a: Shape, b: Shape): boolean {
    if (a.shape !== b.shape || a.x !== b.x || a.y !== b.y) return false;
    if ("points" in a && "points" in b) {
        return (
            a.points.length === b.points.length &&
            a.points.every(
                ([x, y], index) => x === b.points[index]![0] && y === b.points[index]![1],
            )
        );
    }
    if ("width" in a && "width" in b) return a.width === b.width && a.height === b.height;
    return true;
}

/** The box of a shape: its own for a rectangle or ellipse, its points' bounds for a polygon. */
export function shapeBox(shape: Shape): ShapeBox {
    switch (shape.shape) {
        case "rectangle":
        case "ellipse":
            return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
        case "point":
            return { x: shape.x, y: shape.y, width: 0, height: 0 };
        case "polygon":
        case "polyline": {
            let left = Infinity;
            let top = Infinity;
            let right = -Infinity;
            let bottom = -Infinity;
            for (const [px, py] of shape.points) {
                left = Math.min(left, px);
                top = Math.min(top, py);
                right = Math.max(right, px);
                bottom = Math.max(bottom, py);
            }
            if (left === Infinity) return { x: shape.x, y: shape.y, width: 0, height: 0 };
            return {
                x: shape.x + left,
                y: shape.y + top,
                width: right - left,
                height: bottom - top,
            };
        }
    }
}

/** `shape` moved by `(dx, dy)`. */
export function moveShape<S extends Shape>(shape: S, dx: number, dy: number): S {
    return { ...cloneShape(shape), x: shape.x + dx, y: shape.y + dy };
}

/**
 * `shape` fitted to `box`: a rectangle or ellipse takes it; a polygon's points scale from its
 * own box to it (a side of length 0 stays where it is moved to). The position stays the first
 * point of a polygon, so its points keep their meaning relative to `x, y`.
 */
export function fitShape<S extends Shape>(shape: S, box: ShapeBox): S {
    if (shape.shape === "rectangle" || shape.shape === "ellipse") {
        return { ...shape, x: box.x, y: box.y, width: box.width, height: box.height };
    }
    if (shape.shape === "point") return { ...shape, x: box.x, y: box.y };
    const from = shapeBox(shape);
    const sx = from.width === 0 ? 0 : box.width / from.width;
    const sy = from.height === 0 ? 0 : box.height / from.height;
    const absolute = shape.points.map(([px, py]): ShapePoint => [
        box.x + (shape.x + px - from.x) * sx,
        box.y + (shape.y + py - from.y) * sy,
    ]);
    return polygonFrom(shape, absolute) as S;
}

/** The absolute positions of a polygon's or polyline's points. */
export function absolutePoints(shape: Extract<Shape, { points: ShapePoint[] }>): ShapePoint[] {
    return shape.points.map(([px, py]): ShapePoint => [shape.x + px, shape.y + py]);
}

/**
 * A polygon (or polyline) of the kind of `like` through the absolute points `points`: positioned
 * at its first point, the points relative to it, as Tiled stores a polygon made by clicks.
 */
export function polygonFrom<S extends Extract<Shape, { points: ShapePoint[] }>>(
    like: S,
    points: readonly ShapePoint[],
): S {
    const [x, y] = points[0] ?? [like.x, like.y];
    return { ...like, x, y, points: points.map(([px, py]): ShapePoint => [px - x, py - y]) };
}

/** A polygon through the absolute points `points`, positioned at the first. */
export function polygonShape(points: readonly ShapePoint[]): Extract<Shape, { shape: "polygon" }> {
    return polygonFrom({ shape: "polygon", x: 0, y: 0, points: [] }, points);
}

/** A polygon with point `index` moved to the absolute position `to`. */
export function movePolygonPoint<S extends Extract<Shape, { points: ShapePoint[] }>>(
    shape: S,
    index: number,
    to: ShapePoint,
): S {
    const points = absolutePoints(shape);
    points[index] = [to[0], to[1]];
    return { ...shape, points: points.map(([px, py]): ShapePoint => [px - shape.x, py - shape.y]) };
}

/** A polygon with a point at the absolute position `at` put after point `after`. */
export function insertPolygonPoint<S extends Extract<Shape, { points: ShapePoint[] }>>(
    shape: S,
    after: number,
    at: ShapePoint,
): S {
    const points = shape.points.map(([px, py]): ShapePoint => [px, py]);
    points.splice(after + 1, 0, [at[0] - shape.x, at[1] - shape.y]);
    return { ...shape, points };
}

/** A polygon without point `index`; the position stays, so the other points do not move. */
export function removePolygonPoint<S extends Extract<Shape, { points: ShapePoint[] }>>(
    shape: S,
    index: number,
): S {
    return {
        ...shape,
        points: shape.points
            .filter((_, each) => each !== index)
            .map(([x, y]): ShapePoint => [x, y]),
    };
}

/** Why a tile's collision list breaks FORMAT §2.4's rules; null when it keeps them. */
export function collisionProblem(shapes: readonly Shape[]): string | null {
    if (shapes.length > MAX_COLLISION_SHAPES) {
        return `A tile has at most ${MAX_COLLISION_SHAPES} collision shapes.`;
    }
    const inRange = (value: number) =>
        Number.isFinite(value) && Math.abs(value) <= MAX_COLLISION_COORD;
    for (const shape of shapes) {
        if (shape.shape === "point" || shape.shape === "polyline") {
            return "Collision shapes are rectangles, ellipses and polygons.";
        }
        if (!inRange(shape.x) || !inRange(shape.y)) {
            return `Collision coordinates lie within −${MAX_COLLISION_COORD}..${MAX_COLLISION_COORD}.`;
        }
        if (shape.shape === "polygon") {
            if (shape.points.length > MAX_SHAPE_POINTS) {
                return `A polygon has at most ${MAX_SHAPE_POINTS} points.`;
            }
            if (shape.points.length < MIN_POLYGON_POINTS) {
                return `A polygon has at least ${MIN_POLYGON_POINTS} points.`;
            }
            if (!shape.points.every(([px, py]) => inRange(px) && inRange(py))) {
                return `Collision coordinates lie within −${MAX_COLLISION_COORD}..${MAX_COLLISION_COORD}.`;
            }
        } else if (
            !(shape.width >= 0 && shape.height >= 0) ||
            shape.width > 2 * MAX_COLLISION_COORD ||
            shape.height > 2 * MAX_COLLISION_COORD
        ) {
            return "A rectangle or ellipse has a size of 0 or more within the coordinate range.";
        }
    }
    return null;
}

/** Clamps a coordinate into the collision range of FORMAT §2.4. */
export function clampCollisionCoord(value: number): number {
    return Math.min(MAX_COLLISION_COORD, Math.max(-MAX_COLLISION_COORD, value));
}

/**
 * `(fx, fy)` of the orientations indexed `H<<2 | V<<1 | D`; the drawn tile is turned by π/2
 * when `D` is set (FORMAT §1.2).
 */
const FX = [1, 1, 1, -1, -1, 1, -1, -1] as const;
const FY = [1, -1, -1, -1, 1, 1, -1, 1] as const;

/**
 * Where a point of a `tileWidth × tileHeight` tile, in its own pixels from its top-left corner
 * as drawn untransformed, lands when the tile is drawn in `orientation` (FORMAT §1.2): in
 * pixels from the top-left corner of the drawn box (`D ? th × tw : tw × th`).
 */
export function orientPoint(
    point: ShapePoint,
    orientation: Orientation,
    tileWidth: number,
    tileHeight: number,
): ShapePoint {
    const d = (orientation & 1) !== 0;
    const a = (point[0] - tileWidth / 2) * FX[orientation];
    const b = (point[1] - tileHeight / 2) * FY[orientation];
    // R(π/2)·(a, b) = (−b, a).
    const [x, y] = d ? [-b, a] : [a, b];
    const boxWidth = d ? tileHeight : tileWidth;
    const boxHeight = d ? tileWidth : tileHeight;
    return [x + boxWidth / 2 + 0, y + boxHeight / 2 + 0];
}

/**
 * A collision shape as its tile is drawn in `orientation`, in pixels from the top-left corner
 * of the drawn box: rectangles and ellipses stay axis-aligned (their box turns with the tile),
 * a polygon's points move one by one.
 */
export function orientShape(
    shape: Shape,
    orientation: Orientation,
    tileWidth: number,
    tileHeight: number,
): Shape {
    const at = (point: ShapePoint) => orientPoint(point, orientation, tileWidth, tileHeight);
    if (shape.shape === "rectangle" || shape.shape === "ellipse") {
        const [x0, y0] = at([shape.x, shape.y]);
        const [x1, y1] = at([shape.x + shape.width, shape.y + shape.height]);
        return {
            ...shape,
            x: Math.min(x0, x1),
            y: Math.min(y0, y1),
            width: Math.abs(x1 - x0),
            height: Math.abs(y1 - y0),
        };
    }
    if (shape.shape === "point") {
        const [x, y] = at([shape.x, shape.y]);
        return { ...shape, x, y };
    }
    return polygonFrom(shape, absolutePoints(shape).map(at));
}
