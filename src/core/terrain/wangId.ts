import type { Orientation } from "../cells";
import type { TerrainSetType } from "../model";

// Terrain IDs per index (FORMAT §2.4): Tiled's `WangId` (`src/libtiled/wangset.h`, `.cpp`, tag
// v1.12.2), eight indexes clockwise from the top, even = edges, odd = corners, 0 = no terrain.
// A WangId is held as 8 bytes; 0xFF at an index is Tiled's `INDEX_MASK`: in a desired WangId
// it means "no wish", in a mask it means "this index is a hard constraint".
// Derived from libtiled (BSD 2-clause licence): see public/THIRD-PARTY-NOTICES.txt.

/** Indexes per WangId. */
export const WANG_INDEXES = 8;
/** `INDEX_MASK`: no wish in a desired WangId, a hard constraint in a mask. */
export const INDEX_MASK = 0xff;

export const TOP = 0;
export const TOP_RIGHT = 1;
export const RIGHT = 2;
export const BOTTOM_RIGHT = 3;
export const BOTTOM = 4;
export const BOTTOM_LEFT = 5;
export const LEFT = 6;
export const TOP_LEFT = 7;

/** A WangId index, 0..7 clockwise from the top. */
export type WangIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Offsets of the neighbour at each index: the 8 surrounding cells clockwise from the one above. */
export const AROUND: readonly (readonly [number, number])[] = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
];

export const isCorner = (index: number): boolean => (index & 1) === 1;
export const oppositeIndex = (index: number): WangIndex => ((index + 4) % 8) as WangIndex;
export const nextIndex = (index: number): WangIndex => ((index + 1) % 8) as WangIndex;
export const previousIndex = (index: number): WangIndex => ((index + 7) % 8) as WangIndex;

/** Whether the set's type uses `index` (Tiled's `typeMask()`): corners, edges or all. */
export function typeUsesIndex(type: TerrainSetType, index: number): boolean {
    if (type === "corner") return isCorner(index);
    if (type === "edge") return !isCorner(index);
    return true;
}

/**
 * The index of a cell's 3 × 3 grid position (Tiled's `WangId::indexByGrid`): sides are edges,
 * corners are corners, the centre is none (null).
 */
export function indexByGrid(x: number, y: number): WangIndex | null {
    const map: readonly (readonly (WangIndex | null)[])[] = [
        [TOP_LEFT, TOP, TOP_RIGHT],
        [LEFT, null, RIGHT],
        [BOTTOM_LEFT, BOTTOM, BOTTOM_RIGHT],
    ];
    const row = map[y];
    if (!row || x < 0 || x > 2) throw new RangeError(`Grid position must be 0..2, got ${x}, ${y}.`);
    return row[x]!;
}

/** `rotated(1)`: a quarter turn clockwise; index `i` moves to `i + 2`. */
const ROTATE: readonly number[] = [6, 7, 0, 1, 2, 3, 4, 5];
/** `flippedHorizontally()`: left and right swap, top and bottom stay, corners mirror. */
const FLIP_H: readonly number[] = [0, 7, 6, 5, 4, 3, 2, 1];

/** `out[k] = from[source[k]]`. */
function permute(from: readonly number[], source: readonly number[]): number[] {
    return source.map((index) => from[index]!);
}

/**
 * Per orientation `H<<2 | V<<1 | D`, the source index of each index of a cell's WangId: Tiled's
 * `wangIdOfCell`, which applies the anti-diagonal flip (rotate once, then flip horizontally),
 * then H, then V (V = flip horizontally, then rotate twice).
 */
export const ORIENTATION_SOURCES: readonly (readonly number[])[] = Array.from(
    { length: 8 },
    (_, orientation) => {
        let sources = [0, 1, 2, 3, 4, 5, 6, 7];
        if (orientation & 1) sources = permute(permute(sources, ROTATE), FLIP_H);
        if (orientation & 4) sources = permute(sources, FLIP_H);
        if (orientation & 2) sources = permute(permute(permute(sources, FLIP_H), ROTATE), ROTATE);
        return sources;
    },
);

/** The WangId of a tile drawn in `orientation`, given its stored WangId. */
export function orientWangId(wangId: ArrayLike<number>, orientation: Orientation): number[] {
    return ORIENTATION_SOURCES[orientation]!.map((index) => wangId[index]!);
}
