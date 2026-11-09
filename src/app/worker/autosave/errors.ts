// Why a storage operation of autosave failed (TE-048), as the worker tasks report it.

/**
 * - `quota`: the browser's storage for the site is full.
 * - `unavailable`: there is no IndexedDB where the operation ran.
 * - `storage`: IndexedDB failed otherwise (blocked, no answer, an aborted transaction).
 */
export type AutosaveErrorCode = "quota" | "unavailable" | "storage";

/** The error a snapshot operation rejects with when IndexedDB fails. */
export class AutosaveError extends Error {
    override readonly name = "AutosaveError";
    readonly code: AutosaveErrorCode;

    constructor(code: AutosaveErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.code = code;
    }
}

/** An error of IndexedDB as an `AutosaveError`; other errors as they are. */
export function storageError(error: unknown): unknown {
    if (error instanceof AutosaveError) return error;
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "QuotaExceededError") {
        return new AutosaveError("quota", "The browser's storage for this site is full.", {
            cause: error,
        });
    }
    if (error instanceof DOMException || (error instanceof Error && name === "Error")) {
        return new AutosaveError("storage", error.message || String(error), { cause: error });
    }
    return error;
}

/**
 * Whether `error` says that storage is full: a `QuotaExceededError`, an `AutosaveError`
 * "quota", or either one as a worker task's failure (`WorkerError.remote`).
 */
export function isQuotaError(error: unknown): boolean {
    const own = error as { name?: unknown; code?: unknown; remote?: unknown } | null;
    if (own === null || typeof own !== "object") return false;
    if (own.name === "QuotaExceededError") return true;
    if (own.name === "AutosaveError" && own.code === "quota") return true;
    return own.remote !== undefined && own.remote !== null && isQuotaError(own.remote);
}
