import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cellValue } from "../../src/core/cells";
import type { CellRect } from "../../src/core/cells";
import { forEachRegionCell, rectRegion, regionCells } from "../../src/core/fill";
import type { TerrainSet, TerrainSetType } from "../../src/core/model";
import {
    AROUND,
    TerrainFiller,
    analyzeTerrainSet,
    effectiveTypeForColor,
    applyTerrainFill,
    nextIndex,
    oppositeIndex,
    previousIndex,
    typeUsesIndex,
    wangIdOfCell,
    xorshift32,
} from "../../src/core/terrain";
import type { TerrainAnalysis, TerrainFillResult, WangIndex } from "../../src/core/terrain";
import { LAYER, MAP, SLOT, commit, setup, tileLayer, tileset } from "./te-006-support";

// TE-041: the terrain filler (SPEC §5.2), Tiled's `WangFiller` at v1.12.2. Properties over
// random sets, maps and painting: every resolved cell matches its painted indexes and its
// resolved neighbours; a complete set leaves no invalid cell; nothing outside the bounds (the
// touched region grown by the maximum distance, clipped to the map) changes; a fixed seed gives
// the same result twice. Then unresolvable painting on an incomplete set, and the result as a
// cell patch of a stroke transaction.

/** Every combination of `count` indexes over terrains `1..c`. */
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

/** The complete set of `type` over `c` terrains, one tile per combination. */
function completeWangIds(type: TerrainSetType, c: number): number[][] {
    if (type === "mixed") return combinations(c, 8);
    return combinations(c, 4).map((combo) => {
        const wangId = [0, 0, 0, 0, 0, 0, 0, 0];
        combo.forEach((color, i) => (wangId[type === "corner" ? i * 2 + 1 : i * 2] = color));
        return wangId;
    });
}

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

/** A map of `width × height` cells, row by row. */
interface Grid {
    width: number;
    height: number;
    cells: number[];
}

const at = (grid: Grid) => (x: number, y: number) => grid.cells[y * grid.width + x]!;

type Paint =
    | { kind: "corner"; x: number; y: number; color: number }
    | { kind: "edge"; x: number; y: number; index: WangIndex; color: number }
    | { kind: "full"; x: number; y: number; color: number }
    | { kind: "index"; x: number; y: number; index: WangIndex; color: number };

/** A cell index the painting constrains: `[x, y, index, color]`. */
type Constraint = [number, number, number, number];

/** The hard constraints a list of paints sets, as the brush defines them (SPEC §5.3). */
function constraintsOf(paints: readonly Paint[], type: TerrainSetType): Constraint[] {
    const out: Constraint[] = [];
    for (const paint of paints) {
        const { x, y, color } = paint;
        if (paint.kind === "corner") {
            out.push(
                [x, y - 1, 5, color],
                [x, y, 7, color],
                [x - 1, y, 1, color],
                [x - 1, y - 1, 3, color],
            );
        } else if (paint.kind === "edge") {
            const [dx, dy] = AROUND[paint.index]!;
            out.push(
                [x, y, paint.index, color],
                [x + dx, y + dy, oppositeIndex(paint.index), color],
            );
        } else if (paint.kind === "index") {
            out.push([x, y, paint.index, color]);
        } else {
            for (let i = 0; i < 8; i++) if (typeUsesIndex(type, i)) out.push([x, y, i, color]);
            for (let i = 0; i < 8; i++) {
                const corner = (i & 1) === 1;
                const [dx, dy] = AROUND[i]!;
                if (type === "edge" && corner) continue;
                if (corner || type !== "corner")
                    out.push([x + dx, y + dy, oppositeIndex(i), color]);
                if (!corner && type !== "edge") {
                    out.push(
                        [x + dx, y + dy, (i + 3) % 8, color],
                        [x + dx, y + dy, (i + 5) % 8, color],
                    );
                }
            }
        }
    }
    return out;
}

interface Case {
    analysis: TerrainAnalysis;
    grid: Grid;
    paints: Paint[];
    /** Fill tools: a region instead of paints. */
    fill: CellRect | null;
    corrections: boolean;
    seed: number;
}

