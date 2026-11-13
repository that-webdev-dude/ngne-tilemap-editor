import { encode } from "fast-png";

// TE-042: the terrain fixtures of SPEC §5.2 (`tests/fixtures/terrain/`) and everything that
// writes them: the tileset PNGs, the TSJ tilesets and the TMJ maps as Tiled 1.12.2 writes them
// (`MapToVariantConverter` into the JSON plugin's `JsonWriter`, auto-formatted, CSV layer data,
// map format version "1.11"), the scripted strokes and the README that lists them for the
// owner's check in Tiled.
//
// Every set has exactly one tile per terrain combination it holds. Each golden is a picture of
// the terrain at every vertex and edge of the map after its stroke, traced by hand against
// Tiled's `wangfiller.cpp` (v1.12.2) and written here; the tiles of a golden are the tiles whose
// combination its picture gives each cell. `scripts/terrain-fixtures.ts` writes the files; the
// TE-042 test checks that the committed files are exactly what `terrainFixtureFiles` returns.
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

// --- Pictures -------------------------------------------------------------------------------
//
// A picture is `2 × MAP_SIZE + 1` lines of as many characters: vertex (x, y) at line 2y,
// column 2x; the top edge of cell (x, y) at line 2y, column 2x + 1; its left edge at line
// 2y + 1, column 2x; line 2y + 1, column 2x + 1 is the cell itself (a space). A letter of
// `TERRAINS` is that terrain; a space is "no terrain" (vertices of an edge set, edges of a
// corner set).

const GRASS_CORNER = [..."G G G G G G G G G"];
const BLANK = " ".repeat(17);
const GRASS_EDGE_ROW = " G G G G G G G G ";
const GRASS_EDGE_COLUMN = "G G G G G G G G G";
const GRASS_MIXED_ROW = "GGGGGGGGGGGGGGGGG";

/** A picture of Grass everywhere, with `lines` replacing the lines at their keys. */
function picture(type: TerrainFixtureType, lines: Record<number, string> = {}): string[] {
    return Array.from({ length: 2 * MAP_SIZE + 1 }, (_, line) => {
        const replaced = lines[line];
        if (replaced !== undefined) {
            if (replaced.length !== 2 * MAP_SIZE + 1) {
                throw new Error(`Picture line ${line} is ${replaced.length} characters long.`);
            }
            return replaced;
        }
        const even = line % 2 === 0;
        if (type === "corner") return even ? GRASS_CORNER.join("") : BLANK;
        if (type === "edge") return even ? GRASS_EDGE_ROW : GRASS_EDGE_COLUMN;
        return even ? GRASS_MIXED_ROW : GRASS_EDGE_COLUMN;
    });
}

function terrainOf(letter: string): number {
    if (letter === " ") return 0;
    const index = TERRAINS.findIndex((terrain) => terrain.letter === letter);
    if (index < 0) throw new Error(`Unknown terrain letter "${letter}".`);
    return index + 1;
}

/** The WangId a picture gives cell (x, y). */
function pictureWangId(lines: readonly string[], x: number, y: number): number[] {
    const at = (line: number, column: number) => terrainOf(lines[line]![column]!);
    const top = 2 * y;
    const left = 2 * x;
    return [
        at(top, left + 1),
        at(top, left + 2),
        at(top + 1, left + 2),
        at(top + 2, left + 2),
        at(top + 2, left + 1),
        at(top + 2, left),
        at(top + 1, left),
        at(top, left),
    ];
}

// --- Maps and strokes -----------------------------------------------------------------------

export interface TerrainMap {
    /** File name in the fixture folder. */
    readonly file: string;
    readonly fixture: string;
    readonly picture: readonly string[];
    /** Cells left empty, whatever the picture gives them. */
    readonly erased: readonly (readonly [number, number])[];
}

export type TerrainSide = "top" | "right" | "bottom" | "left";

/** One click in Tiled: one run of the filler on the map as the steps before left it. */
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
    /** The map the stroke must leave. */
    readonly golden: string;
    /** How the golden was traced, for the README. */
    readonly trace: string;
}

const SAND = 2;
const WATER = 3;

