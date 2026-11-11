/**
 * Where exports go (SPEC §10.2; the sprite editor's SPEC §9.6): a folder chosen with the
 * directory picker of the File System Access API where the browser has it, otherwise a download.
 * Like `projectFiles.ts`, everything here touches the page only when it is called, so the modules
 * that import it also load in Node; the export workflows take an `ExportPlatform`, and tests
 * give them a fake.
 */

/** A folder of the user's disk that exports are written to. */
export interface ExportFolderHandle {
    /** The folder's name, as the picker showed it. */
    readonly name: string;
    /**
     * What IndexedDB stores to give the folder back after a reload (a native
     * `FileSystemDirectoryHandle` is structured-cloneable): `ExportPlatform.folderFrom` takes
     * it back.
     */
    readonly stored: unknown;
    /** Whether the app may write into the folder now, without asking. */
    canWrite(): Promise<boolean>;
    /**
     * Asks the user for write permission (the browser shows its prompt only during a user
     * gesture); true when it is granted. A prompt the browser refuses to show counts as a
     * refusal.
     */
    requestWrite(): Promise<boolean>;
    /** Which of these file names exist in the folder already. */
    existing(names: readonly string[]): Promise<string[]>;
    /**
     * The bytes of a file of the folder, or null when it has none of that name (or a folder
     * has it): the marker, and the files an export compares before it writes (SPEC §10.2).
     */
    read(name: string): Promise<Uint8Array | null>;
    /** Creates or replaces a file of the folder; the file keeps its old content on failure. */
    write(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
    /** False when the folder no longer exists (moved or deleted since it was chosen). */
    exists(): Promise<boolean>;
}

/** The type of a file an export downloads: its media type. */
export interface ExportFileType {
    /** A short name of the type: "zip". */
    readonly kind: string;
    readonly mime: string;
}

export const ZIP_FILE: ExportFileType = {
    kind: "zip",
    mime: "application/zip",
};

export interface ExportPlatform {
    /** True when exports go to a folder (directory picker); false when they download. */
    canChooseFolder(): boolean;
    /** Asks for a folder; null when the user cancels. */
    chooseFolder(): Promise<ExportFolderHandle | null>;
    /** A folder from what IndexedDB kept of it (`stored`), or null when it is not one. */
    folderFrom(stored: unknown): ExportFolderHandle | null;
    /** Hands the bytes to the browser as a download named `name`. */
    download(name: string, bytes: Uint8Array<ArrayBuffer>, type: ExportFileType): void;
    /**
     * Whether the page still has the user's gesture (`navigator.userActivation.isActive`): a
     * permission prompt needs it, and it lapses a few seconds after the key or click.
     */
    hasUserActivation(): boolean;
}

// --- File System Access, as far as exports use it ------------------------------------------------

type PermissionMode = { mode: "read" | "readwrite" };

interface NativeWritable {
    write(data: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
}

interface NativeFileHandle {
    readonly kind: string;
    readonly name: string;
    createWritable(): Promise<NativeWritable>;
    getFile(): Promise<Blob>;
}

interface NativeDirectoryHandle {
    readonly kind: string;
    readonly name: string;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<NativeFileHandle>;
    keys?(): AsyncIterator<string>;
    queryPermission?(descriptor: PermissionMode): Promise<PermissionState>;
    requestPermission?(descriptor: PermissionMode): Promise<PermissionState>;
}

interface FileSystemAccessWindow {
    showDirectoryPicker?(options?: { id?: string; mode?: "read" | "readwrite" }): Promise<unknown>;
}

/** The picker remembers the last folder under this id. */
const FOLDER_PICKER_ID = "ngne-tilemap-export";

const WRITE: PermissionMode = { mode: "readwrite" };

function pickers(): FileSystemAccessWindow {
    return window as unknown as FileSystemAccessWindow;
}

/** True when the user closed a picker without choosing: not a failure. */
function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function isNotFound(error: unknown): boolean {
    return error instanceof DOMException && error.name === "NotFoundError";
}

function isTypeMismatch(error: unknown): boolean {
    return error instanceof DOMException && error.name === "TypeMismatchError";
}

function isDirectory(value: unknown): value is NativeDirectoryHandle {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<NativeDirectoryHandle>;
    return (
        candidate.kind === "directory" &&
        typeof candidate.name === "string" &&
        typeof candidate.getFileHandle === "function"
    );
}

/** Writes through a writable; the browser writes to a copy, which an abort throws away. */
async function writeTo(file: NativeFileHandle, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const writable = await file.createWritable();
    try {
        await writable.write(bytes);
    } catch (error) {
        await writable.abort?.().catch(() => {});
        throw error;
    }
    await writable.close();
}

function wrapFolder(native: NativeDirectoryHandle): ExportFolderHandle {
    return {
        name: native.name,
        stored: native,
        async canWrite() {
            // A browser without the permission methods grants what the handle was given for.
            if (!native.queryPermission) return true;
            return (await native.queryPermission(WRITE)) === "granted";
        },
        async requestWrite() {
            if (!native.requestPermission) return true;
            try {
                return (await native.requestPermission(WRITE)) === "granted";
            } catch {
                // Chrome throws when it may not prompt (no user gesture): no permission.
                return false;
            }
        },
        async existing(names) {
            const found: string[] = [];
            for (const name of names) {
                try {
                    await native.getFileHandle(name);
                    found.push(name);
                } catch (error) {
                    // A name taken by a folder is not a file this export replaces; the write
                    // fails on it and says so.
                    if (!isNotFound(error) && !isTypeMismatch(error)) throw error;
                }
            }
            return found;
        },
        async read(name) {
            let file: NativeFileHandle;
            try {
                file = await native.getFileHandle(name);
            } catch (error) {
                if (isNotFound(error) || isTypeMismatch(error)) return null;
                throw error;
            }
            return new Uint8Array(await (await file.getFile()).arrayBuffer());
        },
        async write(name, bytes) {
            await writeTo(await native.getFileHandle(name, { create: true }), bytes);
        },
        async exists() {
            if (!native.keys) return true;
            try {
                // Listing a folder that was removed fails with NotFoundError; any other
                // failure (no read permission yet) says nothing about it.
                const keys = native.keys();
                await keys.next();
                await keys.return?.();
                return true;
            } catch (error) {
                return !isNotFound(error);
            }
        },
    };
}

/** The page's platform: File System Access where the browser has it, else downloads. */
export function browserExportFiles(): ExportPlatform {
    return {
        canChooseFolder: () => typeof pickers().showDirectoryPicker === "function",

        async chooseFolder() {
            const show = pickers().showDirectoryPicker;
            if (typeof show !== "function") return null;
            try {
                const native = await show.call(window, { id: FOLDER_PICKER_ID, mode: "readwrite" });
                return isDirectory(native) ? wrapFolder(native) : null;
            } catch (error) {
                if (isAbort(error)) return null;
                throw error;
            }
        },

        folderFrom: (stored) => (isDirectory(stored) ? wrapFolder(stored) : null),

        download(name, bytes, type) {
            const url = URL.createObjectURL(new Blob([bytes], { type: type.mime }));
            const link = document.createElement("a");
            link.href = url;
            link.download = name;
            link.hidden = true;
            document.body.append(link);
            link.click();
            link.remove();
            // The download has started from the URL; it is let go once the browser has it.
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
        },

        hasUserActivation() {
            const { userActivation } = navigator as Navigator & {
                userActivation?: { isActive: boolean };
            };
            // Without the API the prompt is tried, and a refusal reported.
            return userActivation?.isActive ?? true;
        },
    };
}
