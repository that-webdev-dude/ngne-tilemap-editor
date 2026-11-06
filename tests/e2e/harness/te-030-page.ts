// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import type { AnimationFrame } from "../../../src/core/model";
import { setAnimationCommand } from "../../../src/core/tileset";

// TE-030 page module: the specs import it into the running editor, next to the TE-025 one
// (`load` there sets up the project: "Terrain", 12 tiles of 16 px on 4 columns, tile 5
// animated, and "Props"). It reads and sets tiles' animations through the history and reads the
// Tilesets panel's canvas for the animated mark.

export { canvasPixel, load, token } from "./te-025-page";

const state = () => window.__ngneTest!.session.getState();

/** The number of undo steps and the labels of the next undo and redo. */
export function history(): { undo: number; label: string | null; redo: string | null } {
    const { history } = state();
    return { undo: history.undoCount, label: history.undoLabel, redo: history.redoLabel };
}

/** The animation of tile `tileId` of the tileset at `index` in the list. */
export function animation(tileId: number, index = 0): AnimationFrame[] {
    const tileset = state().session.project.tilesets[index]!;
    return tileset.tiles.find((tile) => tile.id === tileId)!.animation;
}

/** Sets the animation of tile `tileId` of the first tileset: one history entry. */
export function setAnimation(tileId: number, frames: AnimationFrame[]): void {
    const tileset = state().session.project.tilesets[0]!;
    state().history.execute(setAnimationCommand(tileset.id, tileId, frames, "add"));
}
