import { afterEach, describe, expect, it } from "vitest";
import { createWorkerClient } from "../../src/app/worker/client";
import type { WorkerClient } from "../../src/app/worker/client";
import { WorkerError } from "../../src/app/worker/protocol";
import { collectTasks } from "../../src/app/worker/task";
import type { WorkerTask } from "../../src/app/worker/task";
import { workerTasks } from "../../src/app/worker/taskTable";
import { encodePng } from "../../src/core/codec";
import { inProcessWorkers } from "./te-010-support";
import type { InProcessWorker } from "./te-010-support";

// TE-010: the page-side client: one request at a time, cancellation, crash and replacement,
// over in-process workers (te-010-support.ts) with two test tasks besides the real ones.

/** Resolves when `release` of its run is called; the run's input is its key. */
const held = new Map<string, () => void>();
const testTasks: WorkerTask[] = [
    {
        name: "test.hold",
        run: (key) =>
            new Promise<string>((resolve) => held.set(key as string, () => resolve(key as string))),
    },
    { name: "test.echo", run: (input) => input },
];
const tasks = new Map([...workerTasks, ...collectTasks({ test: { tasks: testTasks } })]);

let client: WorkerClient;
let workers: InProcessWorker[];

function start(): WorkerClient {
    const started = inProcessWorkers(tasks);
    workers = started.workers;
    client = createWorkerClient(started.factory);
    return client;
}

afterEach(() => {
    client?.dispose();
    held.clear();
});

function run(task: string, input: unknown, options?: Parameters<WorkerClient["run"]>[2]) {
    return client.run(task as never, input as never, options);
}

/** Resolves once the request has started in the worker. */
function startedRun(task: string, input: unknown, options: { signal?: AbortSignal } = {}) {
    let onStarted!: () => void;
    const started = new Promise<void>((resolve) => (onStarted = resolve));
    const result = run(task, input, { ...options, onStarted });
    return { result, started };
}

async function rejection(promise: Promise<unknown>): Promise<WorkerError> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(WorkerError);
        return error as WorkerError;
    }
    throw new Error("expected a rejection");
}

describe("queue", () => {
    it("runs requests one at a time, in order, in one worker", async () => {
        start();
        const first = startedRun("test.hold", "a");
        const second = startedRun("test.hold", "b");
        const third = run("test.echo", 3);
        await first.started;
        expect(held.has("b")).toBe(false);
        held.get("a")!();
        await second.started;
        held.get("b")!();
        expect(await Promise.all([first.result, second.result, third])).toEqual(["a", "b", 3]);
        expect(client.workersStarted).toBe(1);
        const order = workers[0]!.responses.map(({ type, id }) => `${type}:${id}`);
        expect(order).toEqual([
            "started:1",
            "done:1",
            "started:2",
            "done:2",
            "started:3",
            "done:3",
        ]);
    });

    it("starts no worker before the first request", () => {
        start();
        expect(client.workersStarted).toBe(0);
    });
});

describe("cancellation", () => {
    it("drops a queued request before anything is sent; its buffers stay attached", async () => {
        start();
        const first = startedRun("test.hold", "a");
        const controller = new AbortController();
        const bytes = encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(16) });
        const queued = run(
            "png.decode",
            { bytes },
            { signal: controller.signal, transfer: [bytes.buffer] },
        );
        await first.started;
        controller.abort();
        const error = await rejection(queued);
        expect(error).toMatchObject({ code: "cancelled", task: "png.decode", remote: null });
        expect(bytes.byteLength).toBeGreaterThan(0);
        held.get("a")!();
        expect(await first.result).toBe("a");
        expect(workers[0]!.responses.map(({ id }) => id)).not.toContain(2);
        expect(workers[0]!.terminated).toBe(false);
    });

    it("stops a running request by ending its worker; the next request starts a new one", async () => {
        start();
        const controller = new AbortController();
        const running = startedRun("test.hold", "a", { signal: controller.signal });
        const next = run("test.echo", "next");
        await running.started;
        controller.abort();
        expect(await rejection(running.result)).toMatchObject({
            code: "cancelled",
            task: "test.hold",
        });
        expect(workers[0]!.terminated).toBe(true);
        expect(await next).toBe("next");
        expect(client.workersStarted).toBe(2);
        expect(workers[1]!.terminated).toBe(false);
    });

    it("rejects at once when the signal has already aborted", async () => {
        start();
        const error = await rejection(run("test.echo", 1, { signal: AbortSignal.abort() }));
        expect(error.code).toBe("cancelled");
        expect(client.workersStarted).toBe(0);
    });

    it("dispose rejects the running and the queued requests and every later one", async () => {
        start();
        const running = startedRun("test.hold", "a");
        const queued = run("test.echo", 1);
        await running.started;
        client.dispose();
        expect((await rejection(running.result)).code).toBe("cancelled");
        expect((await rejection(queued)).code).toBe("cancelled");
        expect((await rejection(run("test.echo", 2))).code).toBe("cancelled");
        expect(workers[0]!.terminated).toBe(true);
    });
});

describe("crash", () => {
    it("rejects the running request; the next request starts a new worker", async () => {
        start();
        const running = startedRun("test.hold", "a");
        const queued = run("test.echo", "after");
        await running.started;
        workers[0]!.crash("boom");
        const error = await rejection(running.result);
        expect(error).toMatchObject({ code: "crashed", task: "test.hold" });
        expect(error.message).toContain("boom");
        expect(workers[0]!.terminated).toBe(true);
        expect(await queued).toBe("after");
        expect(client.workersStarted).toBe(2);
    });

    it("an idle worker that crashes is replaced by the next request", async () => {
        start();
        expect(await run("test.echo", 1)).toBe(1);
        workers[0]!.crash("idle");
        expect(await run("test.echo", 2)).toBe(2);
        expect(client.workersStarted).toBe(2);
    });

    it("ignores a crash reported by a worker that was already replaced", async () => {
        start();
        const controller = new AbortController();
        const first = startedRun("test.hold", "a", { signal: controller.signal });
        await first.started;
        controller.abort();
        await rejection(first.result);
        const second = startedRun("test.hold", "b");
        await second.started;
        workers[0]!.crash("late");
        held.get("b")!();
        expect(await second.result).toBe("b");
    });
});

describe("requests that cannot be sent", () => {
    it("rejects as internal and goes on with the next request", async () => {
        start();
        const error = await rejection(run("test.echo", { f: () => 1 }));
        expect(error.code).toBe("internal");
        expect(error.message).toContain("cannot be sent");
        expect(await run("test.echo", 5)).toBe(5);
    });
});
