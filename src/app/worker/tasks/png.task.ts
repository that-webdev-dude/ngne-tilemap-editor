import { PngError, decodePng, encodePng } from "../../../core/codec";
import type { PixelBuffer, PngDecodeOptions, PngEncodeOptions } from "../../../core/codec";
import { buffersOf, defineTask } from "../task";

// PNG decode and encode (`core/sprite/png`) off the main thread.

export interface PngDecodeInput {
    bytes: Uint8Array;
    options?: PngDecodeOptions;
}

export interface PngEncodeInput {
    pixels: PixelBuffer;
    options?: PngEncodeOptions;
}

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** `decodePng`; the pixels are transferred. */
        "png.decode": TaskType<PngDecodeInput, PixelBuffer, PngError>;
        /** `encodePng`; the file is transferred. */
        "png.encode": TaskType<PngEncodeInput, Uint8Array<ArrayBuffer>, PngError>;
    }
}

export const tasks = [
    defineTask("png.decode", {
        run: ({ bytes, options }) => decodePng(bytes, options),
        transfer: (pixels) => buffersOf(pixels.data),
        failures: [PngError],
    }),
    defineTask("png.encode", {
        run: ({ pixels, options }) => encodePng(pixels, options),
        transfer: (bytes) => buffersOf(bytes),
        failures: [PngError],
    }),
];
