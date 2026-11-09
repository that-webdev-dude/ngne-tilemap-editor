// The one way the app opens its IndexedDB databases (SPEC §10.1: recent files, autosave
// snapshots, session state), in the page and in the background worker. It imports nothing, so
// both can load it.
//
// An open that another connection blocks, or that does not answer within the timeout, fails
// the operation that asked, and a connection that opens after that is closed at once; the next
// operation tries again. A connection the browser closes, or that a newer version elsewhere asks
// to close, is let go, and the next operation opens another.

/** Resolves with the request's result, rejects with its error. */
export function request<Result>(task: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        task.onsuccess = () => resolve(task.result);
        task.onerror = () => reject(task.error ?? new Error("IndexedDB request failed."));
    });
}

export interface DatabaseOptions {
    /** Where the database is opened: the global `indexedDB`, or a test's. */
    factory: Pick<IDBFactory, "open">;
    name: string;
    version: number;
    /** Creates what a new or older database lacks (`onupgradeneeded`). */
    upgrade(db: IDBDatabase): void;
    /** How long an open may take, in milliseconds; then the operation that asked fails. */
    timeoutMs: number;
}

/**
 * A function that gives the database, opened on first use and kept while it is usable (see
 * above). A failed open rejects that call only: the next call opens again.
 */
export function cachedDatabase(options: DatabaseOptions): () => Promise<IDBDatabase> {
    const { factory, name, version, upgrade, timeoutMs } = options;
    let opened: Promise<IDBDatabase> | null = null;

    const open = (): Promise<IDBDatabase> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const opening = factory.open(name, version);
        opening.onupgradeneeded = () => upgrade(opening.result);
        return new Promise<IDBDatabase>((resolve, reject) => {
            /** Given up: a connection that opens later is closed at once. */
            const giveUp = (error: Error) => {
                opening.onsuccess = () => opening.result.close();
                reject(error);
            };
            opening.onsuccess = () => resolve(opening.result);
            opening.onerror = () => reject(opening.error ?? new Error("Not opened."));
            opening.onblocked = () => giveUp(new Error("The database is blocked."));
            timer = setTimeout(() => giveUp(new Error("IndexedDB did not answer.")), timeoutMs);
        }).finally(() => clearTimeout(timer));
    };

    return () => {
        if (opened) return opened;
        const opening = open().then((db) => {
            /** The connection is no longer usable: the next operation opens another. */
            const forget = () => {
                if (opened === opening) opened = null;
            };
            db.onversionchange = () => {
                db.close();
                forget();
            };
            db.onclose = forget;
            return db;
        });
        opened = opening;
        opening.catch(() => {
            if (opened === opening) opened = null;
        });
        return opening;
    };
}
