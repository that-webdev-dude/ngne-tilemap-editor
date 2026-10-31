import { readFileSync } from "node:fs";
import fc from "fast-check";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { CellStore, cellValue } from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import { FlatCells, QuadEmitter } from "../../src/core/runtime/emit";
import type { EmitTileset } from "../../src/core/runtime/emit";
import { collect, emitAll, sparseCells, tilesetOf, wholeMap } from "./te-011-support";
import type { Quad } from "./te-011-support";

// The shared quad emitter (SPEC §11.3, ENGINE §4): order, one sprite object, culling, both
// value kinds, and the import-free source the generated runtime inlines.

const EMIT_SOURCE = new URL("../../src/core/runtime/emit.ts", import.meta.url);

describe("order", () => {
    it("groups quads by tileset in list order, row-major inside a tileset, one depth per layer", () => {
        // List order is B (slot 5), A (slot 2): list order, not slot order, groups the quads.
        const b = tilesetOf({ key: 5, tileWidth: 8, tileHeight: 8, texture: "b" });
        const a = tilesetOf({ key: 2, tileWidth: 8, tileHeight: 8, texture: "a" });
        const cells = sparseCells({
            "0,0": cellValue(2, 0),
            "2,0": cellValue(5, 0),
            "1,1": cellValue(2, 1),
            "0,2": cellValue(5, 1),
            "2,2": cellValue(2, 0, 0b100),
        });
        const options = { ...wholeMap(3, 3, 8), depth: 7, layer: 2 };
        const { quads } = emitAll("slot", [b, a], cells, options);

        const grid = (q: Quad) => [Math.floor(q.x / 8), Math.floor(q.y / 8)];
        // Row-major: by y, then x. A quad's centre lies in the cell it was placed in.
        expect(quads.map((q) => [q.texture, ...grid(q)])).toEqual([
            ["b", 2, 0],
            ["b", 0, 2],
            ["a", 0, 0],
            ["a", 1, 1],
            ["a", 2, 2],
        ]);
        expect(new Set(quads.map((q) => q.depth))).toEqual(new Set([7]));
        expect(new Set(quads.map((q) => q.layer))).toEqual(new Set([2]));
    });

    it("is row-major across chunk borders of a CellStore", () => {
        const tileset = tilesetOf({ key: 1, tileWidth: 4, tileHeight: 4 });
        const store = new CellStore();
        const spots = [
            [40, 3],
            [2, 3],
            [33, 3],
            [2, 40],
            [31, 0],
        ] as const;
        for (const [x, y] of spots) store.set(x, y, cellValue(1, 0));
        const { quads } = emitAll("slot", [tileset], store, wholeMap(64, 64, 4));
        const placed = quads.map((q) => [Math.floor(q.x / 4), Math.floor(q.y / 4)]);
        expect(placed).toEqual([
            [31, 0],
            [2, 3],
            [33, 3],
            [40, 3],
            [2, 40],
        ]);
    });

    it("emits the same quads for the same layer twice, and for a repeated call on one emitter", () => {
        const tileset = tilesetOf({ key: 1, tileWidth: 8, tileHeight: 8 });
        const emitter = new QuadEmitter("slot", [tileset]);
        const cells = new FlatCells(
            [cellValue(1, 0), 0, cellValue(1, 1), cellValue(1, 1, 3)],
            2,
            2,
        );
        const first = collect();
        const second = collect();
        emitter.emitLayer(first, cells, wholeMap(2, 2, 8));
        emitter.emitLayer(second, cells, wholeMap(2, 2, 8));
        expect(first.quads).toHaveLength(3);
        expect(second.quads).toEqual(first.quads);
    });
});

describe("sprite object", () => {
    it("hands every sink call the same sprite object, across tilesets and calls", () => {
        const a = tilesetOf({ key: 1, tileWidth: 8, tileHeight: 8 });
        const b = tilesetOf({ key: 2, tileWidth: 16, tileHeight: 16 });
        const emitter = new QuadEmitter("slot", [a, b]);
        const cells = new FlatCells([cellValue(1, 0), cellValue(2, 1), cellValue(1, 1), 0], 2, 2);
        const sink = collect();
        emitter.emitLayer(sink, cells, wholeMap(2, 2, 8));
        emitter.emitLayer(sink, cells, wholeMap(2, 2, 8));
        expect(sink.received).toHaveLength(6);
        for (const s of sink.received) expect(s).toBe(emitter.sprite);
    });

    it("sets every field the engine contract names, with alpha, colour, layer and depth", () => {
        const tileset = tilesetOf({ key: 1, tileWidth: 8, tileHeight: 8, tiles: 4, texture: "t" });
        const options = { ...wholeMap(1, 1, 8), alpha: 0.5, color: 0xff8800ff, layer: 3, depth: 9 };
        const { quads } = emitAll(
            "slot",
            [tileset],
            sparseCells({ "0,0": cellValue(1, 3) }),
            options,
        );
        expect(quads).toEqual([
            {
                x: 4,
                y: 4,
                width: 8,
                height: 8,
                rotation: 0,
                texture: "t",
                u: 0.75,
                v: 0.25,
                uw: 0.25,
                vh: 0.5,
                alpha: 0.5,
                color: 0xff8800ff,
                layer: 3,
                depth: 9,
            },
        ]);
    });
});

