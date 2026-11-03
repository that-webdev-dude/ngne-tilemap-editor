import { MAX_ANIMATION_FRAMES, MAX_ANIMATION_FRAMES_PER_TILESET, MAX_TILE_SIZE } from "../model";
import type { PixelBuffer, Project } from "../model";
import { expandTag } from "../sprite/animation";
import type { TagPlayback } from "../sprite/animation";
import { compositeFrame } from "../sprite/composite/compositeFrame";
import type { SpriteDoc } from "../sprite/model";
import { deserialize } from "../sprite/project/deserialize";
import type { ProjectContents } from "../sprite/project/deserialize";
import { assertPixelBytes, assertSkeleton, readDocJson } from "../sprite/project/docFromJson";
import { ProjectError } from "../sprite/project/errors";
import {
    DOC_ENTRY,
    MANIFEST_ENTRY,
    MAX_DOC_JSON_BYTES,
    MAX_MANIFEST_BYTES,
    MAX_PROJECT_CONTENT_BYTES,
    PROJECT_VERSION,
} from "../sprite/project/format";
import { parseJson } from "../sprite/project/json";
import { readManifest } from "../sprite/project/manifest";
import { migrateDocJson } from "../sprite/project/migrations";
import { openZip } from "../sprite/project/zip";
import { buildTileset, storedColumns, storedImage, storedOrigin, tilesetNameOf } from "./build";
import type { TilesetImport, TilesetImportOptions, TilesetImportWarning } from "./build";
import { TilesetImportError } from "./errors";
import { checkGridOptions, gridCount } from "./gridPng";
import type { GridOptions } from "./gridPng";
import { checkLimits, checkPackability } from "./room";
import type { TilesetShape } from "./room";

// Sprite project `.ngsprite` → tileset (SPEC §6.1). The file is read by the sprite editor's
// reader and every frame composited as its export does (`compositeFrame`), then cut by a grid
// like a grid PNG. Tiles are the cells of every frame, frames in order and cells row by row; a
// cell equal to the same cell of an earlier frame is that cell's tile, not a new one. Source
// keys are `[frameId, column, row]` of the first occurrence. Each tag (or, with several frames
// and no tag, one over all frames) is expanded with `expandTag`; every cell whose tile changes
// within it animates the tile it shows first through its tiles, so that with one tile per
// frame the tileset matches the import of the sprite editor's atlas export.

/** Reads a `.ngsprite` whole: the sprite editor's `deserialize` outside tests. */
export type SpriteReader = (bytes: Uint8Array) => Promise<ProjectContents>;

/** The sprite editor's document, as the import reads it. */
export type { SpriteDoc };

export interface SpriteImportOptions extends TilesetImportOptions, GridOptions {}

/** The sprite editor's refusal as an import refusal; anything else is rethrown. */
function refused(error: unknown): TilesetImportError {
    if (!(error instanceof ProjectError)) throw error;
    return new TilesetImportError("sprite", error.message, { cause: error });
}

/** The manifest's `version`, read without checking anything else; null when there is none. */
function statedVersion(bytes: Uint8Array): unknown {
    try {
        const manifest = parseJson(bytes, MANIFEST_ENTRY);
        return typeof manifest === "object" && manifest !== null
            ? (manifest as { version?: unknown }).version
            : null;
    } catch {
        return null;
    }
}

/**
 * The document of a `.ngsprite` without its images: its size, grid, frames and tags, read the
 * way the sprite editor's `deserialize` reads them, without decoding a pixel. Throws
 * `TilesetImportError` ("sprite") for a file the sprite editor's reader refuses; a file of a
 * newer schema version is refused naming both versions.
 */
