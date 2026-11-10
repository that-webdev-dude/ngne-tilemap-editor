/**
 * The export folder of each project, kept in IndexedDB by project ID (SPEC §10.2): the user
 * picks a folder once per project, and later exports write there after a reload too. A record
 * holds the folder handle (structured-cloneable). Whether the folder is the project's is not
 * kept here: its marker file says so (FORMAT §5).
 *
 * Storage is best effort: where IndexedDB is missing or fails (private windows, Node, a
 * handle that cannot be cloned), a record lives in memory for the session only, and nothing
 * is reported. A database another tab blocks is not waited for; one a newer version replaces
 * is closed. A `load` that does not answer within `FOLDER_LOAD_TIMEOUT_MS` ends the export
 * that waits for it (`exportProject.ts`), so no file operation waits for storage forever.
 */

/** How long an export waits for the stored folder of a project, in milliseconds. */
export const FOLDER_LOAD_TIMEOUT_MS = 3000;

/** What is kept of one project's export folder. */
export interface StoredExportFolder {
    /** `ExportFolderHandle.stored`: the native handle. */
    folder: unknown;
}

export interface ExportFolderStorage {
    /** The record of a project, or null when there is none (or it cannot be read). */
    load(projectId: string): Promise<StoredExportFolder | null>;
    /** Replaces the record of a project; failures are ignored. */
    save(projectId: string, record: StoredExportFolder): Promise<void>;
}

const DATABASE = "ngne-tilemap-editor-export";
const STORE = "folders";

function request<Result>(task: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        task.onsuccess = () => resolve(task.result);
        task.onerror = () => reject(task.error ?? new Error("IndexedDB request failed."));
    });
}

function isRecord(value: unknown): value is StoredExportFolder {
    return typeof value === "object" && value !== null && "folder" in value;
}

/** The records in the page's IndexedDB; a storage that keeps nothing where there is none. */
export function indexedDbExportFolders(): ExportFolderStorage {
    let opened: Promise<IDBDatabase | null> | null = null;
    const database = (): Promise<IDBDatabase | null> => {
        opened ??= (async () => {
            if (typeof indexedDB === "undefined") return null;
            try {
                const opening = indexedDB.open(DATABASE, 1);
                opening.onupgradeneeded = () => {
                    if (!opening.result.objectStoreNames.contains(STORE)) {
                        opening.result.createObjectStore(STORE);
                    }
                };
                const db = await new Promise<IDBDatabase>((resolve, reject) => {
                    opening.onsuccess = () => resolve(opening.result);
                    opening.onerror = () => reject(opening.error ?? new Error("Not opened."));
                    // Another tab holds an older version open: no waiting for it.
                    opening.onblocked = () => reject(new Error("The database is blocked."));
                });
                // A newer version elsewhere: let it go, and open again next time.
                db.onversionchange = () => {
                    db.close();
                    opened = null;
                };
                return db;
            } catch {
                opened = null;
                return null;
            }
        })();
        return opened;
    };
    return {
        async load(projectId) {
            const db = await database();
            if (!db) return null;
            try {
                const value: unknown = await request(
                    db.transaction(STORE, "readonly").objectStore(STORE).get(projectId),
                );
                return isRecord(value) ? value : null;
            } catch {
                return null;
            }
        },
        async save(projectId, record) {
            const db = await database();
            if (!db) return;
            try {
                await request(
                    db.transaction(STORE, "readwrite").objectStore(STORE).put(record, projectId),
                );
            } catch {
                // Ignored on purpose: the record stays in memory for the session.
            }
        },
    };
}