describe("cells that draw nothing", () => {
    it("skips empty cells, unknown slots and GIDs, missing tiles and cells outside the layer", () => {
        const sparse: EmitTileset = {
            ...tilesetOf({ key: 1, tileWidth: 8, tileHeight: 8, tiles: 1, span: 4 }),
            ids: [2],
            uv: new Float32Array([0, 0, 1, 1]),
        };
        // Tile 2 exists; tiles 0 and 1 do not; the span ends at 3.
        const slotCells = sparseCells({
            "0,0": 0,
            "1,0": cellValue(9, 0),
            "2,0": cellValue(1, 0),
            "3,0": cellValue(1, 3),
            "4,0": cellValue(1, 2),
            "9,0": cellValue(1, 2),
            "0,5": cellValue(1, 2),
        });
        const bySlot = emitAll("slot", [sparse], slotCells, wholeMap(5, 1, 8));
        expect(bySlot.quads).toHaveLength(1);
        expect(bySlot.quads[0]!.x).toBe(4 * 8 + 4);

        // GIDs: firstGid 10, tile 2 is GID 12; 9 is below the span, 14 is past it.
        const gidSet: EmitTileset = { ...sparse, key: 10 };
        const gidCells = sparseCells({
            "0,0": 9,
            "1,0": 10,
            "2,0": 12,
            "3,0": 14,
            "4,0": 0x0fffffff,
        });
        const byGid = emitAll("gid", [gidSet], gidCells, wholeMap(5, 1, 8));
        expect(byGid.quads).toHaveLength(1);
        expect(byGid.quads[0]!.x).toBe(2 * 8 + 4);
    });

    it("emits nothing for an empty view, no tilesets or an empty layer", () => {
        const tileset = tilesetOf({ key: 1, tileWidth: 8, tileHeight: 8 });
        const cells = new FlatCells([cellValue(1, 0)], 1, 1);
        expect(
            emitAll("slot", [tileset], cells, { ...wholeMap(1, 1, 8), viewWidth: 0 }).quads,
        ).toEqual([]);
        expect(emitAll("slot", [], cells, wholeMap(1, 1, 8)).quads).toEqual([]);
        expect(emitAll("slot", [tileset], cells, wholeMap(0, 0, 8)).quads).toEqual([]);
        expect(
            emitAll("slot", [tileset], cells, { ...wholeMap(1, 1, 8), viewX: 8, viewWidth: 4 })
                .quads,
        ).toEqual([]);
    });
});

