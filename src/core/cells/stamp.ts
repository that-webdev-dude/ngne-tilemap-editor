import { flipH, flipV, rotateLeft, rotateRight } from "./orientation";
import { cellOrientation, withOrientation } from "./value";
import type { Orientation } from "./value";

// Stamp transforms (SPEC §2.3, Tiled's `TileLayer::flip` and `rotate`): a flip mirrors the
// cells' positions, a quarter turn rotates the stamp's rectangle and swaps its width and
// height, and every cell's orientation goes through the same operation.

/** A rectangle of in-memory cell values, row by row from the top-left; 0 is an empty cell. */
export interface Stamp {
    readonly width: number;
    readonly height: number;
    readonly cells: Uint32Array;
}

/** The four stamp transforms; rotations are clockwise (right) and counter-clockwise on screen. */
export type StampTransform = "flipH" | "flipV" | "rotateRight" | "rotateLeft";

const ORIENTATION_OPS: Record<StampTransform, (orientation: Orientation) => Orientation> = {
    flipH,
    flipV,
    rotateRight,
    rotateLeft,
};

/** One cell value under `transform`; empty stays empty. */
export function transformCell(value: number, transform: StampTransform): number {
    return withOrientation(value, ORIENTATION_OPS[transform](cellOrientation(value)));
}

/**
 * A new stamp: `stamp` under `transform`. A `w × h` stamp stays `w × h` under a flip and turns
 * into `h × w` under a rotation. Throws `RangeError` when `cells` does not hold `w × h` values.
 */
export function transformStamp(stamp: Stamp, transform: StampTransform): Stamp {
    const { width: w, height: h, cells } = stamp;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || cells.length !== w * h) {
        throw new RangeError(`A ${w}x${h} stamp needs ${w * h} cells, got ${cells.length}.`);
    }
    const turned = transform === "rotateRight" || transform === "rotateLeft";
    const width = turned ? h : w;
    const height = turned ? w : h;
    const out = new Uint32Array(w * h);
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            let tx: number;
            let ty: number;
            switch (transform) {
                case "flipH":
                    [tx, ty] = [w - 1 - x, y];
                    break;
                case "flipV":
                    [tx, ty] = [x, h - 1 - y];
                    break;
                case "rotateRight":
                    [tx, ty] = [h - 1 - y, x];
                    break;
                case "rotateLeft":
                    [tx, ty] = [y, w - 1 - x];
                    break;
            }
            out[ty * width + tx] = transformCell(cells[y * w + x]!, transform);
        }
    }
    return { width, height, cells: out };
}