function run(c: Case): TerrainFillResult {
    const filler = new TerrainFiller({
        analysis: c.analysis,
        back: at(c.grid),
        width: c.grid.width,
        height: c.grid.height,
        random: xorshift32(c.seed),
        corrections: c.corrections,
    });
    if (c.fill) filler.setRegion(rectRegion(c.fill));
    for (const paint of c.paints) {
        if (paint.kind === "corner") filler.setCorner(paint.x, paint.y, paint.color);
        else if (paint.kind === "edge") filler.setEdge(paint.x, paint.y, paint.index, paint.color);
        else if (paint.kind === "index")
            filler.setWangIndex(paint.x, paint.y, paint.index, paint.color);
        else filler.setFullTile(paint.x, paint.y, paint.color);
    }
    return filler.apply();
}

const wangOf = (analysis: TerrainAnalysis, value: number) => {
    const out = new Uint8Array(8);
    wangIdOfCell(analysis, value, out);
    return out;
};

const TYPES: readonly TerrainSetType[] = ["corner", "edge", "mixed"];

/** A set: complete, or a random part of a complete one; terrains 2 or 3 (mixed: 2). */
const setArb = (complete: boolean) =>
    fc
        .record({
            type: fc.constantFrom(...TYPES),
            colors: fc.integer({ min: 2, max: 3 }),
            keep: fc.array(fc.boolean(), { minLength: 81, maxLength: 81 }),
        })
        .map(({ type, colors, keep }) => {
            const c = type === "mixed" ? 2 : colors;
            const all = completeWangIds(type, c);
            const wangIds = complete
                ? all
                : all.filter((_, i) => keep[i % keep.length] && i % 3 !== 0);
            return analyzeTerrainSet(
                terrainSet(type, c, wangIds.length > 0 ? wangIds : [all[0]!]),
                SLOT,
            );
        });

/**
 * Brush paints the set's type supports, around and just outside a `width × height` map. Each
 * paints an index in every cell that shares it; a lone `setWangIndex` does not, so a neighbour
 * resolved first may override it, as in Tiled.
 */
function paintArb(analysis: TerrainAnalysis, width: number, height: number, withNone: boolean) {
    const color = fc.integer({ min: withNone ? 0 : 1, max: analysis.colorCount });
    const x = fc.integer({ min: -1, max: width });
    const y = fc.integer({ min: -1, max: height });
    const edgeIndex = fc.constantFrom<WangIndex>(0, 2, 4, 6);
    const corner = fc.record({ kind: fc.constant("corner" as const), x, y, color });
    const edge = fc.record({ kind: fc.constant("edge" as const), x, y, index: edgeIndex, color });
    const full = fc.record({ kind: fc.constant("full" as const), x, y, color });
    const kinds =
        analysis.type === "corner"
            ? [corner, full]
            : analysis.type === "edge"
              ? [edge, full]
              : [corner, edge, full];
    return fc.array(fc.oneof(...kinds), { minLength: 1, maxLength: 5 });
}

/** A case on `set`; `covered`: every cell of the map holds a tile of the set. */
function caseArb(
    setArbitrary: fc.Arbitrary<TerrainAnalysis>,
    options: { covered: boolean; fill: boolean },
) {
    return setArbitrary.chain((analysis) =>
        fc
            .record({
                width: fc.integer({ min: 1, max: 7 }),
                height: fc.integer({ min: 1, max: 7 }),
            })
            .chain(({ width, height }) => {
                const values = Array.from(analysis.candidateValues);
                const cell = options.covered
                    ? fc.constantFrom(...values)
                    : fc.oneof(
                          fc.constantFrom(...values),
                          fc.constant(0),
                          fc.constant(cellValue(SLOT + 1, 0)),
                      );
                return fc.record({
                    analysis: fc.constant(analysis),
                    grid: fc
                        .array(cell, { minLength: width * height, maxLength: width * height })
                        .map((cells): Grid => ({ width, height, cells })),
                    paints: options.fill
                        ? fc.constant<Paint[]>([])
                        : paintArb(analysis, width, height, !options.covered),
                    fill: options.fill
                        ? fc
                              .record({
                                  x: fc.integer({ min: -1, max: width - 1 }),
                                  y: fc.integer({ min: -1, max: height - 1 }),
                                  width: fc.integer({ min: 1, max: 4 }),
                                  height: fc.integer({ min: 1, max: 4 }),
                              })
                              .map((rect): CellRect | null => rect)
                        : fc.constant(null),
                    corrections: options.fill ? fc.constant(false) : fc.boolean(),
                    seed: fc.integer({ min: 0, max: 0xffffffff }),
                });
            }),
    );
}