const grass = (fixture: string, type: TerrainFixtureType): TerrainMap => ({
    file: `${fixture}.tmj`,
    fixture,
    picture: picture(type),
    erased: [],
});

const golden = (fixture: string, stroke: string, lines: readonly string[]): TerrainMap => ({
    file: `${fixture}-${stroke}.golden.tmj`,
    fixture,
    picture: lines,
    erased: [],
});

const damaged = (from: TerrainMap, erased: readonly (readonly [number, number])[]): TerrainMap => ({
    file: `${from.fixture}-fill.tmj`,
    fixture: from.fixture,
    picture: from.picture,
    erased,
});

// Corner complete: Grass and Sand, all 16 combinations. Every combination exists, so each
// cell the filler resolves takes the tile of exactly the corners it is given: the result is
// the picture of the painted vertices.

const cornerCompleteBrush = golden(
    "corner-complete",
    "brush",
    picture("corner", {
        6: "G G G S S G G G G",
        10: "G G G G G S G G G",
    }),
);

const cornerCompleteFullTile = golden(
    "corner-complete",
    "full-tile",
    picture("corner", {
        2: "G G G G G S S G G",
        4: "G G G G G S S G G",
        10: "G G S S G G G G G",
        12: "G G S S G G G G G",
    }),
);

const cornerCompleteFill = damaged(cornerCompleteBrush, [
    [1, 3],
    [2, 3],
    [3, 3],
    [4, 3],
    [5, 3],
    [6, 3],
]);

// Corner incomplete: Grass–Sand and Sand–Water, 31 combinations; Grass and Water are two
// transitions apart (maximum distance 2), so Water painted into Grass is ringed with Sand.

const cornerIncompleteBrush = golden(
    "corner-incomplete",
    "brush",
    picture("corner", {
        6: "G G G S S S S G G",
        8: "G G G S W W S G G",
        10: "G G G S S S S G G",
    }),
);

const cornerIncompleteFullTile = golden(
    "corner-incomplete",
    "full-tile",
    picture("corner", {
        2: "G S S S S G G G G",
        4: "G S W W S G G G G",
        6: "G S W W S G G G G",
        8: "G S S S S S S S G",
        10: "G G G G S W W S G",
        12: "G G G G S W W S G",
        14: "G G G G S S S S G",
    }),
);

const cornerIncompleteFill = damaged(cornerIncompleteBrush, [
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
    [5, 4],
    [6, 4],
]);

// Edge complete: Grass and Sand, all 16 combinations.

const edgeCompleteBrush = golden(
    "edge-complete",
    "brush",
    picture("edge", {
        6: " G G G S G G G G ",
        7: "G G G G S G G G G",
        11: "G G G G G S G G G",
    }),
);

const edgeCompleteFullTile = golden(
    "edge-complete",
    "full-tile",
    picture("edge", {
        2: " G G G G G S G G ",
        3: "G G G G G S S G G",
        4: " G G G G G S G G ",
        10: " G G S G G G G G ",
        11: "G G S S G G G G G",
        12: " G G S G G G G G ",
    }),
);

const edgeCompleteFill = damaged(edgeCompleteBrush, [
    [3, 3],
    [5, 5],
]);

// Edge incomplete: Grass–Sand and Sand–Water, 31 combinations.

const edgeIncompleteBrush = golden(
    "edge-incomplete",
    "brush",
    picture("edge", {
        4: " G G G S G G G G ",
        5: "G G G S S G G G G",
        6: " G G G W S G G G ",
        7: "G G G S W S G G G",
        8: " G G G S S G G G ",
    }),
);

const edgeIncompleteFullTile = golden(
    "edge-incomplete",
    "full-tile",
    picture("edge", {
        8: " G G S G G G G G ",
        9: "G G S S G G G G G",
        10: " G S W S G G G G ",
        11: "G S W W S G G G G",
        12: " G S W S G G G G ",
        13: "G G S S G G G G G",
        14: " G G S G G G G G ",
    }),
);

const edgeIncompleteFill = damaged(edgeIncompleteBrush, [
    [3, 2],
    [4, 3],
]);

