import { cellOrientation, cellSlot, cellTileId, cellValue } from "../cells";
import type { TerrainSet, TerrainSetType } from "../model";
import { ORIENTATION_SOURCES, WANG_INDEXES, isCorner, typeUsesIndex } from "./wangId";

// Analysis of one terrain set (SPEC §5.2): Tiled's `WangSet` (`src/libtiled/wangset.cpp`, tag
// v1.12.2) without probabilities and transformations (Later): the candidate list (base tiles
// only), the colour-distance matrix by fixed-point relaxation, the maximum distance,
// completeness and the missing combinations of corner and edge sets.
// Derived from libtiled (BSD 2-clause licence): see public/THIRD-PARTY-NOTICES.txt.

/** What the filler and the Terrains panel read of a terrain set. */
export interface TerrainAnalysis {
    readonly type: TerrainSetType;
    /** Terrains of the set, `C`. */
    readonly colorCount: number;
    /** The slot of the set's tileset: candidates are cells of it. */
    readonly slot: number;
    /** Candidates, in the order of the set's tiles: their WangIds masked by type, 8 bytes each. */
    readonly candidateWangIds: Uint8Array;
    /** The cell value of each candidate: its tile, untransformed. */
    readonly candidateValues: Uint32Array;
    /**
     * Distances, `(C + 1) × (C + 1)`, row `a` column `b` at `a × (C + 1) + b`: the fewest
     * transitions from terrain `a` to `b`, −1 when there is no path. Rows are terrains `1..C`;
     * column 0 is the distance to "no terrain"; row 0 is unused (`penalty` reads column 0).
     */
    readonly distances: Int32Array;
    /** The largest distance between two terrains, at least 1 (Tiled's starting value). */
    readonly maximumDistance: number;
    /** `C⁴` for corner and edge sets, `C⁸` for mixed sets. */
    readonly completeSetSize: number;
    /** Distinct combinations of the type's indexes, none of them 0, that some tile has. */
    readonly presentCombinations: number;
    /** Every combination of the type's indexes is present (SPEC §5.1, §5.2). */
    readonly complete: boolean;
    /**
     * Tiled's `WangSet::isComplete()`, which the filler reads to skip its look-ahead. It counts
     * only WangIds with a terrain at all eight indexes after the type mask, so a corner or edge
     * set is never complete to the filler (reference/tiled.md §4).
     */
    readonly fillerComplete: boolean;
    /** `completeSetSize − presentCombinations` for corner and edge sets; null for mixed sets. */
    readonly missingCount: number | null;
    /** The present combinations of a corner or edge set, as `combinationKey` gives them. */
    readonly presentKeys: ReadonlySet<number>;
    /** Stored WangId of each tile of the set, masked by type, by tile ID. */
    readonly tileWangIds: ReadonlyMap<number, Uint8Array>;
}

/** The type's indexes in the order of Tiled's `cornerColor(i)` / `edgeColor(i)`. */
function typeIndexes(type: "corner" | "edge"): readonly number[] {
    return type === "corner" ? [1, 3, 5, 7] : [0, 2, 4, 6];
}

/** Key of a corner or edge combination: its four terrains as bytes, first index lowest. */
function combinationKey(wangId: ArrayLike<number>, at: number, indexes: readonly number[]): number {
    let key = 0;
    for (let k = 3; k >= 0; k--) key = key * 256 + wangId[at + indexes[k]!]!;
    return key;
}

