// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";

// TE-068 benchmark page module (tests/perf/te-068-frames-in-flight.perf.ts): counts the frames
// the editor's viewport has submitted that the GPU has not finished. NGNE 0.3.0 keeps its device
// private, so the module wraps `GPUQueue.prototype.submit`. NGNE submits one command buffer per
// frame (its only `queue.submit` is in `render`); after each submit the wrapper asks that queue
// for `onSubmittedWorkDone()`, which settles when the frame and everything before it is done.
// The frames in flight right after a submit are that queue's promises still pending, that frame
// included. The preview (a `BrowserGame`) has a device and queue of its own: the viewport's queue
// is the one whose submit is followed, in the same task, by a new viewport frame. The page
// imports it into the running editor.

/** The part of `GPUQueue` the wrapper uses; the DOM library of the pinned TypeScript has none. */
interface Queue {
    submit: (this: Queue, buffers: unknown) => void;
    onSubmittedWorkDone: (this: Queue) => Promise<void>;
}

interface QueueState {
    pending: number;
    /** Frames in flight right after each submit since `start`, that frame included. */
    inFlight: number[];
    submits: number;
    lastSubmitAt: number;
    idleAt: number;
}

export interface FlightRecord {
    /** The viewport's frames in flight right after each of its submits since `start`. */
    inFlight: number[];
    submits: number;
    /** Frames the viewport reported since `start`: one per submit. */
    frames: number;
    /** Viewport tiers of the submitted frames. */
    tiers: string[];
    /** Milliseconds from the viewport's last submit to the GPU finishing it. */
    idleMs: number;
    /** Submits to other queues (the preview) since `start`, and their most frames in flight. */
    otherSubmits: number;
    otherMaxInFlight: number;
}

/** How long `start` and `stop` wait for the GPU to finish the submitted frames. */
const IDLE_LIMIT_MS = 120_000;

let installed = false;
const queues = new Map<Queue, QueueState>();
let viewportQueue: Queue | null = null;
let tiers = new Set<string>();
let framesAtStart = 0;

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-068 frames in flight: no viewport");
    return probe;
}

function stateOf(queue: Queue): QueueState {
    let state = queues.get(queue);
    if (!state) {
        state = { pending: 0, inFlight: [], submits: 0, lastSubmitAt: -1, idleAt: -1 };
        queues.set(queue, state);
    }
    return state;
}

function idle(): boolean {
    return [...queues.values()].every((state) => state.pending === 0);
}

/** Resolves when `condition` holds, checked every millisecond; rejects after `limitMs`. */
function until(condition: () => boolean, limitMs: number, what: () => string): Promise<void> {
    const start = performance.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            if (condition()) resolve();
            else if (performance.now() - start > limitMs) reject(new Error(what()));
            else setTimeout(check, 1);
        };
        check();
    });
}

/** Counts a submit to `queue` until the GPU has finished it. */
function counted(queue: Queue): void {
    const state = stateOf(queue);
    state.lastSubmitAt = performance.now();
    state.pending += 1;
    state.submits += 1;
    state.inFlight.push(state.pending);
    const probe = window.__ngneTest?.viewport;
    const frames = probe?.stats.frames ?? 0;
    // The viewport counts its frame after `render` returns, in the same task; a microtask runs
    // after that. Its tier is set before it renders.
    const tier = probe?.stats.tier ?? "none";
    queueMicrotask(() => {
        if ((window.__ngneTest?.viewport?.stats.frames ?? 0) > frames) {
            viewportQueue ??= queue;
            if (queue === viewportQueue) tiers.add(tier);
        }
    });
    void queue.onSubmittedWorkDone().then(() => {
        state.pending -= 1;
        if (state.pending === 0) state.idleAt = performance.now();
    });
}

/** Wraps `GPUQueue.prototype.submit` once; every later submit of the page is counted. */
export function install(): void {
    if (installed) return;
    const prototype = (globalThis as unknown as { GPUQueue?: { prototype: Queue } }).GPUQueue
        ?.prototype;
    if (!prototype) throw new Error("te-068 frames in flight: no GPUQueue");
    const submit = prototype.submit;
    prototype.submit = function (this: Queue, buffers: unknown) {
        submit.call(this, buffers);
        counted(this);
    };
    installed = true;
}

/** Waits for the GPU to finish what was submitted, then starts a new record. */
export async function start(): Promise<void> {
    await until(idle, IDLE_LIMIT_MS, () => "te-068: GPU not idle before the start");
    for (const state of queues.values()) {
        state.inFlight = [];
        state.submits = 0;
    }
    tiers = new Set();
    framesAtStart = viewport().stats.frames;
}

/** Ends the record once the GPU has finished every frame submitted since `start`. */
export async function stop(): Promise<FlightRecord> {
    // Read in one task: a frame the page asks for while the GPU drains is not in the record.
    const frames = viewport().stats.frames - framesAtStart;
    const own = viewportQueue ? stateOf(viewportQueue) : null;
    const submits = own?.submits ?? 0;
    const others = [...queues.entries()].filter(([queue]) => queue !== viewportQueue);
    const otherSubmits = others.reduce((sum, [, state]) => sum + state.submits, 0);
    const otherMaxInFlight = Math.max(0, ...others.flatMap(([, state]) => state.inFlight));
    await until(idle, IDLE_LIMIT_MS, () => {
        const pending = [...queues.values()].reduce((sum, state) => sum + state.pending, 0);
        return `te-068: ${pending} frames still in flight ${IDLE_LIMIT_MS / 1000} s after the last submit`;
    });
    return {
        inFlight: own ? own.inFlight.slice(0, submits) : [],
        submits,
        frames,
        tiers: [...tiers],
        idleMs: own && submits > 0 ? own.idleAt - own.lastSubmitAt : 0,
        otherSubmits,
        otherMaxInFlight,
    };
}
