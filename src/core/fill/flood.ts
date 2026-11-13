import type { CellRect } from "../cells";
import type { PixelPoint } from "../raster/line";
import { regionBounds } from "./region";
import type { Region, RowSpan } from "./region";

// The flood fill of the bucket and the magic wand (SPEC §4.3): the cells 4-connected to an
// origin cell through cells that match it, kept inside a rectangle or a region. A scanline fill
// over a state grid the size of the bounds' bounding box: each run of a row is filled at once
// and seeds the runs above and below it. Every allowed cell is read at most once and no other
// cell is read. Iterative and pure.

/** A cell's value; 0 when it is empty. */
export type CellReader = (x: number, y: number) => number;

/** Not allowed, or read and not matching. */
const BLOCKED = 0;
/** Allowed and not read yet. */
const UNREAD = 1;
/** Read and matching, not filled yet. */
const MATCHING = 2;
/** In the result. */
const FILLED = 3;

/** The cells a fill may visit: a state per cell of `box`, row by row. */
interface FillGrid {
    readonly box: CellRect;
    readonly state: Uint8Array;
}

/** The test of a value equal to `target`, tile and flags alike. */
function equalTo(target: number): (value: number) => boolean {
    return (value) => value === target;
}

function isRegion(bounds: CellRect | Region): bounds is Region {
    return Array.isArray(bounds);
}

/** The grid of the allowed cells of `bounds`, all unread; null when there are none. */
function allowedGrid(bounds: CellRect | Region): FillGrid | null {
    if (!isRegion(bounds)) {
        if (bounds.width <= 0 || bounds.height <= 0) return null;
        const state = new Uint8Array(bounds.width * bounds.height).fill(UNREAD);
        return { box: bounds, state };
    }
    const box = regionBounds(bounds);
    if (!box) return null;
    const state = new Uint8Array(box.width * box.height);
    for (const span of bounds) {
        const row = (span.y - box.y) * box.width - box.x;
        state.fill(UNREAD, row + span.start, row + span.end);
    }
    return { box, state };
}

/**
 * The region of the cells 4-connected to `origin` through allowed, matching cells, origin
 * included. The allowed cells are those of `bounds`, a rectangle or a region. A cell matches
 * when `matches(read(x, y))` holds, or without `matches` when its value equals the origin's
 * exactly (tile and flags). Empty when `origin` is not allowed or does not match.
 */
export function floodRegion(
    read: CellReader,
    origin: PixelPoint,
    bounds: CellRect | Region,
    matches?: (value: number) => boolean,
): Region {
    const grid = allowedGrid(bounds);
    if (!grid) return [];
    const { box, state } = grid;
    const ox = origin.x - box.x;
    const oy = origin.y - box.y;
    if (ox < 0 || oy < 0 || ox >= box.width || oy >= box.height) return [];
    if (state[oy * box.width + ox] !== UNREAD) return [];

    const accepts = matches ?? equalTo(read(origin.x, origin.y));

    /** Whether the cell at grid index `index` (column `column`, row `row`) matches and is unfilled. */
    const open = (index: number, column: number, row: number): boolean => {
        if (state[index] === UNREAD) {
            state[index] = accepts(read(box.x + column, box.y + row)) ? MATCHING : BLOCKED;
        }
        return state[index] === MATCHING;
    };

    const seeds: number[] = [];
    /** Pushes one seed for each run of matching cells of `row` between `left` and `right`. */
    const seedRow = (row: number, left: number, right: number): void => {
        const base = row * box.width;
        let inRun = false;
        for (let column = left; column <= right; column++) {
            const matching = open(base + column, column, row);
            if (matching && !inRun) seeds.push(base + column);
            inRun = matching;
        }
    };

    const spans: RowSpan[] = [];
    if (open(oy * box.width + ox, ox, oy)) seeds.push(oy * box.width + ox);
    while (seeds.length > 0) {
        const seed = seeds.pop()!;
        if (state[seed] !== MATCHING) continue;
        const row = Math.floor(seed / box.width);
        const base = row * box.width;
        let left = seed - base;
        let right = left;
        while (left > 0 && open(base + left - 1, left - 1, row)) left--;
        while (right < box.width - 1 && open(base + right + 1, right + 1, row)) right++;
        state.fill(FILLED, base + left, base + right + 1);
        spans.push({ y: box.y + row, start: box.x + left, end: box.x + right + 1 });
        if (row > 0) seedRow(row - 1, left, right);
        if (row < box.height - 1) seedRow(row + 1, left, right);
    }
    spans.sort((a, b) => a.y - b.y || a.start - b.start);
    return spans;
}
