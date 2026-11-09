import type { PixelBuffer, Project } from "../../../core/model";
import {
    MAX_MAP_JSON_BYTES,
    MAX_PROJECT_JSON_BYTES,
    PROJECT_ENTRY,
    ProjectError,
    mapEntry,
    projectFromWire,
} from "../../../core/project";
import type { ProjectWire } from "../../../core/project";
import { quoted } from "../../../core/project/errors";
import { encodeJson, parseJson } from "../../../core/project/json";
import { migrate } from "../../../core/project/migrations";
import { readMapJson } from "../../../core/project/readMap";
import {
    assertPixelLimits,
    readProjectJson,
    takenExportNames,
} from "../../../core/project/readProject";
import { mapJson, projectJson } from "../../../core/project/toJson";
import { imagePixels, tilesetPixels } from "./snapshotStorage";
import type {
    SnapshotKey,
    SnapshotRecord,
    SnapshotStorage,
    SnapshotWrite,
    StoredSnapshot,
} from "./snapshotStorage";

// A snapshot of a project as autosave writes it and recovery reads it (SPEC §10.1, TE-048). The
// page hands the worker the project without pixels, with the cells of the changed maps only,
// and the changed pixels (`SnapshotInput`, `autosave.ts`); the worker makes the JSON entries
// here, with the writer's functions of FORMAT §2 (`projectJson`, `mapJson`), and stores them.
// Recovery reads them back with the reader's checks of FORMAT §2.9 steps 3 to 5, the pixels
// checked against the sizes `project.json` states: what a project file gets.

/** A snapshot to write, as it crosses from the page to the worker. */
export interface SnapshotInput {
    readonly record: SnapshotRecord;
    /** True when the storage may hold records of the key the page does not know of. */
    readonly replace: boolean;
    /**
     * The project as plain data (`projectToWire`), its tilesets and images without pixels
     * (`data` of length 0) and the maps not in `maps` without layers.
     */
    readonly project: ProjectWire;
    /** The maps whose entries are written: new and changed ones. */
    readonly maps: readonly string[];
    /** Maps the project no longer has. */
    readonly deleteMaps: readonly string[];
    /** Pixels to write, by `tilesetPixels` / `imagePixels` name. */
    readonly putPixels: ReadonlyMap<string, PixelBuffer>;
    readonly deletePixels: readonly string[];
}

/**
 * What the storage writes for `input`: `project.json` and the entry of each map in `maps`,
 * encoded as the writer encodes them, and the pixels as they are.
 */
export function snapshotWrite(input: SnapshotInput): SnapshotWrite {
    const project = projectFromWire(input.project);
    const putEntries = new Map<string, Uint8Array>();
    putEntries.set(PROJECT_ENTRY, encodeJson(projectJson(project)));
    for (const id of input.maps) {
        const map = project.maps.find((each) => each.id === id);
        if (!map) throw new RangeError(`Autosave: the project has no map ${quoted(id)}.`);
        putEntries.set(mapEntry(id), encodeJson(mapJson(project, map)));
    }
    return {
        record: input.record,
        replace: input.replace,
        putEntries,
        deleteEntries: input.deleteMaps.map(mapEntry),
        putPixels: input.putPixels,
        deletePixels: input.deletePixels,
    };
}

/** Writes the snapshot `input` describes to `storage`. */
export function writeSnapshot(
    storage: SnapshotStorage,
    input: SnapshotInput,
): Promise<"written" | "taken"> {
    return storage.write(snapshotWrite(input));
}

function entryOf(stored: StoredSnapshot, name: string, maxBytes: number, what: string): unknown {
    const bytes = stored.entries.get(name);
    if (!bytes) {
        throw new ProjectError("missing-entry", `The snapshot has no ${what}.`, { entry: name });
    }
    if (bytes.length > maxBytes) {
        throw new ProjectError(
            "too-large",
            `Entry ${quoted(name)} holds ${bytes.length} bytes; the limit is ${maxBytes} bytes.`,
            { entry: name },
        );
    }
    return parseJson(bytes, name);
}

/** The pixels `name` of the snapshot, which must have the size `project.json` states. */
function pixelsOf(stored: StoredSnapshot, name: string, stated: PixelBuffer): PixelBuffer {
    const pixels = stored.pixels.get(name);
    if (!pixels) {
        throw new ProjectError("missing-entry", `The snapshot has no pixels of ${name}.`, {
            entry: name,
        });
    }
    const { width, height } = stated;
    if (
        pixels.width !== width ||
        pixels.height !== height ||
        pixels.data.length !== width * height * 4
    ) {
        throw new ProjectError(
            "image-size",
            `The pixels of ${name} are ${pixels.width}×${pixels.height}; the project states ` +
                `${width}×${height}.`,
            { entry: name },
        );
    }
    return pixels;
}

/**
 * The project a stored snapshot holds, with the reader's checks (FORMAT §2.9 steps 3 to 5) and
 * pixels of the stated sizes. Throws `ProjectError` as the reader does. The project shares its
 * pixel buffers with `stored`.
 */
export function projectOfSnapshot(stored: StoredSnapshot): Project {
    const { version } = stored.record;
    const skeleton = readProjectJson(
        migrate(
            "project",
            entryOf(stored, PROJECT_ENTRY, MAX_PROJECT_JSON_BYTES, "project"),
            version,
        ),
    );
    const { project } = skeleton;
    const context = { project, exportNames: takenExportNames(project) };
    for (const mapId of skeleton.mapIds) {
        const name = mapEntry(mapId);
        const value = entryOf(stored, name, MAX_MAP_JSON_BYTES, `map ${quoted(mapId)}`);
        project.maps.push(readMapJson(migrate("map", value, version), mapId, context));
    }
    assertPixelLimits(project);
    for (const tileset of project.tilesets) {
        tileset.pixels = pixelsOf(stored, tilesetPixels(tileset.id), tileset.pixels);
    }
    for (const image of project.images) {
        image.pixels = pixelsOf(stored, imagePixels(image.id), image.pixels);
    }
    return project;
}

/**
 * A snapshot recovery took: its record (now the taking page's) and its project, or, when it does
 * not hold a readable project, why (`problem`, the reader's message) and no project.
 */
export type TakenSnapshot =
    | { readonly record: SnapshotRecord; readonly project: Project; readonly problem?: undefined }
    | { readonly record: SnapshotRecord; readonly project: null; readonly problem: string };

/**
 * Takes the snapshot `key` for `owner` if its owner is still `expectedOwner` (`SnapshotStorage
 * .take`) and reads its project. A snapshot that does not hold a readable project (the reader
 * throws `ProjectError`) is `owner`'s all the same: the result says so with its record, so that
 * the page can still discard it.
 */
export async function takeSnapshot(
    storage: SnapshotStorage,
    key: SnapshotKey,
    expectedOwner: string,
    owner: string,
): Promise<TakenSnapshot | "taken" | "gone"> {
    const taken = await storage.take(key, expectedOwner, owner);
    if (taken === "taken" || taken === "gone") return taken;
    try {
        return { record: taken.record, project: projectOfSnapshot(taken) };
    } catch (error) {
        if (!(error instanceof ProjectError)) throw error;
        return { record: taken.record, project: null, problem: error.message };
    }
}