export function readSpriteOutline(bytes: Uint8Array): SpriteDoc {
    try {
        const archive = openZip(bytes, MAX_PROJECT_CONTENT_BYTES);
        const manifestBytes = archive.read(MANIFEST_ENTRY, MAX_MANIFEST_BYTES);
        if (!manifestBytes) {
            throw new ProjectError(
                "missing-manifest",
                `The file has no entry "${MANIFEST_ENTRY}": it is not a sprite project.`,
                { entry: MANIFEST_ENTRY },
            );
        }
        let manifest;
        try {
            manifest = readManifest(parseJson(manifestBytes, MANIFEST_ENTRY));
        } catch (error) {
            if (error instanceof ProjectError && error.code === "newer-version") {
                throw new ProjectError(
                    "newer-version",
                    `The sprite project has schema version ${String(statedVersion(manifestBytes))}; ` +
                        `this editor reads sprite projects up to version ${PROJECT_VERSION}.`,
                    { entry: MANIFEST_ENTRY, cause: error },
                );
            }
            throw error;
        }
        const docBytes = archive.read(DOC_ENTRY, MAX_DOC_JSON_BYTES);
        if (!docBytes) {
            throw new ProjectError("missing-document", `The file has no entry "${DOC_ENTRY}".`, {
                entry: DOC_ENTRY,
            });
        }
        const skeleton = readDocJson(
            migrateDocJson(parseJson(docBytes, DOC_ENTRY), manifest.version),
        );
        assertPixelBytes(skeleton.doc, skeleton.imageIds.length);
        assertSkeleton(skeleton);
        return skeleton.doc;
    } catch (error) {
        if (error instanceof RangeError) {
            throw new TilesetImportError("sprite", "There is not enough memory to read the file.", {
                cause: error,
            });
        }
        throw refused(error);
    }
}

/**
 * The grid the import dialog starts from (SPEC §6.1): the sprite's grid when its cell is at
 * most 256 px a side, its offset as the margin when that is one value and not negative (else
 * 0); else the whole canvas, one tile per frame, when it is at most 256 px a side; else null,
 * and the user supplies a size.
 */
export function spriteGridDefaults(
    doc: Pick<SpriteDoc, "width" | "height" | "settings">,
): GridOptions | null {
    const { width, height, offsetX, offsetY } = doc.settings.grid;
    if (width <= MAX_TILE_SIZE && height <= MAX_TILE_SIZE) {
        const margin = offsetX === offsetY && offsetX >= 0 ? offsetX : 0;
        return { tileWidth: width, tileHeight: height, margin, spacing: 0 };
    }
    if (doc.width <= MAX_TILE_SIZE && doc.height <= MAX_TILE_SIZE) {
        return { tileWidth: doc.width, tileHeight: doc.height, margin: 0, spacing: 0 };
    }
    return null;
}

/** The tags a sprite imports: its own, or with several frames and none, one over all. */
function importedTags(doc: SpriteDoc): (TagPlayback & { name: string })[] {
    if (doc.tags.length > 0) return doc.tags;
    if (doc.frames.length < 2) return [];
    return [
        {
            name: doc.name,
            fromFrameId: doc.frames[0]!.id,
            toFrameId: doc.frames[doc.frames.length - 1]!.id,
            direction: "forward",
            repeat: 0,
        },
    ];
}

/** The cells of one frame cut by `options`: per row and per column. */
function frameGrid(doc: SpriteDoc, options: GridOptions): { columns: number; rows: number } {
    const { tileWidth, tileHeight, margin, spacing } = options;
    return {
        columns: gridCount(doc.width, tileWidth, margin, spacing),
        rows: gridCount(doc.height, tileHeight, margin, spacing),
    };
}

/** The shape of `tileCount` tiles of `options` for `fileName`, stored about square. */
function spriteShape(options: SpriteImportOptions, tileCount: number): TilesetShape {
    const { tileWidth, tileHeight } = options;
    return {
        name: tilesetNameOf(options.fileName),
        tileCount,
        tileWidth,
        tileHeight,
        columns: storedColumns(tileCount, tileWidth, tileHeight),
    };
}

/**
 * Checks `doc` against `project` from its outline alone, without a pixel: refused with
 * `TilesetImportError` when the options are out of range, no whole tile fits the canvas, the
 * cells of one frame (each a tile of its own) already exceed a limit of FORMAT §2.8, or the
 * cells of all frames, counted as distinct tiles, would not pack (SPEC §6.1). Returns the
 * shape of that many tiles. The limits are checked again on the tiles the import makes.
 */
