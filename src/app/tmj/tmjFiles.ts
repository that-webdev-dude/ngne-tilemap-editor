import { baseName, folderOf, isTmjMapFile, resolveTmjPath, tmjFileKind } from "../../core/tmj";
import type { PickedFile } from "../tilesets/import/importSources";
import { pickedFile } from "../tilesets/import/pickTilesetFiles";

// The files of one Import Tiled Map (SPEC §13 Files): a folder picked with File System Access,
// whose files are found by their path relative to the map; or files picked in one multi-select
// or dropped, found by base name. Files added later (Add files…) are found by base name too.
// Only the kinds the import reads are kept: maps, tilesets, templates and PNGs. The pickers
// touch the page only when called, so this module loads in Node.

/** A file of the set: where it is in the folder (its name without one), and its bytes. */
export interface TmjSetFile {
    /** Its path in the picked folder, `/` between folders; its name when not from a folder. */
    readonly path: string;
    readonly file: PickedFile;
}

export interface TmjFileSet {
    /** "folder": a folder was picked; "files": files were picked or dropped. */
    readonly mode: "folder" | "files";
    /** What the dialog says was picked: the folder's name, or the files' count. */
    readonly label: string;
    /** Files found by their path in the folder. */
    readonly byPath: ReadonlyMap<string, TmjSetFile>;
    /** The same files by their path in lower case: a path of another letter case finds them. */
    readonly byLowerPath: ReadonlyMap<string, TmjSetFile>;
    /** Files found by base name: every file of a pick or drop, and those added. */
    readonly byName: ReadonlyMap<string, TmjSetFile>;
}

/** The kinds of file the import reads, by name. */
export function isTmjSetName(name: string): boolean {
    return tmjFileKind(name) !== null;
}

/** The types the picker of files offers (SPEC §13, SUITE §7). */
export const TMJ_PICKER_ACCEPT = ".tmj,.json,.tsj,.tsx,.tj,image/png,.png";

/** The most files a folder is read for: a folder that holds more is cut short. */
export const MAX_FOLDER_FILES = 4096;

const nameKey = (name: string) => name.toLowerCase();

/** A set of `files` picked or dropped, found by base name (the first of a name wins). */
export function fileSetOf(files: readonly PickedFile[]): TmjFileSet {
    const byName = new Map<string, TmjSetFile>();
    for (const file of files) {
        if (!isTmjSetName(file.name)) continue;
        const key = nameKey(baseName(file.name));
        if (!byName.has(key)) byName.set(key, { path: baseName(file.name), file });
    }
    const count = byName.size;
    return {
        mode: "files",
        label: `${count} ${count === 1 ? "file" : "files"}`,
        byPath: new Map(),
        byLowerPath: new Map(),
        byName,
    };
}

/** A set of a folder's files, found by their path in it. */
export function folderSetOf(name: string, files: readonly TmjSetFile[]): TmjFileSet {
    const byPath = new Map<string, TmjSetFile>();
    const byLowerPath = new Map<string, TmjSetFile>();
    for (const entry of files) {
        if (!isTmjSetName(entry.path)) continue;
        byPath.set(entry.path, entry);
        const lower = entry.path.toLowerCase();
        if (!byLowerPath.has(lower)) byLowerPath.set(lower, entry);
    }
    return {
        mode: "folder",
        label: `Folder “${name}”`,
        byPath,
        byLowerPath,
        byName: new Map(),
    };
}

/** `set` with `files` added, found by base name; a name already there is replaced. */
export function withAddedFiles(set: TmjFileSet, files: readonly PickedFile[]): TmjFileSet {
    const byName = new Map(set.byName);
    for (const file of files) {
        if (!isTmjSetName(file.name)) continue;
        byName.set(nameKey(baseName(file.name)), { path: baseName(file.name), file });
    }
    return { ...set, byName };
}

/**
 * The file a map at `mapPath` (in the set) names by `path` (from the map's folder): by its
 * path in the folder first, then by that path in another letter case (as Tiled finds it on
 * Windows), then by base name. Undefined when the set has none.
 */
