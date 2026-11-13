// Straight lines of cells (SPEC §4.1, §4.3): the cells a drag crosses between two samples and
// the line mode of the stamp brush. A midpoint (Bresenham) line walked along its longer axis
// from the end with the smaller coordinate there; a line drawn the other way round gives the
// same cells in reverse order. The manhattan form never steps diagonally. Pure, integer
// arithmetic only.

/** A cell, in whole cell coordinates. */
export interface PixelPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * The cells of the straight line from `from` to `to`, both ends included, in order from `from`.
 * With `manhattan`, each step across the minor axis adds the cell beside it first, so
 * consecutive cells always share a side. Throws `RangeError` for a coordinate that is not a
 * safe integer.
 */
export function pointsOnLine(from: PixelPoint, to: PixelPoint, manhattan = false): PixelPoint[] {
    const values = [from.x, from.y, to.x, to.y];
    if (!values.every((value) => Number.isSafeInteger(value))) {
        throw new RangeError(
            `pointsOnLine needs whole cell coordinates, got (${from.x}, ${from.y}) to (${to.x}, ${to.y})`,
        );
    }
    // A tie between the axes is walked along x.
    const steep = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
    const majorOf = (point: PixelPoint): number => (steep ? point.y : point.x);
    const minorOf = (point: PixelPoint): number => (steep ? point.x : point.y);
    const cellAt = (major: number, minor: number): PixelPoint =>
        steep ? { x: minor, y: major } : { x: major, y: minor };

    const reversed = majorOf(to) < majorOf(from);
    const start = reversed ? to : from;
    const end = reversed ? from : to;
    const first = majorOf(start);
    const last = majorOf(end);
    const length = last - first;
    const rise = Math.abs(minorOf(end) - minorOf(start));
    const minorStep = minorOf(end) > minorOf(start) ? 1 : -1;

    const points: PixelPoint[] = [];
    let error = Math.floor(length / 2);
    let minor = minorOf(start);
    for (let major = first; major <= last; major++) {
        points.push(cellAt(major, minor));
        error -= rise;
        if (error < 0) {
            minor += minorStep;
            error += length;
            if (manhattan && major < last) points.push(cellAt(major, minor));
        }
    }
    if (reversed) points.reverse();
    return points;
}
