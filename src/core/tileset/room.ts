import {
    MAX_IMAGE_SIDE,
    MAX_TILESETS,
    MAX_TILESET_PIXELS,
    MAX_TILES_PER_PROJECT,
    MAX_TILES_PER_TILESET,
} from "../model";
import type { Project } from "../model";
import { checkPackable } from "../pack";
import { TilesetImportError } from "./errors";

// Whether a new tileset fits the project: the limits of FORMAT §2.8 and packability (SPEC §6.1).
// An import checks them from the source's size alone, before any pixel is decoded; the
// add-tileset command checks the limits again against the project as it is then.

/** The layout of a tileset that is not made yet. */
export interface TilesetShape {
    name: string;
    tileCount: number;
    tileWidth: number;
    tileHeight: number;
    /** Tiles per row of the stored image. */
    columns: number;
}

/** The size of the stored image of `shape`: its grid without margin or spacing. */
export function storedSize(shape: TilesetShape): { width: number; height: number } {
    return {
        width: shape.columns * shape.tileWidth,
        height: Math.ceil(shape.tileCount / shape.columns) * shape.tileHeight,
    };
}

/**
 * Throws `TilesetImportError` ("limit") naming the first limit of FORMAT §2.8 that a tileset
 * of `shape` added to `project` would exceed: tilesets per project, image side, tiles per
 * tileset, tiles in all tilesets, pixels of all tileset images.
 */
export function checkLimits(project: Project, shape: TilesetShape): void {
    const limit = (message: string) => new TilesetImportError("limit", message);
    if (project.tilesets.length >= MAX_TILESETS) {
        throw limit(`A project holds at most ${MAX_TILESETS} tilesets.`);
    }
    const { width, height } = storedSize(shape);
    if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
        throw limit(
            `The tiles of ${JSON.stringify(shape.name)} need an image of ${width} × ${height} px; ` +
                `a tileset image is at most ${MAX_IMAGE_SIDE} px a side.`,
        );
    }
    if (shape.tileCount > MAX_TILES_PER_TILESET) {
        throw limit(
            `${JSON.stringify(shape.name)} would have ${shape.tileCount} tiles; a tileset ` +
                `holds at most ${MAX_TILES_PER_TILESET}.`,
        );
    }
    let tiles = shape.tileCount;
    let pixels = width * height;
    for (const tileset of project.tilesets) {
        tiles += tileset.tiles.length;
        pixels += tileset.pixels.width * tileset.pixels.height;
    }
    if (tiles > MAX_TILES_PER_PROJECT) {
        throw limit(
            `With ${JSON.stringify(shape.name)} the tilesets would hold ${tiles} tiles; all ` +
                `tilesets together hold at most ${MAX_TILES_PER_PROJECT}.`,
        );
    }
    if (pixels > MAX_TILESET_PIXELS) {
        throw limit(
            `With ${JSON.stringify(shape.name)} the tileset images would hold ${pixels} pixels; ` +
                `all tileset images together hold at most ${MAX_TILESET_PIXELS} (64 MP).`,
        );
    }
}

/**
 * Throws `TilesetImportError` ("packability") when `distinctTiles` tiles of `shape` would not
 * fit the tileset's export atlas. Without pixels, tiles count as distinct unless the source
 * shows them the same (atlas frames on one rectangle).
 */
export function checkPackability(shape: TilesetShape, distinctTiles: number): void {
    const result = checkPackable(shape.name, distinctTiles, shape.tileWidth, shape.tileHeight);
    if (!result.ok) throw new TilesetImportError("packability", result.message);
}
