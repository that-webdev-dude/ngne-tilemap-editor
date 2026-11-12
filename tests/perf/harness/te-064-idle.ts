// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { createProjectSession } from "../../../src/core/model";
import { createReferenceProject, REFERENCE } from "../../support/referenceProject";

// TE-064 benchmark page module (tests/perf/te-064-idle.perf.ts): the idle editor. The reference
// map opens as a map opens; the view is set through the app's commands; once the editor has
// settled, windows with nothing done count every frame the page submits. NGNE 0.3.0 keeps its
// device private, so the module wraps `GPUQueue.prototype.submit` (as TE-068's does) and counts
// the submits of every queue of the page (viewport and preview). It also counts the app's
// animation-frame callbacks, and the page's own animation frames with a loop of its own, which
// shows that the page was running. The page imports it into the running editor.

/** The part of `GPUQueue` the wrapper uses; the DOM library of the pinned TypeScript has none. */
interface Queue {
    submit: (this: Queue, buffers: unknown) => void;
}

let installed = false;
let submits = 0;
let animationFrames = 0;
/** The browser's own `requestAnimationFrame`, for the page's probe of animation frames. */
let nativeRequest: typeof window.requestAnimationFrame = (callback) =>
    window.requestAnimationFrame(callback);

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-064 idle: no viewport");
    return probe;
}

/** Resolves when `condition` holds, checked between tasks; rejects after `limitMs`. */
function until(condition: () => boolean, limitMs = 60_000): Promise<void> {
    const start = performance.now();
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            if (condition()) {
                channel.port1.close();
                resolve();
            } else if (performance.now() - start > limitMs) {
                channel.port1.close();
                reject(new Error("te-064 idle: timed out"));
            } else {
                setTimeout(() => channel.port2.postMessage(null), 1);
            }
        };
        channel.port2.postMessage(null);
    });
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wraps `GPUQueue.prototype.submit` and `requestAnimationFrame` once, to count them. */
function install(): void {
    if (installed) return;
    const prototype = (globalThis as unknown as { GPUQueue?: { prototype: Queue } }).GPUQueue
        ?.prototype;
    if (!prototype) throw new Error("te-064 idle: no GPUQueue");
    const submit = prototype.submit;
    prototype.submit = function (this: Queue, buffers: unknown) {
        submit.call(this, buffers);
        submits += 1;
    };
    const request = window.requestAnimationFrame.bind(window);
    nativeRequest = request;
    window.requestAnimationFrame = (callback) =>
        request((time) => {
            animationFrames += 1;
            callback(time);
        });
    installed = true;
}

export interface Opened {
    view: "100" | "fit";
    tier: string;
    zoom: number;
    canvas: [number, number];
    /** Submits counted while the map opened: the counter sees the editor's frames. */
    submits: number;
}

/**
 * Opens the reference map (ENGINE §6) at 100% in its middle, as a map opens, and waits for the
 * chunk tier and both tileset textures. With `view` "fit", runs View › Fit Map (the chunk tier).
 */
export async function openReference(view: "100" | "fit"): Promise<Opened> {
    install();
    const counted = submits;
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const session = createProjectSession(createReferenceProject());
    const side = REFERENCE.width * REFERENCE.tileWidth;
    Object.assign(session.perMap.get(session.activeMapId)!.view, {
        centreX: side / 2,
        centreY: side / 2,
        zoom: 1,
    });
    const frames = probe.stats.frames;
    hooks.session.getState().replace(session);
    await until(() => probe.stats.frames > frames);
    await until(() => probe.chunkStats().ready);
    await until(() => probe.textureIds().filter((id) => id.startsWith("ed:ts:")).length === 2);
    if (view === "fit") {
        const before = probe.stats.frames;
        await hooks.commands.get("view.fit")!.run();
        await until(() => probe.stats.frames > before);
    }
    const state = hooks.session.getState();
    return {
        view,
        tier: probe.stats.tier,
        zoom: state.session.perMap.get(state.session.activeMapId)!.view.zoom,
        canvas: [probe.canvas.width, probe.canvas.height],
        submits: submits - counted,
    };
}

export interface IdleRecord {
    ms: number;
    /** Frames the page submitted to any GPU queue meanwhile. */
    submits: number;
    /** Frames the viewport reported meanwhile. */
    viewportFrames: number;
    /** Animation-frame callbacks the app ran meanwhile. */
    appAnimationFrames: number;
    /** Animation frames of the page meanwhile, counted by a loop of the module's own. */
    pageAnimationFrames: number;
    tier: string;
}

/** Waits until the chunk tier has no work left, then `settleMs` more. */
export async function settle(settleMs: number): Promise<void> {
    install();
    const probe = viewport();
    await until(() => probe.chunkStats().ready && probe.chunkStats().pending === 0);
    await wait(settleMs);
}

/** Counts for `ms` with nothing done. */
export async function idle(ms: number): Promise<IdleRecord> {
    install();
    const probe = viewport();
    const submitsBefore = submits;
    const appBefore = animationFrames;
    const framesBefore = probe.stats.frames;
    let pageAnimationFrames = 0;
    let running = true;
    const tick = () => {
        if (!running) return;
        pageAnimationFrames += 1;
        nativeRequest(tick);
    };
    nativeRequest(tick);
    const start = performance.now();
    await wait(ms);
    running = false;
    return {
        ms: performance.now() - start,
        submits: submits - submitsBefore,
        viewportFrames: probe.stats.frames - framesBefore,
        appAnimationFrames: animationFrames - appBefore,
        pageAnimationFrames,
        tier: probe.stats.tier,
    };
}

/**
 * Runs View › Zoom In and counts the submits until its frame is drawn: the counter must see a
 * frame the editor draws after the windows.
 */
export async function changeView(): Promise<number> {
    const probe = viewport();
    const before = submits;
    const frames = probe.stats.frames;
    await window.__ngneTest!.commands.get("view.zoomIn")!.run();
    await until(() => probe.stats.frames > frames, 10_000);
    return submits - before;
}
