import { absolutePoints, clampCollisionCoord, shapeBox } from "../../../core/model";
import type { Shape, ShapeBox, ShapePoint } from "../../../core/model";

// The geometry of the Collision Editor's tools (SPEC §6.4; TE-029), free of the DOM: snapping,
// what a press hits (a shape, a polygon's vertex or edge), and the box a drag spans. Positions
// are tile pixels from the tile's top-left corner; reaches are in tile pixels (the view divides
// its CSS reach by the zoom).

/** The tools of the editor's strip (DESIGN §9). */
export type CollisionTool = "select" | "points" | "rectangle" | "ellipse" | "polygon";

export const COLLISION_TOOLS: readonly CollisionTool[] = [
    "select",
    "points",
    "rectangle",
    "ellipse",
    "polygon",
];

/**
 * A pointer position as a tool uses it: rounded to whole pixels when `snap` (the strip's Snap,
 * inverted while Ctrl is held), and kept within FORMAT §2.4's coordinate range.
 */
export function toolPoint(x: number, y: number, snap: boolean): ShapePoint {
    const round = (value: number) => (snap ? Math.round(value) : value);
    return [clampCollisionCoord(round(x)), clampCollisionCoord(round(y))];
}

/** Whether `point` lies inside the polygon through `points` (even-odd rule). */
function insidePolygon(points: readonly ShapePoint[], [x, y]: ShapePoint): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i]!;
        const [xj, yj] = points[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Distance from `p` to the segment `a`–`b`, and the nearest point on it. */
function toSegment(
    p: ShapePoint,
    a: ShapePoint,
    b: ShapePoint,
): { distance: number; at: ShapePoint } {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t =
        length === 0
            ? 0
            : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
    const at: ShapePoint = [a[0] + t * dx, a[1] + t * dy];
    return { distance: Math.hypot(p[0] - at[0], p[1] - at[1]), at };
}

/** Whether a press at `point` hits `shape`: inside it, or within `reach` of its outline. */
export function hitsShape(shape: Shape, point: ShapePoint, reach: number): boolean {
    const box = shapeBox(shape);
    const [x, y] = point;
    const near =
        x >= box.x - reach &&
        x <= box.x + box.width + reach &&
        y >= box.y - reach &&
        y <= box.y + box.height + reach;
    if (!near) return false;
    switch (shape.shape) {
        case "rectangle":
            return true;
        case "ellipse": {
            const rx = box.width / 2 + reach;
            const ry = box.height / 2 + reach;
            const u = (x - (box.x + box.width / 2)) / rx;
            const v = (y - (box.y + box.height / 2)) / ry;
            return u * u + v * v <= 1;
        }
        case "polygon":
        case "polyline": {
            const points = absolutePoints(shape);
            if (shape.shape === "polygon" && insidePolygon(points, point)) return true;
            return hitEdge(shape, point, reach) !== null;
        }
        case "point":
            return Math.hypot(x - shape.x, y - shape.y) <= reach;
    }
}

/** The topmost shape a press at `point` hits (the last in the list), or −1. */
export function hitShape(shapes: readonly Shape[], point: ShapePoint, reach: number): number {
    for (let index = shapes.length - 1; index >= 0; index--) {
        if (hitsShape(shapes[index]!, point, reach)) return index;
    }
    return -1;
}

/** The vertex of a polygon within `reach` of `point` (the nearest), or −1. */
export function hitVertex(shape: Shape, point: ShapePoint, reach: number): number {
    if (shape.shape !== "polygon" && shape.shape !== "polyline") return -1;
    let best = -1;
    let bestDistance = Infinity;
    absolutePoints(shape).forEach(([x, y], index) => {
        const distance = Math.max(Math.abs(point[0] - x), Math.abs(point[1] - y));
        if (distance <= reach && distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return best;
}

/**
 * The edge of a polygon within `reach` of `point` (the nearest): the index of the point it
 * starts at and the nearest position on it; null when none is.
 */
export function hitEdge(
    shape: Shape,
    point: ShapePoint,
    reach: number,
): { after: number; at: ShapePoint } | null {
    if (shape.shape !== "polygon" && shape.shape !== "polyline") return null;
    const points = absolutePoints(shape);
    const edges = shape.shape === "polygon" ? points.length : points.length - 1;
    let best: { after: number; at: ShapePoint; distance: number } | null = null;
    for (let index = 0; index < edges; index++) {
        const hit = toSegment(point, points[index]!, points[(index + 1) % points.length]!);
        if (hit.distance <= reach && (!best || hit.distance < best.distance)) {
            best = { after: index, at: hit.at, distance: hit.distance };
        }
    }
    return best && { after: best.after, at: best.at };
}

/** The box spanned by a drag from `a` to `b`. */
export function dragBox(a: ShapePoint, b: ShapePoint): ShapeBox {
    return {
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        width: Math.abs(b[0] - a[0]),
        height: Math.abs(b[1] - a[1]),
    };
}
