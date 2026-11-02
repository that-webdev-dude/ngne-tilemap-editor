// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { currentStamp, setCurrentStamp } from "../../../src/app/tools/stamp/currentStamp";
import { cellOrientation, cellTileId, cellValue } from "../../../src/core/cells";
import type { Orientation } from "../../../src/core/cells";
import { findLayer } from "../../../src/core/model";
import type { TileLayer } from "../../../src/core/model";
import { MAP } from "./te-017-map";

// TE-018 page module: the TE-017 page module (test map, history, overlay) and what the TE-018
// specs read besides: cells and stamps with their orientation (FORMAT §1.2, the 3-bit index
// `H<<2 | V<<1 | D`), and the active tool.

export * from "./te-017-page";

/** A cell as the specs write it: tile id of slot 1 and orientation, or null for empty. */
export type CellSpec = [tile: number, orientation: number] | null;

const encode = (cell: CellSpec) =>
    cell === null ? 0 : cellValue(1, cell[0], cell[1] as Orientation);

const decode = (value: number): CellSpec =>
    value === 0 ? null : [cellTileId(value), cellOrientation(value)];

function tileLayer(id: number): TileLayer {
    const { session } = window.__ngneTest!.session.getState();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    return findLayer(map, id)!.layer as TileLayer;
}

/** Sets the current stamp: `cells` row by row. */
export function setOrientedStamp(width: number, height: number, cells: CellSpec[]): void {
    setCurrentStamp({ width, height, cells: Uint32Array.from(cells, encode) });
}

/** The current stamp, its cells row by row; null without one. */
export function stamp(): { width: number; height: number; cells: CellSpec[] } | null {
    const current = currentStamp();
    if (!current) return null;
    return { width: current.width, height: current.height, cells: [...current.cells].map(decode) };
}

/** Writes `[x, y, cell]` entries into tile layer `id`, outside the history. */
export function put(id: number, entries: [number, number, CellSpec][]): void {
    const layer = tileLayer(id);
    for (const [x, y, cell] of entries) layer.cells.set(x, y, encode(cell));
    window.__ngneTest!.session.getState().touch();
}

/** The non-empty cells of tile layer `id`, as "x,y:tile/orientation", row by row. */
export function orientedCells(id: number): string[] {
    const layer = tileLayer(id);
    const found: string[] = [];
    for (let y = 0; y < MAP.height; y++) {
        for (let x = 0; x < MAP.width; x++) {
            const value = layer.cells.get(x, y);
            if (value !== 0) found.push(`${x},${y}:${cellTileId(value)}/${cellOrientation(value)}`);
        }
    }
    return found;
}

/** The id of the active tool. */
export function activeTool(): string {
    return toolState.activeId();
}
