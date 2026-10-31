import { describe, expect, it } from "vitest";
import {
    CHECKER_BLOCK,
    checkerBlock,
    checkerBlockSize,
    checkerColourAt,
    checkerMean,
    checkerPixels,
    checkerSpec,
} from "../../src/engine/viewport/checker";

// TE-013: the checkerboard texture `ed:checker` (ENGINE §3).

const CHECKER = { a: 0x112233, b: 0xaabbcc, size: 2 };

function pixel(image: { width: number; data: Uint8ClampedArray }, x: number, y: number) {
    const at = (y * image.width + x) * 4;
    return [...image.data.slice(at, at + 4)];
}

describe("checkerPixels", () => {
    it("starts with colour a at the top-left and alternates every `size` pixels", () => {
        const image = checkerPixels(8, 8, CHECKER);
        expect(pixel(image, 0, 0)).toEqual([0x11, 0x22, 0x33, 255]);
        expect(pixel(image, 1, 1)).toEqual([0x11, 0x22, 0x33, 255]);
        expect(pixel(image, 2, 0)).toEqual([0xaa, 0xbb, 0xcc, 255]);
        expect(pixel(image, 0, 2)).toEqual([0xaa, 0xbb, 0xcc, 255]);
        expect(pixel(image, 2, 2)).toEqual([0x11, 0x22, 0x33, 255]);
    });

    it("rejects sizes that are not positive integers", () => {
        expect(() => checkerPixels(0, 4, CHECKER)).toThrow(RangeError);
        expect(() => checkerPixels(4, 4, { ...CHECKER, size: 0 })).toThrow(RangeError);
        expect(() => checkerPixels(4.5, 4, CHECKER)).toThrow(RangeError);
    });
});

describe("checker block", () => {
    it("is CHECKER_BLOCK squares a side, and its squares match checkerColourAt", () => {
        const image = checkerBlock(CHECKER);
        expect(image.width).toBe(CHECKER_BLOCK * CHECKER.size);
        expect(image.width).toBe(checkerBlockSize(CHECKER));
        for (const [x, y] of [
            [0, 0],
            [3, 1],
            [5, 9],
            [31, 31],
            [16, 17],
        ] as const) {
            const colour = checkerColourAt(CHECKER, x, y);
            expect(pixel(image, x, y)).toEqual([
                (colour >>> 16) & 255,
                (colour >>> 8) & 255,
                colour & 255,
                255,
            ]);
        }
    });

    it("tiles seamlessly: a block holds an even number of squares", () => {
        expect(CHECKER_BLOCK % 2).toBe(0);
        const size = checkerBlockSize(CHECKER);
        expect(checkerColourAt(CHECKER, size, 0)).toBe(checkerColourAt(CHECKER, 0, 0));
        expect(checkerColourAt(CHECKER, 0, size)).toBe(checkerColourAt(CHECKER, 0, 0));
    });
});

describe("checkerColourAt", () => {
    it("extends the pattern to negative pixels", () => {
        expect(checkerColourAt(CHECKER, -1, 0)).toBe(CHECKER.b);
        expect(checkerColourAt(CHECKER, -3, 0)).toBe(CHECKER.a);
        expect(checkerColourAt(CHECKER, -1, -1)).toBe(CHECKER.a);
    });
});

describe("checkerSpec and checkerMean", () => {
    it("tells two checkers apart by colours and size", () => {
        expect(checkerSpec(CHECKER)).toBe(checkerSpec({ ...CHECKER }));
        expect(checkerSpec(CHECKER)).not.toBe(checkerSpec({ ...CHECKER, size: 4 }));
        expect(checkerSpec(CHECKER)).not.toBe(checkerSpec({ ...CHECKER, b: 0xaabbcd }));
    });

    it("averages the two colours per channel", () => {
        expect(checkerMean({ a: 0x000000, b: 0xfefefe, size: 1 })).toBe(0x7f7f7f);
        expect(checkerMean({ a: 0x102030, b: 0x302010, size: 1 })).toBe(0x202020);
    });
});
