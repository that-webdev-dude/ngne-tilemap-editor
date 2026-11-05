import { describe, expect, it } from "vitest";
import { hitBox, scaleBox } from "../../src/app/selection/transform/handles";
import {
    dragBox,
    hitEdge,
    hitShape,
    hitVertex,
    toolPoint,
} from "../../src/app/tilesets/collision/collisionTools";
import type { Orientation } from "../../src/core/cells";
import type { History } from "../../src/core/history";
import {
    MAX_COLLISION_SHAPES,
    MAX_SHAPE_POINTS,
    collisionProblem,
    fitShape,
    insertPolygonPoint,
    movePolygonPoint,
    moveShape,
    orientPoint,
    orientShape,
    polygonShape,
    removePolygonPoint,
    shapeBox,
} from "../../src/core/model";
import type { Shape, ShapePoint } from "../../src/core/model";
import {
    COLLISION_LABELS,
    TilesetEditError,
    collisionCommand,
    setCollisionCommand,
} from "../../src/core/tileset";
import type { CollisionEdit } from "../../src/core/tileset";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { setup } from "./te-006-support";

// TE-029: the collision editor's command (SPEC §6.4) and the geometry under the editor and Show
// Collision. Every collision command passes the TE-006 symmetry harness; a list past FORMAT
// §2.4's limits (64 shapes, 1024 points, ±4096) is refused with the project unchanged; a
// tile's shapes turn with its orientation as FORMAT §1.2 turns its texels. The project of
// `setup` has tileset "ts" (slot 1) with tiles 0 and 1 of 8 × 8 px.

const RECT: Shape = { shape: "rectangle", x: 1, y: 2, width: 3, height: 4 };
const ELLIPSE: Shape = { shape: "ellipse", x: 0, y: 0, width: 8, height: 4 };
const TRIANGLE: Shape = polygonShape([
    [1, 1],
    [7, 1],
    [4, 6],
]);

function collisionOf(history: History, tileId: number): Shape[] {
    return history.session.project.tilesets[0]!.tiles.find((tile) => tile.id === tileId)!.collision;
}

/** Expects `run` to throw a `TilesetEditError` with `code` and to leave the project unchanged. */
function expectRefused(history: History, code: string, run: () => void): void {
    const before = snapshotProject(history.session.project);
    const undoCount = history.undoCount;
    let caught: unknown;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(TilesetEditError);
    expect((caught as TilesetEditError).code).toBe(code);
    expect(snapshotProject(history.session.project)).toStrictEqual(before);
    expect(history.undoCount).toBe(undoCount);
}

