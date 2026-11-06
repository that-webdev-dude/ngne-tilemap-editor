import { MAX_ANIMATION_FRAMES, MAX_ANIMATION_FRAMES_PER_TILESET } from "./limits";
import type { AnimationFrame, Tileset } from "./types";

// Tile animations (FORMAT §2.4, SPEC §6.4): a tile is animated when its frame list is not
// empty; each frame names a tile of the same tileset and shows for `ms` (1..65 535). The list
// edits of the Animation Editor (TE-030) are pure functions here, so the editor, its commands
// and their tests share them; `animationFrameAt` is the looping playback its preview shows.

/** The fewest and most milliseconds a frame shows (FORMAT §2.4). */
export const MIN_FRAME_MS = 1;
export const MAX_FRAME_MS = 65_535;
/** The duration of a new frame until the editor is told another (Tiled's default). */
export const DEFAULT_FRAME_MS = 100;

export function cloneFrames(frames: readonly AnimationFrame[]): AnimationFrame[] {
    return frames.map((frame) => ({ tile: frame.tile, ms: frame.ms }));
}

export function framesEqual(a: readonly AnimationFrame[], b: readonly AnimationFrame[]): boolean {
    return (
        a.length === b.length &&
        a.every((frame, index) => frame.tile === b[index]!.tile && frame.ms === b[index]!.ms)
    );
}

/** Whether `ms` is a frame duration FORMAT §2.4 allows: an integer in 1..65 535. */
export function isFrameMs(ms: number): boolean {
    return Number.isInteger(ms) && ms >= MIN_FRAME_MS && ms <= MAX_FRAME_MS;
}

/**
 * Why `frames` cannot be the animation of tile `tileId` of `tileset`, as a sentence; null when
 * it can. Checks FORMAT §2.4: at most 1024 frames, durations 1..65 535 ms, frames naming tiles
 * of the tileset, and at most 65 536 frames in all the tileset's animations together.
 */
export function animationProblem(
    tileset: Pick<Tileset, "tiles">,
    tileId: number,
    frames: readonly AnimationFrame[],
): string | null {
    if (frames.length > MAX_ANIMATION_FRAMES) {
        return `A tile animation holds at most ${MAX_ANIMATION_FRAMES} frames; this one would hold ${frames.length}.`;
    }
    const ids = new Set(tileset.tiles.map((tile) => tile.id));
    for (const frame of frames) {
        if (!isFrameMs(frame.ms)) {
            return `A frame shows for ${MIN_FRAME_MS} to ${MAX_FRAME_MS} ms, not ${frame.ms}.`;
        }
        if (!ids.has(frame.tile)) return `The tileset has no tile with the ID ${frame.tile}.`;
    }
    let total = frames.length;
    for (const tile of tileset.tiles) {
        if (tile.id !== tileId) total += tile.animation.length;
    }
    if (total > MAX_ANIMATION_FRAMES_PER_TILESET) {
        return `A tileset's animations hold at most ${MAX_ANIMATION_FRAMES_PER_TILESET} frames together; this one would hold ${total}.`;
    }
    return null;
}

/** The frames of `tileIds`, each for `ms`, inserted before index `at` (clamped to the list). */
export function insertFrames(
    frames: readonly AnimationFrame[],
    at: number,
    tileIds: readonly number[],
    ms: number,
): AnimationFrame[] {
    const index = Math.min(Math.max(0, Math.trunc(at)), frames.length);
    const added = tileIds.map((tile) => ({ tile, ms }));
    return [...cloneFrames(frames.slice(0, index)), ...added, ...cloneFrames(frames.slice(index))];
}

/** The indices of `indices` that name frames of a list of `length`, once each, ascending. */
function validIndices(indices: readonly number[], length: number): number[] {
    return [...new Set(indices)]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < length)
        .sort((a, b) => a - b);
}

/**
 * The frames at `indices` moved, in list order, to the gap before index `at` of the list as it
 * is (0..length; `length` is the end), as a list view moves a dragged selection. Returns the
 * list and the indices the moved frames have in it.
 */
export function moveFrames(
    frames: readonly AnimationFrame[],
    indices: readonly number[],
    at: number,
): { frames: AnimationFrame[]; moved: number[] } {
    const chosen = validIndices(indices, frames.length);
    const gap = Math.min(Math.max(0, Math.trunc(at)), frames.length);
    const picked = new Set(chosen);
    const before = frames.filter((_, index) => index < gap && !picked.has(index));
    const after = frames.filter((_, index) => index >= gap && !picked.has(index));
    const moving = chosen.map((index) => frames[index]!);
    const next = cloneFrames([...before, ...moving, ...after]);
    const moved = moving.map((_, offset) => before.length + offset);
    return { frames: next, moved };
}

/**
 * The frames at `indices` moved one place up (`delta` −1) or down (+1), each on its own, as a
 * list view nudges a selection: a chosen frame at that end of the list stays, and so does one
 * right behind a chosen frame that stays. Returns the list and the indices the chosen frames
 * have in it.
 */
export function nudgeFrames(
    frames: readonly AnimationFrame[],
    indices: readonly number[],
    delta: -1 | 1,
): { frames: AnimationFrame[]; moved: number[] } {
    const items = cloneFrames(frames);
    const picked = items.map(() => false);
    for (const index of validIndices(indices, items.length)) picked[index] = true;
    const order = items.map((_, index) => index);
    if (delta > 0) order.reverse();
    for (const index of order) {
        const next = index + delta;
        if (!picked[index] || next < 0 || next >= items.length || picked[next]) continue;
        [items[index], items[next]] = [items[next]!, items[index]!];
        picked[index] = false;
        picked[next] = true;
    }
    const moved = picked.flatMap((chosen, index) => (chosen ? [index] : []));
    return { frames: items, moved };
}

/** The list without the frames at `indices`. */
export function deleteFrames(
    frames: readonly AnimationFrame[],
    indices: readonly number[],
): AnimationFrame[] {
    const picked = new Set(validIndices(indices, frames.length));
    return cloneFrames(frames.filter((_, index) => !picked.has(index)));
}

/** The list with the frames at `indices` shown for `ms`. */
export function setFrameDurations(
    frames: readonly AnimationFrame[],
    indices: readonly number[],
    ms: number,
): AnimationFrame[] {
    const picked = new Set(validIndices(indices, frames.length));
    return frames.map((frame, index) => ({
        tile: frame.tile,
        ms: picked.has(index) ? ms : frame.ms,
    }));
}

/**
 * The index of the frame a looping animation shows `elapsedMs` after it started: frame `k`
 * shows from the sum of the durations before it, up to but not including the sum through it;
 * after the last frame the loop starts again. −1 for an empty list.
 */
export function animationFrameAt(frames: readonly AnimationFrame[], elapsedMs: number): number {
    if (frames.length === 0) return -1;
    let total = 0;
    for (const frame of frames) total += Math.max(0, frame.ms);
    if (total <= 0) return 0;
    let time = Math.max(0, elapsedMs) % total;
    for (let index = 0; index < frames.length; index++) {
        const ms = Math.max(0, frames[index]!.ms);
        if (time < ms) return index;
        time -= ms;
    }
    return frames.length - 1;
}