// Mixed complete: Grass and Sand at all eight indexes, 256 combinations.

const mixedCompleteBrush = golden(
    "mixed-complete",
    "brush",
    picture("mixed", {
        6: "GGGGGGSGGGGGGGGGG",
        9: "G G G G G S G G G",
        12: "GGGGGSGGGGGGGGGGG",
    }),
);

const mixedCompleteFullTile = golden(
    "mixed-complete",
    "full-tile",
    picture("mixed", {
        4: "GGGGGGGGSSSGGGGGG",
        5: "G G G G S S G G G",
        6: "GGGGGGGGSSSGGGGGG",
    }),
);

const mixedCompleteFill = damaged(mixedCompleteBrush, [
    [3, 3],
    [5, 4],
]);

// Mixed incomplete: Grass–Sand and Sand–Water at all eight indexes, 511 combinations.

const mixedIncompleteBrush = golden(
    "mixed-incomplete",
    "brush",
    picture("mixed", {
        6: "GGGGGGSSSSSGGGGGG",
        7: "G G G S S S G G G",
        8: "GGGGGGSSWSSGGGGGG",
        9: "G G G S S S G G G",
        10: "GGSSSGSSSSSGGGGGG",
        11: "G S S G G G G G G",
        12: "GGSWSGGGGGGGGGGGG",
        13: "G S S G G G G G G",
        14: "GGSSSGGGGGGGGGGGG",
    }),
);

const mixedIncompleteFullTile = golden(
    "mixed-incomplete",
    "full-tile",
    picture("mixed", {
        2: "GGSSSSSSSGGGGGGGG",
        3: "G S S S S G G G G",
        4: "GGSSWWWSSGGGGGGGG",
        5: "G S W W S G G G G",
        6: "GGSSWWWSSGGGGGGGG",
        7: "G S S S S G G G G",
        8: "GGSSSSSSSGGGGGGGG",
    }),
);

const mixedIncompleteFill = damaged(mixedIncompleteBrush, [
    [3, 3],
    [1, 5],
]);