export function findTmjFile(
    set: TmjFileSet,
    mapPath: string,
    path: string,
): TmjSetFile | undefined {
    const resolved = resolveTmjPath(folderOf(mapPath), path);
    const inFolder = set.byPath.get(resolved) ?? set.byLowerPath.get(resolved.toLowerCase());
    return inFolder ?? set.byName.get(nameKey(baseName(path)));
}

const decoder = new TextDecoder();

/** A file's text (UTF-8, without a byte order mark). */
export async function readText(file: PickedFile): Promise<string> {
    return decoder.decode(await file.read());
}

/**
 * The maps among the set's files, by path: `.tmj` files, and `.json` files that are Tiled
 * maps (SPEC §13), in path order.
 */
export async function mapsOf(set: TmjFileSet): Promise<TmjSetFile[]> {
    const all = [...set.byPath.values(), ...set.byName.values()];
    const maps: TmjSetFile[] = [];
    const seen = new Set<string>();
    for (const entry of all) {
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        const kind = tmjFileKind(entry.path);
        if (kind === "map") maps.push(entry);
        else if (kind === "json") {
            const text = await readText(entry.file);
            if (isTmjMapFile(entry.path, () => text)) maps.push(entry);
        }
    }
    return maps.sort((a, b) => a.path.localeCompare(b.path));
}

/** The part of a directory handle the walk reads. */
interface DirectoryLike {
    readonly kind: string;
    readonly name: string;
    values(): AsyncIterable<DirectoryLike | FileLike>;
}

interface FileLike {
    readonly kind: string;
    readonly name: string;
    getFile(): Promise<File>;
}

interface DirectoryWindow {
    showDirectoryPicker?(options?: { id?: string; mode?: "read" }): Promise<unknown>;
}

/** The picker remembers the last folder under this id. */
const FOLDER_PICKER_ID = "ngne-tilemap-tmj";

function isDirectory(value: unknown): value is DirectoryLike {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Partial<DirectoryLike>;
    return candidate.kind === "directory" && typeof candidate.values === "function";
}

/** Whether the browser can pick a folder (File System Access). */
export function canPickFolder(): boolean {
    return typeof (window as unknown as DirectoryWindow).showDirectoryPicker === "function";
}

/** The files of `root` the import reads, by path; hidden folders are skipped. */
export async function walkFolder(root: DirectoryLike): Promise<TmjSetFile[]> {
    const out: TmjSetFile[] = [];
    const walk = async (directory: DirectoryLike, prefix: string): Promise<void> => {
        for await (const entry of directory.values()) {
            if (out.length >= MAX_FOLDER_FILES) return;
            const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
            if (isDirectory(entry)) {
                if (!entry.name.startsWith(".")) await walk(entry, path);
            } else if (entry.kind === "file" && isTmjSetName(entry.name)) {
                const handle = entry as FileLike;
                out.push({
                    path,
                    file: {
                        name: entry.name,
                        read: async () =>
                            new Uint8Array(await (await handle.getFile()).arrayBuffer()),
                    },
                });
            }
        }
    };
    await walk(root, "");
    return out;
}

/** Asks for the folder holding the map; resolves null when the user cancels. */
export async function pickTmjFolder(): Promise<TmjFileSet | null> {
    const show = (window as unknown as DirectoryWindow).showDirectoryPicker;
    if (typeof show !== "function") return null;
    let root: unknown;
    try {
        root = await show.call(window, { id: FOLDER_PICKER_ID, mode: "read" });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return null;
        throw error;
    }
    if (!isDirectory(root)) return null;
    return folderSetOf(root.name, await walkFolder(root));
}

/** Asks for files, several at once; resolves null when the user cancels. */
export function pickTmjFiles(): Promise<PickedFile[] | null> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = TMJ_PICKER_ACCEPT;
        input.multiple = true;
        input.hidden = true;
        input.dataset.importTmjInput = "";
        const finish = (files: readonly File[] | null) => {
            input.remove();
            resolve(files && files.length > 0 ? files.map(pickedFile) : null);
        };
        input.addEventListener("change", () => finish(Array.from(input.files ?? [])), {
            once: true,
        });
        input.addEventListener("cancel", () => finish(null), { once: true });
        document.body.append(input);
        input.click();
    });
}
