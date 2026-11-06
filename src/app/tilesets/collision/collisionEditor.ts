import type { Shape, Tile, Tileset } from "../../../core/model";
import { collisionCommand } from "../../../core/tileset";
import type { CollisionEdit } from "../../../core/tileset";
import { commandDialogs } from "../../dialogs/dialogRequests";
import { sessionStore } from "../../state/session";
import { currentTileset, historyIdle, runTilesetCommand } from "../edit/tilesetEdit";
import { focusTile, selectedTiles } from "../panel/tilesetPanel";
import { tilesetWorkflowBusy } from "../tilesetWorkflow";

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

/**
 * Whether Edit Collision… can open now: a tile is selected, no stroke is under way and no
 * tileset file operation is in progress.
 */
export function canEditCollision(): boolean {
    const tileset = currentTileset();
    return (
        tileset !== null &&
        historyIdle() &&
        !tilesetWorkflowBusy() &&
        selectedTiles(tileset).length > 0
    );
}

/** Opens the Collision Editor on the selected tiles; resolves when it closes. */
export async function editCollision(): Promise<boolean> {
    const tileset = currentTileset();
    if (!tileset || !historyIdle() || tilesetWorkflowBusy()) return false;
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
