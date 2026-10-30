import { isCellValue } from "./value";

// A tile layer's cells (SPEC §2.2): chunks of 32 × 32 values keyed by chunk coordinates, an
// absent chunk all empty, each chunk with its count of non-empty cells. The chunk size is the
// viewport's chunk tier (ENGINE §4). Coordinates may be negative, ready for infinite maps.

/** Cells per chunk side, as a power of two. */
export const CHUNK_BITS = 5;
/** Cells per chunk side. */
export const CHUNK_SIZE = 1 << CHUNK_BITS;
/** Mask of a cell's x or y within its chunk. */
export const CELL_INDEX_MASK = CHUNK_SIZE - 1;

/** Cell coordinates lie in `[-2^30, 2^30)`, so a chunk key fits a double exactly. */
export const MAX_COORD = 2 ** 30;
const KEY_BIAS = 2 ** 25;
const KEY_SPAN = 2 ** 26;

/** Rectangle in cell coordinates. */
export interface CellRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** One chunk as the store hands it out. Callers read it and never write it. */
export interface CellChunk {
    /** Chunk coordinates: the chunk covers cells `cx·32 .. cx·32 + 31` and likewise in y. */
    readonly cx: number;
    readonly cy: number;
    /** Values row by row, index `(x & 31) + (y & 31)·32`. */
    readonly cells: Uint32Array;
    /** Non-empty cells in `cells`, at least 1. */
    readonly count: number;
}

interface Chunk {
    cx: number;
    cy: number;
    cells: Uint32Array;
    count: number;
}

function assertCoord(value: number): void {
    if (!Number.isInteger(value) || value < -MAX_COORD || value >= MAX_COORD) {
        throw new RangeError(`Cell coordinate must be an integer in [-2^30, 2^30), got ${value}.`);
    }
}

function assertRect(rect: CellRect): void {
    assertCoord(rect.x);
    assertCoord(rect.y);
    if (!Number.isInteger(rect.width) || !Number.isInteger(rect.height)) {
        throw new RangeError(
            `Cell rectangle size must be integers, got ${rect.width}x${rect.height}.`,
        );
    }
}

function chunkKey(cx: number, cy: number): number {
    return (cx + KEY_BIAS) * KEY_SPAN + (cy + KEY_BIAS);
}

/** The chunk range `[cx0, cx1] × [cy0, cy1]` a non-empty rectangle touches, or null. */
function chunkRange(rect: CellRect): [number, number, number, number] | null {
    assertRect(rect);
    if (rect.width <= 0 || rect.height <= 0) return null;
    const right = Math.min(rect.x + rect.width, MAX_COORD) - 1;
    const bottom = Math.min(rect.y + rect.height, MAX_COORD) - 1;
    return [rect.x >> CHUNK_BITS, rect.y >> CHUNK_BITS, right >> CHUNK_BITS, bottom >> CHUNK_BITS];
}

export class CellStore {
    private readonly chunks = new Map<number, Chunk>();
    private total = 0;

    /** Non-empty cells in the whole store. */
    get count(): number {
        return this.total;
    }

    /** Allocated chunks; each holds at least one non-empty cell. */
    get chunkCount(): number {
        return this.chunks.size;
    }

    /** The value at `(x, y)`, 0 when empty. */
    get(x: number, y: number): number {
        assertCoord(x);
        assertCoord(y);
        const chunk = this.chunks.get(chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS));
        return chunk === undefined
            ? 0
            : chunk.cells[(x & CELL_INDEX_MASK) | ((y & CELL_INDEX_MASK) << CHUNK_BITS)]!;
    }

    /**
     * Sets `(x, y)` to `value` (0 empties it) and returns the previous value. A chunk is
     * allocated on its first non-empty cell and released when its last one empties. Throws
     * `RangeError` unless `value` passes `isCellValue`; whether its tile exists is the
     * project's to check.
     */
    set(x: number, y: number, value: number): number {
        assertCoord(x);
        assertCoord(y);
        if (!isCellValue(value)) {
            throw new RangeError(`Not an in-memory cell value: ${value}.`);
        }
        const cx = x >> CHUNK_BITS;
        const cy = y >> CHUNK_BITS;
        const k = chunkKey(cx, cy);
        let chunk = this.chunks.get(k);
        if (chunk === undefined) {
            if (value === 0) return 0;
            chunk = { cx, cy, cells: new Uint32Array(CHUNK_SIZE * CHUNK_SIZE), count: 0 };
            this.chunks.set(k, chunk);
        }
        const index = (x & CELL_INDEX_MASK) | ((y & CELL_INDEX_MASK) << CHUNK_BITS);
        const previous = chunk.cells[index]!;
        chunk.cells[index] = value;
        const delta = (value !== 0 ? 1 : 0) - (previous !== 0 ? 1 : 0);
        chunk.count += delta;
        this.total += delta;
        if (chunk.count === 0) this.chunks.delete(k);
        return previous;
    }

    /** Empties every cell, or only those inside `rect`. */
    clear(rect?: CellRect): void {
        if (rect === undefined) {
            this.chunks.clear();
            this.total = 0;
            return;
        }
        const x1 = rect.x + rect.width;
        const y1 = rect.y + rect.height;
        for (const chunk of [...this.chunksIn(rect)] as Chunk[]) {
            const ox = chunk.cx << CHUNK_BITS;
            const oy = chunk.cy << CHUNK_BITS;
            const left = Math.max(rect.x - ox, 0);
            const top = Math.max(rect.y - oy, 0);
            const right = Math.min(x1 - ox, CHUNK_SIZE);
            const bottom = Math.min(y1 - oy, CHUNK_SIZE);
            let removed = 0;
            for (let y = top; y < bottom; y += 1) {
                for (let x = left; x < right; x += 1) {
                    const index = x | (y << CHUNK_BITS);
                    if (chunk.cells[index] !== 0) {
                        chunk.cells[index] = 0;
                        removed += 1;
                    }
                }
            }
            chunk.count -= removed;
            this.total -= removed;
            if (chunk.count === 0) this.chunks.delete(chunkKey(chunk.cx, chunk.cy));
        }
    }

    /**
     * The allocated chunks `rect` touches, in no particular order. Visits
     * `min(chunks the rectangle spans, allocated chunks)` entries, so it is O(chunks).
     */
    *chunksIn(rect: CellRect): Generator<CellChunk> {
        const range = chunkRange(rect);
        if (range === null) return;
        const [cx0, cy0, cx1, cy1] = range;
        const spanned = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
        if (spanned > this.chunks.size) {
            for (const chunk of this.chunks.values()) {
                if (chunk.cx >= cx0 && chunk.cx <= cx1 && chunk.cy >= cy0 && chunk.cy <= cy1) {
                    yield chunk;
                }
            }
            return;
        }
        for (let cy = cy0; cy <= cy1; cy += 1) {
            for (let cx = cx0; cx <= cx1; cx += 1) {
                const chunk = this.chunks.get(chunkKey(cx, cy));
                if (chunk !== undefined) yield chunk;
            }
        }
    }

    /**
     * An upper bound of the non-empty cells inside `rect`: the summed counts of the chunks it
     * touches (ENGINE §4 tier choice). O(chunks), no cell scan.
     */
    countUpperBound(rect: CellRect): number {
        let sum = 0;
        for (const chunk of this.chunksIn(rect)) sum += chunk.count;
        return sum;
    }
}
