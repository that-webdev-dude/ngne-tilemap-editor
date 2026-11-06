import type { Command, Touched } from "../history";
import { cloneShapes, collisionProblem, shapesEqual } from "../model";
import type { Project, Shape, Tile, Tileset } from "../model";
import { TilesetEditError } from "./errors";
import { tilesetOf } from "./lookup";

// The collision editor's command (SPEC §6.4; TE-029): the collision list of one or more tiles
// of a tileset set to one list, one history entry. Every edit of the editor (a shape added,
// moved, resized, its points edited, its fields typed, deleted) is this command with the list
// after the edit; with several tiles selected the list is copied to each (SPEC §6.4). Its `do`
// checks the list against FORMAT §2.4 (64 shapes, 1024 points, coordinates within ±4096) and
// throws `TilesetEditError` ("collision") before changing anything. Collision is not drawn by
// the viewport's tiers, so `touched` names no tileset: the overlay of Show Collision follows
// the history itself.

/** Labels of the history entries, by the edit. */
export const COLLISION_LABELS = {
    add: "Add Collision Shape",
    move: "Move Collision Shape",
    resize: "Resize Collision Shape",
    points: "Edit Collision Points",
    change: "Change Collision Shape",
    delete: "Delete Collision Shape",
} as const;

export type CollisionEdit = keyof typeof COLLISION_LABELS;

/** Bytes a command claims besides its shapes. */
const OVERHEAD_BYTES = 256;
/** Bytes counted per shape and per polygon point it holds. */
const SHAPE_BYTES = 64;
const POINT_BYTES = 16;

function shapeBytes(shapes: readonly Shape[]): number {
    let bytes = 0;
    for (const shape of shapes) {
        bytes += SHAPE_BYTES + ("points" in shape ? shape.points.length * POINT_BYTES : 0);
    }
    return bytes;
}

function nothingTouched(): Touched {
    return { mapId: null, layerIds: [], cellRects: [], tilesetIds: [], structure: false };
}

function tilesOf(tileset: Tileset, tileIds: readonly number[]): Tile[] {
    return tileIds.map((tileId) => {
        const tile = tileset.tiles.find((each) => each.id === tileId);
        if (!tile) {
            throw new TilesetEditError(
                "tile-not-found",
                `“${tileset.name}” has no tile with the ID ${tileId}.`,
            );
        }
        return tile;
    });
}

/**
 * The command that sets the collision list of tiles `tileIds` of tileset `tilesetId` to
 * `shapes` (copied), labelled by `edit`. Its `do` throws `TilesetEditError` when the list breaks
 * FORMAT §2.4 or a tile is gone; undo puts back each tile's own list.
 */
export function setCollisionCommand(
    tilesetId: string,
    tileIds: readonly number[],
    shapes: readonly Shape[],
    edit: CollisionEdit,
): Command {
    const after = cloneShapes(shapes);
    const ids = [...new Set(tileIds)];
    let before: Shape[][] = [];
    let bytes = OVERHEAD_BYTES + shapeBytes(after);
    return {
        label: COLLISION_LABELS[edit],
        get bytes() {
            return bytes;
        },
        touched: nothingTouched(),
        do(session) {
            const problem = collisionProblem(after);
            if (problem !== null) throw new TilesetEditError("collision", problem);
            const tiles = tilesOf(tilesetOf(session.project, tilesetId), ids);
            before = tiles.map((tile) => tile.collision);
            bytes =
                OVERHEAD_BYTES +
                shapeBytes(after) +
                before.reduce((sum, list) => sum + shapeBytes(list), 0);
            for (const tile of tiles) tile.collision = cloneShapes(after);
        },
        undo(session) {
            const tiles = tilesOf(tilesetOf(session.project, tilesetId), ids);
            tiles.forEach((tile, index) => (tile.collision = before[index]!));
        },
    };
}

/**
 * The command for an edit that leaves tiles `tileIds` with `shapes`; null when every tile has
 * that list already (no history entry). Throws `TilesetEditError` when the tileset or a tile
 * is missing.
 */
export function collisionCommand(
    project: Project,
    tilesetId: string,
    tileIds: readonly number[],
    shapes: readonly Shape[],
    edit: CollisionEdit,
): Command | null {
    const tiles = tilesOf(tilesetOf(project, tilesetId), tileIds);
    if (tiles.every((tile) => shapesEqual(tile.collision, shapes))) return null;
    return setCollisionCommand(tilesetId, tileIds, shapes, edit);
}
