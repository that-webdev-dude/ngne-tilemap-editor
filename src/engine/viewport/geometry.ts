// The viewport's camera (ENGINE §4): quads are placed in map pixels and NGNE's camera carries the
// view, its top-left at `viewOrigin` and the device pixels per map pixel as its zoom, so a map
// point lands at `(point − origin) × scale` device pixels. The overlay, hit-testing and sprite
// clips use the same mapping. Pure arithmetic: no DOM and no NGNE.

/** A size in device pixels. */
export interface DeviceSize {
    width: number;
    height: number;
}

/** A rectangle in map pixels. */
export interface MapRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * A rectangle of whole device pixels (the canvas's backing pixels), from `x, y` to the
 * exclusive edges `x + width, y + height`: the shape of NGNE's sprite clip.
 */
export interface PixelRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** What the camera needs: the view centre in map pixels and the device pixels per map pixel. */
export interface Camera2D {
    centreX: number;
    centreY: number;
    scale: number;
}

/**
 * Device pixels per map pixel at `zoom` (CSS pixels per map pixel) on a display that has `dpr`
 * device pixels per CSS pixel.
 */
export function deviceScale(zoom: number, dpr: number): number {
    return zoom * dpr;
}

/** The map pixels the canvas shows: the view centre in the middle of the canvas. */
export function visibleRect(camera: Camera2D, size: DeviceSize): MapRect {
    const origin = viewOrigin(camera, size);
    return {
        ...origin,
        width: size.width / camera.scale,
        height: size.height / camera.scale,
    };
}

/**
 * The map pixel at the canvas's top-left corner: the position of NGNE's camera, whose zoom is
 * `camera.scale`.
 */
export function viewOrigin(camera: Camera2D, size: DeviceSize): { x: number; y: number } {
    return {
        x: camera.centreX - size.width / camera.scale / 2,
        y: camera.centreY - size.height / camera.scale / 2,
    };
}

/** The parallax settings of a map (FORMAT §3.4). */
export interface ParallaxOrigin {
    parallaxOriginX: number;
    parallaxOriginY: number;
}

/**
 * How far a layer is drawn from its map position, in map pixels (FORMAT §3.4):
 * `offset + (centre − parallaxOrigin) × (1 − parallax)` on each axis.
 */
export function layerShift(
    origin: ParallaxOrigin,
    camera: Pick<Camera2D, "centreX" | "centreY">,
    layer: { offsetX: number; offsetY: number; parallaxX: number; parallaxY: number },
): { x: number; y: number } {
    return {
        x: layer.offsetX + (camera.centreX - origin.parallaxOriginX) * (1 - layer.parallaxX),
        y: layer.offsetY + (camera.centreY - origin.parallaxOriginY) * (1 - layer.parallaxY),
    };
}

/** A map pixel position on the canvas, in device pixels, as NGNE's camera maps it. */
export function toDevice(
    camera: Camera2D,
    size: DeviceSize,
    x: number,
    y: number,
): { x: number; y: number } {
    const origin = viewOrigin(camera, size);
    return { x: (x - origin.x) * camera.scale, y: (y - origin.y) * camera.scale };
}

/** The map pixel position of a device pixel position: the inverse of `toDevice`. */
export function toMap(
    camera: Camera2D,
    size: DeviceSize,
    x: number,
    y: number,
): { x: number; y: number } {
    const origin = viewOrigin(camera, size);
    return { x: origin.x + x / camera.scale, y: origin.y + y / camera.scale };
}

/**
 * The device pixels `area` (map pixels) covers, as a sprite clip: each edge rounded to the
 * nearest pixel edge, so the clip holds the pixels whose centres lie inside the area, the
 * pixels a quad over the area covers (ENGINE §4, "Painting at overview").
 */
export function deviceClip(camera: Camera2D, size: DeviceSize, area: MapRect): PixelRect {
    const from = toDevice(camera, size, area.x, area.y);
    const x = Math.round(from.x);
    const y = Math.round(from.y);
    return {
        x,
        y,
        width: Math.round(from.x + area.width * camera.scale) - x,
        height: Math.round(from.y + area.height * camera.scale) - y,
    };
}

/** The overlap of two rectangles; null when they share no area. */
export function intersect(a: MapRect, b: MapRect): MapRect | null {
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.width, b.x + b.width);
    const y1 = Math.min(a.y + a.height, b.y + b.height);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
