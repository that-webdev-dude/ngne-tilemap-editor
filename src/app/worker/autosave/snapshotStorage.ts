import type { PixelBuffer } from "../../../core/model";
import { cachedDatabase, request } from "../indexedDb";

// Where the autosave snapshots of SPEC §10.1 (TE-048) are kept: IndexedDB, database
// `ngne-tilemap-editor-autosave` (SUITE §7), opened by the background worker that writes them
// (`app/worker/tasks/autosave.task.ts`). A snapshot is one project: a record with what the
// recovery dialog lists (`snapshots`), the JSON entries of the project file as bytes keyed by
// entry name (`entries`: `project.json`, `maps/<id>.json`, FORMAT §2.2) and the raw pixels of its
// tilesets and images keyed by `tileset/<id>` and `image/<id>` (`pixels`). Entry and pixel
// records are keyed by `[snapshot key, name]`, so a snapshot rewrites one map or one tileset
// without touching the others, and all of one snapshot's records go by one key range.
//
// Every write of a snapshot is one IndexedDB transaction: it lands whole or not at all, so a
// crash in the middle of a write leaves the snapshot before it.
//
// A snapshot names its owner, the page that wrote it or recovered it. Several pages may share
// the database (two windows restored after a crash both offer recovery): a write leaves a
// snapshot of another owner alone, and recovering or discarding a snapshot checks, in the same
// transaction, that its owner is still the one the page saw (the sprite editor's SE-042).

/** The key of a snapshot: one per open project, kept while it is open (`autosave.ts`). */
export type SnapshotKey = string;

/** A map's thumbnail as the recovery dialog shows it. */
export interface SnapshotThumbnail {
    readonly mapId: string;
    readonly name: string;
    /** `compositeThumbnail` of the map: at most 128 px on its longer side. */
    readonly image: PixelBuffer;
}

/** What the recovery dialog lists of a snapshot, and what recovery reads first. */
export interface SnapshotRecord {
    readonly key: SnapshotKey;
    /** The project's ID: its session state (`sessionState.ts`) is kept under it. */
    readonly projectId: string;
    /** The project's name when the snapshot was written. */
    readonly name: string;
    /** When the snapshot was written, in milliseconds since the epoch. */
    readonly savedAt: number;
    /**
     * The page that wrote it or recovered it (`recovery.ts`): a snapshot of a page that is
     * still open is not offered for recovery by another page.
     */
    readonly owner: string;
    /** The format version of the JSON entries (`PROJECT_VERSION` when written). */
    readonly version: number;
    /** The project's maps, in list order: each has its entry `maps/<id>.json`. */
    readonly mapIds: readonly string[];
    readonly tilesetIds: readonly string[];
    readonly imageIds: readonly string[];
    /** Thumbnails of the first maps of the list (`RECOVERY_THUMBNAILS`). */
    readonly thumbnails: readonly SnapshotThumbnail[];
}

/** One write of a snapshot: what changed since the snapshot the storage holds. */
export interface SnapshotWrite {
    readonly record: SnapshotRecord;
    /**
     * True when the storage may hold records of this key that the writer does not know of: they
     * are all removed first, in the same transaction.
     */
    readonly replace: boolean;
    /** JSON entries to write, by entry name: `project.json` and the changed maps. */
    readonly putEntries: ReadonlyMap<string, Uint8Array>;
    /** Entries of maps the project no longer has. */
    readonly deleteEntries: readonly string[];
    /** Pixels to write, by `tilesetPixels` / `imagePixels` name: new or changed ones. */
    readonly putPixels: ReadonlyMap<string, PixelBuffer>;
    /** Pixels of tilesets and images the project no longer has. */
    readonly deletePixels: readonly string[];
}

/** A snapshot as recovery reads it back. */
export interface StoredSnapshot {
    readonly record: SnapshotRecord;
    readonly entries: ReadonlyMap<string, Uint8Array>;
    readonly pixels: ReadonlyMap<string, PixelBuffer>;
}

/**
 * What `take` found: the snapshot, now the taking page's; "taken" when its owner is no longer
 * the one expected (another page recovered it); "gone" when it is no longer stored.
 */
export type TakeResult = StoredSnapshot | "taken" | "gone";

