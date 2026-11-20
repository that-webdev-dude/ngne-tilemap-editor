// Where NGNE draws a world quad, by its camera contract ("Camera coordinates"): a map point lands
// at `(point − camera) × zoom` device pixels and sizes scale by the zoom; a screen quad is left as
// it is. The unit tests' recording frames place the viewport's quads with it, so they keep
// checking quads in the device pixels the readback specs compare (ENGINE §4 "Camera").

/** A camera as a frame draws it: `Camera.view(alpha)`. */
export interface CameraView {
    x: number;
    y: number;
    zoom: number;
}

interface Placed {
    x: number;
    y: number;
    width: number;
    height: number;
    screen?: boolean;
}

/** `quad` (map pixels) in device pixels under `view`; a copy. */
export function onScreen<T extends Placed>(quad: T, view: CameraView): T {
    if (quad.screen === true) return { ...quad };
    return {
        ...quad,
        x: (quad.x - view.x) * view.zoom,
        y: (quad.y - view.y) * view.zoom,
        width: quad.width * view.zoom,
        height: quad.height * view.zoom,
    };
}
