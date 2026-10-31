import type { MapView } from "../../core/model";
import type { DeviceSize } from "../../engine/viewport/geometry";
import type { Point } from "./coordinates";
import { fitZoom } from "./zoom";

// View navigation (TE-014): where the map goes when the user pans, zooms or fits. Pure: views
// in, views out. A view is a centre in map pixels and a zoom in CSS pixels per map pixel
// (SPEC §3); navigation thinks in the map's origin on the canvas, in device pixels, and
// converts at the edges. A function that changes nothing returns the view it was given.

/** What a view depends on besides itself. */
export interface NavigationContext {
    /** Device pixels per CSS pixel. */
    dpr: number;
    /** The canvas in device pixels. */
    size: DeviceSize;
    /** The map in map pixels. */
    map: DeviceSize;
}

/** Device pixels of the map that stay visible along each axis, however far it is panned. */
export const MIN_VISIBLE = 32;

/** Scales from this up have whole map pixels on whole device pixels (zoom steps of 1 and above). */
const PIXEL_EXACT = 1;

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

/** The device pixels per map pixel of `view`. */
export function scaleOf(view: MapView, ctx: NavigationContext): number {
    return view.zoom * ctx.dpr;
}

/** The device position of the map's top-left corner. */
export function originOf(view: MapView, ctx: NavigationContext): Point {
    const scale = scaleOf(view, ctx);
    return {
        x: ctx.size.width / 2 - view.centreX * scale,
        y: ctx.size.height / 2 - view.centreY * scale,
    };
}

/** The view that puts the map's top-left corner at `origin` (device pixels) at `scale`. */
function viewAt(origin: Point, scale: number, ctx: NavigationContext): MapView {
    return {
        centreX: (ctx.size.width / 2 - origin.x) / scale,
        centreY: (ctx.size.height / 2 - origin.y) / scale,
        zoom: scale / ctx.dpr,
    };
}

/** Whether two views are the same up to the noise of converting between origin and centre. */
export function sameView(a: MapView, b: MapView): boolean {
    const near = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
    return near(a.centreX, b.centreX) && near(a.centreY, b.centreY) && near(a.zoom, b.zoom);
}

/**
 * The origins a view may have along one axis. At least `MIN_VISIBLE` device pixels of the map
 * stay inside the viewport; a map (or a viewport) smaller than that stays visible (or covered)
 * in full.
 */
function originRange(length: number, viewLength: number): { low: number; high: number } {
    const visible = Math.min(MIN_VISIBLE, length, viewLength);
    return { low: visible - length, high: viewLength - visible };
}

function clampAxis(origin: number, length: number, viewLength: number, exact: boolean): number {
    const { low, high } = originRange(length, viewLength);
    // A pixel-exact view has a whole origin, inside the range.
    return exact
        ? clamp(Math.round(origin), Math.ceil(low), Math.floor(high))
        : clamp(origin, low, high);
}

/** The origin to put `view` at, pan limits applied. */
function limited(origin: Point, scale: number, ctx: NavigationContext): Point {
    if (!(ctx.size.width > 0 && ctx.size.height > 0)) return origin;
    const exact = scale >= PIXEL_EXACT;
    return {
        x: clampAxis(origin.x, ctx.map.width * scale, ctx.size.width, exact),
        y: clampAxis(origin.y, ctx.map.height * scale, ctx.size.height, exact),
    };
}

/**
 * The view moved back inside the pan limits: at least `MIN_VISIBLE` device pixels of the map
 * visible along each axis, and at the zoom steps of 1 and above the map's corner on a whole
 * device pixel, so map pixels and cell edges lie on device pixels. A viewport without a size
 * limits nothing.
 */
export function clampView(view: MapView, ctx: NavigationContext): MapView {
    const scale = scaleOf(view, ctx);
    const next = viewAt(limited(originOf(view, ctx), scale, ctx), scale, ctx);
    return sameView(next, view) ? view : next;
}

/** The view moved by `dx`, `dy` device pixels, inside the pan limits. */
export function panView(view: MapView, dx: number, dy: number, ctx: NavigationContext): MapView {
    const origin = originOf(view, ctx);
    const scale = scaleOf(view, ctx);
    const next = viewAt(limited({ x: origin.x + dx, y: origin.y + dy }, scale, ctx), scale, ctx);
    return sameView(next, view) ? view : next;
}

/**
 * The origin along one axis after a zoom from `from` to `to` that keeps the map position under
 * `anchor` where it is. Between zoom steps of 1 and above the map pixel under the anchor is
 * the same one before and after, whatever the rounding of the origin would do.
 */
function zoomOrigin(origin: number, from: number, to: number, anchor: number): number {
    const at = (anchor - origin) / from;
    const next = anchor - at * to;
    if (to < PIXEL_EXACT) return next;
    const pixel = Math.floor(at);
    // The whole origins that leave the anchor inside the pixel: pixel·to ≤ anchor − origin < (pixel + 1)·to.
    const high = Math.floor(anchor - pixel * to);
    const low = Math.floor(anchor - (pixel + 1) * to) + 1;
    return clamp(Math.round(next), low, high);
}

/**
 * The view at `scale` device pixels per map pixel with the map position under `anchor`
 * (device pixels) kept in place, then moved inside the pan limits. Used with the cursor as the
 * anchor for the wheel, and with the centre of the viewport for keys and menu commands.
 */
export function zoomView(
    view: MapView,
    scale: number,
    anchor: Point,
    ctx: NavigationContext,
): MapView {
    const from = scaleOf(view, ctx);
    if (Math.abs(scale - from) <= 1e-9 * from) return clampView(view, ctx);
    const origin = originOf(view, ctx);
    const next = {
        x: zoomOrigin(origin.x, from, scale, anchor.x),
        y: zoomOrigin(origin.y, from, scale, anchor.y),
    };
    return viewAt(limited(next, scale, ctx), scale, ctx);
}

/** The centre of a viewport, the anchor of the zoom commands that have no cursor. */
export function viewportCentre(size: DeviceSize): Point {
    return { x: size.width / 2, y: size.height / 2 };
}

/**
 * The view that shows the whole map: the largest zoom step at which it fits the viewport,
 * centred. "Fit" (key 0).
 */
export function fitView(ctx: NavigationContext): MapView {
    const scale = fitZoom(ctx.map.width, ctx.map.height, ctx.size.width, ctx.size.height);
    const centred = {
        x: (ctx.size.width - ctx.map.width * scale) / 2,
        y: (ctx.size.height - ctx.map.height * scale) / 2,
    };
    const origin =
        scale >= PIXEL_EXACT ? { x: Math.floor(centred.x), y: Math.floor(centred.y) } : centred;
    return viewAt(origin, scale, ctx);
}
