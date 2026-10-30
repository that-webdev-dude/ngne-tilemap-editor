import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    CellConversionError,
    CellStore,
    FLIP_H,
    GID_MASK,
    MAX_TILE_ID,
    RESERVED_BIT,
    assignFirstGids,
    cellValue,
    cellsToGids,
    createGidTable,
    gidToValue,
    gidsToCells,
    isCellValue,
    valueToGid,
} from "../../src/core/cells";
import type { GidTable, Orientation } from "../../src/core/cells";

// In-memory values ↔ GIDs with a map's firstGid table (SPEC §2.2, FORMAT §1.2).

const tilesetList = fc.uniqueArray(
    fc.record({
        slot: fc.integer({ min: 1, max: 255 }),
        nextTileId: fc.oneof(
            fc.integer({ min: 1, max: 64 }),
            fc.integer({ min: 1, max: MAX_TILE_ID + 1 }),
        ),
    }),
    { minLength: 1, maxLength: 40, selector: (t) => t.slot },
);

/** A writer's table, or a reader's with gaps between the spans, entries in any order. */
const table: fc.Arbitrary<GidTable> = fc.oneof(
    tilesetList.map(assignFirstGids),
    fc
        .tuple(
            tilesetList,
            fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 40, maxLength: 40 }),
        )
        .map(([tilesets, gaps]) => {
            let firstGid = 1;
            const entries = tilesets.map(({ slot, nextTileId }, i) => {
                firstGid += gaps[i]!;
                const entry = { slot, firstGid, nextTileId };
                firstGid += nextTileId;
                return entry;
            });
            return createGidTable(entries.reverse());
        }),
);

const orientation = fc.integer({ min: 0, max: 7 }) as fc.Arbitrary<Orientation>;

/** A valid value of `t`: empty, or a tile inside some span in any orientation. */
function valueOf(t: GidTable): fc.Arbitrary<number> {
    const tile = fc
        .integer({ min: 0, max: t.entries.length - 1 })
        .chain((i) =>
            fc.tuple(
                fc.constant(t.entries[i]!),
                fc.integer({ min: 0, max: t.entries[i]!.nextTileId - 1 }),
                orientation,
            ),
        )
        .map(([entry, tileId, o]) => cellValue(entry.slot, tileId, o));
    return fc.oneof({ weight: 1, arbitrary: fc.constant(0) }, { weight: 9, arbitrary: tile });
}

const tableAndValues = table.chain((t) =>
    fc.tuple(fc.constant(t), fc.array(valueOf(t), { minLength: 1, maxLength: 200 })),
);