export function planSprite(
    project: Project,
    doc: SpriteDoc,
    options: SpriteImportOptions,
): TilesetShape {
    checkGridOptions(options);
    const { tileWidth, tileHeight, margin, spacing } = options;
    const { columns, rows } = frameGrid(doc, options);
    if (columns === 0 || rows === 0) {
        throw new TilesetImportError(
            "no-tiles",
            `No whole tile of ${tileWidth} × ${tileHeight} px fits the sprite of ` +
                `${doc.width} × ${doc.height} px with margin ${margin} and spacing ${spacing}.`,
        );
    }
    // Every cell of a frame is a tile, as cells repeat only the same cell of an earlier frame.
    checkLimits(project, spriteShape(options, columns * rows));
    // Without pixels every cell of every frame may be a tile of its own.
    const cells = doc.frames.length * columns * rows;
    checkPackability(spriteShape(options, cells), cells);
    return spriteShape(options, columns * rows);
}

/** FNV-1a of `bytes`: a quick key for finding equal cells; equality is then checked. */
function hashOf(bytes: Uint8Array): number {
    let hash = 0x811c9dc5;
    for (let at = 0; at < bytes.length; at++) hash = Math.imul(hash ^ bytes[at]!, 0x01000193);
    return hash >>> 0;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false;
    return true;
}

/** The pixels of the `width × height` area at `(x, y)` of `image`, rows top to bottom. */
function cut(image: PixelBuffer, x: number, y: number, width: number, height: number): Uint8Array {
    const row = width * 4;
    const bytes = new Uint8Array(row * height);
    for (let dy = 0; dy < height; dy++) {
        const from = ((y + dy) * image.width + x) * 4;
        bytes.set(image.data.subarray(from, from + row), dy * row);
    }
    return bytes;
}

/**
 * Imports `doc`, a sprite read whole (with its images), as a new tileset of `project` (not
 * added yet: see `addTilesetCommand`). Throws `TilesetImportError` as `planSprite` does, and
 * ("limit") as soon as the tiles made exceed a limit of FORMAT §2.8, a tag would animate a
 * tile through more than 1024 frames, or the animations would hold more than 65 536 frames
 * together.
 */
