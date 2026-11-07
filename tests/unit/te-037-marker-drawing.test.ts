import { describe, expect, it } from "vitest";
import { traceShape } from "../../src/app/markers/markerDrawing";
import type { PathSink } from "../../src/app/markers/markerDrawing";
import type { Marker } from "../../src/core/model";

// TE-037: the paths markers are drawn from (DESIGN §4). A layer's rectangles, ellipses and
// polygons are filled as one path with the nonzero rule, so every closed shape must wind the same
// way as `rect` and `ellipse` do (clockwise on screen, y down): a polygon traced the other way
// would cancel the fill where it overlaps another shape.

/** The polygons a sink receives, as lists of points. */
function recorded(marker: Exclude<Marker, { shape: "point" }>): [number, number][][] {
    const paths: [number, number][][] = [];
    const sink: PathSink = {
        moveTo: (x, y) => void paths.push([[x, y]]),
        lineTo: (x, y) => void paths.at(-1)!.push([x, y]),
        bezierCurveTo: () => {},
        quadraticCurveTo: () => {},
        arc: () => {},
        ellipse: () => {},
        rect: (x, y, w, h) =>
            void paths.push([
                [x, y],
                [x + w, y],
                [x + w, y + h],
                [x, y + h],
            ]),
        closePath: () => {},
    };
    traceShape(sink, marker);
    return paths;
}

/** Twice the signed area, y down: positive for the direction `rect` traces. */
function area(points: [number, number][]): number {
    let sum = 0;
    points.forEach(([x, y], k) => {
        const [nx, ny] = points[(k + 1) % points.length]!;
        sum += x * ny - nx * y;
    });
    return sum;
}

const base = { id: 1, name: "", class: "", properties: [] };

describe("closed shapes wind one way", () => {
    it("a rectangle winds positively", () => {
        const [path] = recorded({
            ...base,
            shape: "rectangle",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
        });
        expect(area(path!)).toBeGreaterThan(0);
    });

    it("a polygon given the other way round is traced as a rectangle is, at its own points", () => {
        const reversed: Marker = {
            ...base,
            shape: "polygon",
            x: 10,
            y: 20,
            points: [
                [25, 25],
                [25, 75],
                [75, 75],
                [75, 25],
            ],
        };
        const [path] = recorded(reversed);
        expect(area(path!)).toBeGreaterThan(0);
        expect(new Set(path!.map(([x, y]) => `${x},${y}`))).toEqual(
            new Set(["35,45", "35,95", "85,95", "85,45"]),
        );
    });

    it("a polygon already wound that way keeps its order", () => {
        const [path] = recorded({
            ...base,
            shape: "polygon",
            x: 0,
            y: 0,
            points: [
                [0, 0],
                [10, 0],
                [5, 8],
            ],
        });
        expect(path).toEqual([
            [0, 0],
            [10, 0],
            [5, 8],
        ]);
    });

    it("a polyline keeps its order: it is never filled", () => {
        const [path] = recorded({
            ...base,
            shape: "polyline",
            x: 0,
            y: 0,
            points: [
                [0, 0],
                [0, 10],
                [10, 10],
            ],
        });
        expect(path).toEqual([
            [0, 0],
            [0, 10],
            [10, 10],
        ]);
    });
});
