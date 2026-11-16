import { encode } from "fast-png";

// TE-042: the terrain fixtures of SPEC §5.2 (`tests/fixtures/terrain/`) and everything that
// writes them: the tileset PNGs, the TSJ tilesets and the TMJ maps in the layout Tiled 1.12.2
// saves (auto-formatted JSON, layer data in rows, map format version "1.11"), the scripted
// strokes and the README that lists them.
//
// Every set has exactly one tile per terrain combination it holds. Each golden is the map Tiled
// 1.12.2 saved after its stroke (captured results, below). `scripts/terrain-fixtures.ts` writes
// the files; the TE-042 test checks that the committed files are exactly what
// `terrainFixtureFiles` returns.
//
// Node runs this file directly through `scripts/terrain-fixtures.ts`, so it imports nothing
// relative and uses only erasable TypeScript syntax.

export type TerrainFixtureType = "corner" | "edge" | "mixed";

/** Terrains of every fixture: terrain `n` is `TERRAINS[n − 1]`. */
export const TERRAINS = [
    { name: "Grass", letter: "G", color: "#5a9e3a" },
    { name: "Sand", letter: "S", color: "#e2c275" },
    { name: "Water", letter: "W", color: "#3b78c9" },
] as const;

/** Tile size of every fixture tileset, in pixels; divisible by 2 and 3 for the drawings. */
export const TILE_SIZE = 24;
/** Size of every fixture map, in cells. */
export const MAP_SIZE = 8;

export interface TerrainFixture {
    /** File stem of the tileset and its maps; the tileset's name. */
    readonly name: string;
    /** Name of the terrain set. */
    readonly title: string;
    readonly type: TerrainFixtureType;
    /** Terrains `1..terrains` of `TERRAINS`. */
    readonly terrains: number;
    /** A combination is in the set when all its terrains belong to one of these groups. */
    readonly groups: readonly (readonly number[])[];
    /** Columns of the tileset image. */
    readonly columns: number;
}

export const TERRAIN_FIXTURES: readonly TerrainFixture[] = [
    {
        name: "corner-complete",
        title: "Corner complete",
        type: "corner",
        terrains: 2,
        groups: [[1, 2]],
        columns: 8,
    },
    {
        name: "corner-incomplete",
        title: "Corner incomplete",
        type: "corner",
        terrains: 3,
        groups: [
            [1, 2],
            [2, 3],
        ],
        columns: 8,
    },
    {
        name: "edge-complete",
        title: "Edge complete",
        type: "edge",
        terrains: 2,
        groups: [[1, 2]],
        columns: 8,
    },
    {
        name: "edge-incomplete",
        title: "Edge incomplete",
        type: "edge",
        terrains: 3,
        groups: [
            [1, 2],
            [2, 3],
        ],
        columns: 8,
    },
    {
        name: "mixed-complete",
        title: "Mixed complete",
        type: "mixed",
        terrains: 2,
        groups: [[1, 2]],
        columns: 16,
    },
    {
        name: "mixed-incomplete",
        title: "Mixed incomplete",
        type: "mixed",
        terrains: 3,
        groups: [
            [1, 2],
            [2, 3],
        ],
        columns: 16,
    },
];

/** WangId indexes a type uses, clockwise from the top (Tiled's order). */
function typeIndexes(type: TerrainFixtureType): readonly number[] {
    if (type === "corner") return [1, 3, 5, 7];
    if (type === "edge") return [0, 2, 4, 6];
    return [0, 1, 2, 3, 4, 5, 6, 7];
}

/**
 * The tiles of a fixture: tile `id` has `wangIds[id]`. Combination `n` gives the type's `k`-th
 * index digit `k` of `n` in base `terrains`, plus 1; the combinations outside every group are
 * left out and the rest numbered in that order.
 */
export function fixtureWangIds(fixture: TerrainFixture): number[][] {
    const indexes = typeIndexes(fixture.type);
    const c = fixture.terrains;
    const out: number[][] = [];
    for (let n = 0; n < c ** indexes.length; n++) {
        let rest = n;
        const digits = indexes.map(() => {
            const digit = (rest % c) + 1;
            rest = Math.floor(rest / c);
            return digit;
        });
        if (!fixture.groups.some((group) => digits.every((digit) => group.includes(digit)))) {
            continue;
        }
        const wangId = [0, 0, 0, 0, 0, 0, 0, 0];
        indexes.forEach((index, k) => (wangId[index] = digits[k]!));
        out.push(wangId);
    }
    return out;
}

