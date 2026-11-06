import type { Command, Touched } from "../history";
import { animationProblem, cloneFrames, framesEqual } from "../model";
import type { AnimationFrame, Project, Tile, Tileset } from "../model";
import { TilesetEditError } from "./errors";
import { tilesetOf } from "./lookup";

// The animation editor's command (SPEC §6.4; TE-030): the frame list of one tile of a tileset
// set to a new list, one history entry, as Tiled's `ChangeTileAnimation`. Every edit of the
// editor (frames added, moved, their durations changed, deleted) is this command with the list
// after the edit. Its `do` checks the list against FORMAT §2.4 (1024 frames a tile, 65 536 a
// tileset, durations 1..65 535 ms, frames naming tiles of the tileset) and throws
// `TilesetEditError` ("animation") before changing anything. The viewport draws every tile as
// itself (an animated tile shows its own pixels), so `touched` names no tileset: the Tilesets
// panel's animated mark and the editor follow the history itself.

/** Labels of the history entries, by the edit. */
export const ANIMATION_LABELS = {
    add: "Add Animation Frames",
    move: "Move Animation Frames",
    duration: "Change Frame Duration",
    delete: "Delete Animation Frames",
} as const;

export type AnimationEdit = keyof typeof ANIMATION_LABELS;

/** Bytes a command claims besides its frames. */
const OVERHEAD_BYTES = 128;
/** Bytes counted per frame. */
const FRAME_BYTES = 16;

function nothingTouched(): Touched {
    return { mapId: null, layerIds: [], cellRects: [], tilesetIds: [], structure: false };
}

function tileOf(tileset: Tileset, tileId: number): Tile {
    const tile = tileset.tiles.find((each) => each.id === tileId);
    if (!tile) {
        throw new TilesetEditError(
            "tile-not-found",
            `“${tileset.name}” has no tile with the ID ${tileId}.`,
        );
    }
    return tile;
}

/**
 * The command that sets the animation of tile `tileId` of tileset `tilesetId` to `frames`
 * (copied), labelled by `edit`. Its `do` throws `TilesetEditError` when the list breaks FORMAT
 * §2.4 or the tile is gone; undo puts back the tile's own list.
 */
export function setAnimationCommand(
    tilesetId: string,
    tileId: number,
    frames: readonly AnimationFrame[],
    edit: AnimationEdit,
): Command {
    const after = cloneFrames(frames);
    let before: AnimationFrame[] = [];
    let bytes = OVERHEAD_BYTES + after.length * FRAME_BYTES;
    return {
        label: ANIMATION_LABELS[edit],
        get bytes() {
            return bytes;
        },
        touched: nothingTouched(),
        do(session) {
            const tileset = tilesetOf(session.project, tilesetId);
            const tile = tileOf(tileset, tileId);
            const problem = animationProblem(tileset, tileId, after);
            if (problem !== null) throw new TilesetEditError("animation", problem);
            before = tile.animation;
            bytes = OVERHEAD_BYTES + (after.length + before.length) * FRAME_BYTES;
            tile.animation = cloneFrames(after);
        },
        undo(session) {
            tileOf(tilesetOf(session.project, tilesetId), tileId).animation = before;
        },
    };
}

/**
 * The command for an edit that leaves tile `tileId` with `frames`; null when the tile has that
 * list already (no history entry). Throws `TilesetEditError` when the tileset or the tile is
 * missing.
 */
export function animationCommand(
    project: Project,
    tilesetId: string,
    tileId: number,
    frames: readonly AnimationFrame[],
    edit: AnimationEdit,
): Command | null {
    const tile = tileOf(tilesetOf(project, tilesetId), tileId);
    if (framesEqual(tile.animation, frames)) return null;
    return setAnimationCommand(tilesetId, tileId, frames, edit);
}