/** Every map written, in file order of the README. */
export const TERRAIN_MAPS: readonly TerrainMap[] = [
    grass("corner-complete", "corner"),
    cornerCompleteFill,
    cornerCompleteBrush,
    cornerCompleteFullTile,
    grass("corner-incomplete", "corner"),
    cornerIncompleteFill,
    cornerIncompleteBrush,
    cornerIncompleteFullTile,
    grass("edge-complete", "edge"),
    edgeCompleteFill,
    edgeCompleteBrush,
    edgeCompleteFullTile,
    grass("edge-incomplete", "edge"),
    edgeIncompleteFill,
    edgeIncompleteBrush,
    edgeIncompleteFullTile,
    grass("mixed-complete", "mixed"),
    mixedCompleteFill,
    mixedCompleteBrush,
    mixedCompleteFullTile,
    grass("mixed-incomplete", "mixed"),
    mixedIncompleteFill,
    mixedIncompleteBrush,
    mixedIncompleteFullTile,
];

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
        trace:
            "Each click makes Sand a hard constraint at one corner of the four cells around the " +
            "vertex; their other corners want what they had. The tile with exactly those " +
            "corners exists (penalty 0, the only one), and it agrees with every neighbour, so " +
            "no correction runs.",
    },
    {
        fixture: "corner-complete",
        name: "full-tile",
        map: "corner-complete.tmj",
        steps: [
            { kind: "tile", x: 2, y: 5, terrain: SAND },
            { kind: "tile", x: 5, y: 1, terrain: SAND },
        ],
        golden: cornerCompleteFullTile.file,
        trace:
            "Full tile mode fixes the four corners of the cell and the corners its eight " +
            "neighbours share with it; every one of the nine cells then has an exact tile.",
    },
    {
        fixture: "corner-complete",
        name: "fill",
        map: cornerCompleteFill.file,
        steps: [{ kind: "fill", x: 1, y: 3 }],
        golden: cornerCompleteBrush.file,
        trace:
            "The region is the empty strip of row 3. Border seeding gives each of its cells " +
            "its top corners from row 2 and its bottom corners from row 4 (the strip is one " +
            "cell high, so every corner is seeded); the exact tile is the only one at penalty " +
            "0, and the look-ahead (corner sets are never complete to the filler) keeps it.",
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
        trace:
            "Water at a corner leaves only Sand–Water tiles; the three corners that want Grass " +
            "cost 1 each as Sand and 2 as Water, so each of the four cells takes Sand there: " +
            "the only tile at the lowest penalty (3 for the first cell; the later ones share " +
            "corners already fixed by it, so 2, 2 and 1). Corrections then reach the edge " +
            "neighbours whose " +
            "shared corners became Sand; each takes its exact Grass–Sand tile, and so on to " +
            "the diagonal cells. The second click turns vertex (5,4) to Water the same way.",
    },
    {
        fixture: "corner-incomplete",
        name: "full-tile",
        map: "corner-incomplete.tmj",
        steps: [
            { kind: "tile", x: 2, y: 2, terrain: WATER },
            { kind: "tile", x: 5, y: 5, terrain: WATER },
        ],
        golden: cornerIncompleteFullTile.file,
        trace:
            "The cell's four corners are Water; its neighbours keep their shared corners Water " +
            "and take Sand at the corners that wanted Grass (the cheapest, and the only one). " +
            "Corrections give the next ring its exact Grass–Sand tiles. In the second click " +
            "cell (4,4) wants Sand, Grass, Grass beside its Water corner and takes Sand at all " +
            "three (penalty 2, the only one).",
    },
    {
        fixture: "corner-incomplete",
        name: "fill",
        map: cornerIncompleteFill.file,
        steps: [{ kind: "fill", x: 1, y: 4 }],
        golden: cornerIncompleteBrush.file,
        trace:
            "As for the complete set: the one-cell-high strip of row 4 has every corner seeded " +
            "from rows 3 and 5, its exact tiles exist, and the look-ahead finds a tile for " +
            "every neighbour.",
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
        trace:
            "Each click fixes one edge in the two cells that share it; their other edges want " +
            "what they had and the exact tile exists, so nothing else changes.",
    },
    {
        fixture: "edge-complete",
        name: "full-tile",
        map: "edge-complete.tmj",
        steps: [
            { kind: "tile", x: 2, y: 5, terrain: SAND },
            { kind: "tile", x: 5, y: 1, terrain: SAND },
        ],
        golden: edgeCompleteFullTile.file,
        trace:
            "Full tile mode on an edge set fixes the cell's four edges and the edge each side " +
            "neighbour shares with it (diagonal cells are not touched); all five cells have " +
            "exact tiles.",
    },
    {
        fixture: "edge-complete",
        name: "fill",
        map: edgeCompleteFill.file,
        steps: [
            { kind: "fill", x: 3, y: 3 },
            { kind: "fill", x: 5, y: 5 },
        ],
        golden: edgeCompleteBrush.file,
        trace:
            "Each region is one empty cell, so border seeding gives all four of its edges from " +
            "its neighbours and its exact tile is the only one at penalty 0. (A region two " +
            "cells wide would leave the edge between them without a wish, and Tiled would " +
            "pick at random.)",
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
        trace:
            "Water on an edge leaves only Sand–Water tiles for the two cells sharing it; their " +
            "other edges want Grass and take Sand (penalty 3, the only one). Corrections give " +
            "the cells beyond those edges their exact Grass–Sand tiles. The second click " +
            "turns the right edge of cell (3,3) to Water: cell (3,3) has its exact tile, cell " +
            "(4,3) takes Sand at its three other edges, and its neighbours are corrected.",
    },
    {
        fixture: "edge-incomplete",
        name: "full-tile",
        map: "edge-incomplete.tmj",
        steps: [{ kind: "tile", x: 2, y: 5, terrain: WATER }],
        golden: edgeIncompleteFullTile.file,
        trace:
            "The cell's four edges are Water; each side neighbour keeps its shared edge Water " +
            "and takes Sand at its three other edges (the only tile at penalty 3); corrections " +
            "give the cells beyond them their exact Grass–Sand tiles.",
    },
    {
        fixture: "edge-incomplete",
        name: "fill",
        map: edgeIncompleteFill.file,
        steps: [
            { kind: "fill", x: 3, y: 2 },
            { kind: "fill", x: 4, y: 3 },
        ],
        golden: edgeIncompleteBrush.file,
        trace:
            "One empty cell per click, so all four edges are seeded and the exact tile is the " +
            "only one at penalty 0; the look-ahead finds a tile for every neighbour (the " +
            "other empty cell only meets the filled one at a corner, which an edge set " +
            "ignores).",
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
        trace:
            "Both terrains are used at corners and edges, so the brush paints corners and " +
            "edges (`PaintEdgeAndCorner`). Every combination exists: each painted index lands " +
            "in exact tiles and nothing else changes.",
    },
    {
        fixture: "mixed-complete",
        name: "full-tile",
        map: "mixed-complete.tmj",
        steps: [{ kind: "tile", x: 4, y: 2, terrain: SAND }],
        golden: mixedCompleteFullTile.file,
        trace:
            "All eight indexes of the cell, plus the edge and two corners each side neighbour " +
            "shares with it and the corner each diagonal neighbour shares; exact tiles for all " +
            "nine cells.",
    },
    {
        fixture: "mixed-complete",
        name: "fill",
        map: mixedCompleteFill.file,
        steps: [
            { kind: "fill", x: 3, y: 3 },
            { kind: "fill", x: 5, y: 4 },
        ],
        golden: mixedCompleteBrush.file,
        trace:
            "One empty cell per click: its edges are seeded from the side neighbours and its " +
            "corners from the diagonal ones, so its exact tile is the only one at penalty 0. " +
            "The set is complete to the filler, so there is no look-ahead.",
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
        trace:
            "Water at one index leaves only Sand–Water tiles, and the seven indexes that want " +
            "Grass take Sand, the only tile at the lowest penalty, in the four cells around " +
            "the vertex (7 for the first; 5, 5 and 3 for the others, whose shared indexes the " +
            "first fixed) and then in the two cells sharing the edge (7, then 5). " +
            "Corrections give the ring around " +
            "them their exact Grass–Sand tiles; cell (2,5) keeps the Sand corner it got from " +
            "the first click.",
    },
    {
        fixture: "mixed-incomplete",
        name: "full-tile",
        map: "mixed-incomplete.tmj",
        steps: [{ kind: "tile", x: 2, y: 2, terrain: WATER }],
        golden: mixedIncompleteFullTile.file,
        trace:
            "All eight indexes of the cell are Water and its eight neighbours keep the indexes " +
            "they share with it Water; every other index of theirs takes Sand (the only tile " +
            "at the lowest penalty). Corrections give the next ring its exact Grass–Sand tiles.",
    },
    {
        fixture: "mixed-incomplete",
        name: "fill",
        map: mixedIncompleteFill.file,
        steps: [
            { kind: "fill", x: 3, y: 3 },
            { kind: "fill", x: 1, y: 5 },
        ],
        golden: mixedIncompleteBrush.file,
        trace:
            "One empty cell per click, every index seeded from its eight neighbours (cell " +
            "(3,3) takes Water at its bottom-right corner from cell (4,4)); the exact tile is " +
            "the only one at penalty 0 and the look-ahead keeps it.",
    },
];

