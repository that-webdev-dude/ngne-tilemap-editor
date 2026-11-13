import { describe, expect, it } from "vitest";
import { pointsOnLine } from "../../src/core/raster/line";

// TE-016: `pointsOnLine` gives the cells Tiled v1.12.2 joins a drag with: the classic Bresenham
// line. The expected cells below are worked by hand from that algorithm: walk the major axis
// from the end with the smaller coordinate, start the error at half the major length, step the
// minor axis when the error drops below zero, and reverse the result of a reversed line.

type Cells = [number, number][];

const cells = (from: [number, number], to: [number, number], manhattan = false): Cells =>
    pointsOnLine({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, manhattan).map((point) => [
        point.x,
        point.y,
    ]);

const TABLE: { name: string; from: [number, number]; to: [number, number]; expected: Cells }[] = [
    { name: "a single cell", from: [5, 5], to: [5, 5], expected: [[5, 5]] },
    {
        name: "horizontal",
        from: [0, 2],
        to: [3, 2],
        expected: [
            [0, 2],
            [1, 2],
            [2, 2],
            [3, 2],
        ],
    },
    {
        name: "vertical",
        from: [0, 0],
        to: [0, 2],
        expected: [
            [0, 0],
            [0, 1],
            [0, 2],
        ],
    },
    {
        name: "diagonal",
        from: [0, 0],
        to: [3, 3],
        expected: [
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3],
        ],
    },
    {
        // Zingl's all-octant form steps diagonally first here, to (1, 1); Tiled does not.
        name: "shallow, the tie Tiled breaks along x",
        from: [0, 0],
        to: [2, 1],
        expected: [
            [0, 0],
            [1, 0],
            [2, 1],
        ],
    },
    {
        name: "shallow",
        from: [0, 0],
        to: [5, 2],
        expected: [
            [0, 0],
            [1, 0],
            [2, 1],
            [3, 1],
            [4, 2],
            [5, 2],
        ],
    },
    {
        name: "shallow, upwards",
        from: [0, 0],
        to: [4, -2],
        expected: [
            [0, 0],
            [1, 0],
            [2, -1],
            [3, -1],
            [4, -2],
        ],
    },
    {
        name: "steep",
        from: [0, 0],
        to: [1, 3],
        expected: [
            [0, 0],
            [0, 1],
            [1, 2],
            [1, 3],
        ],
    },
    {
        // The cells of the forward line, last first: not a line drawn from the other end.
        name: "reversed shallow",
        from: [2, 1],
        to: [0, 0],
        expected: [
            [2, 1],
            [1, 0],
            [0, 0],
        ],
    },
    {
        name: "reversed steep",
        from: [1, 3],
        to: [0, 0],
        expected: [
            [1, 3],
            [1, 2],
            [0, 1],
            [0, 0],
        ],
    },
    {
        name: "reversed horizontal, outside the map",
        from: [-1, -4],
        to: [-4, -4],
        expected: [
            [-1, -4],
            [-2, -4],
            [-3, -4],
            [-4, -4],
        ],
    },
];

describe("pointsOnLine", () => {
    for (const { name, from, to, expected } of TABLE) {
        it(`gives Tiled's cells: ${name}`, () => {
            expect(cells(from, to)).toEqual(expected);
        });
    }

    it("adds the cell after each minor-axis step with manhattan, as Tiled does", () => {
        expect(cells([0, 0], [2, 1], true)).toEqual([
            [0, 0],
            [1, 0],
            [1, 1],
            [2, 1],
        ]);
        expect(cells([0, 0], [1, 3], true)).toEqual([
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 2],
            [1, 3],
        ]);
    });

    it("joins any two cells without a gap, both ends included", () => {
        for (let x = -6; x <= 6; x++) {
            for (let y = -6; y <= 6; y++) {
                const line = cells([0, 0], [x, y]);
                expect(line[0]).toEqual([0, 0]);
                expect(line.at(-1)).toEqual([x, y]);
                expect(line).toHaveLength(Math.max(Math.abs(x), Math.abs(y)) + 1);
                for (let index = 1; index < line.length; index++) {
                    const [ax, ay] = line[index - 1]!;
                    const [bx, by] = line[index]!;
                    expect(Math.max(Math.abs(bx - ax), Math.abs(by - ay))).toBe(1);
                }
                expect(cells([x, y], [0, 0])).toEqual([...line].reverse());
            }
        }
    });

    it("refuses ends that are not whole numbers", () => {
        expect(() => cells([0, 0.5], [1, 1])).toThrow(RangeError);
    });
});
