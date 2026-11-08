import { describe, expect, it } from "vitest";
import { cellValue, orientationMatrix } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import type { TerrainSet, TerrainSetType } from "../../src/core/model";
import {
    AROUND,
    ORIENTATION_SOURCES,
    analyzeTerrainSet,
    missingCombinations,
    terrainAnalysis,
    transitionPenalty,
    wangIdOfCell,
} from "../../src/core/terrain";
import type { TerrainAnalysis } from "../../src/core/terrain";

// TE-041: the analysis of a terrain set (SPEC §5.2), Tiled's `WangSet` at v1.12.2: base-tile
// candidates masked by type, the colour-distance matrix by fixed-point relaxation (corners and
// edges never connected), the maximum distance, completeness, missing combinations of corner
// and edge sets in the order of Tiled's `templateWangIdAt`, and the WangId of a cell drawn in
// any of the 8 orientations.

const SLOT = 3;

/** A set of `colors` terrains whose tile `i` has `wangIds[i]`. */
function terrainSet(type: TerrainSetType, colors: number, wangIds: number[][]): TerrainSet {
    return {
        name: "Set",
        type,
        colors: Array.from({ length: colors }, (_, i) => ({
            name: `T${i + 1}`,
            color: "#000000ff",
            tile: null,
        })),
        tiles: wangIds.map((wangId, tile) => ({ tile, wangId })),
    };
}

/** A corner WangId from its corners top-right, bottom-right, bottom-left, top-left. */
const corners = (tr: number, br: number, bl: number, tl: number) => [0, tr, 0, br, 0, bl, 0, tl];
/** An edge WangId from its edges top, right, bottom, left. */
const edges = (t: number, r: number, b: number, l: number) => [t, 0, r, 0, b, 0, l, 0];

/** Every combination of `count` indexes over terrains `1..c`, first index varying fastest. */
function combinations(c: number, count: number): number[][] {
    const out: number[][] = [];
    for (let n = 0; n < c ** count; n++) {
        let rest = n;
        out.push(
            Array.from({ length: count }, () => {
                const digit = (rest % c) + 1;
                rest = Math.floor(rest / c);
                return digit;
            }),
        );
    }
    return out;
}

/** The distance matrix rows `1..C`, columns `0..C`. */
function matrix(analysis: TerrainAnalysis): number[][] {
    const n = analysis.colorCount + 1;
    return Array.from({ length: analysis.colorCount }, (_, row) =>
        Array.from(analysis.distances.subarray((row + 1) * n, (row + 2) * n)),
    );
}

