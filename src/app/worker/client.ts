import { WorkerError } from "./protocol";
import type {
    RemoteError,
    TaskFailure,
    TaskInput,
    TaskName,
    TaskOutput,
    WorkerRequest,
    WorkerResponse,
} from "./protocol";

// The page side of the background worker (SPEC §1). Requests wait in a queue on the page and
// go to the worker one at a time, with their buffers. That makes cancellation exact: a queued
// request is dropped before anything is sent, and a running one is stopped by ending the
// worker, which stops synchronous work too (packing, zip, PNG encoding). The next request
// starts a new worker; so does the next request after a crash.

/** What a connection reports to the client. */
export interface WorkerEvents {
    message(response: WorkerResponse): void;
    /** The worker cannot go on; `reason` says why. */
    crash(reason: string): void;
}

/** One started worker, as the client uses it. */
export interface WorkerConnection {
    post(request: WorkerRequest, transfer: Transferable[]): void;
    /** Ends the worker at once, whatever it is doing. */
    terminate(): void;
}

/** Starts a worker that reports to `events`. */
export type WorkerFactory = (events: WorkerEvents) => WorkerConnection;

export interface RunOptions {
    /** Aborting it rejects the request with `cancelled` and stops the task if it runs. */
    signal?: AbortSignal;
    /**
     * Buffers of the input to hand to the worker instead of copying: they are detached when
     * the request is sent, which is when it leaves the queue. A request cancelled before that
     * leaves them as they are.
     */
    transfer?: Transferable[];
    /** Called when the worker takes the request up. */
    onStarted?(): void;
}

export interface WorkerClient {
    /**
     * Runs a task in the worker; resolves with its result, or rejects with `WorkerError`.
     * Requests run one at a time, in the order they were made.
     */
    run<Name extends TaskName>(
        task: Name,
        input: TaskInput<Name>,
        options?: RunOptions,
    ): Promise<TaskOutput<Name>>;
    /** How many workers this client has started. */
    readonly workersStarted: number;
    /** Ends the worker and rejects every request with `cancelled`; later requests too. */
    dispose(): void;
}

interface Pending {
    id: number;
    task: string;
    input: unknown;
    options: RunOptions;
    resolve(output: unknown): void;
    reject(error: WorkerError): void;
}

/** Wires a module worker to `events`. */
export function connectWorker(worker: Worker, events: WorkerEvents): WorkerConnection {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => events.message(event.data);
    worker.onerror = (event) => {
        event.preventDefault();
        events.crash(event.message || "unknown error");
    };
    worker.onmessageerror = () => events.crash("it sent a message that could not be read");
    return {
        post: (request, transfer) => worker.postMessage(request, transfer),
        terminate: () => worker.terminate(),
    };
}

/** The factory of the app: a new module worker running `worker.ts`. */
export const startModuleWorker: WorkerFactory = (events) =>
    // Vite bundles the worker from this exact form (`new Worker(new URL(...))`).
    connectWorker(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }), events);

export function createWorkerClient(start: WorkerFactory = startModuleWorker): WorkerClient {
    const queue: Pending[] = [];
    let running: Pending | null = null;
    let connection: WorkerConnection | null = null;
    let workersStarted = 0;
    let nextId = 1;
    let disposed = false;

    const connect = (): WorkerConnection => {
        if (connection) return connection;
        workersStarted++;
        const started: WorkerConnection = start({
            message: (response) => {
                if (connection === started) receive(response);
            },
            crash: (reason) => {
                if (connection !== started) return;
                const request = running;
                stopWorker();
                request?.reject(
                    new WorkerError(
                        "crashed",
                        request.task,
                        `The background worker failed: ${reason}.`,
                    ),
                );
                pump();
            },
        });
        connection = started;
        return started;
    };

    const stopWorker = () => {
        connection?.terminate();
        connection = null;
        running = null;
    };

    /** Sends the next queued request when none runs. */
    const pump = () => {
        if (running || disposed) return;
        const request = queue.shift();
        if (!request) return;
        running = request;
        try {
            const { id, task, input } = request;
            connect().post({ id, task, input }, request.options.transfer ?? []);
        } catch (error) {
            // The input cannot be cloned or a buffer cannot be transferred; nothing was sent.
            running = null;
            const reason = error instanceof Error ? error.message : String(error);
            request.reject(
                new WorkerError(
                    "internal",
                    request.task,
                    `The request for worker task "${request.task}" cannot be sent: ${reason}`,
                ),
            );
            pump();
        }
    };

    const receive = (response: WorkerResponse) => {
        const request = running;
        if (!request || response.id !== request.id) return;
        if (response.type === "started") {
            request.options.onStarted?.();
            return;
        }
        running = null;
        if (response.type === "done") {
            request.resolve(response.output);
        } else if (response.failure.code === "failed") {
            const { remote } = response.failure;
            request.reject(new WorkerError("failed", request.task, remote.message, remote));
        } else {
            request.reject(new WorkerError("internal", request.task, response.failure.message));
        }
        pump();
    };

    const cancel = (request: Pending) => {
        const error = new WorkerError(
            "cancelled",
            request.task,
            `Worker task "${request.task}" was cancelled.`,
        );
        if (request === running) {
            stopWorker();
            request.reject(error);
            pump();
            return;
        }
        const index = queue.indexOf(request);
        if (index < 0) return;
        queue.splice(index, 1);
        request.reject(error);
    };

    return {
        run<Name extends TaskName>(
            task: Name,
            input: TaskInput<Name>,
            options: RunOptions = {},
        ): Promise<TaskOutput<Name>> {
            const { signal } = options;
            if (disposed || signal?.aborted) {
                return Promise.reject(
                    new WorkerError("cancelled", task, `Worker task "${task}" was cancelled.`),
                );
            }
            return new Promise<TaskOutput<Name>>((resolve, reject) => {
                const onAbort = () => cancel(request);
                const request: Pending = {
                    id: nextId++,
                    task,
                    input,
                    options,
                    resolve: (output) => {
                        signal?.removeEventListener("abort", onAbort);
                        resolve(output as TaskOutput<Name>);
                    },
                    reject: (error) => {
                        signal?.removeEventListener("abort", onAbort);
                        reject(error);
                    },
                };
                signal?.addEventListener("abort", onAbort, { once: true });
                queue.push(request);
                pump();
            });
        },
        get workersStarted() {
            return workersStarted;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            const requests = running ? [running, ...queue] : [...queue];
            queue.length = 0;
            stopWorker();
            for (const request of requests) {
                request.reject(
                    new WorkerError(
                        "cancelled",
                        request.task,
                        `Worker task "${request.task}" was cancelled.`,
                    ),
                );
            }
        },
    };
}

/** The app's background worker, started by its first request. */
export const backgroundWorker: WorkerClient = createWorkerClient();

/** Narrows a rejection of `run(task, …)` to the failure the task's type names. */
export function taskFailure<Name extends TaskName>(
    _task: Name,
    error: unknown,
): RemoteError<TaskFailure<Name>> | null {
    return error instanceof WorkerError && error.code === "failed"
        ? (error.remote as RemoteError<TaskFailure<Name>>)
        : null;
}