// --- Captured results -----------------------------------------------------------------------
//
// Captured from Tiled 1.12.2 on 2026-11-16 (capture folder `ngne-captures/tiled-1.12.2`): each
// stroke of `TERRAIN_STROKES` made in Tiled on its start map, and the map saved as JSON. An
// array is the saved layer's GIDs (firstgid 1), row by row. The shape fills of TE-045 were
// captured the same way on the fill maps: `<set>-rectangle` is the Rectangle Fill dragged over
// each fill region, `edge-complete-ellipse` the Ellipse Fill on each edge-complete fill cell,
// `corner-complete-clipped` the Rectangle Fill dragged over row 3 from cell (1,3) to (6,3) with
// cells (1,3)–(3,3) selected.

// prettier-ignore
const CAPTURED: Readonly<Record<string, readonly number[]>> = {
    "corner-complete-brush": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 3, 7, 5, 1, 1, 1,
        1, 1, 2, 10, 9, 1, 1, 1,
        1, 1, 1, 1, 3, 5, 1, 1,
        1, 1, 1, 1, 2, 9, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "corner-complete-full-tile": [
        1, 1, 1, 1, 3, 7, 5, 1,
        1, 1, 1, 1, 4, 16, 13, 1,
        1, 1, 1, 1, 2, 10, 9, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 3, 7, 5, 1, 1, 1, 1,
        1, 4, 16, 13, 1, 1, 1, 1,
        1, 2, 10, 9, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "corner-complete-fill": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 3, 7, 5, 1, 1, 1,
        1, 1, 2, 10, 9, 1, 1, 1,
        1, 1, 1, 1, 3, 5, 1, 1,
        1, 1, 1, 1, 2, 9, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "corner-complete-rectangle": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 3, 7, 5, 1, 1, 1,
        1, 1, 2, 10, 9, 1, 1, 1,
        1, 1, 1, 1, 3, 5, 1, 1,
        1, 1, 1, 1, 2, 9, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "corner-incomplete-brush": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 3, 7, 7, 7, 5, 1,
        1, 1, 4, 18, 22, 20, 13, 1,
        1, 1, 4, 17, 25, 24, 13, 1,
        1, 1, 2, 10, 10, 10, 9, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "corner-incomplete-full-tile": [
        3, 7, 7, 7, 5, 1, 1, 1,
        4, 18, 22, 20, 13, 1, 1, 1,
        4, 19, 31, 28, 13, 1, 1, 1,
        4, 17, 25, 24, 15, 7, 7, 5,
        2, 10, 10, 12, 18, 22, 20, 13,
        1, 1, 1, 4, 19, 31, 28, 13,
        1, 1, 1, 4, 17, 25, 24, 13,
        1, 1, 1, 2, 10, 10, 10, 9,
    ],
    "corner-incomplete-fill": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 3, 7, 7, 7, 5, 1,
        1, 1, 4, 18, 22, 20, 13, 1,
        1, 1, 4, 17, 25, 24, 13, 1,
        1, 1, 2, 10, 10, 10, 9, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "corner-incomplete-rectangle": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 3, 7, 7, 7, 5, 1,
        1, 1, 4, 18, 22, 20, 13, 1,
        1, 1, 4, 17, 25, 24, 13, 1,
        1, 1, 2, 10, 10, 10, 9, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "edge-complete-brush": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 5, 1, 1, 1, 1,
        1, 1, 1, 4, 9, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 3, 9, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "edge-complete-full-tile": [
        1, 1, 1, 1, 1, 5, 1, 1,
        1, 1, 1, 1, 3, 16, 9, 1,
        1, 1, 1, 1, 1, 2, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 5, 1, 1, 1, 1, 1,
        1, 3, 16, 9, 1, 1, 1, 1,
        1, 1, 2, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "edge-complete-fill": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 5, 1, 1, 1, 1,
        1, 1, 1, 4, 9, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 3, 9, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "edge-complete-rectangle": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 5, 1, 1, 1, 1,
        1, 1, 1, 4, 9, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 3, 9, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "edge-incomplete-brush": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 5, 1, 1, 1, 1,
        1, 1, 3, 20, 13, 1, 1, 1,
        1, 1, 3, 19, 24, 9, 1, 1,
        1, 1, 1, 2, 2, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "edge-incomplete-full-tile": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 5, 1, 1, 1, 1, 1,
        1, 7, 20, 13, 1, 1, 1, 1,
        3, 18, 31, 24, 9, 1, 1, 1,
        1, 4, 17, 10, 1, 1, 1, 1,
        1, 1, 2, 1, 1, 1, 1, 1,
    ],
    "edge-incomplete-fill": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 5, 1, 1, 1, 1,
        1, 1, 3, 20, 13, 1, 1, 1,
        1, 1, 3, 19, 24, 9, 1, 1,
        1, 1, 1, 2, 2, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "edge-incomplete-rectangle": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 5, 1, 1, 1, 1,
        1, 1, 3, 20, 13, 1, 1, 1,
        1, 1, 3, 19, 24, 9, 1, 1,
        1, 1, 1, 2, 2, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "mixed-complete-brush": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 9, 33, 1, 1, 1, 1,
        1, 1, 3, 129, 1, 1, 1, 1,
        1, 1, 1, 1, 5, 65, 1, 1,
        1, 1, 17, 1, 1, 1, 1, 1,
        1, 1, 2, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "mixed-complete-full-tile": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 9, 57, 33, 1, 1,
        1, 1, 1, 15, 256, 225, 1, 1,
        1, 1, 1, 3, 132, 129, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "mixed-complete-fill": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 9, 33, 1, 1, 1, 1,
        1, 1, 3, 129, 1, 1, 1, 1,
        1, 1, 1, 1, 5, 65, 1, 1,
        1, 1, 17, 1, 1, 1, 1, 1,
        1, 1, 2, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "mixed-complete-rectangle": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 9, 33, 1, 1, 1, 1,
        1, 1, 3, 129, 1, 1, 1, 1,
        1, 1, 1, 1, 5, 65, 1, 1,
        1, 1, 17, 1, 1, 1, 1, 1,
        1, 1, 2, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "mixed-incomplete-brush": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 9, 57, 57, 33, 1, 1,
        1, 1, 15, 264, 288, 225, 1, 1,
        9, 57, 47, 258, 384, 225, 1, 1,
        15, 272, 227, 132, 132, 129, 1, 1,
        15, 257, 225, 1, 1, 1, 1, 1,
        3, 132, 129, 1, 1, 1, 1, 1,
    ],
    "mixed-incomplete-full-tile": [
        9, 57, 57, 57, 33, 1, 1, 1,
        15, 264, 312, 288, 225, 1, 1, 1,
        15, 270, 511, 480, 225, 1, 1, 1,
        15, 258, 387, 384, 225, 1, 1, 1,
        3, 132, 132, 132, 129, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "mixed-incomplete-fill": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 9, 57, 57, 33, 1, 1,
        1, 1, 15, 264, 288, 225, 1, 1,
        9, 57, 47, 258, 384, 225, 1, 1,
        15, 272, 227, 132, 132, 129, 1, 1,
        15, 257, 225, 1, 1, 1, 1, 1,
        3, 132, 129, 1, 1, 1, 1, 1,
    ],
    "mixed-incomplete-rectangle": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 9, 57, 57, 33, 1, 1,
        1, 1, 15, 264, 288, 225, 1, 1,
        9, 57, 47, 258, 384, 225, 1, 1,
        15, 272, 227, 132, 132, 129, 1, 1,
        15, 257, 225, 1, 1, 1, 1, 1,
        3, 132, 129, 1, 1, 1, 1, 1,
    ],
    "edge-complete-ellipse": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 5, 1, 1, 1, 1,
        1, 1, 1, 4, 9, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 3, 9, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
    "corner-complete-clipped": [
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 3, 7, 5, 1, 1, 1,
        1, 1, 2, 10, 0, 0, 0, 1,
        1, 1, 1, 1, 3, 5, 1, 1,
        1, 1, 1, 1, 2, 9, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ],
};