// --- Tiled's JSON ---------------------------------------------------------------------------

type Json = number | string | boolean | readonly Json[] | { readonly [key: string]: Json };

const INDENT = "    ";

/**
 * Tiled's `escape` (`src/plugins/json/qjsonparser/json.cpp`), one UTF-16 unit at a time. That
 * file's licence allows use without limitation; its notice is in THIRD_PARTY_NOTICES.md.
 */
function escape(text: string): string {
    let out = "";
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        const code = text.charCodeAt(i);
        if (char === "\b") out += "\\b";
        else if (char === "\f") out += "\\f";
        else if (char === "\n") out += "\\n";
        else if (char === "\r") out += "\\r";
        else if (char === "\t") out += "\\t";
        else if (char === '"') out += '\\"';
        else if (char === "\\") out += "\\\\";
        else if (char === "/") out += "\\/";
        else if (code > 127) out += `\\u${code.toString(16).padStart(4, "0")}`;
        else out += char;
    }
    return out;
}

/**
 * Tiled's `JsonWriter::stringify` with auto-formatting on: 4-space indent, map keys in
 * `QVariantMap` order, arrays wrapped every `wrap` items (0: never). Integers only.
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
            .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
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

/** The GIDs of a map (firstgid 1), row by row. */
export function mapData(map: TerrainMap): number[] {
    const fixture = TERRAIN_FIXTURES.find((candidate) => candidate.name === map.fixture)!;
    const tileOf = new Map(fixtureWangIds(fixture).map((wangId, tile) => [wangId.join(), tile]));
    const indexes = new Set(typeIndexes(fixture.type));
    const data: number[] = [];
    for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
            if (map.erased.some(([ex, ey]) => ex === x && ey === y)) {
                data.push(0);
                continue;
            }
            const wangId = pictureWangId(map.picture, x, y);
            if (wangId.some((color, index) => indexes.has(index) === (color === 0))) {
                throw new Error(`${map.file}: cell ${x},${y} has terrain where its type has none.`);
            }
            const tile = tileOf.get(wangId.join());
            if (tile === undefined) {
                throw new Error(`${map.file}: no tile for cell ${x},${y} (${wangId.join()}).`);
            }
            data.push(tile + 1);
        }
    }
    return data;
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

