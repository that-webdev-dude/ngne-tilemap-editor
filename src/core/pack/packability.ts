import { MAX_ATLAS_SIDE } from "../sprite/export/packErrors";

// The packability check of SPEC §6.1: whether `pack` with the options of SPEC §10.2 can hold a
// tileset's distinct tiles, from the packer's layout alone, without pixels. It mirrors the grid
// of `pack` (`core/sprite/export/pack.ts`): one cell per distinct tile of the even tile size,
// ⌈√r⌉ columns, each cell with its 1 px extrusion ring and no padding.

/** Ring around every rectangle on each axis: `extrude: 1` on both sides, `padding: 0`. */
const RING = 2;

/** `size` rounded up to even, at least 2: the side of a tile's rectangle (FORMAT §4). */
export function evenSide(size: number): number {
    return Math.max(2, size + (size % 2));
}

/** Size in pixels of the atlas that holds `distinctTiles` tiles of `tileWidth × tileHeight`. */
export function atlasSizeFor(
    distinctTiles: number,
    tileWidth: number,
    tileHeight: number,
): { width: number; height: number } {
    const values = [distinctTiles, tileWidth, tileHeight];
    if (!values.every((value) => Number.isInteger(value) && value >= 1)) {
        throw new RangeError(
            `Tile count and tile size must be positive integers, got ${values.join(", ")}.`,
        );
    }
    const columns = Math.ceil(Math.sqrt(distinctTiles));
    const rows = Math.ceil(distinctTiles / columns);
    return {
        width: columns * (evenSide(tileWidth) + RING),
        height: rows * (evenSide(tileHeight) + RING),
    };
}

function fits(distinctTiles: number, tileWidth: number, tileHeight: number): boolean {
    const { width, height } = atlasSizeFor(distinctTiles, tileWidth, tileHeight);
    return width <= MAX_ATLAS_SIDE && height <= MAX_ATLAS_SIDE;
}

/**
 * Most distinct tiles of `tileWidth × tileHeight` one atlas holds: 961 of 256 × 256. Both sides
 * of the layout grow with the tile count, so the largest count that fits is found by bisection.
 */
export function maxPackableTiles(tileWidth: number, tileHeight: number): number {
    const columns = Math.floor(MAX_ATLAS_SIDE / (evenSide(tileWidth) + RING));
    let low = 0;
    let high = columns * columns;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(middle, tileWidth, tileHeight)) low = middle;
        else high = middle - 1;
    }
    return low;
}

export type Packability =
    | { ok: true; width: number; height: number }
    | { ok: false; width: number; height: number; maxTiles: number; message: string };

/**
 * Whether a tileset named `tilesetName` with `distinctTiles` distinct tiles of
 * `tileWidth × tileHeight` can be packed (SPEC §6.1): `⌈√r⌉ × (w + 2) ≤ 8192` and
 * `⌈r / ⌈√r⌉⌉ × (h + 2) ≤ 8192` for `r` tiles of even size `w × h`. `width` and `height` are
 * the size `pack` gives the atlas. A refusal carries the limit and a message naming it.
 */
export function checkPackable(
    tilesetName: string,
    distinctTiles: number,
    tileWidth: number,
    tileHeight: number,
): Packability {
    const { width, height } = atlasSizeFor(distinctTiles, tileWidth, tileHeight);
    if (width <= MAX_ATLAS_SIDE && height <= MAX_ATLAS_SIDE) return { ok: true, width, height };
    const maxTiles = maxPackableTiles(tileWidth, tileHeight);
    const size = `${tileWidth} × ${tileHeight}`;
    return {
        ok: false,
        width,
        height,
        maxTiles,
        message:
            `Tileset ${JSON.stringify(tilesetName)} would have ${distinctTiles} distinct tiles ` +
            `of ${size} px; its export atlas holds at most ${maxTiles} tiles of that size ` +
            `(${MAX_ATLAS_SIDE} px a side).`,
    };
}
