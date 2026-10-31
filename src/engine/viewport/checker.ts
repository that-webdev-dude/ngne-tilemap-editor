import type { PixelBuffer } from "../../core/model";

// The checkerboard behind transparent pixels. NGNE's sampler clamps (ENGINE §7), so the
// pattern is an image in the texture `ed:checker` (ENGINE §3) and the viewport draws it as a
// grid of quads, one image per block of `CHECKER_BLOCK` squares a side.

/** The two colours of the checkerboard as 0xRRGGBB, and the side of one square in map pixels. */
export interface ViewportChecker {
    a: number;
    b: number;
    /** 1 or more. */
    size: number;
}

/** Squares per side of the checker image. */
export const CHECKER_BLOCK = 16;

/**
 * A `width` × `height` image of opaque squares, `checker.size` pixels on a side, starting with
 * colour `a` at the top-left. Throws `RangeError` for a size that is not a positive integer.
 */
export function checkerPixels(
    width: number,
    height: number,
    checker: ViewportChecker,
): PixelBuffer {
    const { size } = checker;
    if (![width, height, size].every((value) => Number.isInteger(value) && value >= 1)) {
        throw new RangeError(
            `A checkerboard needs positive integer sizes, got ${width}×${height} in squares ` +
                `of ${size}.`,
        );
    }
    // Two rows of pixels, one starting with each colour; every image row is a copy of one.
    const rowBytes = width * 4;
    const rows = [new Uint8ClampedArray(rowBytes), new Uint8ClampedArray(rowBytes)];
    for (let x = 0; x < width; x++) {
        const first = Math.floor(x / size) % 2 === 0;
        for (const [index, row] of rows.entries()) {
            const colour = first === (index === 0) ? checker.a : checker.b;
            const at = x * 4;
            row[at] = (colour >>> 16) & 255;
            row[at + 1] = (colour >>> 8) & 255;
            row[at + 2] = colour & 255;
            row[at + 3] = 255;
        }
    }
    const data = new Uint8ClampedArray(rowBytes * height);
    for (let y = 0; y < height; y++) {
        data.set(rows[Math.floor(y / size) % 2] ?? rows[0], y * rowBytes);
    }
    return { width, height, data };
}

/** Side of the checker image in map pixels. */
export function checkerBlockSize(checker: ViewportChecker): number {
    return CHECKER_BLOCK * checker.size;
}

/** The image `ed:checker` holds for `checker`: one block of squares. */
export function checkerBlock(checker: ViewportChecker): PixelBuffer {
    const side = checkerBlockSize(checker);
    return checkerPixels(side, side, checker);
}

/** Identifies a checker image: two images with the same spec have the same pixels. */
export function checkerSpec(checker: ViewportChecker): string {
    return `${checker.size}/${checker.a.toString(16)}/${checker.b.toString(16)}`;
}

/** The colour of the square at map pixel `(x, y)`, the grid anchored at the map origin. */
export function checkerColourAt(checker: ViewportChecker, x: number, y: number): number {
    const column = Math.floor(x / checker.size);
    const row = Math.floor(y / checker.size);
    return (column + row) % 2 === 0 ? checker.a : checker.b;
}

/** The average of the two colours, for squares too small on screen to tell apart. */
export function checkerMean(checker: ViewportChecker): number {
    const channel = (shift: number) =>
        Math.round((((checker.a >>> shift) & 255) + ((checker.b >>> shift) & 255)) / 2);
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
