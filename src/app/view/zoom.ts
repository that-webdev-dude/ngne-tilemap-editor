// The zoom steps of SPEC §4.1 and the choices made among them. Pure: no DOM, no store.

/**
 * Device pixels per map pixel, ascending: the sprite editor's steps with 1/32 and 1/16 added
 * below for overview. At the steps of 1 and above a map pixel is square and lies on device
 * pixels at any device pixel ratio; the ones below 1 minify and are not pixel-exact.
 */
export const ZOOM_STEPS: readonly number[] = [
    1 / 32,
    1 / 16,
    1 / 8,
    1 / 4,
    1 / 2,
    1,
    2,
    3,
    4,
    5,
    6,
    8,
    10,
    12,
    16,
    20,
    24,
    32,
    48,
    64,
];

export const MIN_ZOOM = 1 / 32;
export const MAX_ZOOM = 64;

/** The zoom of the keys 1 to 6, in key order (DESIGN §10.3). */
export const KEY_ZOOMS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** Scales within this of a step are that step: `zoom × ratio` need not give the step back. */
const STEP_TOLERANCE = 1e-9;

/** The next step above `scale`; the largest step when there is none. */
export function zoomStepAbove(scale: number): number {
    return ZOOM_STEPS.find((step) => step > scale + STEP_TOLERANCE * step) ?? MAX_ZOOM;
}

/** The next step below `scale`; the smallest step when there is none. */
export function zoomStepBelow(scale: number): number {
    let below = MIN_ZOOM;
    for (const step of ZOOM_STEPS) {
        if (step >= scale - STEP_TOLERANCE * step) break;
        below = step;
    }
    return below;
}

/** One step in (`1`) or out (`-1`) from `scale`, which need not be a step itself. */
export function zoomStep(scale: number, direction: 1 | -1): number {
    return direction === 1 ? zoomStepAbove(scale) : zoomStepBelow(scale);
}

/**
 * The largest zoom step at which a map of `width` × `height` map pixels lies inside a viewport
 * of `viewWidth` × `viewHeight` device pixels; the smallest step when it fits at none.
 */
export function fitZoom(
    width: number,
    height: number,
    viewWidth: number,
    viewHeight: number,
): number {
    let fit = MIN_ZOOM;
    for (const step of ZOOM_STEPS) {
        if (width * step > viewWidth || height * step > viewHeight) break;
        fit = step;
    }
    return fit;
}
