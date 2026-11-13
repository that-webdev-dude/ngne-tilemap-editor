import type { TaskFailure, TaskInput, TaskName, TaskOutput } from "./protocol";

// Task definitions on the worker side. A feature adds tasks by creating a module named
// `*.task.ts` under `src/app/worker` that exports `tasks` and declares their types in
// `WorkerTaskTypes` (protocol.ts); `taskTable.ts` finds it with a glob import, so no shared
// file is edited (RULES 6).

/** A class of error a task throws on purpose: it reaches the page as a `failed` request. */
export type FailureClass = abstract new (...args: never[]) => Error;

/** One task as the worker runs it. */
export interface WorkerTask<Input = unknown, Output = unknown> {
    readonly name: string;
    run(input: Input): Output | Promise<Output>;
    /** The buffers of the result handed to the page instead of copied. */
    transfer?(output: Output): Transferable[];
    /** The errors that reach the page as data; any other error is `internal`. */
    readonly failures?: readonly FailureClass[];
}

/** What a `*.task.ts` module exports. */
export interface TaskModule {
    tasks?: readonly WorkerTask[];
}

/** A task typed by its entry of `WorkerTaskTypes`. */
export function defineTask<Name extends TaskName>(
    name: Name,
    task: Omit<WorkerTask<TaskInput<Name>, TaskOutput<Name>>, "name"> &
        ([TaskFailure<Name>] extends [never]
            ? unknown
            : { readonly failures: readonly FailureClass[] }),
): WorkerTask {
    return { ...task, name } as WorkerTask;
}

/** The buffers behind `views`, each once: a list `postMessage` accepts as `transfer`. */
export function buffersOf(...views: ArrayBufferView[]): Transferable[] {
    const buffers = new Set<ArrayBuffer>();
    for (const view of views) {
        if (view.buffer instanceof ArrayBuffer) buffers.add(view.buffer);
    }
    return [...buffers];
}

/** The tasks of the modules by name. Throws when two tasks share a name. */
export function collectTasks(modules: Record<string, TaskModule>): ReadonlyMap<string, WorkerTask> {
    const table = new Map<string, WorkerTask>();
    for (const path of Object.keys(modules).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        for (const task of modules[path]?.tasks ?? []) {
            if (table.has(task.name)) {
                throw new Error(`Worker task "${task.name}" is defined twice (${path}).`);
            }
            table.set(task.name, task);
        }
    }
    return table;
}
