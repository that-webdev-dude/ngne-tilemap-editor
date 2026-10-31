// Cuts a quad to a rectangle of the screen (ENGINE §4): the live quads drawn over a pending patch
// stay inside the patch, where the chunk under them is stale, and leave the chunk's correct pixels
// around it alone.

import type { SpriteLike } from "../../core/runtime/emit";

/** A rectangle in device pixels, from `x0, y0` to `x1, y1`. */
export interface DeviceRect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/**
 * The span of a quad side's parameter `t ∈ [0, 1]` whose points `origin + t × side` lie in
 * `[lo, hi]` on one axis; null when none does.
 */
function span(lo: number, hi: number, origin: number, side: number): [number, number] | null {
    if (side === 0) return origin > lo && origin < hi ? [0, 1] : null;
    const a = (lo - origin) / side;
    const b = (hi - origin) / side;
    const t0 = Math.max(0, Math.min(a, b));
    const t1 = Math.min(1, Math.max(a, b));
    return t1 > t0 ? [t0, t1] : null;
}

/**
 * Writes to `out` the part of `s` inside `rect`, as NGNE draws a sprite: the corner `(a, b)` of
 * `[0, 1]²` at `origin + a × i + b × j`, with texture point `(u + a × uw, v + b × vh)`, where `i`
 * and `j` are the signed width and height turned by `rotation`. The rotation is a multiple of a
 * quarter turn (the quad emitter's are 0 and π/2), so each side runs along one screen axis.
 * Returns false when no part is inside; a quad wholly inside is copied unchanged.
 */
export function clipQuad(s: SpriteLike, rect: DeviceRect, out: SpriteLike): boolean {
    const c = Math.cos(s.rotation);
    const n = Math.sin(s.rotation);
    const ix = c * s.width;
    const iy = n * s.width;
    const jx = -n * s.height;
    const jy = c * s.height;
    const ox = s.x - (ix + jx) / 2;
    const oy = s.y - (iy + jy) / 2;
    // `i` along x and `j` along y, or the other way round after a quarter turn.
    const straight = Math.abs(c) >= Math.abs(n);
    const a = straight ? span(rect.x0, rect.x1, ox, ix) : span(rect.y0, rect.y1, oy, iy);
    const b = straight ? span(rect.y0, rect.y1, oy, jy) : span(rect.x0, rect.x1, ox, jx);
    if (a === null || b === null) return false;
    Object.assign(out, s);
    const [a0, a1] = a;
    const [b0, b1] = b;
    if (a0 === 0 && a1 === 1 && b0 === 0 && b1 === 1) return true;
    const am = (a0 + a1) / 2;
    const bm = (b0 + b1) / 2;
    out.x = ox + am * ix + bm * jx;
    out.y = oy + am * iy + bm * jy;
    out.width = s.width * (a1 - a0);
    out.height = s.height * (b1 - b0);
    out.u = s.u + a0 * s.uw;
    out.v = s.v + b0 * s.vh;
    out.uw = s.uw * (a1 - a0);
    out.vh = s.vh * (b1 - b0);
    return true;
}
