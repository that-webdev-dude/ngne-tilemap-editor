import type { Stamp } from "../cells";
import type { PixelPoint } from "../raster/line";
import type { Region } from "./region";

// The Tile fill mode of the bucket and shape fill (SPEC §4.3): Tiled's `TileFill`
// (`AbstractTileFillTool::fillWithStamp`, checked at v1.12.2) for one stamp. The stamp is laid
// side by side over the region's bounding box from its top-left cell, row by row, and only the
// region's cells are kept. An empty stamp cell writes nothing: the cell keeps its value (Tiled
// paints a preview layer's `modifiedRegion`, its non-empty cells). Pure.

const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** The value the stamp, tiled from `origin`, has at cell `(x, y)`; 0 for an empty cell. */
export function tiledStampValue(stamp: Stamp, origin: PixelPoint, x: number, y: number): number {
    const sx = wrap(x - origin.x, stamp.width);
    const sy = wrap(y - origin.y, stamp.height);
    return stamp.cells[sy * stamp.width + sx]!;
}

/**
 * Calls `write` for every cell of `region` the stamp, tiled from `origin`, does not leave
 * empty, row by row, with the stamp's value there.
 */
export function forEachTileFillCell(
    stamp: Stamp,
    region: Region,
    origin: PixelPoint,
    write: (x: number, y: number, value: number) => void,
): void {
    for (const span of region) {
        for (let x = span.start; x < span.end; x++) {
            const value = tiledStampValue(stamp, origin, x, span.y);
            if (value !== 0) write(x, span.y, value);
        }
    }
}
