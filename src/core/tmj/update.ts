import type { PngDecoder, SourceAnimation, SourceTiles } from "../tileset";
import { TilesetUpdateError, tileBytes, tileSizeChanged } from "../tileset";
import { TmjError } from "./errors";
import { isObject, parseObject, str } from "./json";
import type { JsonObject } from "./json";
import { resolveTmjPath } from "./paths";
import { convertTmjCollection } from "./tileset";
import type { TmjFiles } from "./tileset";
import { tsxToJson } from "./tsx";

// Update Tileset from Source… of a `"collection"` tileset (SPEC §6.3; TE-062): its source is a
// TSJ, a TSX or a TMJ holding the collection embedded, and the tile images it names, picked as
// TMJ import picks files (SPEC §13). The collection is converted as the import converts it
// (`convertTmjCollection`), so its entries' keys (the image file names, FORMAT §2.4),
// fingerprints and the animations new tiles take are the import's. Paths are from the source
// file's folder.

/** The tileset whose source is re-read: what picks its collection in a TMJ, and its size. */
export interface TmjCollectionTileset {
    readonly name: string;
    readonly tileWidth: number;
    readonly tileHeight: number;
}

/** Whether a tileset's JSON is an image collection: it has no image of its own. */
function isCollection(json: JsonObject): boolean {
    return json.source === undefined && (json.image === undefined || json.image === "");
}

/**
 * The collection a source file holds: a TSJ's or TSX's tileset, or the collection a TMJ embeds
 * named `name` (else its only one). Throws `TmjError` ("format") for a file that is none of
 * them or a TMJ where that picks no single collection, and `TilesetUpdateError` ("source-kind") for a tileset of one image.
 */
export function tmjCollectionOf(text: string, fileName: string, name: string): JsonObject {
    const what = `The file ${fileName}`;
    const json = text.trimStart().startsWith("<") ? tsxToJson(text, what) : parseObject(text, what);
    if (json.type === "map") {
        const tilesets = Array.isArray(json.tilesets) ? json.tilesets.filter(isObject) : [];
        const collections = tilesets.filter(isCollection);
        const named = collections.filter((each) => str(each, "name", "", what) === name);
        if (named.length > 1) {
            throw new TmjError(
                "format",
                `The map ${fileName} embeds several image collections named “${name}”.`,
            );
        }
        const [only] = named.length > 0 ? named : collections;
        if (only === undefined || (named.length === 0 && collections.length > 1)) {
            throw new TmjError(
                "format",
                collections.length === 0
                    ? `The map ${fileName} embeds no image collection.`
                    : `The map ${fileName} embeds no image collection named “${name}”.`,
            );
        }
        return only;
    }
    if (json.type !== undefined && json.type !== "tileset") {
        throw new TmjError("format", `${what} is not a Tiled map or tileset.`);
    }
    if (!isCollection(json)) {
        throw new TilesetUpdateError(
            "source-kind",
            `The tileset ${fileName} is cut from one image, not a collection of images.`,
        );
    }
    return json;
}

/** The images a collection names, by path from its source file's folder, in Tiled's order. */
export function tmjCollectionImages(collection: JsonObject): string[] {
    const paths = new Set<string>();
    for (const tile of Array.isArray(collection.tiles) ? collection.tiles : []) {
        if (isObject(tile) && typeof tile.image === "string" && tile.image !== "") {
            paths.add(resolveTmjPath("", tile.image));
        }
    }
    return [...paths];
}

/**
 * Re-reads the collection of `tileset` from its source file's `text` (named `fileName`) and the
 * images `files` reads, as the import converts it: entries in Tiled's order, keyed by image
 * file name, and the animations the import gives their tiles. A collection without images has
 * no entries. Rejects with `TilesetUpdateError` ("tile-size" for tiles of another size,
 * "source-kind"), else `TmjError` as the import refuses the collection.
 */
export async function readTmjCollection(
    tileset: TmjCollectionTileset,
    text: string,
    fileName: string,
    files: TmjFiles,
    decode?: PngDecoder,
): Promise<SourceTiles> {
    const collection = tmjCollectionOf(text, fileName, tileset.name);
    const converted = await convertTmjCollection(
        collection,
        { name: tileset.name, fileName },
        files,
        decode,
    );
    const { tileWidth, tileHeight } = tileset;
    if (converted === null)
        return { tileWidth, tileHeight, entries: [], animations: [], warnings: [] };
    if (converted.tileWidth !== tileWidth || converted.tileHeight !== tileHeight) {
        throw tileSizeChanged(tileset, converted);
    }
    const entryOf = new Map(converted.tiles.map((tile, k) => [tile.id, k]));
    const animations: SourceAnimation[] = [];
    converted.tiles.forEach((tile, k) => {
        if (tile.animation.length === 0) return;
        animations.push({
            entry: k,
            frames: tile.animation.map((frame) => ({
                entry: entryOf.get(frame.tile)!,
                ms: frame.ms,
            })),
        });
    });
    return {
        tileWidth,
        tileHeight,
        entries: converted.tiles.map((tile, k) => ({
            key: tile.sourceKey!,
            fingerprint: tile.fingerprint,
            pixels: tileBytes(converted.pixels, converted, k),
        })),
        animations,
        warnings: [],
    };
}