describe("GID conversion", () => {
    it("round-trips every valid value through its GID", () => {
        fc.assert(
            fc.property(tableAndValues, ([t, values]) => {
                for (const value of values) {
                    expect(isCellValue(value)).toBe(true);
                    const gid = valueToGid(value, t);
                    expect(gid & RESERVED_BIT).toBe(0);
                    expect(gid === 0).toBe(value === 0);
                    expect(gidToValue(gid, t)).toBe(value);
                }
            }),
        );
    });

    it("keeps empty as 0 both ways", () => {
        fc.assert(
            fc.property(table, (t) => {
                expect(valueToGid(0, t)).toBe(0);
                expect(gidToValue(0, t)).toBe(0);
            }),
        );
    });

    it("round-trips a layer and never sets bit 28", () => {
        fc.assert(
            fc.property(
                tableAndValues,
                fc.integer({ min: 1, max: 70 }),
                fc.integer({ min: 1, max: 70 }),
                ([t, values], width, height) => {
                    const store = new CellStore();
                    values.forEach((value, i) => {
                        const cell = (i * 7919) % (width * height);
                        store.set(cell % width, Math.floor(cell / width), value);
                    });
                    const data = cellsToGids(store, width, height, t);
                    expect(data.length).toBe(width * height);
                    expect(data.every((cell) => (cell & RESERVED_BIT) === 0)).toBe(true);
                    const back = gidsToCells(data, width, height, t);
                    expect(back.count).toBe(store.count);
                    for (let y = 0; y < height; y += 1) {
                        for (let x = 0; x < width; x += 1) {
                            expect(back.get(x, y)).toBe(store.get(x, y));
                            expect(data[y * width + x] === 0).toBe(store.get(x, y) === 0);
                        }
                    }
                },
            ),
        );
    });

    it("assigns firstGids from 1, each span where the previous ends", () => {
        const t = assignFirstGids([
            { slot: 9, nextTileId: 4 },
            { slot: 2, nextTileId: 10 },
            { slot: 200, nextTileId: 1 },
        ]);
        expect(t.entries).toEqual([
            { slot: 9, firstGid: 1, nextTileId: 4 },
            { slot: 2, firstGid: 5, nextTileId: 10 },
            { slot: 200, firstGid: 15, nextTileId: 1 },
        ]);
        expect(valueToGid(cellValue(2, 3, 0b101), t)).toBe((0xa0000000 | 8) >>> 0);
        expect(gidToValue(15, t)).toBe(cellValue(200, 0));
    });

    it("round-trips at the top of the GID range", () => {
        const top = createGidTable([{ slot: 255, firstGid: GID_MASK, nextTileId: 1 }]);
        const full = assignFirstGids(
            Array.from({ length: 255 }, (_, i) => ({ slot: i + 1, nextTileId: MAX_TILE_ID + 1 })),
        );
        expect(full.entries.at(-1)!.firstGid + MAX_TILE_ID).toBeLessThanOrEqual(GID_MASK);
        for (let o = 0; o < 8; o += 1) {
            const cases: [GidTable, number][] = [
                [top, cellValue(255, 0, o as Orientation)],
                [full, cellValue(255, MAX_TILE_ID, o as Orientation)],
                [full, cellValue(1, 0, o as Orientation)],
            ];
            for (const [t, value] of cases) {
                const gid = valueToGid(value, t);
                expect(gid & RESERVED_BIT).toBe(0);
                expect(gidToValue(gid, t)).toBe(value);
            }
            expect(valueToGid(cellValue(255, 0, o as Orientation), top) & GID_MASK).toBe(GID_MASK);
        }
    });

    it("rejects values and GIDs outside the table", () => {
        const t = createGidTable([
            { slot: 1, firstGid: 1, nextTileId: 4 },
            { slot: 3, firstGid: 10, nextTileId: 2 },
        ]);
        const rejects = (convert: () => number) => expect(convert).toThrow(CellConversionError);
        rejects(() => valueToGid(cellValue(2, 0), t)); // slot not listed
        rejects(() => valueToGid(cellValue(1, 4), t)); // past nextTileId
        rejects(() => valueToGid((cellValue(1, 0) | RESERVED_BIT) >>> 0, t));
        rejects(() => valueToGid(FLIP_H, t)); // flags on slot 0
        rejects(() => gidToValue(5, t)); // gap between spans
        rejects(() => gidToValue(12, t)); // past the last span
        rejects(() => gidToValue((1 | RESERVED_BIT) >>> 0, t));
        rejects(() => gidToValue(FLIP_H, t)); // flags on GID 0
        rejects(() => gidToValue(2 ** 32 + 1, t)); // not 32-bit
        rejects(() => gidToValue(1.5, t));
        rejects(() => gidToValue(-1, t));
    });

    it("rejects malformed tables", () => {
        const rejects = (entries: Parameters<typeof createGidTable>[0]) =>
            expect(() => createGidTable(entries)).toThrow(CellConversionError);
        rejects([{ slot: 0, firstGid: 1, nextTileId: 1 }]);
        rejects([{ slot: 256, firstGid: 1, nextTileId: 1 }]);
        rejects([{ slot: 1, firstGid: 0, nextTileId: 1 }]);
        rejects([{ slot: 1, firstGid: 1, nextTileId: 0 }]);
        rejects([{ slot: 1, firstGid: 1, nextTileId: MAX_TILE_ID + 2 }]);
        rejects([{ slot: 1, firstGid: GID_MASK, nextTileId: 2 }]);
        rejects([
            { slot: 1, firstGid: 1, nextTileId: 4 },
            { slot: 2, firstGid: 4, nextTileId: 1 },
        ]);
        rejects([
            { slot: 1, firstGid: 1, nextTileId: 1 },
            { slot: 1, firstGid: 2, nextTileId: 1 },
        ]);
    });

    it("rejects a layer of the wrong length or with cells outside it", () => {
        const t = assignFirstGids([{ slot: 1, nextTileId: 1 }]);
        expect(() => gidsToCells([0, 0, 0], 2, 2, t)).toThrow(CellConversionError);
        expect(() => gidsToCells([1], -1, -1, t)).toThrow(CellConversionError);
        expect(() => cellsToGids(new CellStore(), 1.5, 2, t)).toThrow(CellConversionError);
        const store = new CellStore();
        store.set(2, 0, cellValue(1, 0));
        expect(() => cellsToGids(store, 2, 2, t)).toThrow(CellConversionError);
    });
});
