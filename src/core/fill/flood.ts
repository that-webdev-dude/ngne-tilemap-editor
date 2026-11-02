import type { CellRect } from "../cells";
import type { PixelPoint } from "../raster/line";
import { forEachRegionCell, regionBounds } from "./region";
import type { Region, RowSpan } from "./region";

// The flood fill of the bucket fill and the magic wand (SPEC §4.3): Tiled's queue-based
// scanline fill (`fillRegion` in `src/tiled/tilepainter.cpp`, checked at v1.12.2), 4-connected,
// on a rectangular grid. From a seed it runs left and right as far as the cells match, takes
// that run as a span, and queues one seed per run of matching cells in the rows above and below
// it. The region holds the cells 4-connected to the origin through matching cells, inside the
// bounds: the map, or a region. Pure.

/** Reads the value of a cell; 0 when it is empty. */
export type CellReader = (x: number, y: number) => number;

/**
 * The region of the cells 4-connected to `origin` whose value matches, within `bounds`: by
 * default the cells equal to the origin's value, tile and flags (Tiled's `Cell` equality).
 * Empty when `origin` lies outside `bounds`. Sorted as every region (`region.ts`).
 */
export function floodRegion(
    read: CellReader,
    origin: PixelPoint,
    bounds: CellRect | Region,
    matches?: (value: number) => boolean,
): Region {
    const isRect = !Array.isArray(bounds);
    const box = isRect ? (bounds as CellRect) : regionBounds(bounds as Region);
    if (!box || box.width <= 0 || box.height <= 0) return [];
    const { x: left, y: top, width, height } = box;
    const index = (x: number, y: number) => (y - top) * width + (x - left);
    const inBox = (x: number, y: number) =>
        x >= left && y >= top && x < left + width && y < top + height;
    // The cells of a region bound, over its bounding box.
    let allowed: Uint8Array | null = null;
    if (!isRect) {
        const mask = new Uint8Array(width * height);
        forEachRegionCell(bounds as Region, (x, y) => {
            mask[index(x, y)] = 1;
        });
        allowed = mask;
    }
    const within = (x: number, y: number) =>
        inBox(x, y) && (allowed === null || allowed[index(x, y)] === 1);
    if (!within(origin.x, origin.y)) return [];

    const target = read(origin.x, origin.y);
    const match = matches ?? ((value: number) => value === target);
    const fits = (x: number, y: number) => within(x, y) && match(read(x, y));
    const filled = new Uint8Array(width * height);
    const spans: RowSpan[] = [];
    const queueX: number[] = [origin.x];
    const queueY: number[] = [origin.y];

    for (let head = 0; head < queueX.length; head++) {
        const x = queueX[head]!;
        const y = queueY[head]!;
        // A seed queued twice, or reached by a run since it was queued.
        if (filled[index(x, y)] === 1) continue;
        let start = x;
        while (fits(start - 1, y)) start--;
        let end = x + 1;
        while (fits(end, y)) end++;
        for (let n = start; n < end; n++) filled[index(n, y)] = 1;
        spans.push({ y, start, end });
        // One seed per run of matching cells above and below the span.
        for (const row of [y - 1, y + 1]) {
            if (row < top || row >= top + height) continue;
            let seeded = false;
            for (let n = start; n < end; n++) {
                if (filled[index(n, row)] === 0 && fits(n, row)) {
                    if (!seeded) {
                        queueX.push(n);
                        queueY.push(row);
                        seeded = true;
                    }
                } else {
                    seeded = false;
                }
            }
        }
    }
    return spans.sort((a, b) => a.y - b.y || a.start - b.start);
}
