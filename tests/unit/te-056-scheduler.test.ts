import { describe, expect, it } from "vitest";
import {
    DemandScheduler,
    TICK_MS,
    ticksDelay,
    untilNextAnimationFrame,
} from "../../src/engine/preview/demandScheduler";
import type { FrameClock } from "../../src/engine/preview/demandScheduler";

// TE-056: the preview's frames on demand. A frame runs after a change (`wake`) and when the
// playing tile animations show their next frame; never while nothing can change, so a still
// preview submits no frame (ENGINE §4, redraw on demand).

/** A clock whose animation frames and timers the test runs. */
class TestClock implements FrameClock {
    time = 1000;
    frames = new Map<number, FrameRequestCallback>();
    timers = new Map<number, { at: number; run: () => void }>();
    #next = 1;

    requestAnimationFrame(callback: FrameRequestCallback): number {
        const id = this.#next++;
        this.frames.set(id, callback);
        return id;
    }
    cancelAnimationFrame(id: number): void {
        this.frames.delete(id);
    }
    setTimeout(run: () => void, ms: number): ReturnType<typeof setTimeout> {
        const id = this.#next++;
        this.timers.set(id, { at: this.time + ms, run });
        return id as unknown as ReturnType<typeof setTimeout>;
    }
    clearTimeout(id: ReturnType<typeof setTimeout>): void {
        this.timers.delete(id as unknown as number);
    }
    now(): number {
        return this.time;
    }
    /** Advances the time, running due timers, then one animation frame if any is asked for. */
    advance(ms: number): void {
        this.time += ms;
        for (const [id, timer] of [...this.timers]) {
            if (timer.at <= this.time) {
                this.timers.delete(id);
                timer.run();
            }
        }
        const frames = [...this.frames];
        this.frames.clear();
        for (const [, callback] of frames) callback(this.time);
    }
}

describe("frames on demand", () => {
    it("runs the frame asked for after a wake, and none while nothing is due", () => {
        const clock = new TestClock();
        const scheduler = new DemandScheduler(() => Infinity, clock);
        const run: number[] = [];
        const ask = () => scheduler.request((time) => run.push(time));
        ask();
        clock.advance(16);
        // The first frame is due at once (nothing drawn yet).
        expect(run).toEqual([1016]);
        ask();
        clock.advance(500);
        expect(run).toHaveLength(1);
        scheduler.wake();
        clock.advance(16);
        expect(run).toHaveLength(2);
    });

    it("runs a frame when the animations are due, at the animation frame after the delay", () => {
        const clock = new TestClock();
        let due = 100;
        const scheduler = new DemandScheduler(() => due, clock);
        const run: number[] = [];
        scheduler.request((time) => run.push(time));
        clock.advance(1);
        expect(run).toHaveLength(1);
        scheduler.request((time) => run.push(time));
        clock.advance(80);
        expect(run).toHaveLength(1);
        clock.advance(20);
        expect(run).toHaveLength(2);
        // Paused: nothing is due any more.
        due = Infinity;
        scheduler.request((time) => run.push(time));
        scheduler.replan();
        clock.advance(10_000);
        expect(run).toHaveLength(2);
    });

    it("does not hand the game the time it skipped, nor run after dispose", () => {
        const clock = new TestClock();
        const scheduler = new DemandScheduler(() => Infinity, clock);
        const run: number[] = [];
        scheduler.request((time) => run.push(time));
        clock.advance(10);
        scheduler.request((time) => run.push(time));
        clock.advance(5000);
        scheduler.skip();
        scheduler.wake();
        clock.advance(16);
        // 16 ms after the last frame on the game's clock, not 5016.
        expect(run[1]! - run[0]!).toBe(16);
        scheduler.request((time) => run.push(time));
        scheduler.wake();
        scheduler.dispose();
        clock.advance(16);
        expect(run).toHaveLength(2);
    });
});

describe("the next animation frame", () => {
    it("is the soonest frame change of any looping animation on the shared clock", () => {
        expect(untilNextAnimationFrame([[100, 250]], 0)).toBe(100);
        expect(untilNextAnimationFrame([[100, 250]], 120)).toBe(230);
        // The pass loops: 350 ms is the start again.
        expect(untilNextAnimationFrame([[100, 250]], 360)).toBe(90);
        expect(
            untilNextAnimationFrame(
                [
                    [100, 250],
                    [40, 40],
                ],
                120,
            ),
        ).toBe(40);
    });

    it("is never for animations of one frame, or none", () => {
        expect(untilNextAnimationFrame([], 0)).toBe(Infinity);
        expect(untilNextAnimationFrame([[500]], 0)).toBe(Infinity);
    });

    it("is reached after whole ticks of the game's clock", () => {
        expect(ticksDelay(100)).toBeCloseTo(6 * TICK_MS);
        expect(ticksDelay(1)).toBeCloseTo(TICK_MS);
        expect(ticksDelay(Infinity)).toBe(Infinity);
    });
});
