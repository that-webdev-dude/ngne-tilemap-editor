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

// Why a tileset command is refused (SPEC §6.2). The message says it to the user; `code` says it
// to the code.

export type TilesetEditErrorCode =
    /** No tileset of the project has the ID. */
    | "not-found"
    /** A blank name, or one over 255 characters (FORMAT §1.1). */
    | "name"
    /** Not a slug, or an export name of another map, tileset or image (FORMAT §2.4). */
    | "export-name"
    /** A class over 255 characters. */
    | "class"
    /** A tile offset that is no integer in −4096..4096 (FORMAT §2.4). */
    | "offset"
    /** A move past either end of the list. */
    | "move"
    /** Delete of a tileset some map has a cell of; `maps` names them. */
    | "in-use"
    /** No tile of the tileset has the ID. */
    | "tile-not-found"
    /** A collision list past FORMAT §2.4's limits: 64 shapes, 1024 points, ±4096 (SPEC §6.4). */
    | "collision";

export class TilesetEditError extends Error {
    override readonly name = "TilesetEditError";
    readonly code: TilesetEditErrorCode;
    /** With `in-use`: the names of the maps that use the tileset, in project order. */
    readonly maps: readonly string[];

    constructor(code: TilesetEditErrorCode, message: string, maps: readonly string[] = []) {
        super(message);
        this.code = code;
        this.maps = maps;
    }
}

// Why an update from source is refused (SPEC §6.3). Refusals of the source itself (a PNG that is
// not one, an atlas `validateAtlas` refuses, a limit) are the import's `TilesetImportError`.

export type TilesetUpdateErrorCode =
    /** No tileset of the project has the ID. */
    | "not-found"
    /** The source is of another kind than the tileset's, or `"collection"` (TE-062). */
    | "source-kind"
    /** The source's tiles are of another size than the tileset's. */
    | "tile-size"
    /** An ambiguous or missing tile without a resolution, or a resolution it cannot take. */
    | "resolution";

export class TilesetUpdateError extends Error {
    override readonly name = "TilesetUpdateError";
    readonly code: TilesetUpdateErrorCode;

    constructor(code: TilesetUpdateErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}