describe("terrain set analysis", () => {
    it("complete corner set of 2 terrains: all 16 combinations, distance 1, never complete to the filler", () => {
        const set = terrainSet(
            "corner",
            2,
            combinations(2, 4).map((c) => corners(c[0]!, c[1]!, c[2]!, c[3]!)),
        );
        const analysis = analyzeTerrainSet(set, SLOT);
        // Columns: no terrain, terrain 1, terrain 2. Corner sets never reach "no terrain".
        expect(matrix(analysis)).toEqual([
            [-1, 0, 1],
            [-1, 1, 0],
        ]);
        expect(analysis.maximumDistance).toBe(1);
        expect(analysis.completeSetSize).toBe(16);
        expect(analysis.presentCombinations).toBe(16);
        expect(analysis.complete).toBe(true);
        expect(analysis.missingCount).toBe(0);
        expect(missingCombinations(analysis, 10)).toEqual([]);
        // Tiled's `isComplete()` counts WangIds without a 0 at any of the 8 indexes.
        expect(analysis.fillerComplete).toBe(false);
        expect(analysis.candidateValues.length).toBe(16);
        expect(analysis.candidateValues[5]).toBe(cellValue(SLOT, 5));
    });

    it("corner chain 1–2–3: relaxation gives distance 2 between 1 and 3; 76 combinations missing", () => {
        const set = terrainSet("corner", 3, [
            corners(1, 1, 1, 1),
            corners(2, 2, 2, 2),
            corners(3, 3, 3, 3),
            corners(1, 1, 2, 2),
            corners(2, 2, 3, 3),
        ]);
        const analysis = analyzeTerrainSet(set, SLOT);
        expect(matrix(analysis)).toEqual([
            [-1, 0, 1, 2],
            [-1, 1, 0, 1],
            [-1, 2, 1, 0],
        ]);
        expect(analysis.maximumDistance).toBe(2);
        expect(transitionPenalty(analysis, 1, 3)).toBe(2);
        expect(transitionPenalty(analysis, 0, 0)).toBe(0);
        expect(transitionPenalty(analysis, 0, 2)).toBe(-1);
        expect(analysis.completeSetSize).toBe(81);
        expect(analysis.presentCombinations).toBe(5);
        expect(analysis.complete).toBe(false);
        expect(analysis.missingCount).toBe(76);
        // Template order: corner top-right varies fastest, terrains from 1.
        expect(missingCombinations(analysis, 3)).toEqual([
            corners(2, 1, 1, 1),
            corners(3, 1, 1, 1),
            corners(1, 2, 1, 1),
        ]);
        expect(missingCombinations(analysis, 1000)).toHaveLength(76);
    });

    it("corner set without transitions: terrains unreachable, maximum distance stays 1", () => {
        const set = terrainSet("corner", 2, [corners(1, 1, 1, 1), corners(2, 2, 2, 2)]);
        const analysis = analyzeTerrainSet(set, SLOT);
        expect(matrix(analysis)).toEqual([
            [-1, 0, -1],
            [-1, -1, 0],
        ]);
        expect(analysis.maximumDistance).toBe(1);
        expect(analysis.missingCount).toBe(14);
    });

    it("edge set with wildcards: terrains meet through 'no terrain' at distance 2", () => {
        const set = terrainSet("edge", 2, [
            edges(1, 1, 1, 1),
            edges(2, 2, 2, 2),
            edges(1, 0, 0, 0),
            edges(2, 0, 2, 0),
        ]);
        const analysis = analyzeTerrainSet(set, SLOT);
        expect(matrix(analysis)).toEqual([
            [1, 0, 2],
            [1, 2, 0],
        ]);
        expect(analysis.maximumDistance).toBe(2);
        expect(transitionPenalty(analysis, 0, 1)).toBe(1);
        expect(analysis.completeSetSize).toBe(16);
        // Combinations with a 0 are not counted.
        expect(analysis.presentCombinations).toBe(2);
        expect(analysis.missingCount).toBe(14);
        expect(missingCombinations(analysis, 2)).toEqual([edges(2, 1, 1, 1), edges(1, 2, 1, 1)]);
    });

    it("complete edge set of 2 terrains", () => {
        const set = terrainSet(
            "edge",
            2,
            combinations(2, 4).map((c) => edges(c[0]!, c[1]!, c[2]!, c[3]!)),
        );
        const analysis = analyzeTerrainSet(set, SLOT);
        expect(analysis.complete).toBe(true);
        expect(analysis.missingCount).toBe(0);
        expect(analysis.fillerComplete).toBe(false);
        expect(analysis.maximumDistance).toBe(1);
    });

    it("mixed set: corners and edges are not connected", () => {
        const set = terrainSet("mixed", 2, [
            [1, 1, 1, 1, 1, 1, 1, 1],
            [2, 2, 2, 2, 2, 2, 2, 2],
            [2, 1, 2, 1, 2, 1, 2, 1],
        ]);
        const analysis = analyzeTerrainSet(set, SLOT);
        expect(matrix(analysis)).toEqual([
            [-1, 0, -1],
            [-1, -1, 0],
        ]);
        expect(analysis.completeSetSize).toBe(256);
        expect(analysis.presentCombinations).toBe(3);
        expect(analysis.complete).toBe(false);
        expect(analysis.missingCount).toBeNull();
        expect(missingCombinations(analysis, 5)).toEqual([]);

        const linked = analyzeTerrainSet(
            terrainSet("mixed", 2, [...set.tiles.map((t) => t.wangId), [1, 1, 1, 2, 1, 1, 1, 2]]),
            SLOT,
        );
        expect(matrix(linked)).toEqual([
            [-1, 0, 1],
            [-1, 1, 0],
        ]);
    });

    it("complete mixed sets are complete to the filler too", () => {
        const one = analyzeTerrainSet(terrainSet("mixed", 1, [[1, 1, 1, 1, 1, 1, 1, 1]]), SLOT);
        expect(one.complete).toBe(true);
        expect(one.fillerComplete).toBe(true);
        expect(one.completeSetSize).toBe(1);
        const two = analyzeTerrainSet(terrainSet("mixed", 2, combinations(2, 8)), SLOT);
        expect(two.presentCombinations).toBe(256);
        expect(two.complete).toBe(true);
        expect(two.fillerComplete).toBe(true);
        expect(two.maximumDistance).toBe(1);
    });

    it("masks WangIds by type and leaves out tiles without terrain", () => {
        const set = terrainSet("corner", 2, [
            [2, 1, 2, 1, 2, 1, 2, 1],
            [0, 0, 0, 0, 0, 0, 0, 0],
        ]);
        const analysis = analyzeTerrainSet(set, SLOT);
        expect(Array.from(analysis.candidateWangIds)).toEqual(corners(1, 1, 1, 1));
        expect(Array.from(analysis.candidateValues)).toEqual([cellValue(SLOT, 0)]);
        // Edge colours of a corner set do not link terrains.
        expect(transitionPenalty(analysis, 1, 2)).toBe(-1);
    });

    it("recomputes when the set's arrays change and reuses the result otherwise", () => {
        const set = terrainSet("corner", 2, [corners(1, 1, 1, 1)]);
        const first = terrainAnalysis(set, SLOT);
        expect(terrainAnalysis(set, SLOT)).toBe(first);
        set.tiles = [...set.tiles, { tile: 1, wangId: corners(1, 1, 2, 2) }];
        const second = terrainAnalysis(set, SLOT);
        expect(second).not.toBe(first);
        expect(second.maximumDistance).toBe(1);
        expect(transitionPenalty(second, 1, 2)).toBe(1);
        set.type = "mixed";
        expect(terrainAnalysis(set, SLOT).type).toBe("mixed");
        expect(terrainAnalysis(set, SLOT + 1).slot).toBe(SLOT + 1);
    });
});