/** Tiled's `recalculateColorDistances`: direct transitions, then relaxation until stable. */
function colorDistances(
    colorCount: number,
    wangIds: Uint8Array,
    count: number,
): { distances: Int32Array; maximumDistance: number } {
    const n = colorCount + 1;
    const distances = new Int32Array(n * n).fill(-1);
    const corners = new Set<number>();
    const edges = new Set<number>();
    // Colours sharing a tile's corners, or a tile's edges, are 1 apart. Corners and edges are
    // not connected, which keeps corner and edge sets from reaching "no terrain".
    for (let t = 0; t < count; t++) {
        corners.clear();
        edges.clear();
        for (let index = 0; index < WANG_INDEXES; index++) {
            (isCorner(index) ? corners : edges).add(wangIds[t * 8 + index]!);
        }
        for (const group of [corners, edges]) {
            for (const i of group) {
                if (i === 0) continue;
                for (const j of group) distances[i * n + j] = 1;
            }
        }
    }
    for (let i = 1; i <= colorCount; i++) distances[i * n + i] = 0;

    let maximumDistance = 1;
    let newConnections: boolean;
    do {
        newConnections = false;
        for (let i = 1; i <= colorCount; i++) {
            for (let j = 1; j <= colorCount; j++) {
                if (i === j) continue;
                for (let t = 0; t <= colorCount; t++) {
                    const d0 = distances[i * n + t]!;
                    const d1 = distances[j * n + t]!;
                    if (d0 === -1 || d1 === -1) continue;
                    const d = distances[i * n + j]!;
                    if (d === -1 || d0 + d1 < d) {
                        distances[i * n + j] = d0 + d1;
                        distances[j * n + i] = d0 + d1;
                        maximumDistance = Math.max(maximumDistance, d0 + d1);
                        newConnections = true;
                    }
                }
            }
        }
    } while (newConnections);
    return { distances, maximumDistance };
}

/**
 * The analysis of `set`, whose tileset is in `slot`. Tiles whose stored WangId is all 0 are
 * not in the set (Tiled never stores them); every other tile is a candidate, its WangId masked
 * by the set's type.
 */
export function analyzeTerrainSet(set: TerrainSet, slot: number): TerrainAnalysis {
    const { type } = set;
    const colorCount = set.colors.length;
    const members = set.tiles.filter((tile) => tile.wangId.some((color) => color !== 0));
    const candidateWangIds = new Uint8Array(members.length * WANG_INDEXES);
    const candidateValues = new Uint32Array(members.length);
    const tileWangIds = new Map<number, Uint8Array>();
    members.forEach((tile, t) => {
        for (let index = 0; index < WANG_INDEXES; index++) {
            const color = typeUsesIndex(type, index) ? tile.wangId[index]! : 0;
            candidateWangIds[t * WANG_INDEXES + index] = color;
        }
        candidateValues[t] = cellValue(slot, tile.tile);
        tileWangIds.set(tile.tile, candidateWangIds.subarray(t * 8, t * 8 + 8));
    });

    const { distances, maximumDistance } = colorDistances(
        colorCount,
        candidateWangIds,
        members.length,
    );

    const exponent = type === "mixed" ? 8 : 4;
    const completeSetSize = colorCount ** exponent;
    // Tiled's count: masked WangIds without a 0 at any of the eight indexes.
    const fullIds = new Set<string>();
    const presentKeys = new Set<number>();
    const mixedPresent = new Set<string>();
    for (let t = 0; t < members.length; t++) {
        const wangId = candidateWangIds.subarray(t * 8, t * 8 + 8);
        if (!wangId.includes(0)) fullIds.add(wangId.join(","));
        if (type === "mixed") {
            if (!wangId.includes(0)) mixedPresent.add(wangId.join(","));
        } else {
            const indexes = typeIndexes(type);
            if (indexes.every((index) => wangId[index] !== 0)) {
                presentKeys.add(combinationKey(wangId, 0, indexes));
            }
        }
    }
    const presentCombinations = type === "mixed" ? mixedPresent.size : presentKeys.size;
    return {
        type,
        colorCount,
        slot,
        candidateWangIds,
        candidateValues,
        distances,
        maximumDistance,
        completeSetSize,
        presentCombinations,
        complete: presentCombinations === completeSetSize,
        fillerComplete: fullIds.size === completeSetSize,
        missingCount: type === "mixed" ? null : completeSetSize - presentCombinations,
        presentKeys,
        tileWangIds,
    };
}

/**
 * Tiled's `effectiveTypeForColor`: the set's type, except in a mixed set, where a terrain used
 * only at corners acts as a corner terrain and one used only at edges as an edge terrain. The
 * terrain brush picks its painting mode from it (`wangbrush.cpp` `setColor`).
 */
