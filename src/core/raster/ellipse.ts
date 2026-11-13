import type { PixelPoint } from "./line";

// Ellipse outlines of cells (SPEC §4.3): the ellipse mode of the stamp brush. The outline of
// the axis-aligned ellipse around a centre cell with whole radii, after Alois Zingl's
// `plotEllipse`, github.com/zingl/Bresenham, MIT licence, (c) 2020 zingl. Points come in the
// order that algorithm plots them, four mirrored points per step and then the tips of a flat
// ellipse, repeats included. Pure, integer arithmetic only.

/**
 * The outline cells of the ellipse around `centre` with radii `radiusX` and `radiusY`, in
 * plotting order with repeats. Throws `RangeError` for a value that is not a safe integer or a
 * negative radius.
 */
export function pointsOnEllipse(
    centre: PixelPoint,
    radiusX: number,
    radiusY: number,
): PixelPoint[] {
    const values = [centre.x, centre.y, radiusX, radiusY];
    if (!values.every((value) => Number.isSafeInteger(value)) || radiusX < 0 || radiusY < 0) {
        throw new RangeError(
            `pointsOnEllipse needs a whole centre and whole radii of at least 0, got (${centre.x}, ${centre.y}) with radii ${radiusX}, ${radiusY}`,
        );
    }
    const { x: cx, y: cy } = centre;
    const a = radiusX;
    const b = radiusY;
    const points: PixelPoint[] = [];

    // Walk one quadrant from (-a, 0) to (0, b), mirroring each step into the other three.
    let x = 0 - a; // not -a: a radius of 0 must not give a negative zero
    let y = 0;
    let dx = (1 + 2 * x) * b * b;
    let dy = x * x;
    let err = dx + dy;
    do {
        points.push(
            { x: cx - x, y: cy + y },
            { x: cx + x, y: cy + y },
            { x: cx + x, y: cy - y },
            { x: cx - x, y: cy - y },
        );
        const e2 = 2 * err;
        if (e2 >= dx) {
            x++;
            dx += 2 * b * b;
            err += dx;
        }
        if (e2 <= dy) {
            y++;
            dy += 2 * a * a;
            err += dy;
        }
    } while (x <= 0);

    // A very flat ellipse (radius x of 0 or 1) leaves the loop early: finish its tips.
    while (y < b) {
        y++;
        points.push({ x: cx, y: cy + y }, { x: cx, y: cy - y });
    }
    return points;
}
