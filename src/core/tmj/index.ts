// TMJ import (SPEC §13, BRIEF §7): a Tiled map converted into a new project map, and its
// tilesets into project tilesets (new or reused), with an import report, without touching the
// project.

export { decodeBase64, decodeCells, readEncoding } from "./data";
export type { TmjCompression, TmjEncoding } from "./data";
export { TmjError, ZSTD_MESSAGE } from "./errors";
export type { TmjErrorCode } from "./errors";
export { decodeGid } from "./gid";
export type { DecodedGid, GidDecode } from "./gid";
export { formatColor, tiledColor } from "./json";
export { baseName, folderOf, resolveTmjPath } from "./paths";
export type { JsonObject } from "./json";
export { convertTmjMap } from "./map";
export type { TmjImageRef, TmjMapConversion, TmjMapOptions, TmjTilesetRef } from "./map";
export type { TemplateReader } from "./objects";
export { TMJ_REPORT_ROWS, TMJ_REPORT_TITLES, formatLocation, groupReport } from "./report";
export type { TmjLocation, TmjReportEntry, TmjReportGroup, TmjReportRow } from "./report";
export { applyColorKey, convertTmjTilesets, tmjImagePixels } from "./tileset";
export type { TmjFiles, TmjTilesetConversion, TmjTilesetOptions } from "./tileset";
export { tsxToJson } from "./tsx";
export { parseXml } from "./xml";
export type { XmlElement } from "./xml";
