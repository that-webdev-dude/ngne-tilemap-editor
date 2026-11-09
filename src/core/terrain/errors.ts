// Why a terrain edit is refused (SPEC §5.1). The message says it to the user; `code` says it to
// the code. Each command checks its values against the project as it is when it runs and throws
// before changing anything.

export type TerrainEditErrorCode =
    /** No tileset, terrain set, terrain or tile with the given ID or index. */
    | "not-found"
    /** A blank name, or one over 255 characters (FORMAT §1.1). */
    | "name"
    /** A colour that is no `#rrggbbaa` (FORMAT §2.4). */
    | "colour"
    /** Past FORMAT §2.8: 256 terrain sets per tileset, 254 terrains per set. */
    | "limit"
    /** Remove of the only terrain of a set: a set has 1 to 254 (FORMAT §2.4). */
    | "last-terrain"
    /** A move past either end of the list. */
    | "move"
    /** An index the set's type does not use (FORMAT §2.4). */
    | "index"
    /** A terrain the set does not have. */
    | "terrain";

export class TerrainEditError extends Error {
    override readonly name = "TerrainEditError";
    readonly code: TerrainEditErrorCode;

    constructor(code: TerrainEditErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}
