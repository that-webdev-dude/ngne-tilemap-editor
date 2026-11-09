import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cellTileId, cellValue } from "../../src/core/cells";
import type { TerrainSet, TerrainSetType } from "../../src/core/model";
import {
    BOTTOM,
    LEFT,
    RIGHT,
    TOP,
    TOP_LEFT,
    TerrainFiller,
    analyzeTerrainSet,
    brushStep,
    brushTargetAt,
    effectiveTypeForColor,
    mirroredTarget,
} from "../../src/core/terrain";
import type { BrushStep, BrushTarget, TerrainAnalysis } from "../../src/core/terrain";
import { TERRAIN_STROKES } from "./support/terrainFixtures";
import type { TerrainStep } from "./support/terrainFixtures";

// TE-044: the terrain brush's painting in `core/terrain/brush.ts` (SPEC §5.3, Tiled's
// `wangbrush.cpp` at v1.12.2). The pointer positions the E2E test clicks give the targets of
// the TE-042 strokes, and those targets painted one step each give the goldens; lines, drags
// and rotational symmetry constrain what Tiled's `updateBrush` constrains.

const FOLDER = new URL("../fixtures/terrain/", import.meta.url);
const SLOT = 1;
const SAND = 2;
const WATER = 3;

interface Tmj {
    width: number;
    height: number;
    layers: { data: number[] }[];
}

interface Tsj {
    wangsets: {
        name: string;
        type: TerrainSetType;
        colors: { name: string }[];
        wangtiles: { tileid: number; wangid: number[] }[];
    }[];
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, FOLDER), "utf8"));

interface TestMap {
    width: number;
    height: number;
    cells: number[];
}

function readMap(file: string): TestMap {
    const map = readJson<Tmj>(file);
    const cells = map.layers[0]!.data.map((gid) => (gid === 0 ? 0 : cellValue(SLOT, gid - 1)));
    return { width: map.width, height: map.height, cells };
}

function analysisOf(fixture: string): TerrainAnalysis {
    const [wangSet] = readJson<Tsj>(`${fixture}.tsj`).wangsets;
    const set: TerrainSet = {
        name: wangSet!.name,
        type: wangSet!.type,
        colors: wangSet!.colors.map(({ name }) => ({ name, color: "#000000ff", tile: null })),
        tiles: wangSet!.wangtiles.map(({ tileid, wangid }) => ({ tile: tileid, wangId: wangid })),
    };
    return analyzeTerrainSet(set, SLOT);
}

const noTies = () => {
    throw new Error("The filler needed a random choice between equal candidates.");
};

/** The pointer position (cells, with fraction) the E2E test uses for a step. */
function stepPosition(step: Exclude<TerrainStep, { kind: "fill" }>): [number, number] {
    if (step.kind !== "edge") {
        // A vertex is the top-left corner of its cell: a quarter in from it; a full tile at its middle.
        return step.kind === "corner"
            ? [step.x + 0.25, step.y + 0.25]
            : [step.x + 0.5, step.y + 0.5];
    }
    const along = { top: [0.5, 0.1], right: [0.9, 0.5], bottom: [0.5, 0.9], left: [0.1, 0.5] };
    const [fx, fy] = along[step.side];
    return [step.x + fx!, step.y + fy!];
}

function paint(map: TestMap, analysis: TerrainAnalysis, step: Omit<BrushStep, "mode">) {
    const result = brushStep(
        {
            analysis,
            back: (x, y) => map.cells[y * map.width + x]!,
            width: map.width,
            height: map.height,
            random: noTies,
        },
        { ...step, mode: effectiveTypeForColor(analysis, step.color) },
    );
    for (const { x, y, value } of result.cells) map.cells[y * map.width + x] = value;
    return result;
}

const gids = (cells: readonly number[]) =>
    cells.map((value) => (value === 0 ? 0 : cellTileId(value) + 1));

/** The map after `setCorner`, `setEdge` or `setFullTile` calls made directly on the filler. */
function direct(
    map: TestMap,
    analysis: TerrainAnalysis,
    calls: (filler: TerrainFiller) => void,
): number[] {
    const filler = new TerrainFiller({
        analysis,
        back: (x, y) => map.cells[y * map.width + x]!,
        width: map.width,
        height: map.height,
        random: noTies,
        corrections: true,
    });
    calls(filler);
    const cells = [...map.cells];
    for (const { x, y, value } of filler.apply().cells) cells[y * map.width + x] = value;
    return cells;
}