function capture(key: string): readonly number[] {
    const data = CAPTURED[key];
    if (!data) throw new Error(`No capture "${key}".`);
    return data;
}

// --- Maps and strokes -----------------------------------------------------------------------

export interface TerrainMap {
    /** File name in the fixture folder. */
    readonly file: string;
    readonly fixture: string;
    /** GIDs (firstgid 1), row by row. */
    readonly data: readonly number[];
}

export type TerrainSide = "top" | "right" | "bottom" | "left";

/** One click in Tiled, made on the map as the steps before left it. */
export type TerrainStep =
    /** Terrain brush at vertex (x, y), the top-left corner of cell (x, y). */
    | { readonly kind: "corner"; readonly x: number; readonly y: number; readonly terrain: number }
    /** Terrain brush on one edge of cell (x, y). */
    | {
          readonly kind: "edge";
          readonly x: number;
          readonly y: number;
          readonly side: TerrainSide;
          readonly terrain: number;
      }
    /** Terrain brush in full tile mode on cell (x, y). */
    | { readonly kind: "tile"; readonly x: number; readonly y: number; readonly terrain: number }
    /** Bucket fill in terrain mode at cell (x, y): the cells like it, 4-connected. */
    | { readonly kind: "fill"; readonly x: number; readonly y: number };

