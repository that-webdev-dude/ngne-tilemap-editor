// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { currentViewMapping, zoomTo } from "../../../src/app/view/viewNavigation";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import { cellValue } from "../../../src/core/cells";
import type { Orientation } from "../../../src/core/cells";
import type { Shape, TileLayer } from "../../../src/core/model";
import { setCollisionCommand } from "../../../src/core/tileset";
import { MAP } from "./te-025-map";

// TE-029 page module: the specs import it into the running editor, next to the TE-025 one
// (`load` there sets up the project: "Terrain", 12 tiles of 16 px, and "Props", on a 30 × 20
// map of 16 px cells). It reads and sets tiles' collision shapes through the history, paints
// oriented cells, and reads the overlay canvas back for Show Collision.

export { load } from "./te-025-page";

const state = () => window.__ngneTest!.session.getState();

/** The number of undo steps and the labels of the next undo and redo. */
export function history(): { undo: number; label: string | null; redo: string | null } {
    const { history } = state();
    return { undo: history.undoCount, label: history.undoLabel, redo: history.redoLabel };
}

/** The collision list of tile `tileId` of the tileset at `index` in the list. */
export function collision(tileId: number, index = 0): Shape[] {
    const tileset = state().session.project.tilesets[index]!;
    return tileset.tiles.find((tile) => tile.id === tileId)!.collision;
}

/** Sets the collision list of tiles `tileIds` of the first tileset: one history entry. */
export function setCollision(tileIds: number[], shapes: Shape[]): void {
    const tileset = state().session.project.tilesets[0]!;
    state().history.execute(setCollisionCommand(tileset.id, tileIds, shapes, "add"));
}

/**
 * A polygon of `count` points in a 16 px tile: a top edge from (0, 0) to (16, 0), then the
 * other points along the bottom from (16, 12) back to (0, 12).
 */
export function comb(count: number): Shape {
    const points: [number, number][] = [
        [0, 0],
        [16, 0],
    ];
    const rest = count - 2;
    for (let index = 0; index < rest; index++) {
        points.push([16 - (16 * index) / (rest - 1), 12]);
    }
    return { shape: "polygon", x: 0, y: 0, points };
}

/**
 * Sets cell `(x, y)` of the first tile layer to tile `tile` of the first tileset drawn in
 * `orientation`: one history step, so the viewport and the overlay are told.
 */
export function paint(x: number, y: number, tile: number, orientation: Orientation): void {
    const { session, history } = state();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    const layer = map.layers[0] as TileLayer;
    const before = layer.cells.get(x, y);
    const value = cellValue(session.project.tilesets[0]!.slot, tile, orientation);
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
        do: () => void layer.cells.set(x, y, value),
        undo: () => void layer.cells.set(x, y, before),
    });
}

/** Zooms about the viewport's centre to `scale` device pixels per map pixel. */
export function setScale(scale: number): void {
    zoomTo(scale);
}

/** The Show Collision preference and what `localStorage` holds for the view. */
export function showCollision(): { shown: boolean; stored: string | null } {
    return {
        shown: viewPreferences.getState().collision,
        stored: localStorage.getItem("ngne-tilemap-editor.view"),
    };
}

/** The device position of map pixel `(x, y)` on the overlay canvas, rounded. */
export function device(x: number, y: number): { x: number; y: number } {
    const at = currentViewMapping()!.mapToDevice(x, y);
    return { x: Math.round(at.x), y: Math.round(at.y) };
}

/** A colour token of the page as RGB. */
function tokenRgb(name: string): number[] {
    const text = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const value = Number.parseInt(text.replace("#", ""), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The overlay pixels in `--accent` along the device row under map `y` between map `x0` and
 * `x1`, and along the device column under map `x` between map `y0` and `y1`.
 */
export function accentLines(
    row: { y: number; x0: number; x1: number },
    column: { x: number; y0: number; y1: number },
): { columns: number[]; rows: number[] } {
    const canvas = window.__ngneTest!.overlay!.canvas;
    const context = canvas.getContext("2d")!;
    const accent = tokenRgb("--accent");
    const isAccent = (x: number, y: number) => {
        const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
        return (
            a! > 200 &&
            Math.abs(r! - accent[0]!) <= 2 &&
            Math.abs(g! - accent[1]!) <= 2 &&
            Math.abs(b! - accent[2]!) <= 2
        );
    };
    const columns: number[] = [];
    const rows: number[] = [];
    const y = device(0, row.y).y;
    for (let x = device(row.x0, 0).x; x <= device(row.x1, 0).x; x++) {
        if (isAccent(x, y)) columns.push(x);
    }
    const x = device(column.x, 0).x;
    for (let y = device(0, column.y0).y; y <= device(0, column.y1).y; y++) {
        if (isAccent(x, y)) rows.push(y);
    }
    return { columns, rows };
}

/** The top-left corner of map cell `(x, y)` in map pixels. */
export function cellOrigin(x: number, y: number): [number, number] {
    return [x * MAP.tile, y * MAP.tile];
}
