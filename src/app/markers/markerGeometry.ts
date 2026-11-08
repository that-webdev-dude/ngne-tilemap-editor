import { MAX_MARKER_COORD, effectiveValues, shapeBox, walkLayers } from "../../core/model";
import type { Marker, ProjectMap, Shape, ShapeBox, ShapePoint } from "../../core/model";
import { layerShift } from "../../engine/viewport/geometry";
import { hitsShape } from "../tilesets/collision/collisionTools";
import type { Point } from "../view/coordinates";

// The geometry of the marker tools (SPEC §8; TE-038), free of the DOM: which markers the tools
// may take, what a press hits, what a rubber band takes, snapping, and the box of a selection.
//
// Positions are map pixels. A marker layer is drawn moved by its offset and parallax
// (`layerShift`, FORMAT §3.4): a pointer at map position `p` lies at `p − shift` in the
// coordinates of a marker of that layer, as Tiled works in the coordinates of an object's layer.
//
// What the select tool takes is Tiled's (`AbstractObjectTool::topMostMapObjectAt`,
// `filterMapObjects`, checked at v1.12.2): the markers of every visible, unlocked marker layer,
// the topmost first (the last layer of the tree, the last marker of its list); with Highlight
// Current Layer on, a marker of the active layer before one of another layer. A rubber band takes
// the markers its rectangle touches, or with Alt only those it encloses (`ObjectSelectionTool`).

/** A marker the tools may take, with its layer and where that layer is drawn. */
export interface EditableMarker {
    readonly marker: Marker;
    readonly layerId: number;
    /** Map pixels the layer is drawn from its markers' positions. */
    readonly shift: Point;
}

/** The view a layer's shift depends on (parallax). */
export type ViewCentre = { centreX: number; centreY: number };

/**
 * The markers of `map` the tools may take: those of visible, unlocked marker layers (and under
 * no hidden or locked group), bottom to top, each layer's in its list order. With `locked`, the
 * markers of visible locked layers too (what is drawn).
 */
export function editableMarkers(
    map: ProjectMap,
    view: ViewCentre,
    locked = false,
): EditableMarker[] {
    const out: EditableMarker[] = [];
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type !== "marker") continue;
        const values = effectiveValues(layer, ancestors);
        if (!values.visible || (!values.unlocked && !locked)) continue;
        const shift = layerShift(map, view, values);
        for (const marker of layer.markers) out.push({ marker, layerId: layer.id, shift });
    }
    return out;
}

/** Where the `MapPin` of a point marker reaches, CSS pixels from its tip (markerDrawing.ts). */
const PIN = { left: -6, right: 6, top: -16, bottom: 2 } as const;

/**
 * Whether a press at map position `at` hits `entry`: inside its shape, or within `reach` map
 * pixels of its outline; a point by its pin (`cssPixel` map pixels a CSS pixel).
 */
export function hitsMarker(entry: EditableMarker, at: Point, reach: number, cssPixel: number) {
    const { marker, shift } = entry;
    const x = at.x - shift.x;
    const y = at.y - shift.y;
    if (marker.shape === "point") {
        const dx = (x - marker.x) / cssPixel;
        const dy = (y - marker.y) / cssPixel;
        return dx >= PIN.left && dx <= PIN.right && dy >= PIN.top && dy <= PIN.bottom;
    }
    return hitsShape(marker, [x, y], reach);
}

/**
 * The topmost marker of `entries` a press at `at` hits, or null. With `prefer` (Highlight Current
 * Layer on: the active layer's id), a marker of that layer comes before the others.
 */
export function markerAt(
    entries: readonly EditableMarker[],
    at: Point,
    reach: number,
    cssPixel: number,
    prefer: number | null = null,
): EditableMarker | null {
    let first: EditableMarker | null = null;
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]!;
        if (!hitsMarker(entry, at, reach, cssPixel)) continue;
        if (prefer === null || entry.layerId === prefer) return entry;
        first ??= entry;
    }
    return first;
}

/** A rectangle of map pixels; `width` and `height` are 0 or more. */
export type Band = ShapeBox;

/** The band spanned by two map positions. */
export function bandOf(a: Point, b: Point): Band {
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
    };
}

function boxInside(inner: ShapeBox, outer: ShapeBox): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
    );
}

function boxesMeet(a: ShapeBox, b: ShapeBox): boolean {
    return (
        a.x <= b.x + b.width &&
        b.x <= a.x + a.width &&
        a.y <= b.y + b.height &&
        b.y <= a.y + a.height
    );
}

