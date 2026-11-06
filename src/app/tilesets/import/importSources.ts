import { MAX_IMAGE_SIDE } from "../../../core/model";
import {
    TilesetImportError,
    readAtlasJson,
    readAtlasOutline,
    readPngSize,
    readSpriteOutline,
} from "../../../core/tileset";
import type { AtlasOutline, SpriteDoc } from "../../../core/tileset";
import { reason } from "../errorReason";

// The files of one tileset import (SPEC §6.1, SUITE §7), read and recognised by their names: a
// grid PNG, a sprite project, or an atlas (its `.atlas.json` and its PNG, picked or dropped
// together). Only what needs no decoding is read here: a PNG's header, a sprite's outline, an
// atlas's JSON. A file the import cannot take still makes a source, with the reason, so the
// dialog shows it (TE-024: refusals are shown in the dialog).

/** A file picked or dropped: its name, and its bytes read when asked. */
export interface PickedFile {
    readonly name: string;
    read(): Promise<Uint8Array>;
}

export type ImportSource =
    | {
          kind: "image";
          fileName: string;
          bytes: Uint8Array;
          size: { width: number; height: number };
      }
    | {
          kind: "sprite";
          fileName: string;
          bytes: Uint8Array;
          /** Names this file to the worker, which reads it whole once (`tileset.task.ts`). */
          key: string;
          /** The sprite without its images. */
          doc: SpriteDoc;
      }
    | {
          kind: "atlas";
          fileName: string;
          json: unknown;
          outline: AtlasOutline;
          png: { fileName: string; bytes: Uint8Array };
          size: { width: number; height: number };
      }
    | {
          /** The file could not be taken; the dialog shows why. */
          kind: "refused";
          fileName: string;
          message: string;
      };

export type ImportSourceKind = ImportSource["kind"];

export const isPngName = (name: string) => /\.png$/i.test(name);
export const isSpriteName = (name: string) => /\.ngsprite$/i.test(name);
export const isAtlasName = (name: string) => /\.atlas\.json$/i.test(name);

/** Whether the import takes a file of this name (SUITE §7). */
export function isTilesetSourceName(name: string): boolean {
    return isPngName(name) || isSpriteName(name) || isAtlasName(name);
}

let lastKey = 0;

/** The atlas's PNG among `files`: the one its `image` names, else the only PNG. */
function atlasPng(json: unknown, files: readonly PickedFile[]): PickedFile | null {
    const pngs = files.filter((file) => isPngName(file.name));
    const image =
        typeof json === "object" && json !== null ? (json as { image?: unknown }).image : null;
    const named = pngs.find((file) => file.name === image);
    return named ?? (pngs.length === 1 ? pngs[0]! : null);
}

/** The image the atlas names, for the message that asks for it. */
function imageName(json: unknown): string | null {
    const image =
        typeof json === "object" && json !== null ? (json as { image?: unknown }).image : null;
    return typeof image === "string" ? image : null;
}

async function readAtlas(atlas: PickedFile, files: readonly PickedFile[]): Promise<ImportSource> {
    const json = readAtlasJson(await atlas.read(), atlas.name);
    const png = atlasPng(json, files);
    if (!png) {
        const image = imageName(json);
        throw new TilesetImportError(
            "atlas",
            `An atlas is imported with its PNG: pick ${JSON.stringify(atlas.name)} and ` +
                `${image ? JSON.stringify(image) : "its PNG"} together.`,
        );
    }
    const bytes = await png.read();
    const size = readPngSize(bytes);
    return {
        kind: "atlas",
        fileName: atlas.name,
        json,
        outline: readAtlasOutline(json, size),
        png: { fileName: png.name, bytes },
        size,
    };
}

async function readOne(file: PickedFile): Promise<ImportSource> {
    if (isSpriteName(file.name)) {
        const bytes = await file.read();
        return {
            kind: "sprite",
            fileName: file.name,
            bytes,
            key: `sprite-${++lastKey}`,
            doc: readSpriteOutline(bytes),
        };
    }
    const bytes = await file.read();
    return { kind: "image", fileName: file.name, bytes, size: readPngSize(bytes) };
}

/**
 * The source of `files`: an atlas when an `.atlas.json` is among them (with its PNG), else the
 * one PNG or `.ngsprite`. Null when no file is one the import takes. A file that cannot be
 * read gives a `refused` source with the reason.
 */
export async function readImportSource(files: readonly PickedFile[]): Promise<ImportSource | null> {
    const atlas = files.find((file) => isAtlasName(file.name));
    const file = atlas ?? files.find((file) => isTilesetSourceName(file.name));
    if (!file) return null;
    try {
        return atlas ? await readAtlas(atlas, files) : await readOne(file);
    } catch (error) {
        const message =
            error instanceof TilesetImportError
                ? error.message
                : `The file could not be read. ${reason(error)}`;
        return { kind: "refused", fileName: file.name, message };
    }
}

/** Whether a grid PNG of `size` can be decoded for the preview: within 8192 px a side. */
export function decodable(size: { width: number; height: number }): boolean {
    return size.width <= MAX_IMAGE_SIDE && size.height <= MAX_IMAGE_SIDE;
}
