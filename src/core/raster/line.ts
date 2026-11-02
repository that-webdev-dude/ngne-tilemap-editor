// Lines of cells (SPEC §4.1): Tiled's `pointsOnLine` (`src/tiled/geometry.cpp`, checked at
// v1.12.2), Bresenham's algorithm in its classic form. The line runs from the first point to
// the last, both included; each cell after the first is one of the 8 neighbours of the one
// before it, so a drag joined by it skips no cell. A reversed line visits the cells of the
// forward one in reverse order, as Tiled's does. Integer arithmetic only.

/** A cell position: whole numbers, which may lie outside any map. */
export interface PixelPoint {
    readonly x: number;
    readonly y: number;
}

function assertWhole(...values: number[]): void {
    if (!values.every(Number.isSafeInteger)) {
        throw new RangeError(`Line ends must be whole numbers, got ${values.join(", ")}.`);
    }
}

/**
 * The cells of the line from `from` to `to`, in order, both ends included. With `manhattan`
 * the line takes no diagonal step: where Tiled's steps diagonally it adds the cell after the
 * minor-axis step. Throws `RangeError` when an end is not a whole number.
 */
export function pointsOnLine(from: PixelPoint, to: PixelPoint, manhattan = false): PixelPoint[] {
    let x0 = from.x;
    let y0 = from.y;
    let x1 = to.x;
    let y1 = to.y;
    assertWhole(x0, y0, x1, y1);
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) {
        [x0, y0] = [y0, x0];
        [x1, y1] = [y1, x1];
    }
    const reverse = x0 > x1;
    if (reverse) {
        [x0, x1] = [x1, x0];
        [y0, y1] = [y1, y0];
    }
    const deltaX = x1 - x0;
    const deltaY = Math.abs(y1 - y0);
    // Tiled's `deltax / 2` is C++ integer division of a non-negative number.
    let error = Math.floor(deltaX / 2);
    const yStep = y0 < y1 ? 1 : -1;
    let y = y0;
    const points: PixelPoint[] = [];
    const push = (x: number) => points.push(steep ? { x: y, y: x } : { x, y });
    for (let x = x0; x <= x1; x++) {
        push(x);
        error -= deltaY;
        if (error < 0) {
            y += yStep;
            error += deltaX;
            if (manhattan && x < x1) push(x);
        }
    }
    if (reverse) points.reverse();
    return points;
}
