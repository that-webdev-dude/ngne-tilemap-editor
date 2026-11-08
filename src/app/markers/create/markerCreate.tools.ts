import { addMarkerCommand } from "../../../core/markers";
import { MIN_POLYGON_POINTS, MIN_POLYLINE_POINTS } from "../../../core/model";
import type { NewMarker } from "../../../core/markers";
import type { Shape, ShapePoint } from "../../../core/model";
import type { ToolContext, ToolModifiers, ToolPointer, ToolSpec } from "../../tools/types";
import type { Point } from "../../view/coordinates";
import { snapPoint } from "../markerGeometry";
import { clearMarkerPreview, setMarkerPreview } from "../markerPreview";
import { setMarkerSelection } from "../markerSelection";
import {
    HIT_REACH_CSS,
    createTarget,
    layerShiftNow,
    invertsSnap,
    runMarkerCommand,
    snapping,
    toolView,
} from "../markerToolSupport";
import type { CreateTarget, ToolView } from "../markerToolSupport";

// The marker create tools (SPEC §8, DESIGN §6, §10.3; TE-038), Tiled's `CreateObjectTool`s
// (checked at v1.12.2) for rectangles, ellipses, points, polygons and polylines. Each adds to the
// active layer, when it is a visible, unlocked marker layer; one history entry per marker, which
// becomes the selection (Tiled's `finishNewMapObject`). Positions snap to the grid of the map's
// tile size (Snap to Grid; Ctrl inverts it), else to whole pixels; they are in the coordinates
// of the layer, which its offset and parallax move on screen.
//
//   Rectangle (U), Ellipse (Shift+U): press at one corner, drag to the other, release; Shift
//     makes a square or circle (the longer side both ways). A click makes a marker of size 0, as
//     Tiled's does.
//   Point (P): press, drag to place, release.
//   Polygon (Shift+D), Polyline (L): each click adds a point (a click on the last point adds
//     none); Enter, a double click or a right click finishes, and a click on the first point
//     of a polygon of 3 points or more closes it; Backspace removes the last point, and with
//     none left cancels; Escape cancels. Finished with fewer than 3 points (a polygon) or 2 (a
//     polyline), nothing is made.
//
// Right click or Escape during a drag cancels it (the pointer pipeline).

/** The marker in progress. */
interface Making {
    /** The layer, and where it is drawn now (parallax follows the view as it pans). */
    target: CreateTarget;
    view: ToolView;
    /** Where the drag began (rectangle, ellipse), layer coordinates, placed. */
    readonly start: Point;
    /** The points placed so far (polygon, polyline), layer coordinates. */
    readonly points: Point[];
    /** The latest pointer position (map pixels), that position placed, and the modifiers. */
    raw: Point;
    at: Point;
    modifiers: Readonly<ToolModifiers>;
}

let making: Making | null = null;

/** The pointer's position in the target layer's coordinates, placed as the tools place it. */
function placed(
    map: ToolContext["map"],
    target: CreateTarget,
    position: Point,
    modifiers: Readonly<ToolModifiers>,
): Point {
    const local = { x: position.x - target.shift.x, y: position.y - target.shift.y };
    return snapPoint(local, map, snapping(invertsSnap(modifiers)));
}

/**
 * Takes the pointer at map `position` with `modifiers`: where the target layer is drawn now, and
 * the position placed in its coordinates.
 */
function take(
    context: ToolContext,
    current: Making,
    position: Point,
    modifiers: Readonly<ToolModifiers>,
): void {
    current.view = toolView(context);
    const shift = layerShiftNow(context, current.target.layerId, current.view);
    current.target = { layerId: current.target.layerId, shift: shift ?? current.target.shift };
    current.raw = position;
    current.modifiers = modifiers;
    current.at = placed(context.map, current.target, position, modifiers);
}

/** The box from `start` to `end`; with `square`, the longer side both ways (Tiled). */
export function dragBox(start: Point, end: Point, square: boolean) {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    if (square) {
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        dx = (dx < 0 ? -1 : 1) * side;
        dy = (dy < 0 ? -1 : 1) * side;
    }
    return {
        x: Math.min(start.x, start.x + dx),
        y: Math.min(start.y, start.y + dy),
        width: Math.abs(dx),
        height: Math.abs(dy),
    };
}

/** A polygon or polyline through `points` (layer coordinates), its position its first point. */
function pathShape(kind: "polygon" | "polyline", points: readonly Point[]): Shape {
    const first = points[0] ?? { x: 0, y: 0 };
    return {
        shape: kind,
        x: first.x,
        y: first.y,
        points: points.map(({ x, y }): ShapePoint => [x - first.x + 0, y - first.y + 0]),
    };
}

/** Adds `marker` to the target layer: one entry; the new marker becomes the selection. */
function add(context: ToolContext, target: CreateTarget, marker: NewMarker): void {
    const command = runMarkerCommand(context, () =>
        addMarkerCommand(context.map.id, target.layerId, marker),
    );
    const id = command?.markerId;
    if (id !== null && id !== undefined) setMarkerSelection([id], context.map.id);
}

function stop(): void {
    making = null;
    clearMarkerPreview();
}

/** Starts a marker at a press; null when the active layer takes none. */
function begin(context: ToolContext, pointer: ToolPointer): Making | null {
    stop();
    if (pointer.button !== "primary") return null;
    const view = toolView(context);
    const target = createTarget(context, view);
    if (!target) return null;
    const at = placed(context.map, target, pointer.position, pointer.modifiers);
    making = {
        target,
        view,
        start: at,
        points: [],
        raw: pointer.position,
        at,
        modifiers: pointer.modifiers,
    };
    return making;
}

