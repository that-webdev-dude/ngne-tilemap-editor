import type { PixelBuffer, Project, ProjectMap } from "../model";
import { compositeMap } from "./compositor";

// The thumbnail of a map (FORMAT §2.7): the background and the visible tile and image layers with
// opacity and offsets, without parallax, markers or animation (a tile shows its own pixels).

/** The longer side of a scaled thumbnail. */
export const THUMBNAIL_MAX_SIDE = 128;

/**
 * The thumbnail size of a map of `width × height` pixels: that size when neither side exceeds
 * 128, else the longer side 128 and the other `max(1, round(side × 128 / longer))`.
 */
export function thumbnailSize(width: number, height: number): { width: number; height: number } {
    const longer = Math.max(width, height);
    if (longer <= THUMBNAIL_MAX_SIDE) return { width, height };
    const fit = (side: number): number =>
        side === longer
            ? THUMBNAIL_MAX_SIDE
            : Math.max(1, Math.round((side * THUMBNAIL_MAX_SIDE) / longer));
    return { width: fit(width), height: fit(height) };
}

/**
 * Pixel `(x, y)` of the thumbnail shows map pixel `(floor((x + ½) · W / w), floor((y + ½) · H / h))`
 * for a map of `W × H` pixels and a thumbnail of `w × h`.
 */
export function compositeThumbnail(project: Project, map: ProjectMap): PixelBuffer {
    const pixelsX = map.width * map.tileWidth;
    const pixelsY = map.height * map.tileHeight;
    const size = thumbnailSize(pixelsX, pixelsY);
    return compositeMap(project, map, {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        scaleX: { texels: size.width, pixels: pixelsX },
        scaleY: { texels: size.height, pixels: pixelsY },
    });
}