/**
 * The index a pixel of a tile shows: corner tiles in quadrants, edge tiles in the four
 * triangles between the diagonals, mixed tiles in a 3 × 3 grid (null in the middle).
 */
function pixelIndex(type: TerrainFixtureType, px: number, py: number): number | null {
    const half = TILE_SIZE / 2;
    if (type === "corner") {
        if (py < half) return px < half ? 7 : 1;
        return px < half ? 5 : 3;
    }
    if (type === "edge") {
        const dx = px + 0.5 - half;
        const dy = py + 0.5 - half;
        if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 0 : 4;
        return dx < 0 ? 6 : 2;
    }
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
        "`node scripts/terrain-fixtures.ts` (definitions in `tests/unit/support/terrainFixtures.ts`) as",
        "Tiled 1.12.2 writes it; the test checks that the script reproduces them byte for byte.",
        "",
        "## Conventions",
        "",
        "- Maps are 8 × 8 cells of 24 px; cell (x,y) counts from the top-left, as Tiled's status bar",
        "  shows it. Vertex (x,y) is the top-left corner of cell (x,y).",
        "- Terrains: 1 Grass (green), 2 Sand (yellow), 3 Water (blue). A tile is drawn in its",
        "  terrains: corner tiles by quadrant, edge tiles by the triangles between the diagonals,",
        "  mixed tiles in a 3 × 3 grid (corners and edges; the middle is dark grey).",
        "- `<set>.tmj` is all Grass; `<set>-fill.tmj` is a golden with some cells erased, the regions",
        "  the fill stroke fills; `<set>-<stroke>.golden.tmj` is the expected result of a stroke.",
        "- Each step is one click: one run of the filler on the map the steps before it left.",
        "- The strokes keep Tiled's random choice out: every index of every cell the filler resolves",
        "  is constrained, so one candidate has the lowest penalty. Fill regions are empty cells",
        "  enclosed by tiles, one cell high for corner sets and one cell for edge and mixed sets (a",
        "  wider region leaves the edges inside it without a wish). The test makes a tie fail.",
        "",
        "## Owner check in Tiled 1.12.2",
        "",
        "For each stroke below: open its map (reopen it without saving between strokes), select the",
        "terrain set in the Terrain Sets view and, for brush and full-tile strokes, the terrain each",
        "step names; use the named tool and make each step in order. Then open the golden alongside:",
        "every cell must show the same tile. Reply `terrain pass`, or",
        "`terrain fail: <set> <stroke> <cell x,y>`.",
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
                `- Trace: ${stroke.trace}`,
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
    for (const map of TERRAIN_MAPS) files.set(map.file, text(mapJson(map.fixture, mapData(map))));
    files.set("README.md", text(readme()));
    return files;
}
