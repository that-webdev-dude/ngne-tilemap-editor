import type { PixelBuffer, Project } from "../model";
import { PngError, decodePng } from "../sprite/png";
import { pngHeader } from "../sprite/project/png";
import { openZip } from "../sprite/project/zip";
import { ProjectError, fromContainerError, quoted } from "./errors";
import {
    MANIFEST_ENTRY,
    MAX_CONTENT_BYTES,
    MAX_MANIFEST_BYTES,
    MAX_MAP_JSON_BYTES,
    MAX_PROJECT_JSON_BYTES,
    PROJECT_ENTRY,
    imageEntry,
    mapEntry,
    maxPngBytes,
    tilesetEntry,
} from "./format";
import { parseJson } from "./json";
import { readManifest } from "./manifest";
import { migrate } from "./migrations";
import { readMapJson } from "./readMap";
import { assertPixelLimits, readProjectJson, takenExportNames } from "./readProject";

// The reader of FORMAT §2, in the order of §2.9. Steps 1 to 5 decode no pixels.

const BIT_DEPTH = 8;
const COLOR_TYPE_RGBA = 6;

/** An entry's bytes, or `undefined` when absent; container errors become this module's. */
type ReadEntry = (name: string, maxBytes: number) => Uint8Array | undefined;

function required(read: ReadEntry, name: string, maxBytes: number, what: string): Uint8Array {
    const bytes = read(name, maxBytes);
    if (bytes === undefined) {
        throw new ProjectError("missing-entry", `The file has no entry ${quoted(name)}: ${what}.`, {
            entry: name,
        });
    }
    return bytes;
}

/** Step 6 for one PNG: present, within its limit, header checked, then decoded. */
async function readPng(
    read: ReadEntry,
    name: string,
    width: number,
    height: number,
    what: string,
): Promise<PixelBuffer> {
    const bytes = required(read, name, maxPngBytes(width, height), what);
    const header = pngHeader(bytes);
    if (header === null) {
        throw new ProjectError("corrupt-entry", `Entry ${quoted(name)} is not a PNG file.`, {
            entry: name,
        });
    }
    if (header.width !== width || header.height !== height) {
        throw new ProjectError(
            "image-size",
            `Entry ${quoted(name)} is an image of ${header.width}×${header.height} pixels; ` +
                `${what} states ${width}×${height}.`,
            { entry: name },
        );
    }
    const { bitDepth, colorType, interlace } = header;
    if (bitDepth !== BIT_DEPTH || colorType !== COLOR_TYPE_RGBA || interlace !== 0) {
        throw new ProjectError(
            "image-format",
            `Entry ${quoted(name)} is a PNG of colour type ${colorType} with ${bitDepth} bits ` +
                `per sample${interlace === 0 ? "" : ", interlaced"}; it must be 8-bit RGBA ` +
                `(colour type 6), not interlaced.`,
            { entry: name },
        );
    }
    try {
        return await decodePng(bytes);
    } catch (cause) {
        if (!(cause instanceof PngError) || cause.code === "memory") throw cause;
        throw new ProjectError(
            "corrupt-entry",
            `Entry ${quoted(name)} is damaged: ${cause.message}`,
            {
                entry: name,
                cause,
            },
        );
    }
}

/** The reader, with the limit of all entries together as a parameter for tests. */
export async function readProjectFile(
    bytes: Uint8Array,
    maxContentBytes: number = MAX_CONTENT_BYTES,
): Promise<Project> {
    // Step 1: the container.
    let archive;
    try {
        archive = openZip(bytes, maxContentBytes);
    } catch (error) {
        throw fromContainerError(error);
    }
    const read: ReadEntry = (name, maxBytes) => {
        try {
            return archive.read(name, maxBytes);
        } catch (error) {
            throw fromContainerError(error, name);
        }
    };

    // Step 2: the manifest.
    const manifestBytes = read(MANIFEST_ENTRY, MAX_MANIFEST_BYTES);
    if (manifestBytes === undefined) {
        throw new ProjectError(
            "missing-manifest",
            `The file has no entry "${MANIFEST_ENTRY}": it is not a tilemap project.`,
            { entry: MANIFEST_ENTRY },
        );
    }
    const { version } = readManifest(parseJson(manifestBytes, MANIFEST_ENTRY));

    // Step 3: project.json.
    const projectBytes = required(read, PROJECT_ENTRY, MAX_PROJECT_JSON_BYTES, "the project");
    const skeleton = readProjectJson(
        migrate("project", parseJson(projectBytes, PROJECT_ENTRY), version),
    );
    const { project } = skeleton;

    // Step 4: every map, in list order.
    const context = { project, exportNames: takenExportNames(project) };
    for (const mapId of skeleton.mapIds) {
        const name = mapEntry(mapId);
        const mapBytes = required(read, name, MAX_MAP_JSON_BYTES, `the project lists map ${mapId}`);
        project.maps.push(
            readMapJson(migrate("map", parseJson(mapBytes, name), version), mapId, context),
        );
    }

    // Step 5: the pixel limits from the stated sizes.
    assertPixelLimits(project);

    // Step 6: the pixels, one image at a time.
    for (const tileset of project.tilesets) {
        const { width, height } = tileset.pixels;
        tileset.pixels = await readPng(
            read,
            tilesetEntry(tileset.id),
            width,
            height,
            `tileset ${tileset.id}`,
        );
    }
    for (const image of project.images) {
        const { width, height } = image.pixels;
        image.pixels = await readPng(
            read,
            imageEntry(image.id),
            width,
            height,
            `image ${image.id}`,
        );
    }
    return project;
}

/**
 * Reads a `.ngtilemap` project file (FORMAT §2) in the order of §2.9, stopping at the first
 * problem: the container; `manifest.json`; `project.json`, migrated when older; every map; the
 * pixel limits from the stated sizes; every tileset and image PNG, its header before decoding.
 * Every size limit of §2.8 is checked before what it bounds is inflated, decoded or allocated.
 * Tilesets get slots 1, 2, … in list order and cells become in-memory values (SPEC §2.2).
 * Thumbnails and entries the format does not name are not read. `bytes` is untrusted and must
 * not change before the promise settles; the result shares no memory with it.
 *
 * Rejects with `ProjectError`, whose `code` says what failed and whose `entry` names the entry
 * at fault when there is one. A project is returned whole or not at all.
 */
export async function deserialize(bytes: Uint8Array): Promise<Project> {
    try {
        return await readProjectFile(bytes);
    } catch (error) {
        const memory =
            error instanceof RangeError || (error instanceof PngError && error.code === "memory");
        if (!memory) throw error;
        throw new ProjectError("memory", "There is not enough memory to open the project.", {
            cause: error,
        });
    }
}