describe("WangId of a cell", () => {
    const set = terrainSet("corner", 4, [corners(1, 2, 3, 4)]);
    const analysis = analyzeTerrainSet(set, SLOT);
    const of = (value: number) => {
        const out = new Uint8Array(8);
        wangIdOfCell(analysis, value, out);
        return Array.from(out);
    };

    it("turns the stored WangId by the cell's flags as Tiled does", () => {
        expect(of(cellValue(SLOT, 0, 0))).toEqual(corners(1, 2, 3, 4));
        expect(of(cellValue(SLOT, 0, 0b100))).toEqual(corners(4, 3, 2, 1)); // H
        expect(of(cellValue(SLOT, 0, 0b010))).toEqual(corners(2, 1, 4, 3)); // V
        expect(of(cellValue(SLOT, 0, 0b001))).toEqual(corners(3, 2, 1, 4)); // anti-diagonal
        expect(of(cellValue(SLOT, 0, 0b110))).toEqual(corners(3, 4, 1, 2)); // 180°
    });

    it("moves each index where the orientation matrix moves its offset, for all 8 orientations", () => {
        for (let o = 0; o < 8; o++) {
            const [m00, m01, m10, m11] = orientationMatrix(o as Orientation);
            for (let k = 0; k < 8; k++) {
                const [a, b] = AROUND[k]!;
                const target = AROUND.findIndex(
                    ([x, y]) => x === m00 * a + m01 * b && y === m10 * a + m11 * b,
                );
                expect(ORIENTATION_SOURCES[o]![target], `orientation ${o}, index ${k}`).toBe(k);
            }
        }
    });

    it("is 0 for an empty cell, another tileset and a tile outside the set", () => {
        expect(of(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(of(cellValue(SLOT + 1, 0))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(of(cellValue(SLOT, 7))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });
});
