import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    CHUNK_SIZE,
    CellStore,
    FLIP_H,
    MAX_COORD,
    RESERVED_BIT,
    cellValue,
} from "../../src/core/cells";
import type { Orientation } from "../../src/core/cells";
import type { CellRect } from "../../src/core/cells";

// The chunked cell store (SPEC §2.2) against a brute-force map of cells.

const coord = fc.integer({ min: -100, max: 100 });
const value = fc.oneof(
    fc.constant(0),
    fc
        .tuple(
            fc.integer({ min: 1, max: 255 }),
            fc.integer({ min: 0, max: 0xfffff }),
            fc.integer({ min: 0, max: 7 }),
        )
        .map(([slot, tileId, o]) => cellValue(slot, tileId, o as Orientation)),
);
const op = fc.record({ x: coord, y: coord, value });
const rect = fc.record({
    x: coord,
    y: coord,
    width: fc.integer({ min: -4, max: 240 }),
    height: fc.integer({ min: -4, max: 240 }),
});

type Model = Map<string, number>;

function apply(ops: { x: number; y: number; value: number }[]): [CellStore, Model] {
    const store = new CellStore();
    const model: Model = new Map();
    for (const { x, y, value } of ops) {
        const previous = model.get(`${x},${y}`) ?? 0;
        expect(store.set(x, y, value)).toBe(previous);
        if (value === 0) model.delete(`${x},${y}`);
        else model.set(`${x},${y}`, value);
    }
    return [store, model];
}

function cellsOf(model: Model): { x: number; y: number; value: number }[] {
    return [...model].map(([k, value]) => {
        const [x, y] = k.split(",").map(Number) as [number, number];
        return { x, y, value };
    });
}