export interface SnapshotStorage {
    /**
     * Writes a snapshot. Resolves "written" once the transaction committed; "taken" when the
     * stored snapshot of the key names another owner than the record written (another page
     * recovered it): nothing is written then. Rejects with the transaction's error (a
     * `QuotaExceededError` when storage is full), leaving the snapshot before it.
     */
    write(write: SnapshotWrite): Promise<"written" | "taken">;
    /** Removes every record of a snapshot. */
    remove(key: SnapshotKey): Promise<void>;
    /** Every snapshot's record, newest first. */
    list(): Promise<SnapshotRecord[]>;
    /**
     * Reads a snapshot and makes it `owner`'s, in one transaction, if its stored owner is still
     * `expectedOwner`: two pages cannot both recover it.
     */
    take(key: SnapshotKey, expectedOwner: string, owner: string): Promise<TakeResult>;
    /**
     * Removes a snapshot, in one transaction, if its stored owner is still `expectedOwner`: a
     * snapshot another page recovered meanwhile is not removed.
     */
    discard(key: SnapshotKey, expectedOwner: string): Promise<"removed" | "taken" | "gone">;
}

export const AUTOSAVE_DATABASE = "ngne-tilemap-editor-autosave";
export const SNAPSHOT_STORE = "snapshots";
export const ENTRY_STORE = "entries";
export const PIXEL_STORE = "pixels";
const STORES = [SNAPSHOT_STORE, ENTRY_STORE, PIXEL_STORE];

/** How long autosave waits for IndexedDB to open, in milliseconds; then the operation fails. */
export const AUTOSAVE_OPEN_TIMEOUT_MS = 3000;

/** The pixel record name of a tileset. */
export function tilesetPixels(id: string): string {
    return `tileset/${id}`;
}

/** The pixel record name of an image. */
export function imagePixels(id: string): string {
    return `image/${id}`;
}

/** Every key `[key, name]` of one snapshot: arrays sort after strings, so `[key, []]` ends it. */
function rangeOf(key: SnapshotKey): IDBKeyRange {
    return IDBKeyRange.bound([key], [key, []]);
}

/** Resolves when `transaction` commits, rejects with its error when it fails. */
function done(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        // A request's error reaches the transaction before it aborts, with the request's error.
        transaction.onerror = (event) =>
            reject(
                (event.target as IDBRequest | null)?.error ??
                    transaction.error ??
                    new Error("IndexedDB transaction failed."),
            );
        transaction.onabort = () =>
            reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
}

/** Deletes every record of the snapshot `key` within `transaction`. */
function removeAll(transaction: IDBTransaction, key: SnapshotKey): void {
    transaction.objectStore(SNAPSHOT_STORE).delete(key);
    transaction.objectStore(ENTRY_STORE).delete(rangeOf(key));
    transaction.objectStore(PIXEL_STORE).delete(rangeOf(key));
}

/** A stored image read back, or null when it is not one. */
function imageFrom(value: unknown): PixelBuffer | null {
    if (typeof value !== "object" || value === null) return null;
    const { width, height, data } = value as Partial<PixelBuffer>;
    if (typeof width !== "number" || typeof height !== "number") return null;
    return data instanceof Uint8ClampedArray ? { width, height, data } : null;
}

/** The second part of a key `[snapshot key, name]`, or null. */
function nameOf(key: IDBValidKey): string | null {
    const name = Array.isArray(key) ? key[1] : undefined;
    return typeof name === "string" ? name : null;
}

export interface IndexedDbSnapshotOptions {
    /** The IndexedDB to use; the default is the global one (`indexedDB`). */
    factory?: Pick<IDBFactory, "open">;
    timeoutMs?: number;
}

/**
 * The snapshots in IndexedDB, or null where there is none (Node). The connection is opened and
 * kept as `app/worker/indexedDb.ts` says: an open that fails or times out fails the operation
 * that asked, and the next one tries again.
 */
