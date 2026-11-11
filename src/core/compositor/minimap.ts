import type { MapView, ProjectMap } from "../model";
import type { CompositeRequest } from "./compositor";

// The minimap's geometry (DESIGN §8.8): the whole map composited at the dock width, the
// viewport's rectangle on it, and the map point under a minimap point. Sizes and positions are
// in the minimap image's own pixels (its canvas's device pixels) unless a name says otherwise.

export interface Size {
    width: number;
    height: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The map's size in map pixels. */
export function mapPixels(map: ProjectMap): Size {
    return { width: map.width * map.tileWidth, height: map.height * map.tileHeight };
}

/**
 * The minimap image of a map of `map` pixels in a box `side` pixels wide (the dock width): the
 * map's aspect, the longer side `side`, the other `max(1, round(other × side / longer))` (as
 * Tiled's minimap fits the map into its dock). 0 × 0 when the box has no width.
 */
export function minimapSize(map: Size, side: number): Size {
    const box = Math.floor(side);
    if (!(box > 0) || !(map.width > 0) || !(map.height > 0)) return { width: 0, height: 0 };
    const longer = Math.max(map.width, map.height);
    const fit = (length: number): number =>
        length === longer ? box : Math.max(1, Math.round((length * box) / longer));
    return { width: fit(map.width), height: fit(map.height) };
}

/**
 * The composite request of rows `y .. y + rows − 1` of the minimap image `size` of `map`:
 * texel `(x, y)` shows map pixel `(floor((x + ½) · W / w), floor((y + ½) · H / h))`, as a map
 * thumbnail does (FORMAT §2.7). Over the map's background colour, without parallax.
 */
export function minimapRequest(
    map: ProjectMap,
    size: Size,
    y: number,
    rows: number,
): CompositeRequest {
    const pixels = mapPixels(map);
    return {
        x: 0,
        y,
        width: size.width,
        height: rows,
        scaleX: { texels: size.width, pixels: pixels.width },
        scaleY: { texels: size.height, pixels: pixels.height },
    };
}

/**
 * The viewport's rectangle on the minimap image `size` of a map of `map` pixels: the map
 * pixels a viewport of `viewport` device pixels shows at `view` (`zoom` CSS pixels per map
 * pixel, `dpr` device pixels per CSS pixel), clipped to the image. Null when none of it lies
 * on the image or the viewport has no size.
 */
export function minimapViewRect(
    view: MapView,
    viewport: Size,
    dpr: number,
    map: Size,
    size: Size,
): Rect | null {
    const scale = view.zoom * dpr;
    if (!(scale > 0) || !(viewport.width > 0) || !(viewport.height > 0)) return null;
    if (!(size.width > 0) || !(size.height > 0)) return null;
    const kx = size.width / map.width;
    const ky = size.height / map.height;
    const halfWidth = viewport.width / (2 * scale);
    const halfHeight = viewport.height / (2 * scale);
    const left = Math.max(0, (view.centreX - halfWidth) * kx);
    const top = Math.max(0, (view.centreY - halfHeight) * ky);
    const right = Math.min(size.width, (view.centreX + halfWidth) * kx);
    const bottom = Math.min(size.height, (view.centreY + halfHeight) * ky);
    if (!(right > left) || !(bottom > top)) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The map point (map pixels) under point `(x, y)` of the minimap image `size`. */
export function minimapToMap(
    x: number,
    y: number,
    map: Size,
    size: Size,
): { x: number; y: number } {
    return { x: (x * map.width) / size.width, y: (y * map.height) / size.height };
}