export interface TerrainStroke {
    readonly fixture: string;
    readonly name: "brush" | "full-tile" | "fill";
    /** The map the stroke starts from. */
    readonly map: string;
    readonly steps: readonly TerrainStep[];
    /** The map the stroke must leave: its capture. */
    readonly golden: string;
}

const SAND = 2;
const WATER = 3;

/** Tile 0 of every set is all Grass (combination 0), so an all-Grass map is GID 1 throughout. */
const grass = (fixture: string): TerrainMap => ({
    file: `${fixture}.tmj`,
    fixture,
    data: new Array<number>(MAP_SIZE * MAP_SIZE).fill(1),
});

const goldenFile = (fixture: string, stroke: TerrainStroke["name"]) =>
    `${fixture}-${stroke}.golden.tmj`;

const golden = (fixture: string, stroke: TerrainStroke["name"]): TerrainMap => ({
    file: goldenFile(fixture, stroke),
    fixture,
    data: capture(`${fixture}-${stroke}`),
});

/** The fill stroke's start map: a captured brush result with the fill regions erased. */
const erased = (from: TerrainMap, cells: readonly (readonly [number, number])[]): TerrainMap => ({
    file: `${from.fixture}-fill.tmj`,
    fixture: from.fixture,
    data: from.data.map((gid, i) => (cells.some(([x, y]) => y * MAP_SIZE + x === i) ? 0 : gid)),
});

const cornerCompleteBrush = golden("corner-complete", "brush");
const cornerCompleteFill = erased(cornerCompleteBrush, [
    [1, 3],
    [2, 3],
    [3, 3],
    [4, 3],
    [5, 3],
    [6, 3],
]);
const cornerIncompleteBrush = golden("corner-incomplete", "brush");
const cornerIncompleteFill = erased(cornerIncompleteBrush, [
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [5, 4],
    [6, 4],
]);
const edgeCompleteBrush = golden("edge-complete", "brush");
const edgeCompleteFill = erased(edgeCompleteBrush, [
    [3, 3],
    [5, 5],
]);
const edgeIncompleteBrush = golden("edge-incomplete", "brush");
const edgeIncompleteFill = erased(edgeIncompleteBrush, [
    [3, 2],
    [4, 3],
]);
const mixedCompleteBrush = golden("mixed-complete", "brush");
const mixedCompleteFill = erased(mixedCompleteBrush, [
    [3, 3],
    [5, 4],
]);
const mixedIncompleteBrush = golden("mixed-incomplete", "brush");
const mixedIncompleteFill = erased(mixedIncompleteBrush, [
    [3, 3],
    [1, 5],
]);

/** Every map written, in file order of the README. */
export const TERRAIN_MAPS: readonly TerrainMap[] = [
    grass("corner-complete"),
    cornerCompleteFill,
    cornerCompleteBrush,
    golden("corner-complete", "full-tile"),
    golden("corner-complete", "fill"),
    grass("corner-incomplete"),
    cornerIncompleteFill,
    cornerIncompleteBrush,
    golden("corner-incomplete", "full-tile"),
    golden("corner-incomplete", "fill"),
    grass("edge-complete"),
    edgeCompleteFill,
    edgeCompleteBrush,
    golden("edge-complete", "full-tile"),
    golden("edge-complete", "fill"),
    grass("edge-incomplete"),
    edgeIncompleteFill,
    edgeIncompleteBrush,
    golden("edge-incomplete", "full-tile"),
    golden("edge-incomplete", "fill"),
    grass("mixed-complete"),
    mixedCompleteFill,
    mixedCompleteBrush,
    golden("mixed-complete", "full-tile"),
    golden("mixed-complete", "fill"),
    grass("mixed-incomplete"),
    mixedIncompleteFill,
    mixedIncompleteBrush,
    golden("mixed-incomplete", "full-tile"),
    golden("mixed-incomplete", "fill"),
];

/** Captured shape-fill results on the fill maps (TE-045): GIDs, row by row. */
export const SHAPE_FILL_CAPTURES = {
    /** Rectangle Fill over each fill region, by set. */
    rectangle: Object.fromEntries(
        TERRAIN_FIXTURES.map((fixture) => [fixture.name, capture(`${fixture.name}-rectangle`)]),
    ) as Readonly<Record<string, readonly number[]>>,
    /** Ellipse Fill on each edge-complete fill cell. */
    edgeCompleteEllipse: capture("edge-complete-ellipse"),
    /** Rectangle Fill over row 3 of corner-complete with cells (1,3)–(3,3) selected. */
    cornerCompleteClipped: capture("corner-complete-clipped"),
};

