// Why a Tiled map is refused (BRIEF §7, SPEC §13). The message says it to the user; `code` says
// it to the code.

export type TmjErrorCode =
    /** The text is not JSON or XML, or not a Tiled map, tileset or template as Tiled writes it. */
    | "format"
    /** The map is not orthogonal (BRIEF §7: refused). */
    | "orientation"
    /** A layer is compressed with `zstd` (BRIEF §7: refused). */
    | "zstd"
    /** A cell names no tileset of the map, or a tile ID beyond FORMAT §2.8. */
    | "gid"
    /** A limit of FORMAT §2.5 or §2.8 would be exceeded, or a tile is above 256 px a side. */
    | "limit"
    /** An image-collection tileset whose tiles are not all of one size (BRIEF §7: refused). */
    | "mixed-sizes"
    /** A template, tileset or image the map uses was not given. `path` names it. */
    | "missing-file";

export class TmjError extends Error {
    override readonly name = "TmjError";
    readonly code: TmjErrorCode;
    /**
     * With `missing-file`: a template's path as the map writes it; a tileset's or image's from
     * the map's folder (`resolveTmjPath`).
     */
    readonly path: string | null;

    constructor(code: TmjErrorCode, message: string, path: string | null = null) {
        super(message);
        this.code = code;
        this.path = path;
    }
}

/** The message of a `zstd` refusal (BRIEF §7). */
export const ZSTD_MESSAGE =
    "This map uses zstd compression, which cannot be imported: re-save in Tiled with zlib or gzip.";
