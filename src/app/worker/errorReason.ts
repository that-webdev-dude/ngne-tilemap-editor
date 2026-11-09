/**
 * What went wrong, for a message (a toast, a dialog's problem text): the message of the error a
 * background-worker task threw (`WorkerError.remote`), else the thrown value's own message, else
 * the value as text.
 */
export function reason(error: unknown): string {
    const remote = (error as { remote?: { message?: unknown } } | null)?.remote;
    if (remote && typeof remote.message === "string" && remote.message !== "") {
        return remote.message;
    }
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}
