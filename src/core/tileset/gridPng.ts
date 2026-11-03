import { MAX_IMAGE_SIDE, MAX_SOURCE_MARGIN, MAX_TILE_SIZE } from "../model";
import type { PixelBuffer, Project } from "../model";
import { decodePng } from "../sprite/png";
import { buildTileset, storedImage, storedOrigin, tilesetNameOf } from "./build";
import type { TilesetImport, TilesetImportOptions } from "./build";
import { TilesetImportError } from "./errors";
import { readPngSize } from "./pngSize";
import { checkLimits, checkPackability } from "./room";
import type { TilesetShape } from "./room";

// Grid PNG → tileset (SPEC §6.1). The grid is Tiled's (`Tileset::initializeTilesetTiles`,
// `columnCountForWidth`, v1.12.2): tiles start at `margin` and step by the tile size plus
// `spacing`; a tile is every grid cell that lies whole inside the image, so the margin counts at
// the left and top only and partial cells at the right and bottom are not tiles. IDs 0.. run row
// by row, source keys are `[column, row]`, and the tiles' pixels are copied into the stored grid
// without margin or spacing, the source's columns kept.

/** Decodes a PNG to straight RGBA8; the import's default is the sprite editor's `decodePng`. */
export type PngDecoder = (bytes: Uint8Array) => Promise<PixelBuffer>;

export interface GridPngOptions extends TilesetImportOptions {
    tileWidth: number;
    tileHeight: number;
    /** Pixels before the first tile, at the left and at the top. */
    margin: number;
    /** Pixels between tiles. */
    spacing: number;
}

function checkOptions(options: GridPngOptions): void {
    const ranged = (value: number, min: number, max: number) =>
        Number.isInteger(value) && value >= min && value <= max;
    const { tileWidth, tileHeight, margin, spacing } = options;
    if (!ranged(tileWidth, 1, MAX_TILE_SIZE) || !ranged(tileHeight, 1, MAX_TILE_SIZE)) {
        throw new TilesetImportError(
            "options",
            `A tile is 1 to ${MAX_TILE_SIZE} px a side, got ${tileWidth} × ${tileHeight}.`,
        );
    }
    if (!ranged(margin, 0, MAX_SOURCE_MARGIN) || !ranged(spacing, 0, MAX_SOURCE_MARGIN)) {
        throw new TilesetImportError(
            "options",
            `Margin and spacing are 0 to ${MAX_SOURCE_MARGIN} px, got ${margin} and ${spacing}.`,
        );
    }
}

/** Whole tiles per row and per column of an image `size` px long (Tiled's count). */
function count(size: number, tile: number, margin: number, spacing: number): number {
    return Math.max(0, Math.floor((size - margin + spacing) / (tile + spacing)));
}

/**
 * The tileset a grid PNG of `size` would make in `project`, from its size alone: refused with
 * `TilesetImportError` when the options are out of range, the image is above 8192 px a side,
 * no whole tile fits, a limit of FORMAT §2.8 would be exceeded, or the tiles would not pack.
 */
export function planGridPng(
    project: Project,
    size: { width: number; height: number },
    options: GridPngOptions,
): TilesetShape {
    checkOptions(options);
    const { tileWidth, tileHeight, margin, spacing } = options;
    if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
        throw new TilesetImportError(
            "limit",
            `The image is ${size.width} × ${size.height} px; a source image is at most ` +
                `${MAX_IMAGE_SIDE} px a side.`,
        );
    }
    const columns = count(size.width, tileWidth, margin, spacing);
    const rows = count(size.height, tileHeight, margin, spacing);
    if (columns === 0 || rows === 0) {
        throw new TilesetImportError(
            "no-tiles",
            `No whole tile of ${tileWidth} × ${tileHeight} px fits the image of ` +
                `${size.width} × ${size.height} px with margin ${margin} and spacing ${spacing}.`,
        );
    }
    const shape = {
        name: tilesetNameOf(options.fileName),
        tileCount: columns * rows,
        tileWidth,
        tileHeight,
        columns,
    };
    checkLimits(project, shape);
    // Without pixels every cell may be a tile of its own.
    checkPackability(shape, shape.tileCount);
    return shape;
}

/**
 * Imports the grid PNG `bytes` as a new tileset of `project` (not added yet: see
 * `addTilesetCommand`). The size and the limits are checked from the PNG's header before
 * `decode` runs. Rejects with `TilesetImportError`, or the decoder's `PngError`.
 */
export async function importGridPng(
    project: Project,
    bytes: Uint8Array,
    options: GridPngOptions,
    decode: PngDecoder = decodePng,
): Promise<TilesetImport> {
    const shape = planGridPng(project, readPngSize(bytes), options);
    const source = await decode(bytes);
    const { tileWidth, tileHeight, margin, spacing } = options;
    const pixels = storedImage(shape);
    const row = tileWidth * 4;
    const keys: [number, number][] = [];
    for (let k = 0; k < shape.tileCount; k++) {
        const column = k % shape.columns;
        const line = Math.floor(k / shape.columns);
        const fromX = margin + column * (tileWidth + spacing);
        const fromY = margin + line * (tileHeight + spacing);
        const to = storedOrigin(shape, k);
        for (let dy = 0; dy < tileHeight; dy++) {
            const from = ((fromY + dy) * source.width + fromX) * 4;
            pixels.data.set(
                source.data.subarray(from, from + row),
                ((to.y + dy) * pixels.width + to.x) * 4,
            );
        }
        keys.push([column, line]);
    }
    const tileset = buildTileset(
        project,
        options,
        { kind: "image", fileName: options.fileName, margin, spacing },
        shape,
        pixels,
        keys,
    );
    return { tileset, warnings: [] };
}