export const TERRAIN_STROKES: readonly TerrainStroke[] = [
    {
        fixture: "corner-complete",
        name: "brush",
        map: "corner-complete.tmj",
        steps: [
            { kind: "corner", x: 3, y: 3, terrain: SAND },
            { kind: "corner", x: 4, y: 3, terrain: SAND },
            { kind: "corner", x: 5, y: 5, terrain: SAND },
        ],
        golden: cornerCompleteBrush.file,
    },
    {
        fixture: "corner-complete",
        name: "full-tile",
        map: "corner-complete.tmj",
        steps: [
            { kind: "tile", x: 2, y: 5, terrain: SAND },
            { kind: "tile", x: 5, y: 1, terrain: SAND },
        ],
        golden: goldenFile("corner-complete", "full-tile"),
    },
    {
        fixture: "corner-complete",
        name: "fill",
        map: cornerCompleteFill.file,
        steps: [{ kind: "fill", x: 1, y: 3 }],
        golden: goldenFile("corner-complete", "fill"),
    },
    {
        fixture: "corner-incomplete",
        name: "brush",
        map: "corner-incomplete.tmj",
        steps: [
            { kind: "corner", x: 4, y: 4, terrain: WATER },
            { kind: "corner", x: 5, y: 4, terrain: WATER },
        ],
        golden: cornerIncompleteBrush.file,
    },
    {
        fixture: "corner-incomplete",
        name: "full-tile",
        map: "corner-incomplete.tmj",
        steps: [
            { kind: "tile", x: 2, y: 2, terrain: WATER },
            { kind: "tile", x: 5, y: 5, terrain: WATER },
        ],
        golden: goldenFile("corner-incomplete", "full-tile"),
    },
    {
        fixture: "corner-incomplete",
        name: "fill",
        map: cornerIncompleteFill.file,
        steps: [{ kind: "fill", x: 1, y: 4 }],
        golden: goldenFile("corner-incomplete", "fill"),
    },
    {
        fixture: "edge-complete",
        name: "brush",
        map: "edge-complete.tmj",
        steps: [
            { kind: "edge", x: 3, y: 3, side: "top", terrain: SAND },
            { kind: "edge", x: 3, y: 3, side: "right", terrain: SAND },
            { kind: "edge", x: 5, y: 5, side: "left", terrain: SAND },
        ],
        golden: edgeCompleteBrush.file,
    },
    {
        fixture: "edge-complete",
        name: "full-tile",
        map: "edge-complete.tmj",
        steps: [
            { kind: "tile", x: 2, y: 5, terrain: SAND },
            { kind: "tile", x: 5, y: 1, terrain: SAND },
        ],
        golden: goldenFile("edge-complete", "full-tile"),
    },
    {
        fixture: "edge-complete",
        name: "fill",
        map: edgeCompleteFill.file,
        steps: [
            { kind: "fill", x: 3, y: 3 },
            { kind: "fill", x: 5, y: 5 },
        ],
        golden: goldenFile("edge-complete", "fill"),
    },
    {
        fixture: "edge-incomplete",
        name: "brush",
        map: "edge-incomplete.tmj",
        steps: [
            { kind: "edge", x: 3, y: 3, side: "top", terrain: WATER },
            { kind: "edge", x: 3, y: 3, side: "right", terrain: WATER },
        ],
        golden: edgeIncompleteBrush.file,
    },
    {
        fixture: "edge-incomplete",
        name: "full-tile",
        map: "edge-incomplete.tmj",
        steps: [{ kind: "tile", x: 2, y: 5, terrain: WATER }],
        golden: goldenFile("edge-incomplete", "full-tile"),
    },
    {
        fixture: "edge-incomplete",
        name: "fill",
        map: edgeIncompleteFill.file,
        steps: [
            { kind: "fill", x: 3, y: 2 },
            { kind: "fill", x: 4, y: 3 },
        ],
        golden: goldenFile("edge-incomplete", "fill"),
    },
    {
        fixture: "mixed-complete",
        name: "brush",
        map: "mixed-complete.tmj",
        steps: [
            { kind: "corner", x: 3, y: 3, terrain: SAND },
            { kind: "edge", x: 5, y: 4, side: "left", terrain: SAND },
            { kind: "edge", x: 2, y: 6, side: "top", terrain: SAND },
        ],
        golden: mixedCompleteBrush.file,
    },
    {
        fixture: "mixed-complete",
        name: "full-tile",
        map: "mixed-complete.tmj",
        steps: [{ kind: "tile", x: 4, y: 2, terrain: SAND }],
        golden: goldenFile("mixed-complete", "full-tile"),
    },
    {
        fixture: "mixed-complete",
        name: "fill",
        map: mixedCompleteFill.file,
        steps: [
            { kind: "fill", x: 3, y: 3 },
            { kind: "fill", x: 5, y: 4 },
        ],
        golden: goldenFile("mixed-complete", "fill"),
    },
    {
        fixture: "mixed-incomplete",
        name: "brush",
        map: "mixed-incomplete.tmj",
        steps: [
            { kind: "corner", x: 4, y: 4, terrain: WATER },
            { kind: "edge", x: 1, y: 6, side: "top", terrain: WATER },
        ],
        golden: mixedIncompleteBrush.file,
    },
    {
        fixture: "mixed-incomplete",
        name: "full-tile",
        map: "mixed-incomplete.tmj",
        steps: [{ kind: "tile", x: 2, y: 2, terrain: WATER }],
        golden: goldenFile("mixed-incomplete", "full-tile"),
    },
    {
        fixture: "mixed-incomplete",
        name: "fill",
        map: mixedIncompleteFill.file,
        steps: [
            { kind: "fill", x: 3, y: 3 },
            { kind: "fill", x: 1, y: 5 },
        ],
        golden: goldenFile("mixed-incomplete", "fill"),
    },
];

