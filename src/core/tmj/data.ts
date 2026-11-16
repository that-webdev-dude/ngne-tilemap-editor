import { gunzipSync, unzlibSync } from "fflate";
import { TmjError, ZSTD_MESSAGE } from "./errors";

// The cells of a tile layer or chunk (JSON map format, Layer and Chunk; SPEC §13 Tile layers):
// `csv` is a JSON array of GIDs; `base64` is little-endian uint32 GIDs, row by row, uncompressed
// or compressed with zlib or gzip (fflate). `zstd` is refused.

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
for (let i = 0; i < BASE64.length; i += 1) BASE64_VALUES[BASE64.codePointAt(i)!] = i;

/** The number of `=` at the end of base64 text: 2, 1 or 0. */
function paddingOf(text: string): number {
    if (text.endsWith("==")) return 2;
    if (text.endsWith("=")) return 1;
    return 0;
}

/** The value of the base64 digit at `index`; -1 for anything that is not a digit. */
function digitAt(text: string, index: number): number {
    const code = text.codePointAt(index);
    return code !== undefined && code < 128 ? BASE64_VALUES[code]! : -1;
}

/**
 * The 24 bits of the 4 characters at `start`, a padding character counting as zero bits; null
 * when a character before the padding is not a digit.
 */
function decodeGroup(text: string, start: number, digitsEnd: number): number | null {
    let group = 0;
    for (let index = start; index < start + 4; index += 1) {
        const digit = digitAt(text, index);
        if (digit < 0) {
            if (index < digitsEnd) return null;
            group <<= 6;
        } else {
            group = (group << 6) | digit;
        }
    }
    return group;
}

/** The bytes of standard base64 text with `=` padding (RFC 4648 §4); null when malformed. */
export function decodeBase64(text: string): Uint8Array | null {
    if (text.length % 4 !== 0) return null;
    const padding = paddingOf(text);
    const bytes = new Uint8Array((text.length / 4) * 3 - padding);
    let out = 0;
    for (let i = 0; i < text.length; i += 4) {
        const group = decodeGroup(text, i, text.length - padding);
        if (group === null) return null;
        if (out < bytes.length) bytes[out++] = (group >>> 16) & 0xff;
        if (out < bytes.length) bytes[out++] = (group >>> 8) & 0xff;
        if (out < bytes.length) bytes[out++] = group & 0xff;
    }
    return bytes;
}

/** Fills `cells` from csv data: an array of `count` 32-bit integers, as unsigned values. */
function decodeCsvCells(data: unknown, cells: Uint32Array, what: string): Uint32Array {
    const count = cells.length;
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
            throw new TmjError("format", `${what}: GID ${String(value)} is not a 32-bit integer.`);
        }
        cells[i] = value >>> 0;
    }
    return cells;
}

/** `packed` decompressed into `out` (fflate); `packed` itself when it is uncompressed. */
function decompress(packed: Uint8Array, compression: TmjCompression, out: Uint8Array): Uint8Array {
    switch (compression) {
        case "zlib":
            return unzlibSync(packed, { out });
        case "gzip":
            return gunzipSync(packed, { out });
        default:
            return packed;
    }
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
    if (encoding === "csv") return decodeCsvCells(data, cells, what);
    if (typeof data !== "string") {
        throw new TmjError("format", `${what}: base64 data must be a string.`);
    }
    const packed = decodeBase64(data.trim());
    if (packed === null) throw new TmjError("format", `${what}: the base64 data is malformed.`);
    const size = count * 4;
    let bytes: Uint8Array;
    try {
        bytes = decompress(packed, compression, new Uint8Array(size + 1));
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