describe("TE-044 brush targets", () => {
    it("rounds corner sets to the nearest vertex", () => {
        expect(brushTargetAt("corner", false, 3.2, 4.3)).toEqual({
            point: { x: 3, y: 4 },
            index: TOP_LEFT,
        });
        expect(brushTargetAt("corner", false, 3.5, 4.49)).toEqual({
            point: { x: 4, y: 4 },
            index: TOP_LEFT,
        });
        expect(brushTargetAt("corner", false, 3.9, 4.9)).toEqual({
            point: { x: 4, y: 5 },
            index: TOP_LEFT,
        });
    });

    it("picks edges by the cell's diagonals", () => {
        expect(brushTargetAt("edge", false, 2.5, 1.1).index).toBe(TOP);
        expect(brushTargetAt("edge", false, 2.9, 1.5).index).toBe(RIGHT);
        expect(brushTargetAt("edge", false, 2.5, 1.9).index).toBe(BOTTOM);
        expect(brushTargetAt("edge", false, 2.1, 1.5).index).toBe(LEFT);
        expect(brushTargetAt("edge", false, 2.1, 1.5).point).toEqual({ x: 2, y: 1 });
    });

    it("uses the 3 × 3 grid in mixed sets: corners name their vertex, the centre nothing", () => {
        expect(brushTargetAt("mixed", false, 2.9, 1.9)).toEqual({
            point: { x: 3, y: 2 },
            index: TOP_LEFT,
        });
        expect(brushTargetAt("mixed", false, 2.5, 1.1)).toEqual({
            point: { x: 2, y: 1 },
            index: TOP,
        });
        expect(brushTargetAt("mixed", false, 2.5, 1.5)).toEqual({
            point: { x: 2, y: 1 },
            index: null,
        });
    });

    it("takes the cell in full tile mode", () => {
        expect(brushTargetAt("corner", true, 2.9, 1.9)).toEqual({
            point: { x: 2, y: 1 },
            index: null,
        });
    });

    it("keeps or follows the edge while an edge drag stays in its row or column", () => {
        const pressed: BrushTarget = { point: { x: 2, y: 1 }, index: TOP };
        expect(brushTargetAt("edge", false, 2.1, 1.5, pressed).index).toBe(TOP);
        expect(brushTargetAt("edge", false, 3.5, 1.5, pressed)).toEqual({
            point: { x: 3, y: 1 },
            index: LEFT,
        });
        expect(brushTargetAt("edge", false, 2.5, 0.5, pressed).index).toBe(BOTTOM);
        // A diagonal move picks the edge from the position again.
        expect(brushTargetAt("edge", false, 3.9, 2.5, pressed).index).toBe(RIGHT);
    });

    it("mirrors vertices and cells about the map's centre", () => {
        const vertex: BrushTarget = { point: { x: 2, y: 3 }, index: TOP_LEFT };
        expect(mirroredTarget(vertex, false, 8, 8)).toEqual({
            point: { x: 6, y: 5 },
            index: TOP_LEFT,
        });
        expect(mirroredTarget({ point: { x: 1, y: 2 }, index: TOP }, false, 8, 8)).toEqual({
            point: { x: 6, y: 5 },
            index: BOTTOM,
        });
        expect(mirroredTarget({ point: { x: 1, y: 2 }, index: null }, true, 8, 8)).toEqual({
            point: { x: 6, y: 5 },
            index: null,
        });
    });
});

