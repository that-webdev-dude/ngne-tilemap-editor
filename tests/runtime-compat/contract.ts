// TE-052: the deliberate contract break of the compile matrix (SPEC 11.4). The compat script
// copies a folder's engine declarations, renames one field of the engine's `Sprite` with this
// function, and expects the fixture game to stop compiling against the copy.

/** The `Sprite` field the break renames, and its new name. */
export const BROKEN_FIELD = "depth";
export const RENAMED_FIELD = "depthRenamed";

const SPRITE = new RegExp(
    `(\\bexport (?:declare )?(?:interface Sprite|type Sprite =) \\{[^}]*?\\n\\s*)${BROKEN_FIELD}(\\??:)`,
);

/**
 * `source` (an engine declaration file) with the `BROKEN_FIELD` field of its `Sprite` interface
 * renamed to `RENAMED_FIELD`; null when the file declares no such field.
 */
export function renameSpriteField(source: string): string | null {
    if (!SPRITE.test(source)) return null;
    return source.replace(SPRITE, `$1${RENAMED_FIELD}$2`);
}
