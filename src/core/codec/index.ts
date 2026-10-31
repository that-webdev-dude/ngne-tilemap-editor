// The PNG codec and the zip container of `core/sprite` (DESIGN §3.1), for the modules outside
// `core/` that run them: only `core/` imports `core/sprite`, so the background worker
// (`app/worker`) reaches them here.
export { MAX_PNG_SIDE, PngError, decodePng, encodePng } from "../sprite/png";
export type { PngDecodeOptions, PngEncodeOptions, PngErrorCode } from "../sprite/png";
export type { PixelBuffer } from "../sprite/pixels";
export { ProjectError } from "../sprite/project/errors";
export type { ProjectErrorCode } from "../sprite/project/errors";
export { openZip, writeZip } from "../sprite/project/zip";
export type { ZipArchive, ZipInput } from "../sprite/project/zip";
