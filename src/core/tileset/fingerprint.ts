import type { PixelBuffer } from "../model";
import { sha256Hex } from "./sha256";

// Tile fingerprints of FORMAT §2.4: SHA-256 over the tile's `tileWidth × tileHeight × 4` bytes,
// rows top to bottom, RGBA not premultiplied, every pixel with alpha 0 as `0, 0, 0, 0`. They
// match tiles in "Update tileset from source" (SPEC §6.3); they check nothing.

/**
 * The fingerprint of the `width × height` tile whose top-left pixel is `(x, y)` of `pixels`.
 * `scratch`, when given, is reused for the tile's bytes; one of another length is not used.
 */
export function tileFingerprint(
    pixels: PixelBuffer,
    x: number,
    y: number,
    width: number,
    height: number,
    scratch?: Uint8Array,
): string {
    const row = width * 4;
    const size = row * height;
    const bytes = scratch?.length === size ? scratch : new Uint8Array(size);
    for (let dy = 0; dy < height; dy++) {
        const from = ((y + dy) * pixels.width + x) * 4;
        bytes.set(pixels.data.subarray(from, from + row), dy * row);
    }
    for (let at = 3; at < bytes.length; at += 4) {
        if (bytes[at] === 0) bytes[at - 3] = bytes[at - 2] = bytes[at - 1] = 0;
    }
    return sha256Hex(bytes);
}
