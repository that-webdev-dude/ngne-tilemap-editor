// Straight lines of cells (SPEC §4.1, §4.3): the cells a drag crosses between two samples and
// the line mode of the stamp brush. The classic integer Bresenham walk: along the longer axis
// one cell at a time, stepping the shorter axis when the accumulated error runs out. A line is
// always walked from the end with the smaller major coordinate, so a reversed line holds the
// same cells in reverse order. Pure, integer arithmetic only.

/** A cell, in whole cell coordinates. */
export interface PixelPoint {
    readonly x: number;
    readonly y: number;
}

/**
 * The cells of the straight line from `from` to `to`, both ends included, in order from `from`.
 * With `manhattan`, consecutive cells always share a side. Throws `RangeError` for a
 * coordinate that is not a safe integer.
 */
export function pointsOnLine(from: PixelPoint, to: PixelPoint, manhattan = false): PixelPoint[] {
    const values = [from.x, from.y, to.x, to.y];
    if (!values.every((value) => Number.isSafeInteger(value))) {
        throw new RangeError(
            `pointsOnLine needs whole cells, got (${from.x}, ${from.y}) to (${to.x}, ${to.y})`,
        );
    }
    // Steep lines are walked along y: the axes swap on the way in and back on the way out.
    const steep = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
    let [startMajor, startMinor] = steep ? [from.y, from.x] : [from.x, from.y];
    let [endMajor, endMinor] = steep ? [to.y, to.x] : [to.x, to.y];
    // Walk from the smaller major coordinate; the result is turned round at the end.
    const reversed = startMajor > endMajor;
    if (reversed) {
        [startMajor, endMajor] = [endMajor, startMajor];
        [startMinor, endMinor] = [endMinor, startMinor];
    }

    const majorLength = endMajor - startMajor;
    const minorLength = Math.abs(endMinor - startMinor);
    const minorStep = startMinor < endMinor ? 1 : -1;
    const points: PixelPoint[] = [];
    const plot = (major: number, minor: number) =>
        points.push(steep ? { x: minor, y: major } : { x: major, y: minor });

    let error = Math.floor(majorLength / 2);
    let minor = startMinor;
    for (let major = startMajor; major <= endMajor; major++) {
        plot(major, minor);
        if (major === endMajor) break;
        error -= minorLength;
        if (error < 0) {
            minor += minorStep;
            error += majorLength;
            // The cell after the minor step, so the two cells around the step share a side.
            if (manhattan) plot(major, minor);
        }
    }
    return reversed ? points.reverse() : points;
}
