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

/** One fill over a grid: matches cells as it reads them and collects the filled runs. */
class Scanline {
    readonly #read: CellReader;
    readonly #accepts: (value: number) => boolean;
    readonly #box: CellRect;
    readonly #state: Uint8Array;
    readonly #seeds: number[] = [];
    readonly spans: RowSpan[] = [];

    constructor(read: CellReader, accepts: (value: number) => boolean, grid: FillGrid) {
        this.#read = read;
        this.#accepts = accepts;
        this.#box = grid.box;
        this.#state = grid.state;
    }

    /** Whether the cell at `column`, `row` of the grid matches and is not filled yet. */
    #open(column: number, row: number): boolean {
        const { x, y, width } = this.#box;
        const index = row * width + column;
        if (this.#state[index] === UNREAD) {
            this.#state[index] = this.#accepts(this.#read(x + column, y + row))
                ? MATCHING
                : BLOCKED;
        }
        return this.#state[index] === MATCHING;
    }

    /** Pushes one seed for each run of matching cells of `row` between `left` and `right`. */
    #seedRow(row: number, left: number, right: number): void {
        let inRun = false;
        for (let column = left; column <= right; column++) {
            const matching = this.#open(column, row);
            if (matching && !inRun) this.#seeds.push(row * this.#box.width + column);
            inRun = matching;
        }
    }

    /** Fills the run through the seed at grid index `seed` and seeds the rows beside it. */
    #fillRun(seed: number): void {
        const { width, height } = this.#box;
        const row = Math.floor(seed / width);
        let left = seed - row * width;
        let right = left;
        while (left > 0 && this.#open(left - 1, row)) left--;
        while (right < width - 1 && this.#open(right + 1, row)) right++;
        this.#state.fill(FILLED, row * width + left, row * width + right + 1);
        this.spans.push({
            y: this.#box.y + row,
            start: this.#box.x + left,
            end: this.#box.x + right + 1,
        });
        if (row > 0) this.#seedRow(row - 1, left, right);
        if (row < height - 1) this.#seedRow(row + 1, left, right);
    }

    /** Fills from the cell at `column`, `row` until no seed is left. */
    run(column: number, row: number): void {
        if (this.#open(column, row)) this.#seeds.push(row * this.#box.width + column);
        let seed = this.#seeds.pop();
        while (seed !== undefined) {
            if (this.#state[seed] === MATCHING) this.#fillRun(seed);
            seed = this.#seeds.pop();
        }
    }
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
    const column = origin.x - box.x;
    const row = origin.y - box.y;
    const inBox = column >= 0 && row >= 0 && column < box.width && row < box.height;
    if (!inBox || state[row * box.width + column] !== UNREAD) return [];

    const scanline = new Scanline(read, matches ?? equalTo(read(origin.x, origin.y)), grid);
    scanline.run(column, row);
    return scanline.spans.sort((a, b) => a.y - b.y || a.start - b.start);
}
