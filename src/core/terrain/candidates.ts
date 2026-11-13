import type { TerrainAnalysis } from "./analysis";
import { WANG_INDEXES } from "./wangId";

// The candidates of the terrain filler (SPEC §5.2): the set's tiles in the order of its
// analysis, then the empty cell when erasing. For each index and terrain the filler keeps the
// set of candidates with that terrain there, as a bit set, so the candidates that match a
// cell's hard indexes are the intersection of at most eight sets: a cell costs the candidates
// that fit it, not the whole set. Built once per analysis and kept with it.

/** The filler's candidates and the bit sets that find them. */
export interface CandidateTable {
    /** Candidates: the set's tiles, then the empty cell when erasing. */
    readonly count: number;
    /** The empty cell's candidate, −1 when not erasing. */
    readonly empty: number;
    /** 8 terrains per candidate; the empty cell's are all 0. */
    readonly wangIds: Uint8Array;
    /** The cell value of each candidate; the empty cell's is 0. */
    readonly values: Uint32Array;
    /** 32-bit words per bit set. */
    readonly words: number;
    /** Every candidate. */
    readonly all: Uint32Array;
    /**
     * The candidates with terrain `t` at index `i`: `byIndex[i × (colorCount + 1) + t]`, for
     * `t` up to the set's terrain count.
     */
    readonly byIndex: readonly Uint32Array[];
    readonly colorCount: number;
}

const cache = new WeakMap<TerrainAnalysis, { erasing?: CandidateTable; tiles?: CandidateTable }>();

function build(analysis: TerrainAnalysis, erasing: boolean): CandidateTable {
    const tiles = analysis.candidateValues.length;
    const count = tiles + (erasing ? 1 : 0);
    const wangIds = new Uint8Array(count * WANG_INDEXES);
    wangIds.set(analysis.candidateWangIds.subarray(0, tiles * WANG_INDEXES));
    const values = new Uint32Array(count);
    values.set(analysis.candidateValues);
    const words = Math.ceil(count / 32);
    const all = new Uint32Array(words);
    for (let c = 0; c < count; c++) all[c >>> 5] = all[c >>> 5]! | (1 << (c & 31));
    const colorCount = analysis.colorCount;
    const byIndex = Array.from(
        { length: WANG_INDEXES * (colorCount + 1) },
        () => new Uint32Array(words),
    );
    for (let c = 0; c < count; c++) {
        for (let index = 0; index < WANG_INDEXES; index++) {
            const color = wangIds[c * WANG_INDEXES + index]!;
            if (color > colorCount) continue;
            const set = byIndex[index * (colorCount + 1) + color]!;
            set[c >>> 5] = set[c >>> 5]! | (1 << (c & 31));
        }
    }
    return { count, empty: erasing ? tiles : -1, wangIds, values, words, all, byIndex, colorCount };
}

/** The candidate table of `analysis`, with or without the empty cell. */
export function candidateTable(analysis: TerrainAnalysis, erasing: boolean): CandidateTable {
    let entry = cache.get(analysis);
    if (!entry) {
        entry = {};
        cache.set(analysis, entry);
    }
    const key = erasing ? "erasing" : "tiles";
    entry[key] ??= build(analysis, erasing);
    return entry[key];
}

/** Intersects `into` with the candidates that have `color` at `index`. */
export function keepWith(
    table: CandidateTable,
    into: Uint32Array,
    index: number,
    color: number,
): void {
    if (color > table.colorCount) {
        into.fill(0);
        return;
    }
    const set = table.byIndex[index * (table.colorCount + 1) + color]!;
    for (let w = 0; w < table.words; w++) into[w] = into[w]! & set[w]!;
}

/** Whether `set` holds a candidate. */
export function anyCandidate(set: Uint32Array): boolean {
    for (const word of set) if (word !== 0) return true;
    return false;
}

/** Calls `visit` for each candidate of `set`, in candidate order. */
export function forEachCandidate(set: Uint32Array, visit: (c: number) => void): void {
    for (let w = 0; w < set.length; w++) {
        let word = set[w]!;
        while (word !== 0) {
            const bit = 31 - Math.clz32(word & -word);
            visit(w * 32 + bit);
            word &= word - 1;
        }
    }
}
