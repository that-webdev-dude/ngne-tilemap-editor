// Paths of the files a map uses (SPEC §13 Files): Tiled writes them relative to the file that
// names them, so a tileset's image is relative to the tileset. Here every path is made relative
// to the map's folder, with `/` between folders and `.` and `..` resolved as far as they go.

/** Whether Tiled wrote an absolute path (another drive, or a path from the root). */
function isAbsolute(path: string): boolean {
    return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

function normalise(path: string): string {
    const absolute = isAbsolute(path);
    const parts: string[] = [];
    for (const part of path.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop();
        else if (part !== ".." || !absolute) parts.push(part);
    }
    const joined = parts.join("/");
    return absolute && !/^[A-Za-z]:/.test(joined) ? `/${joined}` : joined;
}

/** The folder of a file's path, `""` for the map's own folder. */
export function folderOf(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? "" : path.slice(0, slash);
}

/** The last part of a path: a file's name. */
export function baseName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The path, from the map's folder, of `path` as a file in `folder` (from the map's folder)
 * writes it.
 */
export function resolveTmjPath(folder: string, path: string): string {
    const written = path.replaceAll("\\", "/");
    if (isAbsolute(written) || folder === "") return normalise(written);
    return normalise(`${folder}/${written}`);
}