describe("GIDs and slots", () => {
    it("pick the tileset by the largest firstGid not above the GID, in any list order", () => {
        const first = tilesetOf({
            key: 1,
            tileWidth: 8,
            tileHeight: 8,
            tiles: 3,
            texture: "first",
        });
        const second = tilesetOf({
            key: 4,
            tileWidth: 8,
            tileHeight: 8,
            tiles: 2,
            texture: "second",
        });
        // GIDs 1, 3 | 4, 5 | 6 (past the second span) | 4 with H set.
        const cells = new FlatCells([1, 3, 4, 5, 6, 0x80000004], 6, 1);
        const draws = (list: EmitTileset[]) =>
            emitAll("gid", list, cells, wholeMap(6, 1, 8)).quads.map((q) => [
                q.texture,
                Math.floor(q.x / 8),
                q.u,
            ]);
        const third = Math.fround(2 / 3);
        expect(draws([first, second])).toEqual([
            ["first", 0, 0],
            ["first", 1, third],
            ["second", 2, 0],
            ["second", 3, 0.5],
            ["second", 5, 0],
        ]);
        expect(draws([second, first])).toEqual([
            ["second", 2, 0],
            ["second", 3, 0.5],
            ["second", 5, 0],
            ["first", 0, 0],
            ["first", 1, third],
        ]);
    });

    it("draw the same quads for a layer in slot values and in GIDs", () => {
        const spec = fc.record({
            sizes: fc.array(
                fc.record({
                    tw: fc.integer({ min: 1, max: 24 }),
                    th: fc.integer({ min: 1, max: 24 }),
                    tiles: fc.integer({ min: 1, max: 4 }),
                    gap: fc.integer({ min: 0, max: 3 }),
                }),
                { minLength: 1, maxLength: 4 },
            ),
            cells: fc.array(fc.tuple(fc.nat(255), fc.nat(7), fc.nat(5)), {
                minLength: 12,
                maxLength: 12,
            }),
        });
        fc.assert(
            fc.property(spec, ({ sizes, cells }) => {
                let firstGid = 1;
                const slotSets: EmitTileset[] = [];
                const gidSets: EmitTileset[] = [];
                const starts: number[] = [];
                sizes.forEach(({ tw, th, tiles, gap }, i) => {
                    const base = { tileWidth: tw, tileHeight: th, tiles, span: tiles + gap };
                    slotSets.push(tilesetOf({ ...base, key: i + 1 }));
                    gidSets.push(tilesetOf({ ...base, key: firstGid }));
                    starts.push(firstGid);
                    firstGid += tiles + gap;
                });
                const slotValues: number[] = [];
                const gidValues: number[] = [];
                for (const [pick, o, tileSeed] of cells) {
                    if (pick % 5 === 0) {
                        slotValues.push(0);
                        gidValues.push(0);
                        continue;
                    }
                    const set = pick % sizes.length;
                    const tile = tileSeed % (sizes[set]!.tiles + sizes[set]!.gap);
                    slotValues.push(cellValue(set + 1, tile, o as Orientation));
                    gidValues.push(((o << 29) | (starts[set]! + tile)) >>> 0);
                }
                const options = wholeMap(4, 3, 16, 12);
                const bySlot = emitAll("slot", slotSets, new FlatCells(slotValues, 4, 3), options);
                const byGid = emitAll("gid", gidSets, new FlatCells(gidValues, 4, 3), options);
                // Textures differ by key only; compare everything else.
                const strip = (quads: Quad[]) => quads.map((q) => ({ ...q, texture: "" }));
                expect(strip(byGid.quads)).toEqual(strip(bySlot.quads));
            }),
        );
    });
});