describe("TE-044 brush steps", () => {
    const strokes = TERRAIN_STROKES.filter((stroke) => stroke.name !== "fill");

    it("covers the brush and full-tile strokes of every fixture", () => {
        expect(strokes).toHaveLength(12);
    });

    it.each(strokes.map((stroke) => [`${stroke.fixture} ${stroke.name}`, stroke] as const))(
        "%s, clicked as the E2E test clicks it, equals its golden",
        (_, stroke) => {
            const analysis = analysisOf(stroke.fixture);
            const map = readMap(stroke.map);
            for (const step of stroke.steps) {
                if (step.kind === "fill") throw new Error("not a brush step");
                const tileMode = step.kind === "tile";
                const mode = effectiveTypeForColor(analysis, step.terrain);
                const [cx, cy] = stepPosition(step);
                const to = brushTargetAt(mode, tileMode, cx, cy);
                const result = paint(map, analysis, {
                    tileMode,
                    behaviour: "single",
                    from: null,
                    to,
                    color: step.terrain,
                    symmetry: false,
                });
                expect(result.invalid).toEqual([]);
            }
            const golden = readJson<Tmj>(stroke.golden).layers[0]!.data;
            expect(gids(map.cells)).toEqual(golden);
        },
    );

    it("paints a line of vertices without diagonal steps (corner set)", () => {
        const analysis = analysisOf("corner-complete");
        const map = readMap("corner-complete.tmj");
        const expected = direct(map, analysis, (filler) => {
            for (const [x, y] of [
                [1, 1],
                [2, 1],
                [2, 2],
                [3, 2],
                [4, 2],
            ])
                filler.setCorner(x!, y!, SAND);
        });
        paint(map, analysis, {
            tileMode: false,
            behaviour: "line",
            from: { x: 1, y: 1 },
            to: { point: { x: 4, y: 2 }, index: TOP_LEFT },
            color: SAND,
            symmetry: false,
        });
        expect(map.cells).toEqual(expected);
    });

    it("paints an edge drag with the edge it crosses, leaving out the point painted before", () => {
        const analysis = analysisOf("edge-complete");
        const map = readMap("edge-complete.tmj");
        const expected = direct(map, analysis, (filler) => {
            filler.setEdge(3, 3, LEFT, SAND);
            filler.setEdge(4, 3, LEFT, SAND);
        });
        const result = paint(map, analysis, {
            tileMode: false,
            behaviour: "drag",
            from: { x: 2, y: 3 },
            to: { point: { x: 4, y: 3 }, index: LEFT },
            color: SAND,
            symmetry: false,
        });
        expect(result.index).toBe(LEFT);
        expect(map.cells).toEqual(expected);
    });

    it("paints full tiles along a line of a mixed set", () => {
        const analysis = analysisOf("mixed-complete");
        const map = readMap("mixed-complete.tmj");
        const expected = direct(map, analysis, (filler) => {
            filler.setFullTile(2, 3, SAND);
            filler.setFullTile(3, 3, SAND);
        });
        paint(map, analysis, {
            tileMode: false,
            behaviour: "line",
            from: { x: 2, y: 3 },
            to: { point: { x: 3, y: 3 }, index: TOP },
            color: SAND,
            symmetry: false,
        });
        expect(map.cells).toEqual(expected);
    });

    it("adds the 180° symmetric constraints with symmetry", () => {
        const analysis = analysisOf("corner-complete");
        const map = readMap("corner-complete.tmj");
        const expected = direct(map, analysis, (filler) => {
            filler.setCorner(2, 3, SAND);
            filler.setCorner(6, 5, SAND);
        });
        paint(map, analysis, {
            tileMode: false,
            behaviour: "single",
            from: null,
            to: { point: { x: 2, y: 3 }, index: TOP_LEFT },
            color: SAND,
            symmetry: true,
        });
        expect(map.cells).toEqual(expected);
    });

    it("mirrors edges with the opposite edge (edge set)", () => {
        const analysis = analysisOf("edge-complete");
        const map = readMap("edge-complete.tmj");
        const expected = direct(map, analysis, (filler) => {
            filler.setEdge(1, 2, TOP, SAND);
            filler.setEdge(6, 5, BOTTOM, SAND);
        });
        paint(map, analysis, {
            tileMode: false,
            behaviour: "single",
            from: null,
            to: { point: { x: 1, y: 2 }, index: TOP },
            color: SAND,
            symmetry: true,
        });
        expect(map.cells).toEqual(expected);
    });

    it("paints terrain 0 as a wish like any other (erase)", () => {
        // No tile of a corner set has an empty corner and "no terrain" is unreachable from its
        // terrains, so with corrections on the four cells around the vertex cannot be resolved
        // (Tiled's \`findBestMatch\` discards unreachable candidates): reported and unchanged.
        const analysis = analysisOf("corner-complete");
        const map = readMap("corner-complete.tmj");
        const before = [...map.cells];
        const result = paint(map, analysis, {
            tileMode: false,
            behaviour: "single",
            from: null,
            to: { point: { x: 3, y: 3 }, index: TOP_LEFT },
            color: 0,
            symmetry: false,
        });
        expect(result.invalid).toEqual([
            { y: 2, start: 2, end: 4 },
            { y: 3, start: 2, end: 4 },
        ]);
        expect(map.cells).toEqual(before);
    });

    it("leaves cells it cannot resolve unchanged and reports them (incomplete set)", () => {
        // Water at vertex (3,4) beside the empty strip of row 4: an empty cell's corners want
        // "no terrain", which no terrain of the set reaches.
        const analysis = analysisOf("corner-incomplete");
        const map = readMap("corner-incomplete-fill.tmj");
        const before = [...map.cells];
        const result = paint(map, analysis, {
            tileMode: false,
            behaviour: "single",
            from: null,
            to: { point: { x: 3, y: 4 }, index: TOP_LEFT },
            color: WATER,
            symmetry: false,
        });
        expect(result.invalid).toEqual([{ y: 4, start: 1, end: 4 }]);
        expect(result.cells.length).toBeGreaterThan(0);
        for (const span of result.invalid) {
            for (let x = span.start; x < span.end; x++) {
                expect(result.cells.some((cell) => cell.x === x && cell.y === span.y)).toBe(false);
                expect(map.cells[span.y * map.width + x]).toBe(before[span.y * map.width + x]);
            }
        }
    });
});
