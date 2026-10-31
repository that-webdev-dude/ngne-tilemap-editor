// The viewport's camera (ENGINE §4): NGNE has no camera zoom, so quad positions and sizes are
// scaled into device pixels here and the NGNE camera stays at the origin. Pure arithmetic: no
// DOM and no NGNE.

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
    const width = size.width / camera.scale;
    const height = size.height / camera.scale;
    return {
        x: camera.centreX - width / 2,
        y: camera.centreY - height / 2,
        width,
        height,
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

/** A map pixel position on the canvas, in device pixels. */
export function toDevice(
    camera: Camera2D,
    size: DeviceSize,
    x: number,
    y: number,
): { x: number; y: number } {
    return {
        x: (x - camera.centreX) * camera.scale + size.width / 2,
        y: (y - camera.centreY) * camera.scale + size.height / 2,
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