describe("collision commands", () => {
    it("every edit passes the symmetry harness, labelled by the edit", () => {
        const history = setup();
        const steps: [CollisionEdit, Shape[]][] = [
            ["add", [RECT]],
            ["add", [RECT, ELLIPSE]],
            ["add", [RECT, ELLIPSE, TRIANGLE]],
            ["move", [moveShape(RECT, 2, -1), ELLIPSE, TRIANGLE]],
            [
                "resize",
                [
                    moveShape(RECT, 2, -1),
                    fitShape(ELLIPSE, { x: -2, y: -2, width: 12, height: 6 }),
                    TRIANGLE,
                ],
            ],
            ["points", [RECT, ELLIPSE, insertPolygonPoint(TRIANGLE, 0, [4, 0])]],
            ["change", [{ ...RECT, x: 0.5 }, ELLIPSE]],
            ["delete", [ELLIPSE]],
            ["delete", []],
        ];
        for (const [edit, shapes] of steps) {
            const command = expectSymmetric(history, setCollisionCommand("ts", [0], shapes, edit));
            expect(command.label).toBe(COLLISION_LABELS[edit]);
            expect(collisionOf(history, 0)).toStrictEqual(shapes);
            expect(collisionOf(history, 1)).toStrictEqual([]);
        }
    });

    it("several tiles take a copy of the list, one entry; undo restores each tile's own", () => {
        const history = setup();
        history.execute(setCollisionCommand("ts", [1], [ELLIPSE], "add"));
        const undoCount = history.undoCount;
        expectSymmetric(history, setCollisionCommand("ts", [0, 1], [RECT, TRIANGLE], "add"));
        expect(history.undoCount).toBe(undoCount + 1);
        expect(collisionOf(history, 0)).toStrictEqual([RECT, TRIANGLE]);
        expect(collisionOf(history, 1)).toStrictEqual([RECT, TRIANGLE]);
        // Copies: editing one tile's list leaves the other's alone.
        expect(collisionOf(history, 0)).not.toBe(collisionOf(history, 1));
        expect(collisionOf(history, 0)[1]).not.toBe(collisionOf(history, 1)[1]);
        history.undo();
        expect(collisionOf(history, 0)).toStrictEqual([]);
        expect(collisionOf(history, 1)).toStrictEqual([ELLIPSE]);
    });

    it("an edit that changes no tile makes no command", () => {
        const history = setup();
        history.execute(setCollisionCommand("ts", [0, 1], [RECT], "add"));
        const project = history.session.project;
        expect(collisionCommand(project, "ts", [0, 1], [{ ...RECT }], "change")).toBeNull();
        expect(collisionCommand(project, "ts", [0], [RECT, ELLIPSE], "add")).not.toBeNull();
    });

    it("refuses 65 shapes, a polygon of 1025 points and coordinates past ±4096", () => {
        const history = setup();
        const full = Array.from({ length: MAX_COLLISION_SHAPES }, (_, index) =>
            moveShape(RECT, index, 0),
        );
        expectSymmetric(history, setCollisionCommand("ts", [0], full, "add"));
        expectRefused(history, "collision", () =>
            history.execute(setCollisionCommand("ts", [0], [...full, RECT], "add")),
        );

        const ring = (count: number): ShapePoint[] =>
            Array.from({ length: count }, (_, index): ShapePoint => {
                const angle = (2 * Math.PI * index) / count;
                return [100 * Math.cos(angle), 100 * Math.sin(angle)];
            });
        const most = polygonShape(ring(MAX_SHAPE_POINTS));
        expectSymmetric(history, setCollisionCommand("ts", [1], [most], "add"));
        const more = insertPolygonPoint(most, 0, [100, 1]);
        expect(more.points).toHaveLength(MAX_SHAPE_POINTS + 1);
        expectRefused(history, "collision", () =>
            history.execute(setCollisionCommand("ts", [1], [more], "points")),
        );
        expectRefused(history, "collision", () =>
            history.execute(setCollisionCommand("ts", [1], [{ ...RECT, x: 4097 }], "change")),
        );
        expectRefused(history, "collision", () =>
            history.execute(
                setCollisionCommand("ts", [1], [{ shape: "point", x: 0, y: 0 }], "add"),
            ),
        );
        expectRefused(history, "tile-not-found", () =>
            history.execute(setCollisionCommand("ts", [7], [RECT], "add")),
        );
        expect(collisionProblem([removePolygonPoint(TRIANGLE, 0)])).toMatch(/at least 3/);
    });
});

describe("orientation of collision shapes (FORMAT §1.2)", () => {
    // The FORMAT §1.2 table: where a texel at `(a, b)` from the tile's centre lands.
    const LANDS: Record<Orientation, (a: number, b: number) => [number, number]> = {
        0: (a, b) => [a, b],
        4: (a, b) => [-a, b],
        2: (a, b) => [a, -b],
        6: (a, b) => [-a, -b],
        5: (a, b) => [-b, a],
        3: (a, b) => [b, -a],
        1: (a, b) => [b, a],
        7: (a, b) => [-b, -a],
    };
    const TW = 3;
    const TH = 2;

    it.each(Object.keys(LANDS).map(Number) as Orientation[])(
        "orientation %i moves each point of a 3 × 2 tile as the table",
        (orientation) => {
            const turned = (orientation & 1) !== 0;
            const box = turned ? [TH, TW] : [TW, TH];
            for (const [x, y] of [
                [0, 0],
                [3, 0],
                [1.5, 1],
                [2.25, 0.5],
                [-1, 3],
            ] as ShapePoint[]) {
                const [lx, ly] = LANDS[orientation](x - TW / 2, y - TH / 2);
                expect(orientPoint([x, y], orientation, TW, TH)).toEqual([
                    lx + box[0]! / 2,
                    ly + box[1]! / 2,
                ]);
            }
        },
    );

    it("rectangles and ellipses stay boxes; polygons move point by point", () => {
        const rect: Shape = { shape: "rectangle", x: 2, y: 3, width: 4, height: 6 };
        // 16 px tile: flipped horizontally, then turned 90° clockwise.
        expect(orientShape(rect, 4, 16, 16)).toEqual({ ...rect, x: 10 });
        expect(orientShape(rect, 5, 16, 16)).toEqual({
            shape: "rectangle",
            x: 7,
            y: 2,
            width: 6,
            height: 4,
        });
        expect(orientShape({ ...rect, shape: "ellipse" }, 2, 16, 16)).toEqual({
            shape: "ellipse",
            x: 2,
            y: 7,
            width: 4,
            height: 6,
        });
        const turned = orientShape(TRIANGLE, 5, 8, 8);
        expect(turned.shape).toBe("polygon");
        const points =
            turned.shape === "polygon"
                ? turned.points.map(([px, py]) => [turned.x + px, turned.y + py])
                : [];
        expect(points).toEqual([
            [7, 1],
            [7, 7],
            [2, 4],
        ]);
    });
});