/** Whether the segment `p`–`q` meets the box `box` (Liang–Barsky). */
function segmentMeetsBox(p: ShapePoint, q: ShapePoint, box: ShapeBox): boolean {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    let t0 = 0;
    let t1 = 1;
    const edges: [number, number][] = [
        [-dx, p[0] - box.x],
        [dx, box.x + box.width - p[0]],
        [-dy, p[1] - box.y],
        [dy, box.y + box.height - p[1]],
    ];
    for (const [step, room] of edges) {
        if (step === 0) {
            if (room < 0) return false;
            continue;
        }
        const t = room / step;
        if (step < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return false;
    }
    return true;
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

/** Whether `shape` (in the band's coordinates) and the band have a point in common. */
function shapeMeetsBand(shape: Shape, band: Band): boolean {
    const box = shapeBox(shape);
    if (!boxesMeet(box, band)) return false;
    switch (shape.shape) {
        case "rectangle":
        case "point":
            return true;
        case "ellipse": {
            const rx = box.width / 2;
            const ry = box.height / 2;
            const cx = box.x + rx;
            const cy = box.y + ry;
            // The point of the band nearest the centre lies in the ellipse.
            const nx = Math.max(band.x, Math.min(cx, band.x + band.width));
            const ny = Math.max(band.y, Math.min(cy, band.y + band.height));
            if (rx === 0 || ry === 0) return true;
            const u = (nx - cx) / rx;
            const v = (ny - cy) / ry;
            return u * u + v * v <= 1;
        }
        case "polygon":
        case "polyline": {
            const points = shape.points.map(([px, py]): ShapePoint => [shape.x + px, shape.y + py]);
            const edges = shape.shape === "polygon" ? points.length : points.length - 1;
            for (let k = 0; k < edges; k++) {
                if (segmentMeetsBox(points[k]!, points[(k + 1) % points.length]!, band)) {
                    return true;
                }
            }
            return (
                shape.shape === "polygon" &&
                insidePolygon(points, [band.x + band.width / 2, band.y + band.height / 2])
            );
        }
    }
}

/**
 * The markers of `entries` a rubber band over `band` (map pixels) takes: those it touches, or
 * with `enclosed` (Alt) those whose box it encloses. In the order of `entries`.
 */
export function markersInBand(
    entries: readonly EditableMarker[],
    band: Band,
    enclosed: boolean,
): EditableMarker[] {
    return entries.filter(({ marker, shift }) => {
        const local = { ...band, x: band.x - shift.x, y: band.y - shift.y };
        return enclosed ? boxInside(shapeBox(marker), local) : shapeMeetsBand(marker, local);
    });
}

/**
 * A coordinate as the tools place it: on the nearest multiple of `step` (the map's tile size)
 * when `snap`, else on the nearest whole pixel; within ±1 048 576 (FORMAT §2.5).
 */
export function snapCoord(value: number, step: number, snap: boolean): number {
    const placed = snap && step > 0 ? Math.round(value / step) * step : Math.round(value);
    return Math.max(-MAX_MARKER_COORD, Math.min(MAX_MARKER_COORD, placed)) + 0;
}

/** A position placed as `snapCoord` places each axis, by the map's tile width and height. */
export function snapPoint(
    point: Point,
    map: Pick<ProjectMap, "tileWidth" | "tileHeight">,
    snap: boolean,
): Point {
    return {
        x: snapCoord(point.x, map.tileWidth, snap),
        y: snapCoord(point.y, map.tileHeight, snap),
    };
}

/**
 * The move of a drag by `(dx, dy)` map pixels of markers whose positions start at `align` (the
 * least `x` and `y` of their positions, Tiled's `mAlignPosition`): `align` moved and placed as
 * `snapPoint` places it, less `align`.
 */
export function snappedMove(
    align: Point,
    dx: number,
    dy: number,
    map: Pick<ProjectMap, "tileWidth" | "tileHeight">,
    snap: boolean,
): Point {
    const to = snapPoint({ x: align.x + dx, y: align.y + dy }, map, snap);
    return { x: to.x - align.x + 0, y: to.y - align.y + 0 };
}

/** The least `x` and `y` of the positions of `shapes`; null for none. */
export function alignOf(shapes: readonly Shape[]): Point | null {
    if (shapes.length === 0) return null;
    return {
        x: Math.min(...shapes.map((shape) => shape.x)),
        y: Math.min(...shapes.map((shape) => shape.y)),
    };
}

/** The box round the boxes of `shapes`, in their coordinates; null for none. */
export function selectionBox(shapes: readonly Shape[]): ShapeBox | null {
    if (shapes.length === 0) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const shape of shapes) {
        const box = shapeBox(shape);
        left = Math.min(left, box.x);
        top = Math.min(top, box.y);
        right = Math.max(right, box.x + box.width);
        bottom = Math.max(bottom, box.y + box.height);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Whether a marker's box takes the 8 handles and the W and H fields: a rectangle or ellipse. */
export function resizable(shape: Shape): shape is Extract<Shape, { width: number }> {
    return shape.shape === "rectangle" || shape.shape === "ellipse";
}
