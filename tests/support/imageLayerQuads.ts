import type { Frame, Sprite } from "@ngne/core";
import { createImageLayer } from "../../src/core/model";
import { emitImageLayer } from "../../src/engine/viewport/imageLayers";
import type { ReadyImage } from "../../src/engine/viewport/imageLayers";
import { LAYER } from "../../src/engine/viewport/liveTier";
import { onScreen } from "./ngneScreen";

// The quad of an image layer in the unit tests of image layers (TE-036, GitHub #8): map (0, 0) is
// device (0, 0), 2 device pixels per map pixel, and the area drawn is the whole 200 × 100 canvas
// (map 0 .. 100 × 0 .. 50). The image is 16 × 8 map pixels. The quads are given in device pixels,
// placed as NGNE's camera places them (`ngneScreen`).

const VIEW = { x: 0, y: 0, zoom: 2 };

export const QUAD_READY: ReadyImage = { texture: "ed:img:7", width: 16, height: 8 };
export const QUAD_CLIP = { x: 0, y: 0, width: 40, height: 30 };
const QUAD_SHIFT = { x: 10, y: 5 };

/** The quads `emitImageLayer` emits for a layer at `shift` with opacity 128, depth 3. */
export function emitQuads(
    repeatX: boolean,
    repeatY: boolean,
    shift = QUAD_SHIFT,
    clip = false,
): { count: number; sprites: Sprite[] } {
    const sprites: Sprite[] = [];
    const frame = {
        sprite: (s: Sprite) => {
            sprites.push(onScreen(s, VIEW));
        },
    };
    const layer = { ...createImageLayer(7, "Sky", "img"), repeatX, repeatY };
    const count = emitImageLayer(
        frame as unknown as Frame,
        { layer, ready: QUAD_READY, opacity: 128, shift },
        { x: 0, y: 0, width: 100, height: 50 },
        { layer: LAYER.tiles, depth: 3, clip: clip ? QUAD_CLIP : null },
    );
    return { count, sprites };
}
