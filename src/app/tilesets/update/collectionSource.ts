import { baseName, tmjFileKind } from "../../../core/tmj";
import {
    canPickFolder,
    fileSetOf,
    findTmjFile,
    pickTmjFiles,
    pickTmjFolder,
    readText,
} from "../../tmj/tmjFiles";
import type { TmjFileSet, TmjSetFile } from "../../tmj/tmjFiles";
import type { WorkerClient } from "../../worker/client";
import type { CollectionSourceFiles } from "../../worker/tasks/tilesetUpdate.task";

// The source of a `"collection"` tileset for Update Tileset from Source… (SPEC §6.3; TE-062): its
// TSJ, TSX or TMJ and the tile images it names, picked as Import Tiled Map picks files (SPEC
// §13, TE-061): the folder holding them (File System Access), or without it the files in one
// multi-select, or dropped on the tileset's tab; files are found by their path from the Tiled
// file's folder, else by base name. The Tiled file is the one of the recorded name, else the
// only Tiled file picked. The worker lists the images it names; a missing one refuses the
// update, naming every missing file.

/** The tileset whose source is gathered: its name and recorded file name. */
export interface CollectionTarget {
    readonly name: string;
    readonly fileName: string;
}

const isTiledFile = (path: string) => {
    const kind = tmjFileKind(path);
    return kind === "tileset" || kind === "map" || kind === "json";
};

/** The set's Tiled file of the source: of the recorded name (nearest the folder's top), else the only one. */
export function collectionSourceFile(set: TmjFileSet, fileName: string): TmjSetFile | null {
    const seen = new Set<string>();
    const tiled: TmjSetFile[] = [];
    for (const entry of [...set.byPath.values(), ...set.byName.values()]) {
        if (seen.has(entry.path) || !isTiledFile(entry.path)) continue;
        seen.add(entry.path);
        tiled.push(entry);
    }
    const depth = (path: string) => path.split("/").length;
    const named = tiled
        .filter((entry) => baseName(entry.path).toLowerCase() === fileName.toLowerCase())
        .sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path));
    return named[0] ?? (tiled.length === 1 ? tiled[0]! : null);
}

/** "The image images/a.png is missing" or "The images … are missing". */
function missingText(paths: readonly string[]): string {
    const list = paths.join(", ");
    return paths.length === 1
        ? `The image ${list} is missing: pick it with the source.`
        : `The images ${list} are missing: pick them with the source.`;
}

/**
 * The files of the collection's source in `set`, as the worker reads them, or why there are
 * none. Rejects as the worker's listing of the images rejects (the Tiled file unreadable).
 */
export async function collectionSourceFiles(
    target: CollectionTarget,
    set: TmjFileSet,
    worker: Pick<WorkerClient, "run">,
): Promise<CollectionSourceFiles | string> {
    const source = collectionSourceFile(set, target.fileName);
    if (!source) {
        return `Pick “${target.fileName}”, the Tiled file of the tileset, with its images.`;
    }
    const text = await readText(source.file);
    const fileName = baseName(source.path);
    const images = await worker.run("tileset.collectionImages", {
        fileName,
        text,
        name: target.name,
    });
    const found = images.map((path) => [path, findTmjFile(set, source.path, path)] as const);
    const missing = found.filter(([, file]) => file === undefined).map(([path]) => path);
    if (missing.length > 0) return missingText(missing);
    const bytes: Record<string, Uint8Array> = {};
    for (const [path, file] of found) bytes[path] = await file!.file.read();
    return { kind: "collection", fileName, text, bytes };
}

/**
 * Asks for a collection's source as Import Tiled Map does: the folder holding it, else its
 * files; resolves null when the user cancels.
 */
export async function pickCollectionSource(): Promise<TmjFileSet | null> {
    if (canPickFolder()) return pickTmjFolder();
    const files = await pickTmjFiles();
    return files ? fileSetOf(files) : null;
}
