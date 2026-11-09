import { compositeThumbnail } from "../compositor";
import type { PixelBuffer, Project, Tileset } from "../model";
import { PngError, encodePng } from "../sprite/png";
import { writeZip } from "../sprite/project/zip";
import type { ZipInput } from "../sprite/project/zip";
import { ProjectError, quoted } from "./errors";
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
    thumbnailEntry,
    tilesetEntry,
} from "./format";
import { encodeJson } from "./json";
import { projectManifest } from "./manifest";
import { readMapJson } from "./readMap";
import { assertPixelLimits, readProjectJson, takenExportNames } from "./readProject";
import { mapJson, projectJson } from "./toJson";

// The writer of FORMAT §2. It makes the checks of reading steps 3 to 6 (§2.9) on what it is
// about to write, through the reader's own functions, so it never writes a file it could not
// read back; then it writes the entries in the order of §2.2.

function assertSize(entry: string, bytes: Uint8Array, limit: number): void {
    if (bytes.length > limit) {
        throw new ProjectError(
            "too-large",
            `Entry ${quoted(entry)} would hold ${bytes.length} bytes; the limit is ${limit} bytes.`,
            { entry },
        );
    }
}

/** A tileset's pixels with every pixel no tile covers transparent black (FORMAT §2.6). */
function storedTilesetPixels(tileset: Tileset): PixelBuffer {
    const { pixels, columns, tileWidth, tileHeight } = tileset;
    const covered = tileset.tiles.length % columns;
    if (covered === 0) return pixels;
    const top = pixels.height - tileHeight;
    const left = covered * tileWidth;
    const rowBytes = pixels.width * 4;
    const clean = (data: Uint8ClampedArray) => {
        for (let y = top; y < pixels.height; y += 1) {
            data.fill(0, y * rowBytes + left * 4, (y + 1) * rowBytes);
        }
    };
    for (let y = top; y < pixels.height; y += 1) {
        const row = pixels.data.subarray(y * rowBytes + left * 4, (y + 1) * rowBytes);
        if (row.some((byte) => byte !== 0)) {
            const copy = { ...pixels, data: new Uint8ClampedArray(pixels.data) };
            clean(copy.data);
            return copy;
        }
    }
    return pixels;
}

/** A PNG entry of `buffer`, which must have the stated size; within its limit. */
function pngEntry(entry: string, buffer: PixelBuffer, width: number, height: number): ZipInput {
    if (
        buffer.width !== width ||
        buffer.height !== height ||
        buffer.data.length !== width * height * 4
    ) {
        throw new ProjectError(
            "image-size",
            `Entry ${quoted(entry)} would be an image of ${buffer.width}×${buffer.height} pixels ` +
                `with ${buffer.data.length} bytes; it must be ${width}×${height}.`,
            { entry },
        );
    }
    let data: Uint8Array;
    try {
        data = encodePng(buffer);
    } catch (cause) {
        if (!(cause instanceof PngError)) throw cause;
        throw new ProjectError("memory", `Entry ${quoted(entry)} could not be encoded.`, {
            entry,
            cause,
        });
    }
    assertSize(entry, data, maxPngBytes(width, height));
    return { name: entry, data, stored: true };
}

/**
 * The `.ngtilemap` file of a project (FORMAT §2): `manifest.json`, `project.json`, every map,
 * every tileset and image PNG, a thumbnail per map, in that order; JSON deflated, PNG stored.
 * Cells are written as GIDs of each map's `firstGid` table (SPEC §2.2). The same project
 * always gives the same bytes.
 *
 * Throws `ProjectError`, naming the entry, when the project breaks a rule or limit the reader
 * checks (codes "invalid-project", "invalid-map", "image-size", "too-large") or memory runs out
 * ("memory"): nothing is written that could not be read back.
 */
export function serialize(project: Project): Uint8Array<ArrayBuffer> {
    try {
        return writeProject(project);
    } catch (cause) {
        if (!(cause instanceof RangeError)) throw cause;
        throw new ProjectError("memory", "There is not enough memory to save the project.", {
            cause,
        });
    }
}

function writeProject(project: Project): Uint8Array<ArrayBuffer> {
    const entries: ZipInput[] = [];
    const json = (name: string, value: unknown, limit: number) => {
        const data = encodeJson(value);
        assertSize(name, data, limit);
        entries.push({ name, data, stored: false });
    };
    json(MANIFEST_ENTRY, projectManifest(), MAX_MANIFEST_BYTES);

    // Step 3 on the project's own JSON: what the reader would make of it.
    const projectValue = projectJson(project);
    const skeleton = readProjectJson(projectValue);
    json(PROJECT_ENTRY, projectValue, MAX_PROJECT_JSON_BYTES);

    // Step 4: every map, against the project as read.
    const context = { project: skeleton.project, exportNames: takenExportNames(skeleton.project) };
    for (const map of project.maps) {
        const value = mapJson(project, map);
        readMapJson(value, map.id, context);
        json(mapEntry(map.id), value, MAX_MAP_JSON_BYTES);
    }

    // Steps 5 and 6: the pixel limits, then every PNG at the size `project.json` states.
    assertPixelLimits(skeleton.project);
    project.tilesets.forEach((tileset, index) => {
        const { width, height } = skeleton.project.tilesets[index]!.pixels;
        entries.push(
            pngEntry(tilesetEntry(tileset.id), storedTilesetPixels(tileset), width, height),
        );
    });
    project.images.forEach((image) => {
        entries.push(
            pngEntry(imageEntry(image.id), image.pixels, image.pixels.width, image.pixels.height),
        );
    });
    for (const map of project.maps) {
        const thumbnail = compositeThumbnail(project, map);
        entries.push(
            pngEntry(thumbnailEntry(map.id), thumbnail, thumbnail.width, thumbnail.height),
        );
    }

    let total = 0;
    for (const entry of entries) {
        total += entry.data.length;
        if (total > MAX_CONTENT_BYTES) {
            throw new ProjectError(
                "too-large",
                `The entries of the project would hold more than ${MAX_CONTENT_BYTES} bytes.`,
                { entry: entry.name },
            );
        }
    }
    return writeZip(entries);
}