describe("culling", () => {
    interface Spec {
        gridWidth: number;
        gridHeight: number;
        width: number;
        height: number;
        sets: { tw: number; th: number; offX: number; offY: number }[];
        cells: (readonly [number, number] | null)[];
        view: [number, number, number, number];
        scale: number;
        translate: [number, number];
    }

    const quarter = (min: number, max: number) =>
        fc.integer({ min: min * 4, max: max * 4 }).map((n) => n / 4);

    const specs: fc.Arbitrary<Spec> = fc
        .record({
            gridWidth: fc.integer({ min: 1, max: 32 }),
            gridHeight: fc.integer({ min: 1, max: 32 }),
            width: fc.integer({ min: 1, max: 10 }),
            height: fc.integer({ min: 1, max: 10 }),
            sets: fc.array(
                fc.record({
                    tw: fc.integer({ min: 1, max: 80 }),
                    th: fc.integer({ min: 1, max: 80 }),
                    offX: fc.integer({ min: -60, max: 60 }),
                    offY: fc.integer({ min: -60, max: 60 }),
                }),
                { minLength: 1, maxLength: 3 },
            ),
            view: fc.tuple(
                quarter(-60, 400),
                quarter(-60, 400),
                quarter(0.25, 250),
                quarter(0.25, 250),
            ),
            scale: fc.integer({ min: 1, max: 4 }),
            translate: fc.tuple(quarter(-50, 50), quarter(-50, 50)),
        })
        .chain((base) =>
            fc
                .array(
                    fc.option(fc.tuple(fc.nat(base.sets.length - 1), fc.nat(7)), { nil: null }),
                    { minLength: base.width * base.height, maxLength: base.width * base.height },
                )
                .map((cells) => ({
                    ...base,
                    cells: cells.map((c) => (c === null ? null : ([c[0], c[1]] as const))),
                })),
        );

    it("never drops a tile with a pixel in the view, and keeps the order of emitting every cell", () => {
        fc.assert(
            fc.property(specs, (spec) => {
                const tilesets = spec.sets.map((s, i) =>
                    tilesetOf({
                        key: i + 1,
                        tileWidth: s.tw,
                        tileHeight: s.th,
                        offsetX: s.offX,
                        offsetY: s.offY,
                    }),
                );
                const values = spec.cells.map((c) =>
                    c === null ? 0 : cellValue(c[0] + 1, 1, c[1] as Orientation),
                );
                const cells = new FlatCells(values, spec.width, spec.height);
                const base = {
                    ...wholeMap(spec.width, spec.height, spec.gridWidth, spec.gridHeight),
                    scale: spec.scale,
                    translateX: spec.translate[0],
                    translateY: spec.translate[1],
                };
                const [viewX, viewY, viewWidth, viewHeight] = spec.view;

                const everything = emitAll("slot", tilesets, cells, base).quads;
                const culled = emitAll("slot", tilesets, cells, {
                    ...base,
                    viewX,
                    viewY,
                    viewWidth,
                    viewHeight,
                }).quads;

                // The cells in the order the emitter must produce them, and whether each has a
                // pixel in the view (the tile's content box, FORMAT §1.3).
                const order: boolean[] = [];
                spec.sets.forEach((s, setIndex) => {
                    for (let y = 0; y < spec.height; y += 1) {
                        for (let x = 0; x < spec.width; x += 1) {
                            const c = spec.cells[y * spec.width + x];
                            if (c === null || c === undefined || c[0] !== setIndex) continue;
                            const d = (c[1] & 1) === 1;
                            const boxW = d ? s.th : s.tw;
                            const boxH = d ? s.tw : s.th;
                            const left = x * spec.gridWidth + s.offX;
                            const bottom = (y + 1) * spec.gridHeight + s.offY;
                            order.push(
                                left + boxW > viewX &&
                                    left < viewX + viewWidth &&
                                    bottom > viewY &&
                                    bottom - boxH < viewY + viewHeight,
                            );
                        }
                    }
                });
                expect(everything).toHaveLength(order.length);

                const visible = everything.filter((_, i) => order[i]);
                // Every visible quad is emitted, and what is emitted is a subsequence of everything.
                let next = 0;
                for (const quad of everything) {
                    if (next < culled.length && sameQuad(quad, culled[next]!)) next += 1;
                }
                expect(next).toBe(culled.length);
                next = 0;
                for (const quad of culled) {
                    if (next < visible.length && sameQuad(quad, visible[next]!)) next += 1;
                }
                expect(next).toBe(visible.length);
                // The exact test after the cell range leaves no tile that is out of view.
                expect(culled).toEqual(visible);
            }),
            { numRuns: 400 },
        );
    });

    it("scans cells in the view only", () => {
        const tileset = tilesetOf({ key: 1, tileWidth: 16, tileHeight: 16 });
        const reads: number[] = [];
        const cells = {
            get(x: number, y: number) {
                reads.push(y * 1000 + x);
                return cellValue(1, 0);
            },
        };
        const { quads } = emitAll("slot", [tileset], cells, {
            ...wholeMap(1000, 1000, 16),
            viewX: 160,
            viewY: 320,
            viewWidth: 32,
            viewHeight: 32,
        });
        expect(quads.length).toBeGreaterThanOrEqual(4);
        // 2 × 2 cells in view; the range keeps one cell of slack per side for rounding.
        expect(reads.length).toBeLessThanOrEqual(25);
    });

    it("widens the range for tiles larger than the grid and for tile offsets", () => {
        // A 48 px tile in a 16 px grid reaches 2 cells up and right of its cell; an offset of
        // (+32, −16) moves it further.
        const tileset = tilesetOf({
            key: 1,
            tileWidth: 48,
            tileHeight: 48,
            offsetX: 32,
            offsetY: -16,
        });
        // The cell (0, 4) covers x 32..80, y (5·16 − 16 − 48)..(5·16 − 16) = 16..64.
        const cells = sparseCells({ "0,4": cellValue(1, 0) });
        const inside = { ...wholeMap(8, 8, 16), viewX: 70, viewY: 20, viewWidth: 4, viewHeight: 4 };
        expect(emitAll("slot", [tileset], cells, inside).quads).toHaveLength(1);
        const outside = { ...inside, viewX: 80 };
        expect(emitAll("slot", [tileset], cells, outside).quads).toHaveLength(0);
    });
});

describe("emit.ts source", () => {
    it("has no import statement, dynamic import or import type", () => {
        const source = ts.createSourceFile(
            "emit.ts",
            readFileSync(EMIT_SOURCE, "utf8"),
            ts.ScriptTarget.ES2022,
            true,
        );
        const found: string[] = [];
        const visit = (node: ts.Node): void => {
            if (
                ts.isImportDeclaration(node) ||
                ts.isImportEqualsDeclaration(node) ||
                ts.isImportTypeNode(node) ||
                (ts.isCallExpression(node) &&
                    node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
                (ts.isCallExpression(node) &&
                    ts.isIdentifier(node.expression) &&
                    node.expression.text === "require")
            ) {
                found.push(node.getText(source));
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        expect(found).toEqual([]);
        // The textual check the ticket names: no line starts an import.
        expect(readFileSync(EMIT_SOURCE, "utf8")).not.toMatch(/^\s*import\b/m);
    });
});

function sameQuad(a: Quad, b: Quad): boolean {
    return (
        a.x === b.x &&
        a.y === b.y &&
        a.width === b.width &&
        a.height === b.height &&
        a.rotation === b.rotation &&
        a.u === b.u &&
        a.v === b.v &&
        a.texture === b.texture
    );
}
