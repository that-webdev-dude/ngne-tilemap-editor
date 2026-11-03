import type { PixelBuffer, Project, TileSourceKey, Tileset } from "../model";
import { importAtlas, readAtlasOutline } from "./atlas";
import { storedOrigin } from "./build";
import type { TilesetImport, TilesetImportWarning } from "./build";
import { TilesetUpdateError } from "./errors";
import { importGridPng } from "./gridPng";
import type { PngDecoder } from "./gridPng";
import { readPngSize } from "./pngSize";
import { importSprite } from "./sprite";
import type { SpriteReader } from "./sprite";

// Re-reading a tileset's source for "Update tileset from source" (SPEC §6.3): the source is read
// with the tileset's recorded parameters (tile size, margin, spacing; a sprite composited and
// sliced as at import) by the import of its kind (SPEC §6.1), so its entries, their order, keys
// and fingerprints and the animations the import rules give them are the import's. The import's
// limits are checked as if the source replaced the tileset; the result of the update is checked
// again when it is applied. A source whose tiles are of another size is refused.

/** One tile of the source as the import makes it. */
export interface SourceEntry {
    key: TileSourceKey;
    fingerprint: string;
    /** The tile's `tileWidth × tileHeight × 4` bytes, rows top to bottom, straight RGBA. */
    pixels: Uint8Array;
}

/** An animation the import rules give the tile of entry `entry`, through entries. */
export interface SourceAnimation {
    entry: number;
    frames: { entry: number; ms: number }[];
}

/** A source re-read: its entries in import order, and what the import warns about. */
export interface SourceTiles {
    tileWidth: number;
    tileHeight: number;
    entries: SourceEntry[];
    animations: SourceAnimation[];
    warnings: TilesetImportWarning[];
}

/** The files of a source, by kind; `"collection"` sources are TE-062's. */
export type UpdateSourceFiles =
    | { kind: "image"; png: Uint8Array }
    | { kind: "sprite"; bytes: Uint8Array }
    | { kind: "atlas"; json: unknown; png: Uint8Array };

/** The decoders the import uses; tests replace them. */
export interface UpdateSourceReaders {
    decode?: PngDecoder;
    read?: SpriteReader;
}

/** The refusal of a source whose tiles are `to` while the tileset's are `from`. */
export function tileSizeChanged(
    from: { tileWidth: number; tileHeight: number },
    to: { tileWidth: number; tileHeight: number },
): TilesetUpdateError {
    return new TilesetUpdateError(
        "tile-size",
        `The tile size changed from ${from.tileWidth} × ${from.tileHeight} to ` +
            `${to.tileWidth} × ${to.tileHeight}.`,
    );
}

/** The tileset `id` of `project`; throws `TilesetUpdateError` ("not-found") when none has it. */
export function updatedTileset(project: Project, id: string): Tileset {
    const tileset = project.tilesets.find((each) => each.id === id);
    if (!tileset) throw new TilesetUpdateError("not-found", `No tileset has the ID ${id}.`);
    return tileset;
}

/** `project` without `tileset`: the project its replacement is checked against. */
export function projectWithout(project: Project, tileset: Tileset): Project {
    return { ...project, tilesets: project.tilesets.filter((each) => each !== tileset) };
}

/** The bytes of tile `k` of a stored image of `columns` tiles a row. */
export function tileBytes(
    pixels: PixelBuffer,
    shape: { columns: number; tileWidth: number; tileHeight: number },
    k: number,
): Uint8Array {
    const { tileWidth, tileHeight } = shape;
    const { x, y } = storedOrigin({ ...shape, name: "", tileCount: 0 }, k);
    const row = tileWidth * 4;
    const bytes = new Uint8Array(row * tileHeight);
    for (let dy = 0; dy < tileHeight; dy++) {
        const from = ((y + dy) * pixels.width + x) * 4;
        bytes.set(pixels.data.subarray(from, from + row), dy * row);
    }
    return bytes;
}

/** The entries and animations of an import's tileset (IDs 0.. in source order). */
function sourceTilesOf({ tileset, warnings }: TilesetImport): SourceTiles {
    return {
        tileWidth: tileset.tileWidth,
        tileHeight: tileset.tileHeight,
        entries: tileset.tiles.map((tile, k) => ({
            key: tile.sourceKey!,
            fingerprint: tile.fingerprint,
            pixels: tileBytes(tileset.pixels, tileset, k),
        })),
        animations: tileset.tiles
            .filter((tile) => tile.animation.length > 0)
            .map((tile) => ({
                entry: tile.id,
                frames: tile.animation.map((frame) => ({ entry: frame.tile, ms: frame.ms })),
            })),
        warnings,
    };
}

/**
 * Re-reads the source of tileset `tilesetId` of `project` from `files` with the tileset's
 * recorded parameters. Rejects with `TilesetUpdateError`: "not-found", "source-kind" for files
 * of another kind than the tileset's source (or a `"collection"` tileset), "tile-size" for an
 * atlas whose frames are of another size ("The tile size changed from 16 × 16 to 32 × 32.");
 * else as the import of that kind rejects (`TilesetImportError`, the decoder's `PngError`).
 */
export async function readUpdateSource(
    project: Project,
    tilesetId: string,
    files: UpdateSourceFiles,
    readers: UpdateSourceReaders = {},
): Promise<SourceTiles> {
    const tileset = updatedTileset(project, tilesetId);
    const { source, tileWidth, tileHeight } = tileset;
    if (source.kind !== files.kind) {
        throw new TilesetUpdateError(
            "source-kind",
            `The tileset was imported from ${KIND_NAMES[source.kind]}, not from ${KIND_NAMES[files.kind]}.`,
        );
    }
    const others = projectWithout(project, tileset);
    const options = { fileName: source.fileName, newId: () => tileset.id };
    const grid = {
        ...options,
        tileWidth,
        tileHeight,
        margin: source.margin,
        spacing: source.spacing,
    };
    switch (files.kind) {
        case "image":
            return sourceTilesOf(await importGridPng(others, files.png, grid, readers.decode));
        case "sprite":
            return sourceTilesOf(await importSprite(others, files.bytes, grid, readers.read));
        case "atlas": {
            const { frames } = readAtlasOutline(files.json, readPngSize(files.png));
            // Frames of different sizes are the import's refusal, which names them.
            const [first] = frames;
            const uniform = frames.every(
                (f) => f.width === first?.width && f.height === first.height,
            );
            if (first && uniform && (first.width !== tileWidth || first.height !== tileHeight)) {
                throw tileSizeChanged(tileset, {
                    tileWidth: first.width,
                    tileHeight: first.height,
                });
            }
            return sourceTilesOf(
                await importAtlas(others, files.json, files.png, options, readers.decode),
            );
        }
    }
}

const KIND_NAMES = {
    image: "a grid PNG",
    sprite: "a sprite project",
    atlas: "a sprite atlas",
    collection: "a collection of images",
} as const;
