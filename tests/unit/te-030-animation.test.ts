import { describe, expect, it } from "vitest";
import type { History } from "../../src/core/history";
import {
    DEFAULT_FRAME_MS,
    MAX_ANIMATION_FRAMES,
    MAX_ANIMATION_FRAMES_PER_TILESET,
    animationFrameAt,
    animationProblem,
    deleteFrames,
    insertFrames,
    moveFrames,
    nudgeFrames,
    setFrameDurations,
} from "../../src/core/model";
import type { AnimationFrame } from "../../src/core/model";
import {
    ANIMATION_LABELS,
    TilesetEditError,
    animationCommand,
    setAnimationCommand,
} from "../../src/core/tileset";
import type { AnimationEdit } from "../../src/core/tileset";
import { expectSymmetric, snapshotProject } from "./support/symmetry";
import { SLOT, setup, tileset } from "./te-006-support";

// TE-030: the animation editor's command (SPEC §6.4) and the list edits and playback under the
// editor. Every animation command passes the TE-006 symmetry harness; a list past FORMAT §2.4's
// limits (1024 frames a tile, 65 536 a tileset, 1..65 535 ms, frames naming tiles of the
// tileset) is refused with the project unchanged. The project of `setup` has tileset "ts"
// (slot 1) with tiles 0 and 1 of 8 × 8 px.

const frame = (tile: number, ms: number): AnimationFrame => ({ tile, ms });

