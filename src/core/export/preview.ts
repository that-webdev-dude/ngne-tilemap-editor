import type { Project } from "../model";
import { exportFiles } from "./exportFiles";
import type { ExportFile, ExportFileKind } from "./exportFiles";

// What the Export dialog shows of an export before it is made (SPEC §10.2, DESIGN §9): every
// file of the plan with its size, grouped as the dialog lists them, and the packed image of each
// tileset with its rectangles. It is the plan itself (`exportFiles`), so the sizes are those of
// the files an export of the same project writes.

/** The groups of the dialog's file list, in the order it shows them (DESIGN §9). */
export type ExportFileGroup = "tilemaps" | "tilesets" | "images" | "runtime";

export const EXPORT_FILE_GROUPS: readonly ExportFileGroup[] = [
    "tilemaps",
    "tilesets",
    "images",
    "runtime",
];

/**
 * The group a file is listed in. The marker goes with the runtime: both are the folder's own
 * `ngne-tilemap.*` files, not files of one map, tileset or image.
 */
export function exportFileGroup(kind: ExportFileKind): ExportFileGroup {
    switch (kind) {
        case "tilemap":
            return "tilemaps";
        case "tileset-png":
        case "atlas":
            return "tilesets";
        case "image-png":
            return "images";
        case "marker":
        case "runtime":
            return "runtime";
    }
}

/** One file of the plan, without its bytes. */
export interface ExportPreviewFile {
    name: string;
    kind: ExportFileKind;
    /** Its size in bytes. */
    size: number;
}

/** A rectangle of a packed tileset image, in its pixels. */
export interface AtlasRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A packed tileset as the dialog shows it. */
export interface ExportPreviewAtlas {
    /** The tileset's export name. */
    name: string;
    /** The PNG file of its packed image (`<name>.png`), as the export writes it. */
    png: Uint8Array<ArrayBuffer>;
    width: number;
    height: number;
    /** One per distinct rectangle: tiles with identical pixels share one. */
    rects: AtlasRect[];
}

export interface ExportPreview {
    /** Every file of the plan, in write order. */
    files: ExportPreviewFile[];
    /** Every tileset's packed image, in project order. */
    atlases: ExportPreviewAtlas[];
    /** The plan itself, with the bytes: what the dialog's Export writes when nothing changed. */
    plan: readonly ExportFile[];
}

interface AtlasJson {
    image: string;
    width: number;
    height: number;
    frames: Record<string, AtlasRect>;
}

/** The distinct rectangles of an atlas's frames, first seen first. */
function distinctRects(frames: Record<string, AtlasRect>): AtlasRect[] {
    const seen = new Map<string, AtlasRect>();
    for (const { x, y, w, h } of Object.values(frames)) {
        const key = `${x},${y},${w},${h}`;
        if (!seen.has(key)) seen.set(key, { x, y, w, h });
    }
    return [...seen.values()];
}

/** The preview of `files`, the plan of a project (`exportFiles`). */
export function previewOf(files: readonly ExportFile[]): ExportPreview {
    const byName = new Map(files.map((file) => [file.name, file]));
    const decoder = new TextDecoder();
    const atlases: ExportPreviewAtlas[] = [];
    for (const file of files) {
        if (file.kind !== "atlas") continue;
        const atlas = JSON.parse(decoder.decode(file.bytes)) as AtlasJson;
        const png = byName.get(atlas.image);
        if (!png) continue;
        atlases.push({
            name: file.name.slice(0, -".atlas.json".length),
            png: png.bytes,
            width: atlas.width,
            height: atlas.height,
            rects: distinctRects(atlas.frames),
        });
    }
    return {
        files: files.map(({ name, kind, bytes }) => ({ name, kind, size: bytes.length })),
        atlases,
        plan: files,
    };
}

/**
 * The preview of `project`'s export. Throws what `exportFiles` throws: `TilesetPackError`
 * naming a tileset whose atlas would exceed 8192 px a side.
 */
export function exportPreview(project: Project): ExportPreview {
    return previewOf(exportFiles(project));
}