// ---------------------------------------------------------------------------------------------
// Rectangle and ellipse

function boxTool(kind: "rectangle" | "ellipse", spec: Pick<ToolSpec, "id" | "label">): ToolSpec {
    const shape = (current: Making): Shape => ({
        shape: kind,
        ...dragBox(current.start, current.at, current.modifiers.shift),
    });
    const show = () => {
        if (making)
            setMarkerPreview({
                creating: { shape: shape(making), next: null, shift: making.target.shift },
            });
    };
    const follow = (context: ToolContext, position: Point, modifiers: Readonly<ToolModifiers>) => {
        if (!making) return;
        take(context, making, position, modifiers);
        show();
    };
    return {
        ...spec,
        cursor: "crosshair",
        hint: "Shift: square · Ctrl: snap · Right click, Esc: cancel",
        onDown(context, pointer) {
            if (begin(context, pointer)) show();
        },
        onMove(context, pointer) {
            follow(context, pointer.position, pointer.modifiers);
        },
        onKey(context, key) {
            // The last pointer position, placed again with the new modifiers.
            if (making && ["Shift", "Ctrl"].includes(key.key)) {
                follow(context, making.raw, key.modifiers);
            }
            return false;
        },
        onUp(context, pointer) {
            follow(context, pointer.position, pointer.modifiers);
            const current = making;
            stop();
            if (current) add(context, current.target, shape(current));
        },
        onCancel: stop,
    };
}

// ---------------------------------------------------------------------------------------------
// Point

const pointTool: ToolSpec = {
    id: "markerPoint",
    label: "Point",
    cursor: "crosshair",
    hint: "Ctrl: snap · Right click, Esc: cancel",
    onDown(context, pointer) {
        const current = begin(context, pointer);
        if (current) showPoint(current);
    },
    onMove(context, pointer) {
        if (!making) return;
        take(context, making, pointer.position, pointer.modifiers);
        showPoint(making);
    },
    onUp(context, pointer) {
        if (!making) return;
        take(context, making, pointer.position, pointer.modifiers);
        const { target, at } = making;
        stop();
        add(context, target, { shape: "point", x: at.x, y: at.y });
    },
    onCancel: stop,
};

function showPoint(current: Making): void {
    setMarkerPreview({
        creating: {
            shape: { shape: "point", x: current.at.x, y: current.at.y },
            next: null,
            shift: current.target.shift,
        },
    });
}

// ---------------------------------------------------------------------------------------------
// Polygon and polyline

function pathTool(kind: "polygon" | "polyline", spec: Pick<ToolSpec, "id" | "label">): ToolSpec {
    const least = kind === "polygon" ? MIN_POLYGON_POINTS : MIN_POLYLINE_POINTS;
    const show = () => {
        if (!making) return;
        setMarkerPreview({
            creating: {
                shape: pathShape(kind, making.points),
                next: making.at,
                shift: making.target.shift,
            },
        });
    };
    const hover = (context: ToolContext, pointer: ToolPointer) => {
        if (!making) return;
        take(context, making, pointer.position, pointer.modifiers);
        show();
    };
    return {
        ...spec,
        cursor: "crosshair",
        hint: "Click: add a point · Enter, double or right click: finish · Backspace: remove the last point · Ctrl: snap · Esc: cancel",
        onDown(context, pointer) {
            if (!making) {
                const current = begin(context, pointer);
                if (!current) return;
                context.openGesture();
                current.points.push(current.at);
                show();
                return;
            }
            // A right click finishes (Tiled).
            if (pointer.button !== "primary") {
                context.closeGesture();
                return;
            }
            hover(context, pointer);
            const { points, at, target, view } = making;
            const first = points[0]!;
            if (kind === "polygon") {
                // A click on the first point (placed on it, or within reach of it) closes a
                // polygon of 3 points or more, and adds nothing to a smaller one.
                const reach = HIT_REACH_CSS * view.cssPixel;
                const local = {
                    x: pointer.position.x - target.shift.x,
                    y: pointer.position.y - target.shift.y,
                };
                const onFirst =
                    (at.x === first.x && at.y === first.y) ||
                    Math.max(Math.abs(local.x - first.x), Math.abs(local.y - first.y)) <= reach;
                if (onFirst) {
                    if (points.length >= MIN_POLYGON_POINTS) context.closeGesture();
                    else show();
                    return;
                }
            }
            const last = points[points.length - 1]!;
            if (at.x !== last.x || at.y !== last.y) points.push(at);
            show();
        },
        onMove: hover,
        onHover: hover,
        onKey(context, key) {
            if (!making || key.key !== "Backspace") return false;
            if (key.type === "down") {
                making.points.pop();
                // With no point left, Backspace cancels: closed with too few points, nothing is made.
                if (making.points.length === 0) context.closeGesture();
                else show();
            }
            return true;
        },
        onClose(context) {
            const current = making;
            stop();
            if (!current || current.points.length === 0) return;
            if (current.points.length < least) {
                context.feedback(`A ${kind} has at least ${least} points`);
                return;
            }
            add(context, current.target, pathShape(kind, current.points));
        },
        onCancel: stop,
    };
}

export const tools: ToolSpec[] = [
    boxTool("rectangle", { id: "markerRectangle", label: "Rectangle" }),
    boxTool("ellipse", { id: "markerEllipse", label: "Ellipse" }),
    pointTool,
    pathTool("polygon", { id: "markerPolygon", label: "Polygon" }),
    pathTool("polyline", { id: "markerPolyline", label: "Polyline" }),
];