describe("shape geometry", () => {
    it("boxes, moves, fits and edits polygon points", () => {
        expect(shapeBox(TRIANGLE)).toEqual({ x: 1, y: 1, width: 6, height: 5 });
        const fitted = fitShape(TRIANGLE, { x: 0, y: 0, width: 12, height: 10 });
        expect(shapeBox(fitted)).toEqual({ x: 0, y: 0, width: 12, height: 10 });
        const moved = movePolygonPoint(TRIANGLE, 2, [4, 9]);
        expect(shapeBox(moved)).toEqual({ x: 1, y: 1, width: 6, height: 8 });
        const added = insertPolygonPoint(TRIANGLE, 2, [2, 4]);
        expect(added.points).toHaveLength(4);
        expect(removePolygonPoint(added, 3)).toEqual(TRIANGLE);
    });

    it("snaps to whole pixels and clamps to ±4096", () => {
        expect(toolPoint(1.4, 2.6, true)).toEqual([1, 3]);
        expect(toolPoint(1.4, 2.6, false)).toEqual([1.4, 2.6]);
        expect(toolPoint(5000, -5000, true)).toEqual([4096, -4096]);
        expect(dragBox([4, 1], [1, 5])).toEqual({ x: 1, y: 1, width: 3, height: 4 });
    });

    it("hits shapes, vertices and edges", () => {
        const shapes = [RECT, TRIANGLE];
        expect(hitShape(shapes, [4, 3], 0.5)).toBe(1);
        expect(hitShape(shapes, [1.5, 5], 0.5)).toBe(0);
        expect(hitShape(shapes, [30, 30], 0.5)).toBe(-1);
        expect(hitVertex(TRIANGLE, [7.2, 1.1], 0.5)).toBe(1);
        expect(hitEdge(TRIANGLE, [4, 1.2], 0.5)).toEqual({ after: 0, at: [4, 1] });
        expect(hitEdge(TRIANGLE, [4, 3], 0.5)).toBeNull();
    });

    it("scales a box from a handle; Shift keeps the aspect", () => {
        const box = { x: 0, y: 0, width: 4, height: 2 };
        expect(hitBox(box, { x: 4, y: 2 }, 8, 1)).toEqual({ kind: "handle", handle: "se" });
        expect(hitBox(box, { x: 2, y: 1 }, 8, 1)).toEqual({ kind: "inside" });
        expect(scaleBox(box, "se", { x: 6, y: 5 }, false)).toEqual({
            x: 0,
            y: 0,
            width: 6,
            height: 5,
        });
        expect(scaleBox(box, "se", { x: 8, y: 3 }, true)).toEqual({
            x: 0,
            y: 0,
            width: 8,
            height: 4,
        });
        // A side dragged past the opposite one turns the box over that side.
        expect(scaleBox(box, "w", { x: 9, y: 1 }, false)).toEqual({
            x: 4,
            y: 0,
            width: 5,
            height: 2,
        });
        // A box of size 0 (a click of the rectangle tool) grows from any handle, any way.
        const dot = { x: 4, y: 4, width: 0, height: 0 };
        expect(hitBox(dot, { x: 4, y: 4 }, 8, 1)).toEqual({ kind: "handle", handle: "nw" });
        expect(scaleBox(dot, "nw", { x: 8, y: 7 }, false)).toEqual({
            x: 4,
            y: 4,
            width: 4,
            height: 3,
        });
    });
});
