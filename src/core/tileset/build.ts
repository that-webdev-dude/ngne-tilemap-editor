import { MAX_TEXT_LENGTH, exportNames, randomId, uniqueSlug } from "../model";
import type {
    IdGenerator,
    PixelBuffer,
    Project,
    Tile,
    TileSourceKey,
    Tileset,
    TilesetSource,
} from "../model";
import { tileFingerprint } from "./fingerprint";
import { storedSize } from "./room";
import type { TilesetShape } from "./room";

// What every import ends with (SPEC §6.1): a tileset whose tiles have IDs 0.. in source order,
// a source key and a fingerprint each, its pixels in a stored grid without margin or spacing,
// named after the file, with an export name unique in the project. It gets its slot when the
// add-tileset command adds it.

/** Something the import changed or left out, shown in the import result (SPEC §6.1). */
export interface TilesetImportWarning {
    code: "once-animation" | "duplicate-animation";
    /** The source's ID of the animation. */
    animation: string;
    message: string;
}

/** An imported tileset, not yet in the project, and what the import warns about. */
export interface TilesetImport {
    /** Its `slot` is 0 until `addTilesetCommand` adds it. */
    tileset: Tileset;
    warnings: TilesetImportWarning[];
}

/** Options every import takes. */
export interface TilesetImportOptions {
    /** Name of the file picked or dropped; it names the tileset. */
    fileName: string;
    /** Makes the tileset's ID; a random UUID by default. */
    newId?: IdGenerator;
}

/** The name a file gives its tileset: its base name, without folder or extension. */
export function tilesetNameOf(fileName: string): string {
    const base = fileName.slice(
        Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\")) + 1,
    );
    const stem = /\.atlas\.json$/i.test(base)
        ? base.slice(0, -".atlas.json".length)
        : base.replace(/\.[^.]*$/, "");
    const name = stem.slice(0, MAX_TEXT_LENGTH);
    return name.trim() === "" ? "Tileset" : name;
}

/** The tile `k` of `shape` lies at this pixel of the stored image. */
export function storedOrigin(shape: TilesetShape, k: number): { x: number; y: number } {
    return {
        x: (k % shape.columns) * shape.tileWidth,
        y: Math.floor(k / shape.columns) * shape.tileHeight,
    };
}

/** An empty stored image for `shape`. */
export function storedImage(shape: TilesetShape): PixelBuffer {
    const { width, height } = storedSize(shape);
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/**
 * The tileset of `shape` over `pixels` (its stored image, filled), with one tile per source
 * key in `keys`, fingerprinted. Animations are the caller's to set.
 */
export function buildTileset(
    project: Project,
    options: TilesetImportOptions,
    source: TilesetSource,
    shape: TilesetShape,
    pixels: PixelBuffer,
    keys: readonly TileSourceKey[],
): Tileset {
    const { tileWidth, tileHeight } = shape;
    const scratch = new Uint8Array(tileWidth * tileHeight * 4);
    const tiles = keys.map((sourceKey, id): Tile => {
        const { x, y } = storedOrigin(shape, id);
        return {
            id,
            sourceKey,
            fingerprint: tileFingerprint(pixels, x, y, tileWidth, tileHeight, scratch),
            class: "",
            collision: [],
            animation: [],
            properties: [],
        };
    });
    return {
        id: (options.newId ?? randomId)(),
        name: shape.name,
        exportName: uniqueSlug(shape.name, exportNames(project), "tileset"),
        class: "",
        slot: 0,
        tileWidth,
        tileHeight,
        offsetX: 0,
        offsetY: 0,
        columns: shape.columns,
        pixels,
        nextTileId: tiles.length,
        source,
        tiles,
        terrainSets: [],
        properties: [],
    };
}
