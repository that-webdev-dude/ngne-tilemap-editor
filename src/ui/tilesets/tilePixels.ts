import type { PixelBuffer, Tileset } from "../../core/model";

// The pixels of one tile of a tileset, cut from the tileset's pixels (tile `k` of display order
// at column `k % columns`, row `floor(k / columns)`), for the tile editors' canvases (TE-029,
// TE-030).

/** The pixels of the tile at `index` in display order. */
export function tilePixels(
    pixels: PixelBuffer,
    columns: number,
    tw: number,
    th: number,
    index: number,
): PixelBuffer {
    const left = (index % columns) * tw;
    const top = Math.floor(index / columns) * th;
    const data = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) {
        const from = ((top + y) * pixels.width + left) * 4;
        data.set(pixels.data.subarray(from, from + tw * 4), y * tw * 4);
    }
    return { width: tw, height: th, data };
}

/** The pixels of the tile with ID `tileId` of `tileset`; null when it has no such tile. */
export function tilePixelsById(
    tileset: Pick<Tileset, "pixels" | "columns" | "tileWidth" | "tileHeight" | "tiles">,
    tileId: number,
): PixelBuffer | null {
    const index = tileset.tiles.findIndex((tile) => tile.id === tileId);
    if (index < 0) return null;
    return tilePixels(
        tileset.pixels,
        tileset.columns,
        tileset.tileWidth,
        tileset.tileHeight,
        index,
    );
}
