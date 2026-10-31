import type { RemoteError, WorkerFailure, WorkerRequest, WorkerResponse } from "./protocol";
import type { WorkerTask } from "./task";

// The worker side of the protocol: it answers each request with `started`, then `done` or
// `failed`. The page sends one request at a time (client.ts), so a task runs alone.

/** Where requests come from and answers go: the worker's global scope, or a message port. */
export interface WorkerScope {
    onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
    postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}

function describe(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The failure a thrown error becomes: data when the task names its class, else internal. */
function failureOf(error: unknown, task: WorkerTask): WorkerFailure {
    if (error instanceof Error && task.failures?.some((type) => error instanceof type)) {
        const fields = Object.entries(error).filter(([key]) => key !== "cause" && key !== "stack");
        const remote = { ...Object.fromEntries(fields), name: error.name, message: error.message };
        return { code: "failed", remote: remote as RemoteError<Error> };
    }
    return unexpected(error, task.name);
}

function unexpected(error: unknown, name: string): WorkerFailure {
    return {
        code: "internal",
        message: `Worker task "${name}" failed unexpectedly: ${describe(error)}.`,
    };
}

/** Answers the requests that reach `scope` with the tasks of `tasks`. */
export function serve(scope: WorkerScope, tasks: ReadonlyMap<string, WorkerTask>): void {
    const fail = (id: number, failure: WorkerFailure) =>
        scope.postMessage({ type: "failed", id, failure }, []);

    const handle = async ({ id, task: name, input }: WorkerRequest) => {
        const task = tasks.get(name);
        if (!task) {
            fail(id, { code: "internal", message: `The worker has no task "${name}".` });
            return;
        }
        scope.postMessage({ type: "started", id }, []);
        let output: unknown;
        try {
            output = await task.run(input);
        } catch (error) {
            try {
                fail(id, failureOf(error, task));
            } catch {
                // A field of the error cannot be cloned: its message still gets through.
                fail(id, unexpected(error, name));
            }
            return;
        }
        try {
            scope.postMessage({ type: "done", id, output }, task.transfer?.(output) ?? []);
        } catch (error) {
            fail(id, {
                code: "internal",
                message: `The result of worker task "${name}" cannot be sent: ${describe(error)}.`,
            });
        }
    };

    scope.onmessage = (event) => void handle(event.data);
}