/** Painting every index the type uses of every cell of a rectangle, corrections off. */
function paintedFill(analysis: TerrainAnalysis, rect: CellRect, color: number): Paint[] {
    const paints: Paint[] = [];
    forEachRegionCell(rectRegion(rect), (x, y) => {
        for (let index = 0; index < 8; index++) {
            if (typeUsesIndex(analysis.type, index)) {
                paints.push({ kind: "index", x, y, index: index as WangIndex, color });
            }
        }
    });
    return paints;
}

/** The touched cells inside the map: painted cells and the fill region. */
function touchedRect(c: Case): CellRect | null {
    const cells = constraintsOf(c.paints, c.analysis.type).map(([x, y]) => ({ x, y }));
    if (c.fill) cells.push(...regionCells(rectRegion(c.fill)));
    const inside = cells.filter(
        ({ x, y }) => x >= 0 && y >= 0 && x < c.grid.width && y < c.grid.height,
    );
    if (inside.length === 0) return null;
    const xs = inside.map((p) => p.x);
    const ys = inside.map((p) => p.y);
    return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
    };
}

const RUNS = { numRuns: 300 };

/** Tile IDs `xorshift32(12345)` picks in "pins the tie-breaking of a fixed seed". */
const PINNED_TILES: number[] = [2, 7, 12, 5, 11, 12, 8, 1, 8];