export function effectiveTypeForColor(analysis: TerrainAnalysis, color: number): TerrainSetType {
    if (analysis.type !== "mixed") return analysis.type;
    let usedAsCorner = false;
    let usedAsEdge = false;
    if (color > 0 && color <= analysis.colorCount) {
        const wangIds = analysis.candidateWangIds;
        for (let i = 0; i < wangIds.length; i++) {
            if (wangIds[i] !== color) continue;
            if (isCorner(i % WANG_INDEXES)) usedAsCorner = true;
            else usedAsEdge = true;
        }
    }
    if (usedAsEdge === usedAsCorner) return "mixed";
    return usedAsEdge ? "edge" : "corner";
}

/**
 * Tiled's `transitionPenalty(a, b)`: the distance from terrain `a` to `b`, 0 between two
 * "no terrain", −1 when there is no path.
 */
export function transitionPenalty(analysis: TerrainAnalysis, a: number, b: number): number {
    const n = analysis.colorCount + 1;
    if (a === 0 && b === 0) return 0;
    if (a === 0) return analysis.distances[b * n]!;
    return analysis.distances[a * n + b]!;
}

/**
 * The WangId of cell `value` in the set, masked by type (Tiled's `wangIdOfCell`): 0 at every
 * index for an empty cell, a cell of another tileset or a tile outside the set; otherwise the
 * tile's WangId turned by the cell's orientation. Written to `out`.
 */
export function wangIdOfCell(analysis: TerrainAnalysis, value: number, out: Uint8Array): void {
    const stored =
        value !== 0 && cellSlot(value) === analysis.slot
            ? analysis.tileWangIds.get(cellTileId(value))
            : undefined;
    if (!stored) {
        out.fill(0);
        return;
    }
    const sources = ORIENTATION_SOURCES[cellOrientation(value)]!;
    for (let index = 0; index < WANG_INDEXES; index++) out[index] = stored[sources[index]!]!;
}

/** One missing combination of a corner or edge set: the terrain at each of its 8 indexes. */
export type TerrainCombination = number[];

/**
 * Up to `limit` combinations of a corner or edge set that no tile has, in the order of Tiled's
 * `templateWangIdAt` (its "Patterns" view): the combination `n` has `cornerColor(i)` (or
 * `edgeColor(i)`) = digit `i` of `n` in base `C`, plus 1. Empty for a mixed set.
 */
export function missingCombinations(
    analysis: TerrainAnalysis,
    limit: number,
): TerrainCombination[] {
    if (analysis.type === "mixed" || limit <= 0) return [];
    const indexes = typeIndexes(analysis.type);
    const c = analysis.colorCount;
    const missing: TerrainCombination[] = [];
    const wangId = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let n = 0; n < analysis.completeSetSize && missing.length < limit; n++) {
        let rest = n;
        for (let i = 0; i < 4; i++) {
            wangId[indexes[i]!] = (rest % c) + 1;
            rest = Math.floor(rest / c);
        }
        if (!analysis.presentKeys.has(combinationKey(wangId, 0, indexes)))
            missing.push([...wangId]);
    }
    return missing;
}

const cache = new WeakMap<TerrainSet, { key: unknown[]; analysis: TerrainAnalysis }>();

/**
 * The analysis of `set`, recomputed when it changes: cached by the set object and kept while
 * its type, its `colors` and `tiles` arrays (by identity and length) and `slot` are the same.
 * A change made inside one of those arrays without replacing it is not seen, so code that
 * changes a set replaces the arrays it changes.
 */
export function terrainAnalysis(set: TerrainSet, slot: number): TerrainAnalysis {
    const key = [set.type, set.colors, set.colors.length, set.tiles, set.tiles.length, slot];
    const cached = cache.get(set);
    if (cached && cached.key.every((part, index) => part === key[index])) return cached.analysis;
    const analysis = analyzeTerrainSet(set, slot);
    cache.set(set, { key, analysis });
    return analysis;
}
