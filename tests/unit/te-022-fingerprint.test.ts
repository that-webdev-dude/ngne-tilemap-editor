import { describe, expect, it } from "vitest";
import { sha256Hex, tileFingerprint } from "../../src/core/tileset";
import { referenceSha256 } from "./te-022-support";

// TE-022: tile fingerprints (FORMAT §2.4) are SHA-256 over the tile's RGBA bytes, rows top to
// bottom, every pixel with alpha 0 as 0, 0, 0, 0; computed in `core/` without DOM globals.

describe("sha256Hex", () => {
    it("matches the FIPS 180-4 example and Node's SHA-256 across block boundaries", () => {
        const abc = new TextEncoder().encode("abc");
        expect(sha256Hex(abc)).toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        let seed = 12345;
        for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 65_537]) {
            const bytes = new Uint8Array(length).map(() => {
                seed = (seed * 1_103_515_245 + 12_345) >>> 0;
                return seed >>> 24;
            });
            expect(sha256Hex(bytes), `length ${length}`).toBe(referenceSha256(bytes));
        }
    });
});

describe("tileFingerprint", () => {
    /** A 4 × 2 image: the tile at (1, 0) of 2 × 2 has one transparent pixel with colour. */
    const image = {
        width: 4,
        height: 2,
        data: new Uint8ClampedArray([
            9, 9, 9, 9, 10, 20, 30, 255, 200, 100, 50, 0, 1, 1, 1, 1, 9, 9, 9, 9, 40, 50, 60, 128,
            70, 80, 90, 255, 2, 2, 2, 2,
        ]),
    };
    const zeroed = new Uint8Array([10, 20, 30, 255, 0, 0, 0, 0, 40, 50, 60, 128, 70, 80, 90, 255]);

    it("hashes the tile's rows with alpha-0 pixels as zeros, against a reference SHA-256", () => {
        expect(tileFingerprint(image, 1, 0, 2, 2)).toBe(referenceSha256(zeroed));
        expect(tileFingerprint(image, 1, 0, 2, 2)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("ignores RGB under alpha 0 and nothing else", () => {
        const other = { ...image, data: Uint8ClampedArray.from(image.data) };
        other.data.set([1, 2, 3], 8);
        expect(tileFingerprint(other, 1, 0, 2, 2)).toBe(tileFingerprint(image, 1, 0, 2, 2));
        other.data[11] = 1;
        expect(tileFingerprint(other, 1, 0, 2, 2)).not.toBe(tileFingerprint(image, 1, 0, 2, 2));
    });

    it("leaves the source pixels as they are", () => {
        const before = Uint8ClampedArray.from(image.data);
        tileFingerprint(image, 1, 0, 2, 2, new Uint8Array(16));
        expect(image.data).toEqual(before);
    });
});