describe("terrain filler properties", () => {
    it("every resolved cell matches its painted indexes and its resolved neighbours", () => {
        fc.assert(
            fc.property(
                caseArb(fc.oneof(setArb(true), setArb(false)), { covered: false, fill: false }),
                caseArb(fc.oneof(setArb(true), setArb(false)), { covered: false, fill: true }),
                (painted, filled) => {
                    for (const c of [painted, filled]) {
                        const result = run(c);
                        const placed = new Map(
                            result.cells.map((cell) => [`${cell.x},${cell.y}`, cell.value]),
                        );
                        // Last paint of an index wins, as later paints overwrite `desired`.
                        const wanted = new Map<string, number>();
                        for (const [x, y, index, color] of constraintsOf(
                            c.paints,
                            c.analysis.type,
                        )) {
                            wanted.set(`${x},${y},${index}`, color);
                        }
                        for (const [key, color] of wanted) {
                            const [x, y, index] = key.split(",").map(Number) as [
                                number,
                                number,
                                number,
                            ];
                            const value = placed.get(`${x},${y}`);
                            if (value === undefined) continue;
                            expect(wangOf(c.analysis, value)[index], `painted ${key}`).toBe(color);
                        }
                        for (const cell of result.cells) {
                            const a = wangOf(c.analysis, cell.value);
                            for (let i = 0; i < 8; i++) {
                                const [dx, dy] = AROUND[i]!;
                                const other = placed.get(`${cell.x + dx},${cell.y + dy}`);
                                if (other === undefined) continue;
                                const b = wangOf(c.analysis, other);
                                const o = oppositeIndex(i);
                                expect(b[o], `shared index ${i} of ${cell.x},${cell.y}`).toBe(a[i]);
                                if ((i & 1) === 0) {
                                    expect(b[nextIndex(o)]).toBe(a[previousIndex(i)]);
                                    expect(b[previousIndex(o)]).toBe(a[nextIndex(i)]);
                                }
                            }
                        }
                    }
                },
            ),
            RUNS,
        );
    });

    it("a complete set leaves no invalid cell (brush with and without corrections, fill mode)", () => {
        fc.assert(
            fc.property(
                caseArb(setArb(true), { covered: true, fill: false }),
                fc.record({
                    x: fc.integer({ min: -1, max: 6 }),
                    y: fc.integer({ min: -1, max: 6 }),
                    width: fc.integer({ min: 1, max: 4 }),
                    height: fc.integer({ min: 1, max: 4 }),
                }),
                fc.integer({ min: 1, max: 3 }),
                (c, rect, terrain) => {
                    expect(c.analysis.complete).toBe(true);
                    expect(run(c).invalid).toEqual([]);
                    const color = Math.min(terrain, c.analysis.colorCount);
                    const fill = {
                        ...c,
                        paints: paintedFill(c.analysis, rect, color),
                        corrections: false,
                    };
                    expect(run(fill).invalid).toEqual([]);
                    // Terrain fill mode (SPEC §5.4): the region only, corrections off.
                    const region = { ...c, paints: [], fill: rect, corrections: false };
                    expect(run(region).invalid).toEqual([]);
                },
            ),
            RUNS,
        );
    });

    it("changes nothing outside the bounds: the touched cells grown by the maximum distance, clipped to the map", () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    caseArb(fc.oneof(setArb(true), setArb(false)), { covered: false, fill: false }),
                    caseArb(fc.oneof(setArb(true), setArb(false)), { covered: false, fill: true }),
                ),
                (c) => {
                    const result = run(c);
                    const touched = touchedRect(c);
                    if (!touched) {
                        expect(result).toEqual({ cells: [], invalid: [], bounds: null });
                        return;
                    }
                    const m = c.analysis.maximumDistance;
                    const left = Math.max(0, touched.x - m);
                    const top = Math.max(0, touched.y - m);
                    const right = Math.min(c.grid.width, touched.x + touched.width + m);
                    const bottom = Math.min(c.grid.height, touched.y + touched.height + m);
                    expect(result.bounds).toEqual({
                        x: left,
                        y: top,
                        width: right - left,
                        height: bottom - top,
                    });
                    const inside = (x: number, y: number) =>
                        x >= left && x < right && y >= top && y < bottom;
                    for (const cell of result.cells) expect(inside(cell.x, cell.y)).toBe(true);
                    forEachRegionCell(result.invalid, (x, y) => expect(inside(x, y)).toBe(true));
                },
            ),
            RUNS,
        );
    });

    it("gives the same result twice with a fixed seed; invalid cells are never in the patch", () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    caseArb(fc.oneof(setArb(true), setArb(false)), { covered: false, fill: false }),
                    caseArb(fc.oneof(setArb(true), setArb(false)), { covered: false, fill: true }),
                ),
                (c) => {
                    const first = run(c);
                    expect(run(c)).toEqual(first);
                    const placed = new Set(first.cells.map((cell) => `${cell.x},${cell.y}`));
                    forEachRegionCell(first.invalid, (x, y) =>
                        expect(placed.has(`${x},${y}`)).toBe(false),
                    );
                },
            ),
            RUNS,
        );
    });
});

