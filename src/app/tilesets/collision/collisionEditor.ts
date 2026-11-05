import type { Shape, Tile, Tileset } from "../../../core/model";
import { collisionCommand } from "../../../core/tileset";
import type { CollisionEdit } from "../../../core/tileset";
import { commandDialogs } from "../../dialogs/dialogRequests";
import { sessionStore } from "../../state/session";
import { currentTileset, historyIdle, runTilesetCommand } from "../edit/tilesetEdit";
import { gridLayout, shownTile, tileIndex } from "../panel/tileGrid";
import { selectionRect, tilesetPanelStore } from "../panel/tilesetPanel";

// Tileset → Edit Collision… (SPEC §6.4, DESIGN §9; TE-029): the Collision Editor opens on the
// tiles selected in the Tilesets panel and shows the shapes of the tile the selection ends on.
// Its edits are live commands of the project history, made while the dialog is open (DESIGN §9:
// "Close (edits are live commands)"); with several tiles selected each edit copies the edited
// list to every one of them, one entry (SPEC §6.4). The dialog closes with Close; nothing is
// applied then.

/** What the Collision Editor dialog is opened with. */
export interface CollisionEditorRequest {
    kind: "collision-editor";
    tilesetId: string;
    /** The tiles the edits apply to, in display order. */
    tileIds: readonly number[];
    /** The tile whose shapes and pixels the editor shows. */
    shownTileId: number;
    /** Closes the dialog. */
    answer(values: null): void;
}

/** The tiles selected in the Tilesets panel for `tileset`, shown ones only, in display order. */
export function selectedTiles(tileset: Tileset): Tile[] {
    const state = tilesetPanelStore.getState();
    const rect = selectionRect(tileset, state);
    if (!rect) return [];
    const layout = gridLayout(tileset, 1);
    const tiles: Tile[] = [];
    for (let row = rect.row; row < rect.row + rect.rows; row++) {
        for (let column = rect.column; column < rect.column + rect.columns; column++) {
            const tile = shownTile(tileset, layout, { column, row }, state.filter);
            if (tile) tiles.push(tile);
        }
    }
    return tiles;
}

/** The selected tile the editor shows: the one the selection ends on, else the first. */
function focusTile(tileset: Tileset, tiles: readonly Tile[]): Tile | null {
    const state = tilesetPanelStore.getState();
    const selection = state.selections[tileset.id];
    const layout = gridLayout(tileset, 1);
    const focus = selection ? tileset.tiles[tileIndex(layout, selection.focus)] : undefined;
    return (focus && tiles.includes(focus) ? focus : tiles[0]) ?? null;
}

/** Whether Edit Collision… can open now: a tile is selected and no stroke is under way. */
export function canEditCollision(): boolean {
    const tileset = currentTileset();
    return tileset !== null && historyIdle() && selectedTiles(tileset).length > 0;
}

/** Opens the Collision Editor on the selected tiles; resolves when it closes. */
export async function editCollision(): Promise<boolean> {
    const tileset = currentTileset();
    if (!tileset || !historyIdle()) return false;
    const tiles = selectedTiles(tileset);
    const shown = focusTile(tileset, tiles);
    if (!shown) return false;
    await commandDialogs.open<null>((answer): CollisionEditorRequest => ({
        kind: "collision-editor",
        tilesetId: tileset.id,
        tileIds: tiles.map((tile) => tile.id),
        shownTileId: shown.id,
        answer,
    }));
    return true;
}

/** The tileset and the shown tile of a request as the project has them now; null when gone. */
export function editedTile(
    request: Pick<CollisionEditorRequest, "tilesetId" | "shownTileId">,
): { tileset: Tileset; tile: Tile } | null {
    const { project } = sessionStore.getState().session;
    const tileset = project.tilesets.find((each) => each.id === request.tilesetId);
    const tile = tileset?.tiles.find((each) => each.id === request.shownTileId);
    return tileset && tile ? { tileset, tile } : null;
}

/**
 * Applies `shapes` to the tiles of `request` as one history entry labelled by `edit`. Returns
 * false when nothing changed or a stroke is under way; throws `TilesetEditError` when the list
 * is refused (FORMAT §2.4 limits), the project unchanged.
 */
export function applyCollision(
    request: Pick<CollisionEditorRequest, "tilesetId" | "tileIds">,
    shapes: readonly Shape[],
    edit: CollisionEdit,
): boolean {
    if (!historyIdle()) return false;
    const { project } = sessionStore.getState().session;
    const command = collisionCommand(project, request.tilesetId, request.tileIds, shapes, edit);
    return command ? runTilesetCommand(command) : false;
}
