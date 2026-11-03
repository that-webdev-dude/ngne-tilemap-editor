// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { FLAG_MASK, cellSlot, cellTileId, cellValue } from "../../../src/core/cells";
import type { TileLayer } from "../../../src/core/model";
import { sha256Hex } from "../../support/sha256";
import { MAP } from "./te-025-map";

// TE-028 page module: the specs import it into the running editor, next to the TE-025 and
// TE-026 ones (`load` sets up the project of two tilesets; `readMap` reads the viewport back).
// It paints cells with flags in one history step and reads the tileset and the cells as the
// update leaves them.

export { load } from "./te-025-page";
export { cellCentre, history, readMap, undo } from "./te-026-page";

const state = () => window.__ngneTest!.session.getState();

function firstLayer(): TileLayer {
    const { session } = state();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    return map.layers[0] as TileLayer;
}

/** The active map's name. */
export function mapName(): string {
    const { session } = state();
    return session.project.maps.find((each) => each.id === session.activeMapId)!.name;
}

/**
 * Sets each `[x, y, tile, flags]` of the first tile layer to `tile` of the tileset in `slot`
 * with `flags` (FLIP_* bits): one history step.
 */
export function paint(slot: number, cells: [number, number, number, number][]): void {
    const { session, history } = state();
    const layer = firstLayer();
    const before = cells.map(([x, y]) => layer.cells.get(x, y));
    history.execute({
        label: "Paint",
        bytes: 12 * cells.length,
        touched: {
            mapId: session.activeMapId,
            layerIds: [layer.id],
            cellRects: cells.map(([x, y]) => ({ x, y, width: 1, height: 1 })),
            tilesetIds: [],
            structure: false,
        },
        do: () => {
            for (const [x, y, tile, flags] of cells) {
                layer.cells.set(x, y, (cellValue(slot, tile) | flags) >>> 0);
            }
        },
        undo: () => cells.forEach(([x, y], k) => void layer.cells.set(x, y, before[k]!)),
    });
}

/** The non-empty cells of the first tile layer, as "x,y:slot:tile:flags", row by row. */
export function cells(): string[] {
    const layer = firstLayer();
    const found: string[] = [];
    for (let y = 0; y < MAP.height; y++) {
        for (let x = 0; x < MAP.width; x++) {
            const value = layer.cells.get(x, y);
            if (value === 0) continue;
            const flags = ((value & FLAG_MASK) >>> 0).toString(16);
            found.push(`${x},${y}:${cellSlot(value)}:${cellTileId(value)}:${flags}`);
        }
    }
    return found;
}

export interface TilesetView {
    tiles: { id: number; key: unknown; fingerprint: string }[];
    nextTileId: number;
    columns: number;
    /** SHA-256 of the stored image's bytes, with its size. */
    pixels: string;
}

/** The tileset at `index` of the list as the update leaves it. */
export function tileset(index: number): TilesetView {
    const each = state().session.project.tilesets[index]!;
    return {
        tiles: each.tiles.map((tile) => ({
            id: tile.id,
            key: tile.sourceKey,
            fingerprint: tile.fingerprint,
        })),
        nextTileId: each.nextTileId,
        columns: each.columns,
        pixels: `${each.pixels.width}x${each.pixels.height}:${sha256Hex(each.pixels.data)}`,
    };
}
