import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
    ORIENTATION,
    cellOrientation,
    cellValue,
    transformCell,
    transformStamp,
} from "../../src/core/cells";
import type { Orientation, Stamp, StampTransform } from "../../src/core/cells";

// Stamp transforms (SPEC §2.3): positions move with the stamp, each cell's flags compose.

const cell = fc.oneof(
    fc.constant(0),
    fc
        .tuple(
            fc.integer({ min: 1, max: 255 }),
            fc.integer({ min: 0, max: 0xfffff }),
            fc.integer({ min: 0, max: 7 }),
        )
        .map(([slot, tileId, o]) => cellValue(slot, tileId, o as Orientation)),
);

const stamp: fc.Arbitrary<Stamp> = fc
    .tuple(fc.integer({ min: 1, max: 9 }), fc.integer({ min: 1, max: 9 }))
    .chain(([width, height]) =>
        fc
            .array(cell, { minLength: width * height, maxLength: width * height })
            .map((cells) => ({ width, height, cells: Uint32Array.from(cells) })),
    );

function apply(s: Stamp, transforms: StampTransform[]): Stamp {
    return transforms.reduce(transformStamp, s);
}

function plain(s: Stamp) {
    return { width: s.width, height: s.height, cells: [...s.cells] };
}

describe("stamp transforms", () => {
    it("is the identity after four rotations right or left", () => {
        fc.assert(
            fc.property(stamp, (s) => {
                expect(plain(apply(s, Array(4).fill("rotateRight")))).toEqual(plain(s));
                expect(plain(apply(s, Array(4).fill("rotateLeft")))).toEqual(plain(s));
            }),
        );
    });

    it("is the identity after two flips", () => {
        fc.assert(
            fc.property(stamp, (s) => {
                expect(plain(apply(s, ["flipH", "flipH"]))).toEqual(plain(s));
                expect(plain(apply(s, ["flipV", "flipV"]))).toEqual(plain(s));
            }),
        );
    });

    it("is the identity after rotate right then left", () => {
        fc.assert(
            fc.property(stamp, (s) => {
                expect(plain(apply(s, ["rotateRight", "rotateLeft"]))).toEqual(plain(s));
                expect(plain(apply(s, ["rotateLeft", "rotateRight"]))).toEqual(plain(s));
            }),
        );
    });

    it("turns a w × h stamp into h × w and keeps its size under flips", () => {
        fc.assert(
            fc.property(stamp, (s) => {
                for (const t of ["rotateRight", "rotateLeft"] as const) {
                    const r = transformStamp(s, t);
                    expect([r.width, r.height, r.cells.length]).toEqual([
                        s.height,
                        s.width,
                        s.cells.length,
                    ]);
                }
                for (const t of ["flipH", "flipV"] as const) {
                    const r = transformStamp(s, t);
                    expect([r.width, r.height]).toEqual([s.width, s.height]);
                }
            }),
        );
    });

    it("moves cells and composes their flags as Tiled does", () => {
        // 3 × 2:  a b c
        //         d e f
        const [a, b, c, d, e, f] = [1, 2, 3, 4, 5, 6].map((id) => cellValue(1, id));
        const s: Stamp = { width: 3, height: 2, cells: Uint32Array.from([a!, b!, c!, d!, e!, f!]) };
        const r = (v: number) => transformCell(v, "rotateRight");
        // Clockwise: the left column becomes the top row.
        expect(plain(transformStamp(s, "rotateRight"))).toEqual({
            width: 2,
            height: 3,
            cells: [r(d!), r(a!), r(e!), r(b!), r(f!), r(c!)],
        });
        expect(cellOrientation(r(a!))).toBe(ORIENTATION.rotatedRight);
        const h = (v: number) => transformCell(v, "flipH");
        expect([...transformStamp(s, "flipH").cells]).toEqual([c, b, a, f, e, d].map((v) => h(v!)));
        const v = (x: number) => transformCell(x, "flipV");
        expect([...transformStamp(s, "flipV").cells]).toEqual([d, e, f, a, b, c].map((x) => v(x!)));
    });

    it("flips a rotated cell by toggling H or V only", () => {
        const turned = cellValue(4, 9, ORIENTATION.rotatedRight);
        expect(cellOrientation(transformCell(turned, "flipH"))).toBe(0b001);
        expect(cellOrientation(transformCell(turned, "flipV"))).toBe(0b111);
        expect(transformCell(0, "rotateLeft")).toBe(0);
        expect(() => cellValue(1, 0, 8 as Orientation)).toThrow(RangeError);
    });

    it("rejects a stamp whose cells do not fill its rectangle", () => {
        expect(() =>
            transformStamp({ width: 2, height: 2, cells: new Uint32Array(3) }, "flipH"),
        ).toThrow(RangeError);
    });
});
