import type { PixelBuffer, Project } from "../model";
import { evenSide, packTileset } from "../pack";
import type { PackedTileset } from "../pack";
import { generateRuntime } from "../runtime/generate";
import { encodePng } from "../sprite/png";
import { tilemapFor } from "../tilemap";
import { EXPORT_MARKER_FILE, exportMarkerBytes } from "./marker";

// The export plan of SPEC §10.2: every file of a project's export folder (FORMAT §5), with its
// bytes, in the order the export writes them: the marker, then the PNGs (tileset atlases, then
// images), the atlases, the tilemap JSON and the runtime (BRIEF §5). A game's dev server that
// watches the folder sees an atlas only after its PNG, a tilemap only after its atlases, and the
// runtime, which names them all, last.

/** The generated runtime's file name. */
export const RUNTIME_FILE = "ngne-tilemap.ts";

/** What a file of the export folder is. */
export type ExportFileKind =
    "marker" | "tileset-png" | "image-png" | "atlas" | "tilemap" | "runtime";

/** One file of the export folder. */
export interface ExportFile {
    /** File name without a folder (FORMAT §5). */
    name: string;
    kind: ExportFileKind;
    /** The whole file. */
    bytes: Uint8Array<ArrayBuffer>;
}

const text = (content: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(content);

/**
 * An image as the export writes it (FORMAT §5): its pixels in the top-left corner of an image
 * whose sides are rounded up to even, the extra column on the right and the extra row at the
 * bottom transparent. So a renderer that rounds sprite centres, as NGNE does with `pixelSnap`,
 * draws the image as a quad whose edges fall on whole pixels (FORMAT §3.4). An image of even
 * sides is returned as it is.
 */
export function evenImage(pixels: PixelBuffer): PixelBuffer {
    const width = evenSide(pixels.width);
    const height = evenSide(pixels.height);
    if (width === pixels.width && height === pixels.height) return pixels;
    const data = new Uint8ClampedArray(width * height * 4);
    const row = pixels.width * 4;
    for (let y = 0; y < pixels.height; y += 1) {
        data.set(pixels.data.subarray(y * row, (y + 1) * row), y * width * 4);
    }
    return { width, height, data };
}

/**
 * The names of `project`'s export files in write order, without making them: what the export
 * looks for in a folder before its first write there (SPEC §10.2).
 */
export function exportFileNames(project: Project): string[] {
    return [
        EXPORT_MARKER_FILE,
        ...project.tilesets.map((tileset) => `${tileset.exportName}.png`),
        ...project.images.map((image) => `${image.exportName}.png`),
        ...project.tilesets.map((tileset) => `${tileset.exportName}.atlas.json`),
        ...project.maps.map((map) => `${map.exportName}.tilemap.json`),
        RUNTIME_FILE,
    ];
}

/**
 * Every file of `project`'s export folder (FORMAT §5), in write order (`exportFileNames`):
 *
 * - `ngne-tilemap.export.json`: the marker naming the project.
 * - Per tileset, in project order: `<name>.png`, the image `packTileset` packs, and
 *   `<name>.atlas.json`, its `ngne-sprite-atlas` (FORMAT §4) as the sprite editor writes an
 *   atlas: four-space JSON with a line feed at the end.
 * - Per image, in project order: `<name>.png` of its pixels (colour type 6, bit depth 8), its
 *   sides rounded up to even with transparent pixels (`evenImage`).
 * - Per map, in project order: `<name>.tilemap.json` (`tilemapFor`).
 * - `ngne-tilemap.ts`: the runtime generated for these maps, tilesets and images.
 *
 * Deterministic: the same project gives the same bytes. The project is only read.
 * Every tileset is packed before any file is made, so a tileset whose atlas would exceed
 * 8192 px a side fails at once with `TilesetPackError`, whose message names it.
 */
export function exportFiles(project: Project): ExportFile[] {
    const packed: PackedTileset[] = project.tilesets.map((tileset) => packTileset(tileset));
    const files: ExportFile[] = [
        { name: EXPORT_MARKER_FILE, kind: "marker", bytes: exportMarkerBytes(project) },
    ];
    project.tilesets.forEach((tileset, index) => {
        files.push({
            name: `${tileset.exportName}.png`,
            kind: "tileset-png",
            bytes: encodePng(packed[index]!.image),
        });
    });
    for (const image of project.images) {
        files.push({
            name: `${image.exportName}.png`,
            kind: "image-png",
            bytes: encodePng(evenImage(image.pixels)),
        });
    }
    project.tilesets.forEach((tileset, index) => {
        files.push({
            name: `${tileset.exportName}.atlas.json`,
            kind: "atlas",
            bytes: text(`${JSON.stringify(packed[index]!.atlas, null, 4)}\n`),
        });
    });
    for (const map of project.maps) {
        files.push({
            name: `${map.exportName}.tilemap.json`,
            kind: "tilemap",
            bytes: text(tilemapFor(project, map)),
        });
    }
    files.push({
        name: RUNTIME_FILE,
        kind: "runtime",
        bytes: text(
            generateRuntime({
                tilemaps: project.maps.map((map) => map.exportName),
                tilesets: project.tilesets.map((tileset) => tileset.exportName),
                images: project.images.map((image) => image.exportName),
            }),
        ),
    });
    return files;
}