// --- JSON text ------------------------------------------------------------------------------

type Json = number | string | boolean | readonly Json[] | { readonly [key: string]: Json };

const INDENT = "    ";

/**
 * Ported from qjsonparser's `escape` (`json.cpp`), one UTF-16 unit at a time. Its licence
 * allows use without limitation; its notice is in THIRD_PARTY_NOTICES.md.
 */
function escape(text: string): string {
    let out = "";
    // `split("")` gives UTF-16 units: a lone surrogate's code point is the unit itself.
    for (const char of text.split("")) {
        const code = char.codePointAt(0)!;
        if (char === "\b") out += String.raw`\b`;
        else if (char === "\f") out += String.raw`\f`;
        else if (char === "\n") out += String.raw`\n`;
        else if (char === "\r") out += String.raw`\r`;
        else if (char === "\t") out += String.raw`\t`;
        else if (char === '"') out += String.raw`\"`;
        else if (char === "\\") out += String.raw`\\`;
        else if (char === "/") out += String.raw`\/`;
        else if (code > 127) out += String.raw`\u${code.toString(16).padStart(4, "0")}`;
        else out += char;
    }
    return out;
}

/**
 * Ported from qjsonparser's `JsonWriter::stringify` (`json.cpp`; notice in
 * THIRD_PARTY_NOTICES.md) with auto-formatting on, as in the files Tiled 1.12.2 saves: 4-space
 * indent, object keys sorted, arrays wrapped every `wrap` items (0: never). Integers only.
 */
function stringify(value: Json, depth: number, wrap: number): string {
    const indent = INDENT.repeat(depth);
    if (Array.isArray(value)) {
        const items = value as readonly Json[];
        let out = "[";
        items.forEach((item, i) => {
            if (i !== 0) out += "," + (wrap && i % wrap === 0 ? "\n" + indent : " ");
            out += stringify(item, depth + 1, wrap);
        });
        return out + "]";
    }
    if (typeof value === "object") {
        const map = value as { readonly [key: string]: Json };
        let out = depth !== 0 ? `\n${indent}{\n` : "{";
        Object.keys(map)
            // By UTF-16 code unit.
            .sort((a, b) => Number(a > b) - Number(a < b))
            .forEach((key, i) => {
                if (i !== 0) out += ",\n";
                out += `${indent} "${escape(key)}":${stringify(map[key]!, depth + 1, wrap)}`;
            });
        return out + `\n${indent}}`;
    }
    if (typeof value === "string") return `"${escape(value)}"`;
    if (typeof value === "boolean") return value ? "true" : "false";
    if (!Number.isInteger(value)) throw new Error(`Only integers are written, got ${value}.`);
    return String(value);
}

const TILED_VERSION = "1.12.2";
const FORMAT_VERSION = "1.11";

function tilesetJson(fixture: TerrainFixture, wangIds: readonly number[][]): string {
    const rows = Math.ceil(wangIds.length / fixture.columns);
    return stringify(
        {
            type: "tileset",
            version: FORMAT_VERSION,
            tiledversion: TILED_VERSION,
            name: fixture.name,
            tilewidth: TILE_SIZE,
            tileheight: TILE_SIZE,
            spacing: 0,
            margin: 0,
            tilecount: rows * fixture.columns,
            columns: fixture.columns,
            image: `${fixture.name}.png`,
            imagewidth: fixture.columns * TILE_SIZE,
            imageheight: rows * TILE_SIZE,
            wangsets: [
                {
                    name: fixture.title,
                    type: fixture.type,
                    tile: -1,
                    colors: TERRAINS.slice(0, fixture.terrains).map((terrain) => ({
                        color: terrain.color,
                        name: terrain.name,
                        probability: 1,
                        tile: -1,
                    })),
                    wangtiles: wangIds.map((wangId, tileid) => ({ wangid: wangId, tileid })),
                },
            ],
        },
        0,
        0,
    );
}

