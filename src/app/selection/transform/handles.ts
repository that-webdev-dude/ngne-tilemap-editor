import type { ShapeBox } from "../../../core/model";
import type { Point } from "../../view/coordinates";

// The handles of a shape's box (DESIGN §4, §3.3: marker and collision-shape boxes): eight
// squares on the corners and the middles of the sides of an axis-aligned box. Pure geometry on
// a `ShapeBox` (pixels of the map or the tile), so the collision editor (TE-029) and the marker
// tools share it: the view draws from it and the tools hit-test with it. Shapes have no
// rotation here, so the box has no turn ring.
//
//   nw ── n ── ne        a press on a handle scales the box: the handle's sides follow the
//   │           │        pointer, the opposite ones stay (Shift keeps the aspect ratio)
//   w           e
//   │           │
//   sw ── s ── se

/** A handle of the box: a corner or the middle of a side, named by compass direction. */
export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Which sides of the box a handle moves. */
interface HandleSides {
    /** −1: the left side, 1: the right side, 0: neither. */
    readonly h: -1 | 0 | 1;
    /** −1: the top side, 1: the bottom side, 0: neither. */
    readonly v: -1 | 0 | 1;
}

export const HANDLES: Readonly<Record<HandleId, HandleSides>> = {
    nw: { h: -1, v: -1 },
    n: { h: 0, v: -1 },
    ne: { h: 1, v: -1 },
    e: { h: 1, v: 0 },
    se: { h: 1, v: 1 },
    s: { h: 0, v: 1 },
    sw: { h: -1, v: 1 },
    w: { h: -1, v: 0 },
};

/** The handles in drawing and hit-testing order: corners first, they win where they overlap. */
export const HANDLE_IDS: readonly HandleId[] = ["nw", "ne", "se", "sw", "n", "e", "s", "w"];

/** Side of a handle's square as drawn, in CSS pixels. */
export const HANDLE_SIZE = 7;

/** Half the side of the square a press hits a handle within, in CSS pixels. */
export const HANDLE_REACH = 5;

/** The position of a handle: (x, y) top-left, (x + width, y + height) bottom-right. */
function handleAt(box: ShapeBox, id: HandleId): Point {
    const { h, v } = HANDLES[id];
    return { x: box.x + ((h + 1) / 2) * box.width, y: box.y + ((v + 1) / 2) * box.height };
}

/** The position of each handle, in `HANDLE_IDS` order. */
export function handlePoints(box: ShapeBox): { id: HandleId; point: Point }[] {
    return HANDLE_IDS.map((id) => ({ id, point: handleAt(box, id) }));
}

/** The box's corners, clockwise from its top-left. */
export function boxOutline(box: ShapeBox): Point[] {
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    return [
        { x: box.x, y: box.y },
        { x: right, y: box.y },
        { x: right, y: bottom },
        { x: box.x, y: bottom },
    ];
}

/** What a press at a position does to a box. */
export type BoxHit =
    { kind: "handle"; handle: HandleId } | { kind: "inside" } | { kind: "outside" };

/**
 * What a press at `point` hits on `box`, seen at `scale` device pixels per box pixel and
 * `ratio` device pixels per CSS pixel: a handle (within `HANDLE_REACH` of it, the nearest one),
 * the inside of the box, or nothing.
 */
export function hitBox(box: ShapeBox, point: Point, scale: number, ratio: number): BoxHit {
    const reach = HANDLE_REACH * ratio;
    let best: { handle: HandleId; distance: number } | null = null;
    for (const id of HANDLE_IDS) {
        const at = handleAt(box, id);
        const distance = Math.max(Math.abs(point.x - at.x), Math.abs(point.y - at.y)) * scale;
        if (distance <= reach && (!best || distance < best.distance)) {
            best = { handle: id, distance };
        }
    }
    if (best) return { kind: "handle", handle: best.handle };
    const inside =
        point.x >= box.x &&
        point.x <= box.x + box.width &&
        point.y >= box.y &&
        point.y <= box.y + box.height;
    return inside ? { kind: "inside" } : { kind: "outside" };
}

/**
 * The box after a drag of handle `handle` from the box `start` to `point` (snapped by the
 * caller): the handle's sides go to the pointer and the opposite sides stay; a side dragged
 * past the opposite one turns the box over (a side may reach length 0). With `keepAspect` both
 * sides scale by one
 * factor: a corner by the larger of its two changes (the one farther from 1), a side's middle
 * by its own, the other side centred where it was.
 */
export function scaleBox(
    start: ShapeBox,
    handle: HandleId,
    point: Point,
    keepAspect: boolean,
): ShapeBox {
    const { h, v } = HANDLES[handle];
    const { width: w0, height: h0 } = start;
    let left = start.x;
    let right = start.x + w0;
    let top = start.y;
    let bottom = start.y + h0;
    if (h < 0) left = point.x;
    if (h > 0) right = point.x;
    if (v < 0) top = point.y;
    if (v > 0) bottom = point.y;
    if (keepAspect && w0 > 0 && h0 > 0) {
        const factorH = (right - left) / w0;
        const factorV = (bottom - top) / h0;
        const corner = Math.abs(factorH - 1) >= Math.abs(factorV - 1) ? factorH : factorV;
        const factor = h !== 0 && v !== 0 ? corner : h !== 0 ? factorH : factorV;
        const width = w0 * factor;
        const height = h0 * factor;
        // The sides the handle moves follow the factor; the others stay, or are centred.
        if (h < 0) left = right - width;
        else if (h > 0) right = left + width;
        else {
            left = start.x + (w0 - width) / 2;
            right = left + width;
        }
        if (v < 0) top = bottom - height;
        else if (v > 0) bottom = top + height;
        else {
            top = start.y + (h0 - height) / 2;
            bottom = top + height;
        }
    }
    // A side dragged past the opposite one turns the box over it, so a box of size 0, whose
    // handles all lie on one point, grows whichever way the drag goes.
    return {
        x: Math.min(left, right),
        y: Math.min(top, bottom),
        width: Math.abs(right - left),
        height: Math.abs(bottom - top),
    };
}
