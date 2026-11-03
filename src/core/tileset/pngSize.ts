import { TilesetImportError } from "./errors";

// The size of a PNG from its IHDR chunk alone, so that the limits of an import are checked
// before a pixel is decoded (SPEC §6.1). The decoder checks the rest of the file.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Width and height stated by the PNG's header. Throws `TilesetImportError` ("png"). */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
    const isPng =
        bytes.length >= 24 &&
        SIGNATURE.every((value, index) => bytes[index] === value) &&
        String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR";
    if (!isPng) throw new TilesetImportError("png", "The file is not a PNG image.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width === 0 || height === 0) {
        throw new TilesetImportError("png", `The PNG states a size of ${width} × ${height} px.`);
    }
    return { width, height };
}