function inside(r: CellRect, x: number, y: number): boolean {
    return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

const EVERYWHERE: CellRect = {
    x: -MAX_COORD,
    y: -MAX_COORD,
    width: 2 * MAX_COORD,
    height: 2 * MAX_COORD,
};

describe("cell store", () => {
    it("returns after get what set stored", () => {
        fc.assert(
            fc.property(
                fc.array(op, { maxLength: 300 }),
                fc.array(fc.tuple(coord, coord)),
                (ops, probes) => {
                    const [store, model] = apply(ops);
                    for (const { x, y, value } of cellsOf(model))
                        expect(store.get(x, y)).toBe(value);
                    for (const [x, y] of probes)
                        expect(store.get(x, y)).toBe(model.get(`${x},${y}`) ?? 0);
                },
            ),
        );
    });

    it("keeps chunk counts equal to a brute-force count", () => {
        fc.assert(
            fc.property(fc.array(op, { maxLength: 300 }), (ops) => {
                const [store, model] = apply(ops);
                const brute = new Map<string, number>();
                for (const { x, y } of cellsOf(model)) {
                    const k = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)}`;
                    brute.set(k, (brute.get(k) ?? 0) + 1);
                }
                const counted = new Map<string, number>();
                for (const chunk of store.chunksIn(EVERYWHERE)) {
                    let nonEmpty = 0;
                    for (const cell of chunk.cells) if (cell !== 0) nonEmpty += 1;
                    expect(chunk.count).toBe(nonEmpty);
                    counted.set(`${chunk.cx},${chunk.cy}`, chunk.count);
                }
                expect(counted).toEqual(brute);
                expect(store.chunkCount).toBe(brute.size);
                expect(store.count).toBe(model.size);
            }),
        );
    });

    it("never bounds a rectangle below its true non-empty count", () => {
        fc.assert(
            fc.property(fc.array(op, { maxLength: 300 }), rect, (ops, r) => {
                const [store, model] = apply(ops);
                const exact = cellsOf(model).filter(({ x, y }) => inside(r, x, y)).length;
                expect(store.countUpperBound(r)).toBeGreaterThanOrEqual(exact);
            }),
        );
    });

    it("visits exactly the allocated chunks a rectangle touches", () => {
        fc.assert(
            fc.property(fc.array(op, { maxLength: 300 }), rect, (ops, r) => {
                const [store] = apply(ops);
                const touched = (cx: number, cy: number) =>
                    r.width > 0 &&
                    r.height > 0 &&
                    cx * CHUNK_SIZE < r.x + r.width &&
                    (cx + 1) * CHUNK_SIZE > r.x &&
                    cy * CHUNK_SIZE < r.y + r.height &&
                    (cy + 1) * CHUNK_SIZE > r.y;
                const expected = [...store.chunksIn(EVERYWHERE)]
                    .filter((chunk) => touched(chunk.cx, chunk.cy))
                    .map((chunk) => `${chunk.cx},${chunk.cy}`)
                    .sort();
                const visited = [...store.chunksIn(r)].map((chunk) => `${chunk.cx},${chunk.cy}`);
                expect(visited.sort()).toEqual(expected);
            }),
        );
    });

    it("clears a rectangle and nothing else", () => {
        fc.assert(
            fc.property(fc.array(op, { maxLength: 300 }), rect, (ops, r) => {
                const [store, model] = apply(ops);
                store.clear(r);
                const kept = cellsOf(model).filter(({ x, y }) => !inside(r, x, y));
                for (const { x, y, value } of cellsOf(model)) {
                    expect(store.get(x, y)).toBe(inside(r, x, y) ? 0 : value);
                }
                expect(store.count).toBe(kept.length);
                let total = 0;
                for (const chunk of store.chunksIn(EVERYWHERE)) {
                    expect(chunk.count).toBeGreaterThan(0);
                    total += chunk.count;
                }
                expect(total).toBe(kept.length);
            }),
        );
    });

    it("clears everything", () => {
        const store = new CellStore();
        store.set(-1, -1, cellValue(1, 7));
        store.set(40, 3, cellValue(1, 9));
        store.clear();
        expect([store.count, store.chunkCount, store.get(-1, -1), store.get(40, 3)]).toEqual([
            0, 0, 0, 0,
        ]);
    });

    it("allocates a chunk on its first cell and releases it with its last", () => {
        const store = new CellStore();
        expect(store.set(5, 5, 0)).toBe(0);
        expect(store.chunkCount).toBe(0);
        store.set(5, 5, cellValue(1, 1));
        store.set(6, 5, cellValue(1, 2));
        expect(store.chunkCount).toBe(1);
        store.set(5, 5, 0);
        expect(store.chunkCount).toBe(1);
        store.set(6, 5, 0);
        expect(store.chunkCount).toBe(0);
    });

    it("places negative and extreme coordinates in their own chunks", () => {
        const store = new CellStore();
        const corners: [number, number][] = [
            [-MAX_COORD, -MAX_COORD],
            [MAX_COORD - 1, -MAX_COORD],
            [-MAX_COORD, MAX_COORD - 1],
            [MAX_COORD - 1, MAX_COORD - 1],
            [-1, 0],
            [0, -1],
        ];
        corners.forEach(([x, y], i) => store.set(x, y, cellValue(1, i + 1)));
        corners.forEach(([x, y], i) => expect(store.get(x, y)).toBe(cellValue(1, i + 1)));
        expect(store.chunkCount).toBe(corners.length);
        expect(store.countUpperBound({ x: -32, y: -32, width: 64, height: 64 })).toBe(2);
    });

    it("rejects coordinates and values out of range", () => {
        const store = new CellStore();
        expect(() => store.get(MAX_COORD, 0)).toThrow(RangeError);
        expect(() => store.set(0, -MAX_COORD - 1, 1)).toThrow(RangeError);
        expect(() => store.set(0.5, 0, 1)).toThrow(RangeError);
        expect(() => store.set(0, 0, -1)).toThrow(RangeError);
        expect(() => store.set(0, 0, 2 ** 32)).toThrow(RangeError);
        expect(() => store.set(0, 0, FLIP_H)).toThrow(RangeError); // flags on an empty cell
        expect(() => store.set(0, 0, 5)).toThrow(RangeError); // slot 0
        expect(() => store.set(0, 0, (cellValue(1, 0) | RESERVED_BIT) >>> 0)).toThrow(RangeError);
        expect(() => store.countUpperBound({ x: 0, y: 0, width: 1.5, height: 1 })).toThrow(
            RangeError,
        );
    });
});