function mapJson(fixture: string, data: readonly number[]): string {
    return stringify(
        {
            type: "map",
            version: FORMAT_VERSION,
            tiledversion: TILED_VERSION,
            orientation: "orthogonal",
            renderorder: "right-down",
            width: MAP_SIZE,
            height: MAP_SIZE,
            tilewidth: TILE_SIZE,
            tileheight: TILE_SIZE,
            infinite: false,
            nextlayerid: 2,
            nextobjectid: 1,
            compressionlevel: -1,
            tilesets: [{ firstgid: 1, source: `${fixture}.tsj` }],
            layers: [
                {
                    type: "tilelayer",
                    width: MAP_SIZE,
                    height: MAP_SIZE,
                    id: 1,
                    name: "Tile Layer 1",
                    x: 0,
                    y: 0,
                    visible: true,
                    opacity: 1,
                    data: [...data],
                },
            ],
        },
        0,
        MAP_SIZE,
    );
}

// --- Tileset images -------------------------------------------------------------------------

function hexColor(hex: string): [number, number, number] {
    return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [
        number,
        number,
        number,
    ];
}

/** Colour of the middle of a mixed tile, which no index paints. */
const MIDDLE: [number, number, number] = [0x3a, 0x3a, 0x3a];

/** The corner a pixel of a corner tile shows: the tile's quadrants. */
function cornerPixelIndex(px: number, py: number): number {
    const half = TILE_SIZE / 2;
    if (py < half) return px < half ? 7 : 1;
    return px < half ? 5 : 3;
}

/** The edge a pixel of an edge tile shows: the four triangles between the diagonals. */
function edgePixelIndex(px: number, py: number): number {
    const half = TILE_SIZE / 2;
    const dx = px + 0.5 - half;
    const dy = py + 0.5 - half;
    if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 0 : 4;
    return dx < 0 ? 6 : 2;
}

/**
 * The index a pixel of a tile shows: corner tiles in quadrants, edge tiles in the four
 * triangles between the diagonals, mixed tiles in a 3 × 3 grid (null in the middle).
 */
function pixelIndex(type: TerrainFixtureType, px: number, py: number): number | null {
    if (type === "corner") return cornerPixelIndex(px, py);
    if (type === "edge") return edgePixelIndex(px, py);
    const third = TILE_SIZE / 3;
    const gx = Math.floor(px / third);
    const gy = Math.floor(py / third);
    const grid = [
        [7, 0, 1],
        [6, null, 2],
        [5, 4, 3],
    ];
    return grid[gy]![gx]!;
}

function tilesetPng(fixture: TerrainFixture, wangIds: readonly number[][]): Uint8Array {
    const rows = Math.ceil(wangIds.length / fixture.columns);
    const width = fixture.columns * TILE_SIZE;
    const height = rows * TILE_SIZE;
    const data = new Uint8Array(width * height * 4);
    const colors = TERRAINS.map((terrain) => hexColor(terrain.color));
    wangIds.forEach((wangId, tile) => {
        const left = (tile % fixture.columns) * TILE_SIZE;
        const top = Math.floor(tile / fixture.columns) * TILE_SIZE;
        for (let py = 0; py < TILE_SIZE; py++) {
            for (let px = 0; px < TILE_SIZE; px++) {
                const index = pixelIndex(fixture.type, px, py);
                const rgb = index === null ? MIDDLE : colors[wangId[index]! - 1]!;
                const at = ((top + py) * width + left + px) * 4;
                data.set([...rgb, 255], at);
            }
        }
    });
    return encode({ width, height, data, depth: 8, channels: 4 });
}

// --- README ---------------------------------------------------------------------------------

const SIDE_NAMES: Record<TerrainSide, string> = {
    top: "top",
    right: "right",
    bottom: "bottom",
    left: "left",
};

function stepText(step: TerrainStep): string {
    if (step.kind === "fill") return `click cell (${step.x},${step.y})`;
    const terrain = TERRAINS[step.terrain - 1]!.name;
    if (step.kind === "corner") {
        return `${terrain} at vertex (${step.x},${step.y}), the top-left corner of cell (${step.x},${step.y})`;
    }
    if (step.kind === "edge") {
        return `${terrain} on the ${SIDE_NAMES[step.side]} edge of cell (${step.x},${step.y})`;
    }
    return `${terrain}, full tile, on cell (${step.x},${step.y})`;
}

