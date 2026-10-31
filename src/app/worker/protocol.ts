// The background worker's protocol (SPEC §1): the messages between the page and the worker,
// the task types and the errors a request rejects with. Both sides import this file.

/**
 * The types of one task: what it takes, what it returns, and the errors it throws on purpose
 * (`never` when it throws none).
 */
export interface TaskType<Input, Output, Failure extends Error = never> {
    input: Input;
    output: Output;
    failure: Failure;
}

/**
 * Every task by name. Empty here: each task module adds its own entries, so a task is added
 * without an edit to a shared file (RULES 6).
 *
 *     declare module "../protocol" {
 *         interface WorkerTaskTypes {
 *             "png.decode": TaskType<PngDecodeInput, PixelBuffer, PngError>;
 *         }
 *     }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by augmentation
export interface WorkerTaskTypes {}

export type TaskName = keyof WorkerTaskTypes & string;
export type TaskInput<Name extends TaskName> = WorkerTaskTypes[Name]["input"];
export type TaskOutput<Name extends TaskName> = WorkerTaskTypes[Name]["output"];
export type TaskFailure<Name extends TaskName> = WorkerTaskTypes[Name]["failure"];

/**
 * An error a task threw on purpose, as it crosses to the page: its name, message and own data
 * fields (`code`, `entry`…), without its class, stack or cause.
 */
export type RemoteError<Failure extends Error> = Failure extends Error
    ? { readonly name: Failure["name"]; readonly message: string } & {
          readonly [Key in Exclude<keyof Failure, keyof Error>]: Failure[Key];
      }
    : never;

/** A request from the page. `id` is unique per page-side client. */
export interface WorkerRequest {
    id: number;
    task: string;
    input: unknown;
}

/** How a request ended without a result. See `WorkerErrorCode`. */
export type WorkerFailure =
    { code: "failed"; remote: RemoteError<Error> } | { code: "internal"; message: string };

/**
 * The worker's answers: `started` when it takes a request up, then `done` or `failed` once.
 * A request is answered unless the worker is ended or crashes first.
 */
export type WorkerResponse =
    | { type: "started"; id: number }
    | { type: "done"; id: number; output: unknown }
    | { type: "failed"; id: number; failure: WorkerFailure };

/**
 * Why a request rejected:
 * - `cancelled`: its signal aborted, or the client was disposed. A running task is stopped.
 * - `crashed`: the worker failed while it ran the request (an uncaught error, a script that
 *   did not load, a message that could not be read).
 * - `failed`: the task threw one of the errors its type names; `remote` holds it.
 * - `internal`: anything else: an unknown task, an unexpected error in the task, a request or
 *   result that cannot be sent between threads.
 */
export type WorkerErrorCode = "cancelled" | "crashed" | "failed" | "internal";

/** The one error type a request of the background worker rejects with. */
export class WorkerError<Failure extends Error = Error> extends Error {
    override readonly name = "WorkerError";
    readonly code: WorkerErrorCode;
    /** The task the request named. */
    readonly task: string;
    /** With `failed`: the error the task threw. Null otherwise. */
    readonly remote: RemoteError<Failure> | null;

    constructor(
        code: WorkerErrorCode,
        task: string,
        message: string,
        remote: RemoteError<Failure> | null = null,
    ) {
        super(message);
        this.code = code;
        this.task = task;
        this.remote = remote;
    }
}
