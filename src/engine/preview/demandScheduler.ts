// Frames of the game preview on demand (ENGINE §4, redraw on demand; ENGINE §5). NGNE's
// `BrowserGame` asks its scheduler for the next frame after each one; on
// `requestAnimationFrame` it would draw at the display's rate whether or not anything changed.
// This scheduler runs the frame it was asked for only when the image can differ: at the next
// animation frame after `wake` (a cell, the camera, a choice of the panel changed), and when the
// playing tile animations reach their next frame (`due`). A still preview submits no frame.
//
// The game's fixed step ticks the time between two frames. `skip` stops that clock for the time
// since the last frame, so time that passed while nothing was drawn (paused, or before a play)
// is not ticked through at once.

/** NGNE's fixed tick (`Game.dt` default), in milliseconds. */
export const TICK_MS = 1000 / 60;

/** What NGNE's `FrameScheduler` is: `request` and `cancel` of an animation frame. */
export interface FrameSchedulerLike {
    request(callback: FrameRequestCallback): number;
    cancel(id: number): void;
}

/** The browser's frame and timer functions; tests replace them. */
export interface FrameClock {
    requestAnimationFrame(callback: FrameRequestCallback): number;
    cancelAnimationFrame(id: number): void;
    setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
    clearTimeout(id: ReturnType<typeof setTimeout>): void;
    now(): number;
}

const browserClock: FrameClock = {
    requestAnimationFrame: (callback) => requestAnimationFrame(callback),
    cancelAnimationFrame: (id) => cancelAnimationFrame(id),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (id) => clearTimeout(id),
    now: () => performance.now(),
};

/**
 * A `FrameScheduler` that runs the frame the game asked for at the animation frame after
 * `due()` milliseconds, never while `due()` is Infinity, and at the next animation frame after
 * `wake()`.
 */
export class DemandScheduler implements FrameSchedulerLike {
    readonly #due: () => number;
    readonly #clock: FrameClock;
    #pending: FrameRequestCallback | null = null;
    #id = 0;
    #frame = 0;
    #timer: ReturnType<typeof setTimeout> | undefined;
    /** A change waits to be drawn. */
    #dirty = true;
    /** Real time less the time handed to the game. */
    #offset = 0;
    /** The time handed to the game for its last frame; null before one. */
    #last: number | null = null;

    constructor(due: () => number, clock: FrameClock = browserClock) {
        this.#due = due;
        this.#clock = clock;
    }

    request(callback: FrameRequestCallback): number {
        this.#pending = callback;
        this.#arm();
        return ++this.#id;
    }

    cancel(id: number): void {
        if (id !== this.#id) return;
        this.#pending = null;
        this.#disarm();
    }

    /** Something drawn changed: the next frame runs at the next animation frame. */
    wake(): void {
        this.#dirty = true;
        if (this.#pending) this.#arm();
    }

    /** `due()` may have changed (play, pause): the next frame is planned again. */
    replan(): void {
        if (this.#pending) this.#arm();
    }

    /** The game does not tick the time since its last frame: its clock stood still. */
    skip(now = this.#clock.now()): void {
        if (this.#last !== null) this.#offset = now - this.#last;
    }

    /** Stops every timer; a frame asked for is not run. */
    dispose(): void {
        this.#pending = null;
        this.#disarm();
    }

    #disarm(): void {
        if (this.#frame) this.#clock.cancelAnimationFrame(this.#frame);
        this.#frame = 0;
        if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer);
        this.#timer = undefined;
    }

    #arm(): void {
        this.#disarm();
        if (!this.#pending) return;
        const due = this.#dirty ? 0 : Math.max(this.#due(), 0);
        if (!Number.isFinite(due)) return;
        // The frame waits for the animation frame after the delay, so it lands on a vsync.
        const delay = due - TICK_MS / 2;
        if (delay <= 0) {
            this.#frame = this.#clock.requestAnimationFrame(this.#run);
        } else {
            this.#timer = this.#clock.setTimeout(() => {
                this.#timer = undefined;
                this.#frame = this.#clock.requestAnimationFrame(this.#run);
            }, delay);
        }
    }

    readonly #run = (time: number): void => {
        this.#frame = 0;
        const callback = this.#pending;
        if (!callback) return;
        this.#pending = null;
        this.#dirty = false;
        // Never back in time: the game's fixed step refuses a negative duration.
        const clock = Math.max(time - this.#offset, this.#last ?? -Infinity);
        this.#last = clock;
        callback(clock);
    };
}

/**
 * Milliseconds from `elapsedMs` until one of `animations` shows another frame, on the one clock
 * every tile shares from 0 (SPEC §11.2: each animation loops, its frames lasting the listed
 * milliseconds); Infinity when none will. An animation of one frame, or of no time, never
 * changes.
 */
export function untilNextAnimationFrame(
    animations: readonly (readonly number[])[],
    elapsedMs: number,
): number {
    let soonest = Infinity;
    const age = Math.max(elapsedMs, 0);
    for (const durations of animations) {
        if (durations.length < 2) continue;
        let total = 0;
        for (const ms of durations) total += ms;
        if (!(total > 0)) continue;
        const local = age % total;
        let end = 0;
        for (const ms of durations) {
            end += ms;
            if (local < end) {
                soonest = Math.min(soonest, end - local);
                break;
            }
        }
    }
    return soonest;
}

/** Real milliseconds until the frame after which the game's clock has passed `gameMs`. */
export function ticksDelay(gameMs: number): number {
    if (!Number.isFinite(gameMs)) return Infinity;
    const ticks = Math.max(1, Math.ceil(gameMs / TICK_MS - 1e-9));
    return ticks * TICK_MS;
}
