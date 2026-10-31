import { connectWorker, createWorkerClient } from "../../../src/app/worker/client";
import type { WorkerClient } from "../../../src/app/worker/client";
import { WorkerError } from "../../../src/app/worker/protocol";
import { encodePng } from "../../../src/core/codec";
// The task types, for the spec's program, which does not follow the glob of taskTable.ts.
import type {} from "../../../src/app/worker/tasks/png.task";

// TE-010 E2E page: the background worker as the app starts it (`startModuleWorker`), driven by
// tests/e2e/te-010-worker.spec.ts through `window.te010`.

/** Side of the large image: 4096 × 4096 RGBA, 64 MiB of pixels. */
export const SIDE = 4096;

/** The page's main thread while some work ran. */
export interface MainThreadRecord {
    /** Wall time of the work. */
    ms: number;
    /**
     * Longest time between two steps of a message loop that ran meanwhile: every task of the
     * page delays the next step, so this bounds the longest task from above.
     */
    maxGapMs: number;
    /** Durations of the `longtask` entries (tasks over 50 ms) observed meanwhile. */
    longTasks: number[];
}

export interface DecodeResult extends MainThreadRecord {
    width: number;
    height: number;
    /** Sample pixels that differ from the pattern `pattern` drew. */
    mismatches: number;
}

export interface Te010Harness {
    /** Draws the large image and encodes it in the worker; returns the PNG's length. */
    prepare(): Promise<number>;
    /** A deliberate busy task of `ms` on the main thread, measured as the decode is. */
    control(ms: number): Promise<MainThreadRecord>;
    /** Decodes the large PNG in the worker while the main thread is measured. */
    decode(): Promise<DecodeResult>;
    /** Cancels a decode of the large PNG once the worker has taken it up. */
    cancelRunning(): Promise<{ outcome: string; workersBefore: number; workersAfter: number }>;
    /** Crashes the worker of a client during a request, with a second one queued. */
    crash(): Promise<{ outcome: string; message: string; queued: string; workers: number }>;
}

declare global {
    interface Window {
        te010?: Te010Harness;
    }
}

/** RGBA of pixel (x, y) of the large image. */
function pattern(x: number, y: number): [number, number, number, number] {
    return [x & 255, y & 255, (x * y) & 255, 255];
}

/** Measures the main thread while `work` runs. */
async function measure<T>(
    work: () => Promise<T>,
): Promise<{ result: T; record: MainThreadRecord }> {
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: "longtask" });
    const loop = new MessageChannel();
    let running = true;
    let last = performance.now();
    let maxGapMs = 0;
    loop.port1.onmessage = () => {
        const now = performance.now();
        maxGapMs = Math.max(maxGapMs, now - last);
        last = now;
        if (running) loop.port2.postMessage(null);
    };
    loop.port2.postMessage(null);
    const start = performance.now();
    const result = await work();
    const ms = performance.now() - start;
    // One more step of the loop after the work: the task that ended it is counted too.
    await new Promise<void>((resolve) => {
        running = false;
        const step = loop.port1.onmessage!;
        loop.port1.onmessage = (event) => {
            step.call(loop.port1, event);
            resolve();
        };
    });
    loop.port1.close();
    longTasks.push(...observer.takeRecords().map((entry) => entry.duration));
    observer.disconnect();
    return { result, record: { ms, maxGapMs, longTasks } };
}

const client: WorkerClient = createWorkerClient();
let largePng: Uint8Array<ArrayBuffer> | null = null;
/** A 3 × 2 PNG, encoded on the page: the tests that need no large image skip `prepare`. */
const smallPng = encodePng({ width: 3, height: 2, data: new Uint8ClampedArray(24).fill(200) });

function describe(error: unknown): string {
    return error instanceof WorkerError ? error.code : `not a WorkerError: ${String(error)}`;
}

/** The large PNG, copied so that its buffer can be transferred. */
function largeCopy(): Uint8Array<ArrayBuffer> {
    if (!largePng) throw new Error("te010.prepare() has not run");
    return largePng.slice();
}

const harness: Te010Harness = {
    async prepare() {
        const data = new Uint8ClampedArray(SIDE * SIDE * 4);
        // `pattern` written a pixel at a time; little-endian, as every platform Chrome runs on.
        const words = new Uint32Array(data.buffer);
        for (let y = 0; y < SIDE; y++) {
            for (let x = 0; x < SIDE; x++) {
                const [r, g, b, a] = pattern(x, y);
                words[y * SIDE + x] = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
            }
        }
        const pixels = { width: SIDE, height: SIDE, data };
        largePng = await client.run("png.encode", { pixels }, { transfer: [data.buffer] });
        return largePng.length;
    },

    async control(ms) {
        const { record } = await measure(
            () =>
                new Promise<void>((resolve) =>
                    setTimeout(() => {
                        const end = performance.now() + ms;
                        while (performance.now() < end);
                        resolve();
                    }),
                ),
        );
        return record;
    },

    async decode() {
        const bytes = largeCopy();
        const { result, record } = await measure(() =>
            client.run("png.decode", { bytes }, { transfer: [bytes.buffer] }),
        );
        let mismatches = 0;
        for (let i = 0; i < 4096; i++) {
            const x = (i * 2654435761) % SIDE;
            const y = (i * 40503) % SIDE;
            const at = (y * SIDE + x) * 4;
            const expected = pattern(x, y);
            if (expected.some((value, channel) => result.data[at + channel] !== value)) {
                mismatches++;
            }
        }
        return { ...record, width: result.width, height: result.height, mismatches };
    },

    async cancelRunning() {
        const workersBefore = client.workersStarted;
        const controller = new AbortController();
        const bytes = largeCopy();
        const outcome = await client
            .run(
                "png.decode",
                { bytes },
                {
                    transfer: [bytes.buffer],
                    signal: controller.signal,
                    onStarted: () => controller.abort(),
                },
            )
            .then(() => "resolved", describe);
        // The next request runs in a new worker.
        const next = await client.run("png.decode", { bytes: smallPng });
        if (next.width !== 3) throw new Error("the request after the cancelled one failed");
        return { outcome, workersBefore, workersAfter: client.workersStarted };
    },

    async crash() {
        const crashing = createWorkerClient((events) =>
            connectWorker(
                new Worker(new URL("./te-010-crash.worker.ts", import.meta.url), {
                    type: "module",
                }),
                events,
            ),
        );
        const failed = crashing.run("test.crash" as never, {} as never);
        const queued = crashing.run("png.decode", { bytes: smallPng });
        let message = "";
        const outcome = await failed.then(
            () => "resolved",
            (error: unknown) => {
                message = error instanceof Error ? error.message : "";
                return describe(error);
            },
        );
        const decoded = await queued.then((pixels) => `${pixels.width}x${pixels.height}`, describe);
        const workers = crashing.workersStarted;
        crashing.dispose();
        return { outcome, message, queued: decoded, workers };
    },
};

window.te010 = harness;
document.querySelector("#ready")!.textContent = "ready";
