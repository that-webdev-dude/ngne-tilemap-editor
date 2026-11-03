import { createHash } from "node:crypto";
import { createProject, sequentialIds } from "../../src/core/model";
import type { PixelBuffer, Project } from "../../src/core/model";
import { encodePng } from "../../src/core/sprite/png";

// Shared by the TE-022 tests: source images whose every pixel tells where it came from, PNG
// headers that state a size without pixels, atlases, and the reference SHA-256 of Node.

/** A `width × height` image whose pixel `(x, y)` is `x, y, tag, 255`. */
export function positionImage(width: number, height: number, tag = 7): PixelBuffer {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) data.set([x, y, tag, 255], (y * width + x) * 4);
    }
    return { width, height, data };
}

/** The RGBA of pixel `(x, y)`. */
export function pixelAt(image: PixelBuffer, x: number, y: number): number[] {
    const at = (y * image.width + x) * 4;
    return [...image.data.subarray(at, at + 4)];
}

export const png = (image: PixelBuffer): Uint8Array => encodePng(image);

/**
 * The first 33 bytes of a PNG of `width × height`: signature and IHDR. Enough for the size;
 * any decoder fails on it, so a test that reaches the decoder sees it.
 */
export function pngHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    bytes.set([8, 6, 0, 0, 0], 24);
    return bytes;
}

/** A project with one map and no tileset; IDs `p1`, `p2`, … */
export function emptyProject(): Project {
    return createProject({ newId: sequentialIds("p") });
}

/** Node's SHA-256 of `bytes`, the reference. */
export function referenceSha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

export interface FrameSpec {
    x: number;
    y: number;
    w: number;
    h: number;
    sourceW: number;
    sourceH: number;
    offsetX?: number;
    offsetY?: number;
}

export interface AnimationSpec {
    playback?: "loop" | "once";
    entries: [frame: string, ms: number][];
}

/** A parsed `ngne-sprite-atlas` version 1 over an image of `width × height`. */
export function atlasJson(
    width: number,
    height: number,
    frames: Record<string, FrameSpec>,
    animations: Record<string, AnimationSpec> = {},
): unknown {
    return {
        format: "ngne-sprite-atlas",
        version: 1,
        generator: "test",
        image: "sheet.png",
        width,
        height,
        frames: Object.fromEntries(
            Object.entries(frames).map(([id, frame]) => [
                id,
                { offsetX: 0, offsetY: 0, ...frame, pivot: [0.5, 1] },
            ]),
        ),
        animations: Object.fromEntries(
            Object.entries(animations).map(([id, animation]) => [
                id,
                {
                    playback: animation.playback ?? "loop",
                    durationMs: animation.entries.reduce((sum, [, ms]) => sum + ms, 0),
                    entries: animation.entries.map(([frame, ms]) => ({ frame, ms })),
                },
            ]),
        ),
    };
}
