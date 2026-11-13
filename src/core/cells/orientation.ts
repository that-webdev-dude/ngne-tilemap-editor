import type { Orientation } from "./value";

// The 8 orientations of a tile (FORMAT §1.2, SPEC §2.3) as 2 × 2 integer matrices acting on
// the texel offset `(a, b)` from the tile's centre, screen axes right and down. Tiled applies
// anti-diagonal first, then H, then V, so orientation `HVD` is `V^v · H^h · D^d`.

/** Row-major 2 × 2 matrix `[m00, m01, m10, m11]`: `(a, b)` lands at `(m00·a + m01·b, m10·a + m11·b)`. */
export type Matrix2 = readonly [number, number, number, number];

/** Orientations by name, as the rows of FORMAT §1.2. */
export const ORIENTATION = {
    asDrawn: 0b000,
    flippedH: 0b100,
    flippedV: 0b010,
    rotated180: 0b110,
    rotatedRight: 0b101,
    rotatedLeft: 0b011,
    mainDiagonal: 0b001,
    antiDiagonal: 0b111,
} as const satisfies Record<string, Orientation>;

/**
 * Tiled's rotate tables (`src/libtiled/tilelayer.cpp`, tag `v1.12.2`), indexed by orientation.
 * From libtiled (BSD 2-clause licence): see public/THIRD-PARTY-NOTICES.txt.
 */
export const ROTATE_RIGHT_MASK: readonly Orientation[] = [5, 4, 1, 0, 7, 6, 3, 2];
export const ROTATE_LEFT_MASK: readonly Orientation[] = [3, 2, 7, 6, 1, 0, 5, 4];

/** `p · q`: apply `q`, then `p`. `| 0` keeps entries integers without `-0`. */
export function multiply(p: Matrix2, q: Matrix2): Matrix2 {
    return [
        (p[0] * q[0] + p[1] * q[2]) | 0,
        (p[0] * q[1] + p[1] * q[3]) | 0,
        (p[2] * q[0] + p[3] * q[2]) | 0,
        (p[2] * q[1] + p[3] * q[3]) | 0,
    ];
}

const IDENTITY: Matrix2 = [1, 0, 0, 1];
const MIRROR_H: Matrix2 = [-1, 0, 0, 1];
const MIRROR_V: Matrix2 = [1, 0, 0, -1];
const SWAP_XY: Matrix2 = [0, 1, 1, 0];

function build(orientation: number): Matrix2 {
    let m = orientation & 1 ? SWAP_XY : IDENTITY;
    if (orientation & 4) m = multiply(MIRROR_H, m);
    if (orientation & 2) m = multiply(MIRROR_V, m);
    return m;
}

const MATRICES: readonly Matrix2[] = Array.from({ length: 8 }, (_, o) => build(o));

function key(m: Matrix2): number {
    return (m[0] + 1) * 27 + (m[1] + 1) * 9 + (m[2] + 1) * 3 + (m[3] + 1);
}

const BY_MATRIX = new Map(MATRICES.map((m, o) => [key(m), o as Orientation]));

/** The matrix of an orientation. */
export function orientationMatrix(orientation: Orientation): Matrix2 {
    return MATRICES[orientation]!;
}

/** The orientation of a matrix, or null when it is none of the 8. */
export function matrixOrientation(m: Matrix2): Orientation | null {
    return BY_MATRIX.get(key(m)) ?? null;
}

const COMPOSITIONS: readonly Orientation[] = Array.from({ length: 64 }, (_, i) =>
    matrixOrientation(multiply(MATRICES[i & 7]!, MATRICES[i >> 3]!))!,
);

/** The orientation of drawing in `first`, then transforming by `then`. */
export function compose(first: Orientation, then: Orientation): Orientation {
    return COMPOSITIONS[(first << 3) | then]!;
}

/** Flip horizontally: toggles `H`, leaves `D` (Tiled's `flip()`). */
export function flipH(orientation: Orientation): Orientation {
    return (orientation ^ 0b100) as Orientation;
}

/** Flip vertically: toggles `V`, leaves `D`. */
export function flipV(orientation: Orientation): Orientation {
    return (orientation ^ 0b010) as Orientation;
}

/** A quarter turn clockwise on screen, through Tiled's `rotateRightMask`. */
export function rotateRight(orientation: Orientation): Orientation {
    return ROTATE_RIGHT_MASK[orientation]!;
}

/** A quarter turn counter-clockwise on screen, through Tiled's `rotateLeftMask`. */
export function rotateLeft(orientation: Orientation): Orientation {
    return ROTATE_LEFT_MASK[orientation]!;
}
