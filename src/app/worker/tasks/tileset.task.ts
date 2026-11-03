import { PngError } from "../../../core/codec";
import type { PixelBuffer } from "../../../core/codec";
import { createProject } from "../../../core/model";
import {
    TilesetImportError,
    importAtlas,
    importGridPng,
    importSpriteDocument,
    readSprite,
    spriteFramePixels,
} from "../../../core/tileset";
import type {
    GridOptions,
    SpriteDoc,
    TilesetImport,
    TilesetImportOptions,
} from "../../../core/tileset";
import { buffersOf, defineTask } from "../task";

// Tileset import (`core/tileset`, SPEC §6.1) off the main thread: the decoding and slicing of a
// grid PNG, a sprite project or an atlas, and the composited frames the import dialog shows of
// a sprite. The page plans the import against its project first (limits, packability) and
// sends nothing that plan refuses; here the import runs against an empty project, so its
// limits hold for the tileset alone, and the add-tileset command checks the project again.
//
// A sprite is read whole once per `key` (the page's name for one opened file): the frames the
// dialog shows and the imports of each grid it tries reuse it while this worker lives.

/** What every import takes: the file's name. The tileset's ID is made in the worker. */
type ImportOptions = Omit<TilesetImportOptions, "newId">;

export type TilesetImportInput =
    | { kind: "image"; bytes: Uint8Array; options: ImportOptions & GridOptions }
    | { kind: "sprite"; key: string; bytes: Uint8Array; options: ImportOptions & GridOptions }
    | { kind: "atlas"; json: unknown; png: Uint8Array; options: ImportOptions };

export interface SpriteFrameInput {
    key: string;
    bytes: Uint8Array;
    /** Index of the frame in the sprite's order. */
    frame: number;
}

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** The import's tileset (not added to a project) and warnings; its pixels transferred. */
        "tileset.import": TaskType<
            TilesetImportInput,
            TilesetImport,
            TilesetImportError | PngError
        >;
        /** A sprite's frame composited; the pixels are transferred. */
        "tileset.spriteFrame": TaskType<SpriteFrameInput, PixelBuffer, TilesetImportError>;
        /** Lets the sprite of `key` go, when it is the one held. */
        "tileset.releaseSprite": TaskType<{ key: string }, void>;
    }
}

/** The sprite last read, by its key. */
let sprite: { key: string; doc: Promise<SpriteDoc> } | null = null;

function spriteOf(key: string, bytes: Uint8Array): Promise<SpriteDoc> {
    if (sprite?.key !== key) {
        const doc = readSprite(bytes);
        sprite = { key, doc };
        // A refused file is read again next time rather than kept as a rejection.
        doc.catch(() => {
            if (sprite?.doc === doc) sprite = null;
        });
    }
    return sprite.doc;
}

async function runImport(input: TilesetImportInput): Promise<TilesetImport> {
    const project = createProject();
    switch (input.kind) {
        case "image":
            return importGridPng(project, input.bytes, input.options);
        case "sprite":
            return importSpriteDocument(
                project,
                await spriteOf(input.key, input.bytes),
                input.options,
            );
        case "atlas":
            return importAtlas(project, input.json, input.png, input.options);
    }
}

export const tasks = [
    defineTask("tileset.import", {
        run: runImport,
        transfer: ({ tileset }) => buffersOf(tileset.pixels.data),
        failures: [TilesetImportError, PngError],
    }),
    defineTask("tileset.spriteFrame", {
        run: async ({ key, bytes, frame }) => spriteFramePixels(await spriteOf(key, bytes), frame),
        transfer: (pixels) => buffersOf(pixels.data),
        failures: [TilesetImportError],
    }),
    defineTask("tileset.releaseSprite", {
        run: ({ key }) => {
            if (sprite?.key === key) sprite = null;
        },
    }),
];
