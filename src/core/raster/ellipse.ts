import type { PixelPoint } from "./line";

// Ellipses of cells (SPEC §4.3, the stamp brush's Ctrl+Shift+click): Tiled's `pointsOnEllipse`
// (`src/tiled/geometry.cpp`, checked at v1.12.2), Zingl's Bresenham ellipse ("Bresenham Curve
// Rasterizing Algorithms"). The outline around a centre with two radii, the four quadrants
// emitted together, points repeated where quadrants meet, as Tiled's are. Integer arithmetic
// only; the products stay far below 2^53 for any radius a map can hold.

function assertWhole(...values: number[]): void {
    if (!values.every(Number.isSafeInteger)) {
        throw new RangeError(`Ellipse values must be whole numbers, got ${values.join(", ")}.`);
    }
}

/**
 * The cells of the ellipse around `centre` with radii `radiusX` and `radiusY` (0 or more), in
 * Tiled's order: for each step of the second quadrant from left to top, its point in the
 * first, second, third and fourth quadrant; then the tips of a flat ellipse. Points may repeat.
 * Throws `RangeError` when a value is not a whole number or a radius is negative.
 */
export function pointsOnEllipse(
    centre: PixelPoint,
    radiusX: number,
    radiusY: number,
): PixelPoint[] {
    const { x: xm, y: ym } = centre;
    assertWhole(xm, ym, radiusX, radiusY);
    if (radiusX < 0 || radiusY < 0) {
        throw new RangeError(`Ellipse radii must not be negative, got ${radiusX}, ${radiusY}.`);
    }
    const a = radiusX;
    const b = radiusY;
    const points: PixelPoint[] = [];
    // II. quadrant from bottom left to top right.
    let x = -a;
    let y = 0;
    let e2 = b;
    let dx = (1 + 2 * x) * e2 * e2;
    let dy = x * x;
    let err = dx + dy;
    do {
        points.push({ x: xm - x, y: ym + y });
        points.push({ x: xm + x, y: ym + y });
        points.push({ x: xm + x, y: ym - y });
        points.push({ x: xm - x, y: ym - y });
        e2 = 2 * err;
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
    // Too early a stop for flat ellipses with a = 1: finish the tip.
    while (y++ < b) {
        points.push({ x: xm, y: ym + y });
        points.push({ x: xm, y: ym - y });
    }
    return points;
}