const TOOL_TEXT: Record<TerrainStroke["name"], string> = {
    brush: "Terrain Brush (T), one click per step",
    "full-tile": "Terrain Brush (T) with Ctrl held (full tile mode), one click per step",
    fill: "Bucket Fill Tool (F) in Terrain Fill Mode, one click per step",
};

function readme(): string {
    const lines: string[] = [
        "# Terrain fixtures",
        "",
        "Fixtures of the terrain filler (SPEC §5.2): corner, edge and mixed terrain sets, complete and",
        "incomplete, each with exactly one tile per terrain combination it holds, and the strokes the",
        "TE-042 test (`tests/unit/te-042-goldens.test.ts`) paints on them. Every file here is written by",
        "`node scripts/terrain-fixtures.ts` (definitions in `tests/unit/support/terrainFixtures.ts`) in",
        "the layout Tiled 1.12.2 saves; the test checks that the script reproduces them byte for byte.",
        "",
        "Every golden was captured from Tiled 1.12.2 on 2026-11-16: the stroke's steps made in Tiled on",
        "its start map, and the result saved as JSON.",
        "",
        "## Conventions",
        "",
        "- Maps are 8 × 8 cells of 24 px; cell (x,y) counts from the top-left, as Tiled's status bar",
        "  shows it. Vertex (x,y) is the top-left corner of cell (x,y).",
        "- Terrains: 1 Grass (green), 2 Sand (yellow), 3 Water (blue). A tile is drawn in its",
        "  terrains: corner tiles by quadrant, edge tiles by the triangles between the diagonals,",
        "  mixed tiles in a 3 × 3 grid (corners and edges; the middle is dark grey).",
        "- `<set>.tmj` is all Grass; `<set>-fill.tmj` is the brush golden with some cells erased, the",
        "  regions the fill stroke fills; `<set>-<stroke>.golden.tmj` is the captured result of a stroke.",
        "- Each step is one click, made on the map the steps before it left. Fill regions are empty",
        "  cells enclosed by tiles: one cell high for corner sets, one cell for edge and mixed sets.",
        "",
        "## Making a stroke in Tiled 1.12.2",
        "",
        "Open the stroke's map, select the terrain set in the Terrain Sets view and, for brush and",
        "full-tile strokes, the terrain each step names; use the named tool and make each step in order.",
        "",
        "- Keep the Terrain Brush's **Fill Full Tiles** toolbar toggle off: Ctrl inverts it, so with",
        "  it on, brush strokes would paint full tiles and full-tile strokes single indexes.",
        "- The brush paints what the cursor is nearest to. Corner sets: the nearest corner. Edge sets:",
        "  the edge of the cell's quarter between its diagonals. Mixed sets: the cell is split 3 × 3;",
        "  hover a corner square for a corner and the middle square of a side for that edge.",
    ];
    for (const fixture of TERRAIN_FIXTURES) {
        const count = fixtureWangIds(fixture).length;
        const terrains = TERRAINS.slice(0, fixture.terrains)
            .map((terrain) => terrain.name)
            .join(", ");
        const groups = fixture.groups
            .map((group) => group.map((terrain) => TERRAINS[terrain - 1]!.name).join("–"))
            .join(" and ");
        lines.push(
            "",
            `## ${fixture.title}`,
            "",
            `Tileset \`${fixture.name}.tsj\`, terrain set "${fixture.title}" (${fixture.type}): ` +
                `${terrains}; the ${count} combinations of ${groups}.`,
        );
        for (const stroke of TERRAIN_STROKES.filter((s) => s.fixture === fixture.name)) {
            lines.push(
                "",
                `### ${fixture.name} ${stroke.name}`,
                "",
                `- Map: \`${stroke.map}\`. Tool: ${TOOL_TEXT[stroke.name]}.`,
                ...stroke.steps.map((step, i) => `- Step ${i + 1}: ${stepText(step)}.`),
                `- Golden: \`${stroke.golden}\`.`,
            );
        }
    }
    return lines.join("\n") + "\n";
}

// --- Files ----------------------------------------------------------------------------------

/** Every file of `tests/fixtures/terrain/`, by name. */
export function terrainFixtureFiles(): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    const text = (value: string) => new TextEncoder().encode(value);
    for (const fixture of TERRAIN_FIXTURES) {
        const wangIds = fixtureWangIds(fixture);
        files.set(`${fixture.name}.png`, tilesetPng(fixture, wangIds));
        files.set(`${fixture.name}.tsj`, text(tilesetJson(fixture, wangIds)));
    }
    for (const map of TERRAIN_MAPS) files.set(map.file, text(mapJson(map.fixture, map.data)));
    files.set("README.md", text(readme()));
    return files;
}
