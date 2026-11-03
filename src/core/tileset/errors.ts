// Why a tileset import is refused (SPEC §6.1). The message says it to the user and names the
// limit or the frames at fault; `code` says it to the code.

export type TilesetImportErrorCode =
    /** A tile size, margin or spacing out of its range. */
    | "options"
    /** The PNG is not one, or its header cannot be read. */
    | "png"
    /** The atlas fails the sprite editor's `validateAtlas` rules. */
    | "atlas"
    /** The sprite editor's reader refuses the `.ngsprite`; `cause` is its `ProjectError`. */
    | "sprite"
    /** Atlas frames of different source sizes, or of a source size above 256. */
    | "frame-size"
    /** The source holds no whole tile. */
    | "no-tiles"
    /** A limit of FORMAT §2.8 would be exceeded. */
    | "limit"
    /** More tiles than the tileset's export atlas holds (SPEC §6.1, Packability). */
    | "packability"
    /** The tileset's ID or export name was taken in the project since the import. */
    | "conflict";

export class TilesetImportError extends Error {
    override readonly name = "TilesetImportError";
    readonly code: TilesetImportErrorCode;
    /** With `frame-size`: every frame at fault, in the order of `frames`. */
    readonly frames: readonly string[];

    constructor(
        code: TilesetImportErrorCode,
        message: string,
        options: { cause?: unknown; frames?: readonly string[] } = {},
    ) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.code = code;
        this.frames = options.frames ?? [];
    }
}
