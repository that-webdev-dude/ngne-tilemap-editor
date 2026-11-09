import { ProjectError as ContainerError } from "../sprite/project/errors";

// The one error of the `.ngtilemap` reader and writer (FORMAT §2.9). The zip container and the
// strict JSON parser are the sprite editor's (`core/sprite`), whose own `ProjectError` is turned
// into this one at the boundary with its code, message and entry kept.

/**
 * What was wrong:
 * - `not-a-zip`: the bytes are not a zip archive, its directory is damaged or cut short, or the
 *   local header of an entry that is read is missing or carries another name.
 * - `unsupported-zip`: a zip archive that breaks a container rule of FORMAT §2.1: zip64 (or the
 *   65 535 entries that call for it), several disks, encryption, a compression method other
 *   than stored and deflate, or one name for two entries.
 * - `corrupt-entry`: an entry cannot be read: its checksum, deflate stream or stated size is
 *   wrong, a JSON entry is not UTF-8 JSON or has an object
 *   with a member twice, a PNG entry is not a PNG file or does not decode.
 * - `too-large`: an entry, the pixels of all tilesets or of all images, or the entries together
 *   exceed a size limit of FORMAT §2.8. Reported before anything is inflated or decoded.
 * - `memory`: memory for the project could not be allocated.
 * - `missing-manifest`: the archive has no `manifest.json`: it is not a tilemap project.
 * - `invalid-manifest`: `manifest.json` does not describe a tilemap project of version 1 or
 *   later.
 * - `newer-version`: the file has a version above `PROJECT_VERSION`.
 * - `missing-entry`: `project.json`, a map's JSON or a tileset's or image's PNG is absent.
 * - `invalid-project`: `project.json`, or the project being written, breaks FORMAT §2.4: a
 *   missing or unknown member, a wrong type, a value outside its range, a count limit of §2.8,
 *   a repeated ID or export name, a reference to nothing.
 * - `invalid-map`: a `maps/<mapId>.json`, or a map being written, breaks FORMAT §2.5 or §1.2.
 * - `image-size`: a PNG does not have the size its tileset or image states.
 * - `image-format`: a PNG is not 8-bit RGBA (colour type 6), not interlaced.
 */
export type ProjectErrorCode =
    | "not-a-zip"
    | "unsupported-zip"
    | "corrupt-entry"
    | "too-large"
    | "memory"
    | "missing-manifest"
    | "invalid-manifest"
    | "newer-version"
    | "missing-entry"
    | "invalid-project"
    | "invalid-map"
    | "image-size"
    | "image-format";

export interface ProjectErrorOptions extends ErrorOptions {
    /** The archive entry at fault, when the problem lies in one. */
    entry?: string;
}

/** The one error type thrown by `serialize` and `deserialize`. */
export class ProjectError extends Error {
    override readonly name = "ProjectError";
    readonly code: ProjectErrorCode;
    /** Name of the archive entry at fault ("project.json", "maps/<id>.json"), when there is one. */
    readonly entry: string | undefined;

    constructor(code: ProjectErrorCode, message: string, options: ProjectErrorOptions = {}) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.code = code;
        this.entry = options.entry;
    }
}

/** A name or an ID as it appears in a message: quoted, and cut when it is very long. */
export function quoted(text: string): string {
    return JSON.stringify(text.length > 80 ? `${text.slice(0, 80)}…` : text);
}

/** The codes of the sprite core's container and JSON errors that this reader passes on. */
const CONTAINER_CODES = new Set<ProjectErrorCode>([
    "not-a-zip",
    "unsupported-zip",
    "corrupt-entry",
    "too-large",
    "memory",
]);

/**
 * `error` as this module's error when it is one of the sprite core's container or JSON errors,
 * with `entry` filled in when the sprite core named none; any other value unchanged.
 */
export function fromContainerError(error: unknown, entry?: string): unknown {
    if (!(error instanceof ContainerError)) return error;
    const code = error.code as ProjectErrorCode;
    if (!CONTAINER_CODES.has(code)) return error;
    return new ProjectError(code, error.message, { entry: error.entry ?? entry, cause: error });
}
