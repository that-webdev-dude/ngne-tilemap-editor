import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cellTileId, cellValue } from "../../src/core/cells";
import { floodRegion } from "../../src/core/fill";
import type { TerrainSet, TerrainSetType } from "../../src/core/model";
import { BOTTOM, LEFT, RIGHT, TOP, TerrainFiller, analyzeTerrainSet } from "../../src/core/terrain";
import type { TerrainAnalysis, WangIndex } from "../../src/core/terrain";
import { TERRAIN_STROKES, terrainFixtureFiles } from "./support/terrainFixtures";
import type { TerrainSide, TerrainStep } from "./support/terrainFixtures";

// TE-042: the terrain fixtures of SPEC §5.2. Every scripted stroke runs through `core/terrain`
// on its fixture map and must leave its golden cell for cell; the goldens' `data` arrays are
// read directly from the TMJ files, the terrain sets from the TSJ files. The random source
// throws, so a stroke that would need Tiled's random choice fails. Then the fixture script's
// output equals the committed files byte for byte.

const FOLDER = new URL("../fixtures/terrain/", import.meta.url);
const SLOT = 1;

interface Tmj {
    width: number;
    height: number;
    tilesets: { firstgid: number; source: string }[];
    layers: { type: string; data: number[] }[];
}

interface Tsj {
    wangsets: {
        name: string;
        type: TerrainSetType;
        colors: { name: string; color: string }[];
        wangtiles: { tileid: number; wangid: number[] }[];
    }[];
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(new URL(file, FOLDER), "utf8"));

/** The map's one tile layer as cell values of slot 1 (firstgid 1, no flip bits). */
function readMap(file: string): { width: number; height: number; cells: number[] } {
    const map = readJson<Tmj>(file);
    expect(map.tilesets).toHaveLength(1);
    expect(map.tilesets[0]!.firstgid).toBe(1);
    expect(map.layers).toHaveLength(1);
    const cells = map.layers[0]!.data.map((gid) => (gid === 0 ? 0 : cellValue(SLOT, gid - 1)));
    expect(cells).toHaveLength(map.width * map.height);
    return { width: map.width, height: map.height, cells };
}

const analyses = new Map<string, TerrainAnalysis>();

function analysisOf(tileset: string): TerrainAnalysis {
    const cached = analyses.get(tileset);
    if (cached) return cached;
    const [wangSet] = readJson<Tsj>(tileset).wangsets;
    const set: TerrainSet = {
        name: wangSet!.name,
        type: wangSet!.type,
        colors: wangSet!.colors.map(({ name }) => ({ name, color: "#000000ff", tile: null })),
        tiles: wangSet!.wangtiles.map(({ tileid, wangid }) => ({ tile: tileid, wangId: wangid })),
    };
    const analysis = analyzeTerrainSet(set, SLOT);
    analyses.set(tileset, analysis);
    return analysis;
}

const SIDES: Record<TerrainSide, WangIndex> = {
    top: TOP,
    right: RIGHT,
    bottom: BOTTOM,
    left: LEFT,
};

const noTies = () => {
    throw new Error("The filler needed a random choice between equal candidates.");
};

function runStep(
    map: { width: number; height: number; cells: number[] },
    analysis: TerrainAnalysis,
    step: TerrainStep,
): void {
    const back = (x: number, y: number) => map.cells[y * map.width + x]!;
    const filler = new TerrainFiller({
        analysis,
        back,
        width: map.width,
        height: map.height,
        random: noTies,
        corrections: step.kind !== "fill",
    });
    if (step.kind === "corner") filler.setCorner(step.x, step.y, step.terrain);
    else if (step.kind === "edge") filler.setEdge(step.x, step.y, SIDES[step.side], step.terrain);
    else if (step.kind === "tile") filler.setFullTile(step.x, step.y, step.terrain);
    else {
        // The bucket fill's region (SPEC §4.3): the cells 4-connected to the click, alike.
        const region = floodRegion(back, step, {
            x: 0,
            y: 0,
            width: map.width,
            height: map.height,
        });
        expect(region.length).toBeGreaterThan(0);
        filler.setRegion(region);
    }
    const result = filler.apply();
    expect(result.invalid).toEqual([]);
    for (const { x, y, value } of result.cells) map.cells[y * map.width + x] = value;
}

/** GIDs of a map, as its TMJ `data` holds them. */
const gids = (cells: readonly number[]) =>
    cells.map((value) => (value === 0 ? 0 : cellTileId(value) + 1));

describe("TE-042 terrain goldens", () => {
    it("has strokes for corner, edge and mixed sets, complete and incomplete, in every mode", () => {
        const kinds = new Set(TERRAIN_STROKES.map((stroke) => `${stroke.fixture} ${stroke.name}`));
        for (const type of ["corner", "edge", "mixed"]) {
            for (const completeness of ["complete", "incomplete"]) {
                for (const mode of ["brush", "full-tile", "fill"]) {
                    expect(kinds).toContain(`${type}-${completeness} ${mode}`);
                }
            }
        }
    });

    it.each(TERRAIN_STROKES.map((stroke) => [`${stroke.fixture} ${stroke.name}`, stroke] as const))(
        "%s equals its golden cell for cell",
        (_, stroke) => {
            const analysis = analysisOf(`${stroke.fixture}.tsj`);
            const map = readMap(stroke.map);
            const before = gids(map.cells);
            for (const step of stroke.steps) runStep(map, analysis, step);
            const golden = readJson<Tmj>(stroke.golden).layers[0]!.data;
            expect(gids(map.cells)).not.toEqual(before);
            expect(gids(map.cells)).toEqual(golden);
        },
    );
});

describe("TE-042 fixture script", () => {
    it("reproduces the committed files byte for byte", () => {
        const files = terrainFixtureFiles();
        expect(readdirSync(FOLDER).sort()).toEqual([...files.keys()].sort());
        for (const [name, bytes] of files) {
            const committed = new Uint8Array(readFileSync(new URL(name, FOLDER)));
            expect(committed, name).toEqual(bytes);
        }
    });
});
