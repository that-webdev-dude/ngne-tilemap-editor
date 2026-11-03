// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { cellValue } from "../../../src/core/cells";
import type { TileLayer } from "../../../src/core/model";
import { pixelAt, readCanvas } from "../../../src/engine/testing/readCanvas";
import { MAP } from "./te-025-map";

// TE-026 page module: the specs import it into the running editor, next to the TE-025 one
// (`load` there sets up the project of two tilesets). It reads the history and the tilesets,
// paints cells without the history, and reads the viewport's canvas back.

export { load } from "./te-025-page";

const state = () => window.__ngneTest!.session.getState();

/** The number of undo steps and the label of the last one. */
export function history(): { undo: number; label: string | null } {
    const { history } = state();
    return { undo: history.undoCount, label: history.undoLabel };
}

export function undo(): void {
    state().history.undo();
}

/** The tilesets in list order, with the fields the dialog edits. */
export function tilesets(): {
    id: string;
    name: string;
    exportName: string;
    class: string;
    offsetX: number;
    offsetY: number;
}[] {
    return state().session.project.tilesets.map(
        ({ id, name, exportName, class: className, offsetX, offsetY }) => ({
            id,
            name,
            exportName,
            class: className,
            offsetX,
            offsetY,
        }),
    );
}

/**
 * Sets cell `(x, y)` of the first tile layer to tile `tile` of the tileset in `slot`: one
 * history step, so the viewport is told which cell changed.
 */
export function paint(x: number, y: number, slot: number, tile: number): void {
    const { session, history } = state();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    const layer = map.layers[0] as TileLayer;
    const before = layer.cells.get(x, y);
    history.execute({
        label: "Paint",
        bytes: 12,
        touched: {
            mapId: map.id,
            layerIds: [layer.id],
            cellRects: [{ x, y, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        },
        do: () => void layer.cells.set(x, y, cellValue(slot, tile)),
        undo: () => void layer.cells.set(x, y, before),
    });
}

/**
 * Renders a frame and reads the canvas at the device pixels under map pixels `points`; each
 * result is RGB. The specs run at DPR 1 with the view of `load` (half zoom).
 */
export function readMap(points: [number, number][]): number[][] {
    const probe = window.__ngneTest!.viewport!;
    if (!probe.renderNow()) throw new Error("te-026: the renderer did not submit a frame");
    const image = readCanvas(probe.canvas);
    const box = probe.canvas.getBoundingClientRect();
    const ratio = probe.canvas.width / box.width;
    const mapping = currentViewMapping()!;
    return points.map(([x, y]) => {
        const client = mapping.mapToClient(x, y);
        const dx = Math.floor((client.x - box.left) * ratio);
        const dy = Math.floor((client.y - box.top) * ratio);
        return pixelAt(image, dx, dy).slice(0, 3);
    });
}

/** The centre of map cell `(x, y)` in map pixels. */
export function cellCentre(x: number, y: number): [number, number] {
    return [(x + 0.5) * MAP.tile, (y + 0.5) * MAP.tile];
}
