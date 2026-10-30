import { describe, expect, it } from "vitest";
import {
    ORIENTATION,
    ROTATE_LEFT_MASK,
    ROTATE_RIGHT_MASK,
    compose,
    flipH,
    flipV,
    matrixOrientation,
    multiply,
    orientationMatrix,
    rotateLeft,
    rotateRight,
} from "../../src/core/cells";
import type { Matrix2, Orientation } from "../../src/core/cells";

// The orientation algebra (SPEC §2.3) against Tiled's rotate tables and FORMAT §1.2.

const ALL = [0, 1, 2, 3, 4, 5, 6, 7] as const satisfies readonly Orientation[];

/** Tiled's tables, `src/libtiled/tilelayer.cpp` at tag `v1.12.2`, copied independently. */
const TILED_ROTATE_RIGHT = [5, 4, 1, 0, 7, 6, 3, 2];
const TILED_ROTATE_LEFT = [3, 2, 7, 6, 1, 0, 5, 4];

/** Tiled's operations on the 3-bit index `H<<2 | V<<1 | D`: `flip()` toggles H or V. */
const TILED_OPS: Record<string, (o: number) => number> = {
    flipH: (o) => o ^ 4,
    flipV: (o) => o ^ 2,
    rotateRight: (o) => TILED_ROTATE_RIGHT[o]!,
    rotateLeft: (o) => TILED_ROTATE_LEFT[o]!,
};

/** Quarter turns on screen, axes right and down: clockwise `(a, b) → (−b, a)`. */
const TURN_RIGHT: Matrix2 = [0, -1, 1, 0];
const TURN_LEFT: Matrix2 = [0, 1, -1, 0];

/** FORMAT §1.2, column "Texel at tile offset (a, b) from the centre lands at", by `H V D`. */
const FORMAT_TABLE: [string, Matrix2][] = [
    ["000", [1, 0, 0, 1]], // ( a,  b)
    ["100", [-1, 0, 0, 1]], // (−a,  b)
    ["010", [1, 0, 0, -1]], // ( a, −b)
    ["110", [-1, 0, 0, -1]], // (−a, −b)
    ["101", [0, -1, 1, 0]], // (−b,  a)
    ["011", [0, 1, -1, 0]], // ( b, −a)
    ["001", [0, 1, 1, 0]], // ( b,  a)
    ["111", [0, -1, -1, 0]], // (−b, −a)
];

/** A shortest sequence of Tiled operations taking the identity to each orientation. */
function tiledWords(): string[][] {
    const words: (string[] | undefined)[] = [[]];
    const queue = [0];
    while (queue.length > 0) {
        const o = queue.shift()!;
        for (const [name, op] of Object.entries(TILED_OPS)) {
            const next = op(o);
            if (words[next] === undefined) {
                words[next] = [...words[o]!, name];
                queue.push(next);
            }
        }
    }
    return ALL.map((o) => words[o]!);
}

describe("orientation algebra", () => {
    it("holds Tiled's rotate tables", () => {
        expect(ROTATE_RIGHT_MASK).toEqual(TILED_ROTATE_RIGHT);
        expect(ROTATE_LEFT_MASK).toEqual(TILED_ROTATE_LEFT);
    });

    it("matches every rotate table entry with the matrix product", () => {
        for (const o of ALL) {
            const m = orientationMatrix(o);
            expect(matrixOrientation(multiply(TURN_RIGHT, m)), `right ${o}`).toBe(
                TILED_ROTATE_RIGHT[o],
            );
            expect(matrixOrientation(multiply(TURN_LEFT, m)), `left ${o}`).toBe(
                TILED_ROTATE_LEFT[o],
            );
            expect(rotateRight(o)).toBe(TILED_ROTATE_RIGHT[o]);
            expect(rotateLeft(o)).toBe(TILED_ROTATE_LEFT[o]);
        }
    });

    it("agrees with Tiled's tables on all 64 compositions", () => {
        const words = tiledWords();
        let checked = 0;
        for (const first of ALL) {
            for (const then of ALL) {
                const tiled = words[then]!.reduce(
                    (o, name) => TILED_OPS[name]!(o),
                    first as number,
                );
                expect(compose(first, then), `${first} then ${then}`).toBe(tiled);
                checked += 1;
            }
        }
        expect(checked).toBe(64);
    });

    it("composes as the matrix product", () => {
        for (const first of ALL) {
            for (const then of ALL) {
                expect(orientationMatrix(compose(first, then))).toEqual(
                    multiply(orientationMatrix(then), orientationMatrix(first)),
                );
            }
        }
    });

    it("equals FORMAT §1.2: anti-diagonal, then H, then V", () => {
        const swap: Matrix2 = [0, 1, 1, 0];
        const mirrorH: Matrix2 = [-1, 0, 0, 1];
        const mirrorV: Matrix2 = [1, 0, 0, -1];
        for (const [bits, lands] of FORMAT_TABLE) {
            const [h, v, d] = [...bits].map((bit) => bit === "1");
            let m: Matrix2 = d ? swap : [1, 0, 0, 1];
            if (h) m = multiply(mirrorH, m);
            if (v) m = multiply(mirrorV, m);
            expect(m, bits).toEqual(lands);
            const o = Number.parseInt(bits, 2) as Orientation;
            expect(orientationMatrix(o), bits).toEqual(lands);
            expect(matrixOrientation(lands), bits).toBe(o);
        }
    });

    it("names the rows of FORMAT §1.2", () => {
        expect(ORIENTATION).toEqual({
            asDrawn: 0b000,
            flippedH: 0b100,
            flippedV: 0b010,
            rotated180: 0b110,
            rotatedRight: 0b101,
            rotatedLeft: 0b011,
            mainDiagonal: 0b001,
            antiDiagonal: 0b111,
        });
        expect(rotateRight(ORIENTATION.asDrawn)).toBe(ORIENTATION.rotatedRight);
    });

    it("flips by toggling H or V and leaves D alone", () => {
        for (const o of ALL) {
            expect(flipH(o)).toBe(o ^ 4);
            expect(flipV(o)).toBe(o ^ 2);
            expect(flipH(o) & 1).toBe(o & 1);
            expect(flipV(o) & 1).toBe(o & 1);
        }
    });

    it("rejects a matrix that is no orientation", () => {
        expect(matrixOrientation([2, 0, 0, 1])).toBeNull();
        expect(matrixOrientation([1, 1, 0, 1])).toBeNull();
    });
});
