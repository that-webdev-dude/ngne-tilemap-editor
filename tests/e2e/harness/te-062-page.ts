// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { FLAG_MASK, cellSlot, cellTileId } from "../../../src/core/cells";
import { walkLayers } from "../../../src/core/model";
import type { Tileset } from "../../../src/core/model";
import { sha256Hex } from "../../support/sha256";

// TE-062 page module: the specs import it into the running editor, next to TE-026's (history,
// undo). It reads a tileset by name as the update leaves it, and the cells of the active map
// that show its tiles.

export { history, undo } from "./te-026-page";

const state = () => window.__ngneTest!.session.getState();

function named(name: string): Tileset {
    const tileset = state().session.project.tilesets.find((each) => each.name === name);
    if (!tileset) throw new Error(`te-062: no tileset named ${name}`);
    return tileset;
}

export interface TilesetView {
    id: string;
    tiles: { id: number; key: unknown; fingerprint: string }[];
    nextTileId: number;
    columns: number;
    /** SHA-256 of the stored image's bytes, with its size. */
    pixels: string;
}

/** The tileset `name` as the update leaves it. */
export function tileset(name: string): TilesetView {
    const each = named(name);
    return {
        id: each.id,
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

/** The active map's name. */
export function mapName(): string {
    const { session } = state();
    return session.project.maps.find((each) => each.id === session.activeMapId)!.name;
}

/**
 * The cells of the active map showing tiles of tileset `name`, as "layer x,y:tile:flags", layer
 * by layer, row by row.
 */
export function cells(name: string): string[] {
    const { session } = state();
    const { slot } = named(name);
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    const found: string[] = [];
    for (const { layer } of walkLayers(map.layers)) {
        if (layer.type !== "tile") continue;
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                const value = layer.cells.get(x, y);
                if (value === 0 || cellSlot(value) !== slot) continue;
                const flags = ((value & FLAG_MASK) >>> 0).toString(16);
                found.push(`${layer.name} ${x},${y}:${cellTileId(value)}:${flags}`);
            }
        }
    }
    return found;
}
