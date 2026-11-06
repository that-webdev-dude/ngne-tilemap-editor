import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { DEFAULT_FRAME_MS, isFrameMs } from "../../../core/model";
import type { AnimationFrame, Tile, Tileset } from "../../../core/model";
import { animationCommand } from "../../../core/tileset";
import type { AnimationEdit } from "../../../core/tileset";
import { commandDialogs } from "../../dialogs/dialogRequests";
import { sessionStore } from "../../state/session";
import { currentTileset, historyIdle, runTilesetCommand } from "../edit/tilesetEdit";
import { focusTile, selectedTiles, selectionRect, tilesetPanelStore } from "../panel/tilesetPanel";
import type { GridRect } from "../panel/tileGrid";
import { tilesetWorkflowBusy } from "../tilesetWorkflow";

// Tileset → Edit Animation… (SPEC §6.4, DESIGN §9; TE-030): the Animation Editor opens on the
// tile the Tilesets panel's selection ends on (Tiled's current tile) and edits that tile's frame
// list. Its edits are live commands of the project history, made while the dialog is open, as
// Tiled's editor pushes a `ChangeTileAnimation` on every change; the dialog closes with Close and
// applies nothing then. New frames take the editor's frame duration, 100 ms until the user sets
// another (Tiled's `frame.defaultDuration`); it is kept while the page is open.

/** What the Animation Editor dialog is opened with. */
export interface AnimationEditorRequest {
    kind: "animation-editor";
    tilesetId: string;
    /** The tile whose animation the editor edits. */
    tileId: number;
    /** The panel's selection when the editor opened: the editor's grid starts with it. */
    selection: GridRect | null;
    /** Closes the dialog. */
    answer(values: null): void;
}

export interface FrameDurationState {
    /** The duration of a new frame, and the one Apply gives the selected frames. */
    readonly ms: number;
}

/** The editor's frame duration (Tiled's `frame.defaultDuration`), shared by every opening. */
export const frameDurationStore = createStore<FrameDurationState>(() => ({
    ms: DEFAULT_FRAME_MS,
}));

export function useFrameDuration(): number {
    return useStore(frameDurationStore, (state) => state.ms);
}

/** Sets the frame duration; a value FORMAT §2.4 does not allow is ignored. */
export function setFrameDuration(ms: number): void {
    if (isFrameMs(ms) && frameDurationStore.getState().ms !== ms)
        frameDurationStore.setState({ ms });
}

/**
 * Whether Edit Animation… can open now: a tile is selected, no stroke is under way and no
 * tileset file operation is in progress.
 */
export function canEditAnimation(): boolean {
    const tileset = currentTileset();
    return (
        tileset !== null &&
        historyIdle() &&
        !tilesetWorkflowBusy() &&
        focusTile(tileset, selectedTiles(tileset)) !== null
    );
}

/** Opens the Animation Editor on the selected tile; resolves when it closes. */
export async function editAnimation(): Promise<boolean> {
    const tileset = currentTileset();
    if (!tileset || !historyIdle() || tilesetWorkflowBusy()) return false;
    const tile = focusTile(tileset, selectedTiles(tileset));
    if (!tile) return false;
    const selection = selectionRect(tileset, tilesetPanelStore.getState());
    await commandDialogs.open<null>((answer): AnimationEditorRequest => ({
        kind: "animation-editor",
        tilesetId: tileset.id,
        tileId: tile.id,
        selection,
        answer,
    }));
    return true;
}

/** The tileset and the edited tile of a request as the project has them now; null when gone. */
export function animatedTile(
    request: Pick<AnimationEditorRequest, "tilesetId" | "tileId">,
): { tileset: Tileset; tile: Tile } | null {
    const { project } = sessionStore.getState().session;
    const tileset = project.tilesets.find((each) => each.id === request.tilesetId);
    const tile = tileset?.tiles.find((each) => each.id === request.tileId);
    return tileset && tile ? { tileset, tile } : null;
}

/**
 * Applies `frames` to the tile of `request` as one history entry labelled by `edit`. Returns
 * false when nothing changed or a stroke is under way; throws `TilesetEditError` when the list
 * is refused (FORMAT §2.4 limits), the project unchanged.
 */
export function applyAnimation(
    request: Pick<AnimationEditorRequest, "tilesetId" | "tileId">,
    frames: readonly AnimationFrame[],
    edit: AnimationEdit,
): boolean {
    if (!historyIdle()) return false;
    const { project } = sessionStore.getState().session;
    const command = animationCommand(project, request.tilesetId, request.tileId, frames, edit);
    return command ? runTilesetCommand(command) : false;
}