describe("terrain filler cases", () => {
    // Corner set with terrains 1 and 2 and no transition between them.
    const noTransitions = analyzeTerrainSet(
        terrainSet("corner", 2, [
            [0, 1, 0, 1, 0, 1, 0, 1],
            [0, 2, 0, 2, 0, 2, 0, 2],
        ]),
        SLOT,
    );
    const GRASS = cellValue(SLOT, 0);
    const SAND = cellValue(SLOT, 1);
    const grassMap: Grid = { width: 4, height: 4, cells: Array<number>(16).fill(GRASS) };

    it("returns unresolvable painting on an incomplete set as the invalid region and leaves it unchanged", () => {
        expect(noTransitions.complete).toBe(false);
        const filler = new TerrainFiller({
            analysis: noTransitions,
            back: at(grassMap),
            width: 4,
            height: 4,
            random: xorshift32(1),
            corrections: true,
        });
        filler.setCorner(2, 2, 2);
        const result = filler.apply();
        expect(result.invalid).toEqual([
            { y: 1, start: 1, end: 3 },
            { y: 2, start: 1, end: 3 },
        ]);
        expect(result.cells).toEqual([]);
        expect(result.bounds).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    });

    it("without corrections takes the unreachable terrain at the highest penalty", () => {
        const filler = new TerrainFiller({
            analysis: noTransitions,
            back: at(grassMap),
            width: 4,
            height: 4,
            random: xorshift32(1),
        });
        filler.setFullTile(1, 1, 2);
        const result = filler.apply();
        expect(result.invalid).toEqual([]);
        expect(
            result.cells.filter((cell) => cell.value === SAND).map(({ x, y }) => [x, y]),
        ).toEqual([
            [0, 0],
            [1, 0],
            [2, 0],
            [0, 1],
            [1, 1],
            [2, 1],
            [0, 2],
            [1, 2],
            [2, 2],
        ]);
    });

    it("corner brush on a complete set routes the corner and corrects the neighbours", () => {
        const analysis = analyzeTerrainSet(
            terrainSet("corner", 2, completeWangIds("corner", 2)),
            SLOT,
        );
        // Tile n of the complete set has corner i = digit i of n in base 2, plus 1.
        const all1 = cellValue(SLOT, 0);
        const map: Grid = { width: 3, height: 3, cells: Array<number>(9).fill(all1) };
        const filler = new TerrainFiller({
            analysis,
            back: at(map),
            width: 3,
            height: 3,
            random: xorshift32(7),
            corrections: true,
        });
        filler.setCorner(1, 1, 2);
        const result = filler.apply();
        expect(result.invalid).toEqual([]);
        const after = [...map.cells];
        for (const { x, y, value } of result.cells) after[y * 3 + x] = value;
        const ids = after.map((value) => Array.from(wangOf(analysis, value)));
        // The four cells around vertex (1, 1) take terrain 2 at that vertex only.
        expect(ids[0]).toEqual([0, 1, 0, 2, 0, 1, 0, 1]);
        expect(ids[1]).toEqual([0, 1, 0, 1, 0, 2, 0, 1]);
        expect(ids[3]).toEqual([0, 2, 0, 1, 0, 1, 0, 1]);
        expect(ids[4]).toEqual([0, 1, 0, 1, 0, 1, 0, 2]);
        for (const i of [2, 5, 6, 7, 8]) expect(after[i]).toBe(all1);
    });

    it("full tile mode in a mixed set paints only the indexes the terrain is used at", () => {
        // Terrain 2 appears only on corners, so Tiled's `effectiveTypeForColor` makes the
        // brush paint corners (`wangbrush.cpp` `setColor`).
        const analysis = analyzeTerrainSet(
            terrainSet("mixed", 2, [
                [1, 1, 1, 1, 1, 1, 1, 1],
                [1, 2, 1, 2, 1, 2, 1, 2],
            ]),
            SLOT,
        );
        expect(effectiveTypeForColor(analysis, 2)).toBe("corner");
        expect(effectiveTypeForColor(analysis, 1)).toBe("mixed");
        const map: Grid = { width: 3, height: 3, cells: Array<number>(9).fill(cellValue(SLOT, 0)) };
        const filler = new TerrainFiller({
            analysis,
            back: at(map),
            width: 3,
            height: 3,
            random: xorshift32(1),
            corrections: true,
        });
        filler.setFullTile(1, 1, 2);
        const result = filler.apply();
        // The centre takes the corner tile; no tile has terrain 2 at one corner only, so the
        // 8 neighbours stay unresolved. Painting all 8 indexes would leave the centre too.
        expect(result.cells).toEqual([{ x: 1, y: 1, value: cellValue(SLOT, 1) }]);
        expect(result.invalid).toEqual([
            { y: 0, start: 0, end: 3 },
            { y: 1, start: 0, end: 1 },
            { y: 1, start: 2, end: 3 },
            { y: 2, start: 0, end: 3 },
        ]);
    });

    it("corrects edge neighbours outside the region until the map matches again", () => {
        // Terrains 1–2 and 2–3 meet, 1 and 3 only through 2 (distance 2).
        const wangIds = [
            ...completeWangIds("corner", 2),
            ...completeWangIds("corner", 2)
                .map((id) => id.map((color) => (color === 0 ? 0 : color + 1)))
                .filter((id) => id.includes(3)),
        ];
        const analysis = analyzeTerrainSet(terrainSet("corner", 3, wangIds), SLOT);
        expect(analysis.maximumDistance).toBe(2);
        const all1 = cellValue(SLOT, 0);
        const map: Grid = { width: 6, height: 6, cells: Array<number>(36).fill(all1) };
        const filler = new TerrainFiller({
            analysis,
            back: at(map),
            width: 6,
            height: 6,
            random: xorshift32(5),
            corrections: true,
        });
        filler.setCorner(3, 3, 3);
        const result = filler.apply();
        expect(result.invalid).toEqual([]);
        const after = [...map.cells];
        for (const { x, y, value } of result.cells) after[y * 6 + x] = value;
        // Cells outside the painted 2 × 2 changed: the corrections pass reached them.
        const outsideRegion = result.cells.filter(
            ({ x, y }) => !(x >= 2 && x <= 3 && y >= 2 && y <= 3) && after[y * 6 + x] !== all1,
        );
        expect(outsideRegion.length).toBeGreaterThan(0);
        // Every pair of neighbours on the map shares its terrains.
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                const a = wangOf(analysis, after[y * 6 + x]!);
                for (let i = 0; i < 8; i++) {
                    const [dx, dy] = AROUND[i]!;
                    if (x + dx < 0 || y + dy < 0 || x + dx >= 6 || y + dy >= 6) continue;
                    const b = wangOf(analysis, after[(y + dy) * 6 + x + dx]!);
                    expect(b[oppositeIndex(i)], `${x},${y} index ${i}`).toBe(a[i]);
                }
            }
        }
    });

    it("pins the tie-breaking of a fixed seed", () => {
        // A fill region on an empty map: every candidate ties, so the seed decides.
        const analysis = analyzeTerrainSet(
            terrainSet("corner", 2, completeWangIds("corner", 2)),
            SLOT,
        );
        const empty: Grid = { width: 3, height: 3, cells: Array<number>(9).fill(0) };
        const filler = new TerrainFiller({
            analysis,
            back: at(empty),
            width: 3,
            height: 3,
            random: xorshift32(12345),
        });
        filler.setRegion(rectRegion({ x: 0, y: 0, width: 3, height: 3 }));
        const result = filler.apply();
        expect(result.cells.map(({ value }) => value & 0xfffff)).toEqual(PINNED_TILES);
    });

    it("refuses terrains and indexes outside the set", () => {
        const filler = new TerrainFiller({
            analysis: noTransitions,
            back: at(grassMap),
            width: 4,
            height: 4,
            random: xorshift32(1),
        });
        expect(() => filler.setCorner(1, 1, 3)).toThrow(RangeError);
        expect(() => filler.setFullTile(1, 1, -1)).toThrow(RangeError);
        expect(() => filler.setWangIndex(1, 1, 8 as WangIndex, 1)).toThrow(RangeError);
    });

    it("writes its cell patch into a stroke transaction as one history entry", () => {
        const history = setup();
        const project = history.session.project;
        const analysisSet = terrainSet("corner", 2, completeWangIds("corner", 2));
        project.tilesets[0] = { ...tileset("ts", SLOT, 16), terrainSets: [analysisSet] };
        const analysis = analyzeTerrainSet(analysisSet, SLOT);
        const layer = tileLayer(project);
        const all1 = cellValue(SLOT, 0);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) layer.cells.set(x, y, all1);

        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        const filler = new TerrainFiller({
            analysis,
            back: (x, y) => stroke.get(x, y),
            width: 8,
            height: 8,
            random: xorshift32(3),
            corrections: true,
        });
        filler.setCorner(4, 4, 2);
        const result = filler.apply();
        applyTerrainFill(stroke, result);
        const command = commit(history, "Terrain Brush");
        expect(command).not.toBeNull();
        for (const { x, y, value } of result.cells) expect(layer.cells.get(x, y)).toBe(value);
        expect(history.undo()).toBe(true);
        for (const { x, y } of result.cells) expect(layer.cells.get(x, y)).toBe(all1);
    });
});