export function indexedDbSnapshots(options: IndexedDbSnapshotOptions = {}): SnapshotStorage | null {
    const factory = options.factory ?? (typeof indexedDB === "undefined" ? null : indexedDB);
    if (!factory) return null;
    const database = cachedDatabase({
        factory,
        name: AUTOSAVE_DATABASE,
        version: 1,
        upgrade(db) {
            for (const name of STORES) {
                if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
            }
        },
        timeoutMs: options.timeoutMs ?? AUTOSAVE_OPEN_TIMEOUT_MS,
    });

    return {
        async write(write) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            const snapshots = transaction.objectStore(SNAPSHOT_STORE);
            const entries = transaction.objectStore(ENTRY_STORE);
            const pixels = transaction.objectStore(PIXEL_STORE);
            const { key, owner } = write.record;
            let taken = false;
            /** An error thrown by a request itself (a value that cannot be cloned). */
            let failure: unknown = null;
            // Only a snapshot of this owner is written over: one another page took is left.
            const check = snapshots.get(key);
            check.onsuccess = () => {
                try {
                    const stored = check.result as SnapshotRecord | undefined;
                    if (stored && stored.owner !== owner) {
                        taken = true;
                        transaction.abort();
                        return;
                    }
                    if (write.replace) {
                        entries.delete(rangeOf(key));
                        pixels.delete(rangeOf(key));
                    }
                    for (const name of write.deleteEntries) entries.delete([key, name]);
                    for (const name of write.deletePixels) pixels.delete([key, name]);
                    for (const [name, bytes] of write.putEntries) entries.put(bytes, [key, name]);
                    for (const [name, image] of write.putPixels) pixels.put(image, [key, name]);
                    snapshots.put(write.record, key);
                } catch (error) {
                    failure = error;
                    transaction.abort();
                }
            };
            try {
                await finished;
            } catch (error) {
                if (failure !== null) throw failure;
                if (taken) return "taken";
                throw error;
            }
            return "written";
        },

        async remove(key) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            removeAll(transaction, key);
            await finished;
        },

        async list() {
            const db = await database();
            const all = await request(
                db.transaction(SNAPSHOT_STORE, "readonly").objectStore(SNAPSHOT_STORE).getAll(),
            );
            return (all as SnapshotRecord[]).sort((a, b) => b.savedAt - a.savedAt);
        },

        async take(key, expectedOwner, owner) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            const snapshots = transaction.objectStore(SNAPSHOT_STORE);
            let result: TakeResult = "gone";
            const check = snapshots.get(key);
            check.onsuccess = () => {
                const stored = check.result as SnapshotRecord | undefined;
                if (!stored) return;
                if (stored.owner !== expectedOwner) {
                    result = "taken";
                    return;
                }
                const record: SnapshotRecord = { ...stored, owner };
                snapshots.put(record, key);
                const range = rangeOf(key);
                const entryStore = transaction.objectStore(ENTRY_STORE);
                const pixelStore = transaction.objectStore(PIXEL_STORE);
                const entryKeys = entryStore.getAllKeys(range);
                const entryValues = entryStore.getAll(range);
                const pixelKeys = pixelStore.getAllKeys(range);
                const pixelValues = pixelStore.getAll(range);
                // The requests of a transaction answer in order: the last one answers last.
                pixelValues.onsuccess = () => {
                    const entries = new Map<string, Uint8Array>();
                    entryKeys.result.forEach((stored, index) => {
                        const bytes: unknown = entryValues.result[index];
                        const name = nameOf(stored);
                        if (bytes instanceof Uint8Array && name !== null) entries.set(name, bytes);
                    });
                    const pixels = new Map<string, PixelBuffer>();
                    pixelKeys.result.forEach((stored, index) => {
                        const image = imageFrom(pixelValues.result[index]);
                        const name = nameOf(stored);
                        if (image && name !== null) pixels.set(name, image);
                    });
                    result = { record, entries, pixels };
                };
            };
            await finished;
            return result;
        },

        async discard(key, expectedOwner) {
            const db = await database();
            const transaction = db.transaction(STORES, "readwrite");
            const finished = done(transaction);
            let result: "removed" | "taken" | "gone" = "gone";
            const check = transaction.objectStore(SNAPSHOT_STORE).get(key);
            check.onsuccess = () => {
                const stored = check.result as SnapshotRecord | undefined;
                if (stored && stored.owner !== expectedOwner) {
                    result = "taken";
                    return;
                }
                // Without a record, records of the key may still be left: they go too.
                removeAll(transaction, key);
                if (stored) result = "removed";
            };
            await finished;
            return result;
        },
    };
}
