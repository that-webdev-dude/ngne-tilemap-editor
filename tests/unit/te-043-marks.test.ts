import { describe, expect, it } from "vitest";
import { markBox, markCentre } from "../../src/app/terrains/terrainMarks";
import type { MarkBox } from "../../src/app/terrains/terrainMarks";

// TE-043: where the Terrains panel draws terrain marks (DESIGN §8.6), checked against positions
// written out by hand, so the E2E readback (which samples at `markCentre`) cannot pass with a
// wrong mapping from index to place; and no two marks of a tile meet at any drawn size.

/** A bar's box with its 1 px halo. */
function drawn(box: MarkBox): MarkBox {
    return box.kind === "edge"
        ? { ...box, x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 }
        : box;
}

function overlap(a: MarkBox, b: MarkBox): boolean {
    return (
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    );
}

describe("mark boxes", () => {
    it("a 32 px tile at (1, 1): corners in their corners, edges at their middles", () => {
        const at = (index: number) => markBox(index, 1, 1, 32, 32);
        expect(at(7)).toEqual({ x: 2, y: 2, width: 8, height: 8, kind: "corner" });
        expect(at(1)).toEqual({ x: 24, y: 2, width: 8, height: 8, kind: "corner" });
        expect(at(3)).toEqual({ x: 24, y: 24, width: 8, height: 8, kind: "corner" });
        expect(at(5)).toEqual({ x: 2, y: 24, width: 8, height: 8, kind: "corner" });
        expect(at(0)).toEqual({ x: 13, y: 2, width: 8, height: 4, kind: "edge" });
        expect(at(2)).toEqual({ x: 28, y: 13, width: 4, height: 8, kind: "edge" });
        expect(at(4)).toEqual({ x: 13, y: 28, width: 8, height: 4, kind: "edge" });
        expect(at(6)).toEqual({ x: 2, y: 13, width: 4, height: 8, kind: "edge" });
        expect(markCentre(at(7))).toEqual({ x: 6, y: 6 });
        expect(markCentre(at(2))).toEqual({ x: 30, y: 17 });
    });

    it("no two marks of a tile meet, halos included, from 9 to 64 px a side", () => {
        for (let width = 9; width <= 64; width++) {
            for (const height of [9, 12, 16, 24, 32, 48, 64]) {
                const boxes = [0, 1, 2, 3, 4, 5, 6, 7].map((index) =>
                    drawn(markBox(index, 0, 0, width, height)),
                );
                for (const box of boxes) {
                    expect(box.width).toBeGreaterThan(0);
                    expect(box.x).toBeGreaterThanOrEqual(0);
                    expect(box.y).toBeGreaterThanOrEqual(0);
                    expect(box.x + box.width).toBeLessThanOrEqual(width);
                    expect(box.y + box.height).toBeLessThanOrEqual(height);
                }
                for (let a = 0; a < 8; a++) {
                    for (let b = a + 1; b < 8; b++) {
                        expect(
                            overlap(boxes[a]!, boxes[b]!),
                            `${width}×${height}: ${a}, ${b}`,
                        ).toBe(false);
                    }
                }
            }
        }
    });
});