export function importSpriteDocument(
    project: Project,
    doc: SpriteDoc,
    options: SpriteImportOptions,
): TilesetImport {
    planSprite(project, doc, options);
    const { tileWidth, tileHeight, margin, spacing } = options;
    const { columns, rows } = frameGrid(doc, options);
    const cells = columns * rows;

    // Tiles in order of first occurrence, and per frame and cell the tile it shows.
    const tilePixels: Uint8Array[] = [];
    const keys: [string, number, number][] = [];
    const tileAt = new Int32Array(doc.frames.length * cells);
    const byContent = new Map<string, number[]>();
    let composite: PixelBuffer | undefined;
    doc.frames.forEach((frame, f) => {
        composite = compositeFrame(doc, frame.id, composite ? { into: composite } : {});
        for (let cell = 0; cell < cells; cell++) {
            const column = cell % columns;
            const row = Math.floor(cell / columns);
            const x = margin + column * (tileWidth + spacing);
            const y = margin + row * (tileHeight + spacing);
            const bytes = cut(composite, x, y, tileWidth, tileHeight);
            const key = `${cell}:${hashOf(bytes)}`;
            const candidates = byContent.get(key) ?? [];
            let tile = candidates.find((id) => sameBytes(tilePixels[id]!, bytes));
            if (tile === undefined) {
                tile = tilePixels.length;
                tilePixels.push(bytes);
                keys.push([frame.id, column, row]);
                candidates.push(tile);
                byContent.set(key, candidates);
            }
            tileAt[f * cells + cell] = tile;
        }
        // Refused as soon as the tiles made so far exceed a limit, before more are held.
        checkLimits(project, spriteShape(options, tilePixels.length));
    });

    const shape = spriteShape(options, tilePixels.length);
    const pixels = storedImage(shape);
    const row = tileWidth * 4;
    tilePixels.forEach((bytes, k) => {
        const to = storedOrigin(shape, k);
        for (let dy = 0; dy < tileHeight; dy++) {
            pixels.data.set(
                bytes.subarray(dy * row, (dy + 1) * row),
                ((to.y + dy) * pixels.width + to.x) * 4,
            );
        }
    });
    const tileset = buildTileset(
        project,
        options,
        { kind: "sprite", fileName: options.fileName, margin, spacing },
        shape,
        pixels,
        keys,
    );

    const warnings: TilesetImportWarning[] = [];
    const animatedBy = new Map<number, string>();
    const frameIndex = new Map(doc.frames.map((frame, index) => [frame.id, index]));
    let entries = 0;
    for (const tag of importedTags(doc)) {
        const played = expandTag(doc, tag);
        const frames = played.map((entry) => frameIndex.get(entry.frameId)!);
        const earlier = new Set<string>();
        let animated = 0;
        let dropped = 0;
        for (let cell = 0; cell < cells; cell++) {
            const tiles = frames.map((f) => tileAt[f * cells + cell]!);
            const host = tiles[0]!;
            if (tiles.every((tile) => tile === host)) continue;
            if (tiles.length > MAX_ANIMATION_FRAMES) {
                throw new TilesetImportError(
                    "limit",
                    `The tag ${JSON.stringify(tag.name)} plays ${tiles.length} frames; a tile's ` +
                        `animation holds at most ${MAX_ANIMATION_FRAMES} frames.`,
                );
            }
            const owner = animatedBy.get(host);
            if (owner !== undefined) {
                earlier.add(owner);
                dropped++;
                continue;
            }
            animatedBy.set(host, tag.name);
            tileset.tiles[host]!.animation = tiles.map((tile, i) => ({ tile, ms: played[i]!.ms }));
            entries += tiles.length;
            animated++;
        }
        if (dropped > 0) {
            const owners = [...earlier].map((name) => JSON.stringify(name)).join(", ");
            warnings.push({
                code: "duplicate-animation",
                animation: tag.name,
                message:
                    `The tag ${JSON.stringify(tag.name)} was left out on ${dropped} ` +
                    `${dropped === 1 ? "cell" : "cells"}: the tile it starts on is animated by ` +
                    `the tag ${owners} already.`,
            });
        }
        if (animated > 0 && tag.repeat !== 0) {
            warnings.push({
                code: "once-animation",
                animation: tag.name,
                message:
                    `The tag ${JSON.stringify(tag.name)} plays ${tag.repeat} ` +
                    `${tag.repeat === 1 ? "time" : "times"} in the sprite; it loops here.`,
            });
        }
    }
    if (entries > MAX_ANIMATION_FRAMES_PER_TILESET) {
        throw new TilesetImportError(
            "limit",
            `The animations would hold ${entries} frames together; a tileset's animations ` +
                `hold at most ${MAX_ANIMATION_FRAMES_PER_TILESET}.`,
        );
    }
    return { tileset, warnings };
}

/**
 * Imports the `.ngsprite` `bytes` as a new tileset of `project` (not added yet: see
 * `addTilesetCommand`). The outline is read and checked against the options, the limits and
 * packability before `read` decodes any image. Rejects with `TilesetImportError`: "sprite" for
 * a file the sprite editor's reader refuses (a newer version named with both versions), and
 * what `importSpriteDocument` refuses.
 */
export async function importSprite(
    project: Project,
    bytes: Uint8Array,
    options: SpriteImportOptions,
    read: SpriteReader = deserialize,
): Promise<TilesetImport> {
    planSprite(project, readSpriteOutline(bytes), options);
    return importSpriteDocument(project, await readSprite(bytes, read), options);
}

/**
 * The sprite of the `.ngsprite` `bytes` read whole, with its images, by the sprite editor's
 * reader (`read`). Rejects with `TilesetImportError` ("sprite") for a file it refuses.
 */
export async function readSprite(
    bytes: Uint8Array,
    read: SpriteReader = deserialize,
): Promise<SpriteDoc> {
    try {
        return (await read(bytes)).doc;
    } catch (error) {
        throw refused(error);
    }
}

/**
 * Frame `index` of `doc` composited as the sprite editor exports it (`compositeFrame`): what
 * the import dialog shows under its frame select.
 */
export function spriteFramePixels(doc: SpriteDoc, index: number): PixelBuffer {
    const frame = doc.frames[index];
    if (!frame) throw new RangeError(`The sprite has no frame ${index}.`);
    return compositeFrame(doc, frame.id);
}
