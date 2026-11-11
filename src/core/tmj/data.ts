import { gunzipSync, unzlibSync } from "fflate";
import { TmjError, ZSTD_MESSAGE } from "./errors";

// The cells of a tile layer or chunk (reference/tiled.md §5, SPEC §13 Tile layers): `csv` is a
// JSON array of GIDs; `base64` is little-endian uint32 GIDs, row by row, uncompressed or
// compressed with zlib or gzip (fflate). `zstd` is refused.

export type TmjEncoding = "csv" | "base64";
export type TmjCompression = "" | "zlib" | "gzip";

/** A layer's `encoding` and `compression`, checked; refuses `zstd` and anything unknown. */
export function readEncoding(
    encoding: string,
    compression: string,
    what: string,
): { encoding: TmjEncoding; compression: TmjCompression } {
    if (compression === "zstd") throw new TmjError("zstd", ZSTD_MESSAGE);
    if (encoding !== "csv" && encoding !== "base64") {
        throw new TmjError("format", `${what}: unknown encoding "${encoding}".`);
    }
    if (compression !== "" && compression !== "zlib" && compression !== "gzip") {
        throw new TmjError("format", `${what}: unknown compression "${compression}".`);
    }
    if (encoding === "csv" && compression !== "") {
        throw new TmjError("format", `${what}: csv data cannot be compressed.`);
    }
    return { encoding, compression };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i += 1) BASE64_VALUES[BASE64.charCodeAt(i)] = i;

/** The bytes of standard base64 text with `=` padding (RFC 4648 §4); null when malformed. */
export function decodeBase64(text: string): Uint8Array | null {
    if (text.length % 4 !== 0) return null;
    const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
    const bytes = new Uint8Array((text.length / 4) * 3 - padding);
    let out = 0;
    for (let i = 0; i < text.length; i += 4) {
        let group = 0;
        for (let j = 0; j < 4; j += 1) {
            const index = i + j;
            const code = text.charCodeAt(index);
            const digit = code < 128 ? BASE64_VALUES[code]! : -1;
            if (digit < 0) {
                if (index < text.length - padding) return null;
                group <<= 6;
            } else {
                group = (group << 6) | digit;
            }
        }
        if (out < bytes.length) bytes[out++] = (group >>> 16) & 0xff;
        if (out < bytes.length) bytes[out++] = (group >>> 8) & 0xff;
        if (out < bytes.length) bytes[out++] = group & 0xff;
    }
    return bytes;
}

/**
 * The `count` raw cell numbers of a layer or chunk, as unsigned 32-bit values. Decompression
 * writes into a buffer one byte longer than needed, so data that is too long is found without
 * inflating more than that.
 */
export function decodeCells(
    data: unknown,
    count: number,
    encoding: TmjEncoding,
    compression: TmjCompression,
    what: string,
): Uint32Array {
    const cells = new Uint32Array(count);
    if (encoding === "csv") {
        if (!Array.isArray(data) || data.length !== count) {
            throw new TmjError("format", `${what}: csv data must be an array of ${count} GIDs.`);
        }
        for (let i = 0; i < count; i += 1) {
            const value: unknown = data[i];
            if (
                typeof value !== "number" ||
                !Number.isInteger(value) ||
                value < -0x80000000 ||
                value > 0xffffffff
            ) {
                throw new TmjError(
                    "format",
                    `${what}: GID ${String(value)} is not a 32-bit integer.`,
                );
            }
            cells[i] = value >>> 0;
        }
        return cells;
    }
    if (typeof data !== "string") {
        throw new TmjError("format", `${what}: base64 data must be a string.`);
    }
    const packed = decodeBase64(data.trim());
    if (packed === null) throw new TmjError("format", `${what}: the base64 data is malformed.`);
    const size = count * 4;
    let bytes: Uint8Array;
    try {
        const out = new Uint8Array(size + 1);
        bytes =
            compression === "zlib"
                ? unzlibSync(packed, { out })
                : compression === "gzip"
                  ? gunzipSync(packed, { out })
                  : packed;
    } catch {
        throw new TmjError("format", `${what}: the ${compression} data cannot be decompressed.`);
    }
    if (bytes.length !== size) {
        throw new TmjError("format", `${what}: the data does not hold ${count} cells.`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < count; i += 1) cells[i] = view.getUint32(i * 4, true);
    return cells;
}