function animationOf(history: History, tileId: number): AnimationFrame[] {
    return history.session.project.tilesets[0]!.tiles.find((tile) => tile.id === tileId)!.animation;
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

describe("animation commands", () => {
    it("every edit passes the symmetry harness, labelled by the edit", () => {
        const history = setup();
        const steps: [AnimationEdit, AnimationFrame[]][] = [
            ["add", [frame(0, 100)]],
            ["add", [frame(0, 100), frame(1, 100), frame(0, 100)]],
            ["move", [frame(1, 100), frame(0, 100), frame(0, 100)]],
            ["duration", [frame(1, 250), frame(0, 100), frame(0, 100)]],
            ["duration", [frame(1, 40), frame(0, 40), frame(0, 100)]],
            ["delete", [frame(1, 40), frame(0, 100)]],
            ["delete", []],
        ];
        for (const [edit, frames] of steps) {
            const command = expectSymmetric(history, setAnimationCommand("ts", 0, frames, edit));
            expect(command.label).toBe(ANIMATION_LABELS[edit]);
            expect(animationOf(history, 0)).toStrictEqual(frames);
            expect(animationOf(history, 1)).toStrictEqual([]);
        }
    });

    it("the tile keeps a copy of the list; undo restores its own list", () => {
        const history = setup();
        const frames = [frame(1, 100)];
        history.execute(setAnimationCommand("ts", 0, frames, "add"));
        frames[0]!.ms = 5;
        expect(animationOf(history, 0)).toStrictEqual([frame(1, 100)]);
        history.execute(setAnimationCommand("ts", 0, [frame(0, 30)], "add"));
        history.undo();
        expect(animationOf(history, 0)).toStrictEqual([frame(1, 100)]);
        history.undo();
        expect(animationOf(history, 0)).toStrictEqual([]);
    });

    it("an edit that changes nothing makes no command", () => {
        const history = setup();
        history.execute(setAnimationCommand("ts", 1, [frame(0, 100)], "add"));
        const project = history.session.project;
        expect(animationCommand(project, "ts", 1, [frame(0, 100)], "duration")).toBeNull();
        expect(animationCommand(project, "ts", 0, [], "delete")).toBeNull();
        expect(animationCommand(project, "ts", 1, [frame(0, 101)], "duration")).not.toBeNull();
    });

    it("a missing tileset or tile is refused", () => {
        const history = setup();
        const project = history.session.project;
        expect(() => animationCommand(project, "none", 0, [], "add")).toThrow(TilesetEditError);
        expectRefused(history, "tile-not-found", () =>
            history.execute(setAnimationCommand("ts", 9, [frame(0, 100)], "add")),
        );
        expectRefused(history, "not-found", () =>
            history.execute(setAnimationCommand("none", 0, [frame(0, 100)], "add")),
        );
    });

    it("refuses durations outside 1..65 535 ms and frames naming no tile of the tileset", () => {
        const history = setup();
        for (const ms of [0, -1, 65_536, 12.5, Number.NaN]) {
            expectRefused(history, "animation", () =>
                history.execute(setAnimationCommand("ts", 0, [frame(1, ms)], "duration")),
            );
        }
        expectRefused(history, "animation", () =>
            history.execute(setAnimationCommand("ts", 0, [frame(2, 100)], "add")),
        );
        expectSymmetric(
            history,
            setAnimationCommand("ts", 0, [frame(1, 1), frame(0, 65_535)], "add"),
        );
    });

    it("refuses more than 1024 frames on a tile", () => {
        const history = setup();
        const full = Array.from({ length: MAX_ANIMATION_FRAMES }, (_, k) => frame(k % 2, 10));
        expectSymmetric(history, setAnimationCommand("ts", 0, full, "add"));
        expectRefused(history, "animation", () =>
            history.execute(setAnimationCommand("ts", 0, [...full, frame(0, 10)], "add")),
        );
        expect(animationOf(history, 0)).toHaveLength(MAX_ANIMATION_FRAMES);
    });

    it("refuses more than 65 536 frames in the tileset's animations together", () => {
        const history = setup();
        const tiles = MAX_ANIMATION_FRAMES_PER_TILESET / MAX_ANIMATION_FRAMES + 1; // 65 tiles
        const big = tileset("ts", SLOT, tiles);
        const full = Array.from({ length: MAX_ANIMATION_FRAMES }, () => frame(0, 10));
        // Tiles 0..62 full by hand: 64 512 frames.
        for (let id = 0; id < tiles - 2; id++)
            big.tiles[id]!.animation = full.map((f) => ({ ...f }));
        history.session.project.tilesets[0] = big;
        // Tile 63 takes the tileset to exactly 65 536.
        expectSymmetric(history, setAnimationCommand("ts", tiles - 2, full, "add"));
        expectRefused(history, "animation", () =>
            history.execute(setAnimationCommand("ts", tiles - 1, [frame(0, 10)], "add")),
        );
        // Replacing a tile's own frames counts its new list, not old and new together.
        expectSymmetric(history, setAnimationCommand("ts", tiles - 2, full.slice(0, 10), "delete"));
        expectSymmetric(history, setAnimationCommand("ts", tiles - 1, [frame(0, 10)], "add"));
    }, 60_000); // 65 536 frames snapshotted on every step of the harness

    it("animationProblem names the limit it hits", () => {
        const set = tileset("ts", SLOT);
        expect(animationProblem(set, 0, [frame(0, 1)])).toBeNull();
        expect(animationProblem(set, 0, [frame(0, 0)])).toMatch(/1 to 65535 ms/);
        expect(animationProblem(set, 0, [frame(7, 10)])).toMatch(/ID 7/);
        const tooMany = Array.from({ length: 1025 }, () => frame(0, 1));
        expect(animationProblem(set, 0, tooMany)).toMatch(/at most 1024 frames/);
    });
});

describe("frame list edits", () => {
    const list = [frame(0, 10), frame(1, 20), frame(2, 30), frame(3, 40)];

    it("inserts frames of tiles at a gap, each for the given duration", () => {
        expect(insertFrames(list, 1, [7, 8], DEFAULT_FRAME_MS)).toStrictEqual([
            frame(0, 10),
            frame(7, 100),
            frame(8, 100),
            frame(1, 20),
            frame(2, 30),
            frame(3, 40),
        ]);
        expect(insertFrames(list, 99, [5], 60).at(-1)).toStrictEqual(frame(5, 60));
        expect(insertFrames([], 0, [5], 60)).toStrictEqual([frame(5, 60)]);
    });

    it("moves the chosen frames, in list order, to a gap of the list as it is", () => {
        // One frame down past the next one: gap 3 is before frame 3.
        expect(moveFrames(list, [1], 3)).toStrictEqual({
            frames: [frame(0, 10), frame(2, 30), frame(1, 20), frame(3, 40)],
            moved: [2],
        });
        // To the start, and to the end.
        expect(moveFrames(list, [2], 0).frames.map((f) => f.tile)).toEqual([2, 0, 1, 3]);
        expect(moveFrames(list, [0], 4).frames.map((f) => f.tile)).toEqual([1, 2, 3, 0]);
        // Several, kept in list order whatever order they are given in.
        expect(moveFrames(list, [3, 0], 2)).toStrictEqual({
            frames: [frame(1, 20), frame(0, 10), frame(3, 40), frame(2, 30)],
            moved: [1, 2],
        });
        // A gap inside or next to the moved frames leaves the list as it is.
        expect(moveFrames(list, [1, 2], 2).frames).toStrictEqual(list);
        expect(moveFrames(list, [1, 2], 1).frames).toStrictEqual(list);
    });

    it("nudges each chosen frame one place; a frame at an end, or behind one, stays", () => {
        const tiles = (result: { frames: AnimationFrame[] }) => result.frames.map((f) => f.tile);
        // A split selection: each frame moves one place, not packed together.
        expect(nudgeFrames(list, [0, 2], 1)).toStrictEqual({
            frames: [frame(1, 20), frame(0, 10), frame(3, 40), frame(2, 30)],
            moved: [1, 3],
        });
        expect(tiles(nudgeFrames(list, [1, 3], -1))).toEqual([1, 0, 3, 2]);
        // A run moves as one; at the end it stays, and so do the frames right behind it.
        expect(tiles(nudgeFrames(list, [1, 2], 1))).toEqual([0, 3, 1, 2]);
        expect(nudgeFrames(list, [2, 3], 1)).toStrictEqual({ frames: list, moved: [2, 3] });
        expect(tiles(nudgeFrames(list, [0, 3], -1))).toEqual([0, 1, 3, 2]);
    });

    it("deletes the chosen frames and sets durations of the chosen ones", () => {
        expect(deleteFrames(list, [0, 2, 9])).toStrictEqual([frame(1, 20), frame(3, 40)]);
        expect(setFrameDurations(list, [1, 3], 55)).toStrictEqual([
            frame(0, 10),
            frame(1, 55),
            frame(2, 30),
            frame(3, 55),
        ]);
        // The input is never changed.
        expect(list[1]).toStrictEqual(frame(1, 20));
    });
});

describe("looping playback", () => {
    it("shows each frame for its duration, then starts again", () => {
        const frames = [frame(4, 100), frame(5, 300), frame(6, 50)];
        const at = (ms: number) => animationFrameAt(frames, ms);
        expect([0, 99, 100, 399, 400, 449, 450, 549, 550, 4500].map(at)).toEqual([
            0, 0, 1, 1, 2, 2, 0, 0, 1, 0,
        ]);
        expect(animationFrameAt([], 10)).toBe(-1);
        expect(animationFrameAt([frame(1, 7)], 1e12)).toBe(0);
    });
});
