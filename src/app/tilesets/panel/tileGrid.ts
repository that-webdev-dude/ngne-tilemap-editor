import { cellValue } from "../../../core/cells";
import type { Stamp } from "../../../core/cells";
import type { Tile, Tileset } from "../../../core/model";

// The tile grid of the Tilesets panel (SPEC §6.2, DESIGN §8.5): the tiles of one tileset in
// display order, tile `k` at column `k % columns`, row `floor(k / columns)` of the tileset's
// own grid (`Tileset.columns`, as Tiled's tileset view lays out an image tileset), each drawn
// `zoom` times its size with a 1 px gap round every tile. A selection is a rectangle of grid
// positions; the stamp it makes is laid out as in the panel (SPEC §4.2). The class filter
// hides non-matching tiles in place: the grid keeps its layout, and a hidden tile, like a
// position past the last tile, is an empty cell of the stamp. Pure, so the panel, its tests
// and the status bar share it.

/** The gap round every tile, in CSS pixels (DESIGN §8.5: 1 px `--border` gaps). */
export const TILE_GAP = 1;

/** The zoom steps of the panel (DESIGN §8.5: 1×–8×, whole numbers). */
export const PANEL_ZOOMS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type PanelZoom = (typeof PANEL_ZOOMS)[number];

/** A position of the grid. */
export interface GridPoint {
    readonly column: number;
    readonly row: number;
}

/** A rectangle of grid positions. */
export interface GridRect {
    readonly column: number;
    readonly row: number;
    readonly columns: number;
    readonly rows: number;
}

export interface GridLayout {
    readonly columns: number;
    readonly rows: number;
    /** A tile's drawn size in CSS pixels. */
    readonly tileWidth: number;
    readonly tileHeight: number;
    /** From one tile's left (top) edge to the next's: the tile plus a gap. */
    readonly pitchX: number;
    readonly pitchY: number;
    /** The whole grid, gaps included, in CSS pixels. */
    readonly width: number;
    readonly height: number;
}

/** The layout of `tileset`'s grid at `zoom`. */
export function gridLayout(
    tileset: Pick<Tileset, "columns" | "tileWidth" | "tileHeight" | "tiles">,
    zoom: number,
): GridLayout {
    const columns = Math.max(1, tileset.columns);
    const rows = Math.ceil(tileset.tiles.length / columns);
    const tileWidth = tileset.tileWidth * zoom;
    const tileHeight = tileset.tileHeight * zoom;
    const pitchX = tileWidth + TILE_GAP;
    const pitchY = tileHeight + TILE_GAP;
    return {
        columns,
        rows,
        tileWidth,
        tileHeight,
        pitchX,
        pitchY,
        width: columns * pitchX + TILE_GAP,
        height: rows * pitchY + TILE_GAP,
    };
}

/** The left and top of the tile at `point`, in CSS pixels of the grid. */
export function tileOrigin(layout: GridLayout, point: GridPoint): { x: number; y: number } {
    return { x: TILE_GAP + point.column * layout.pitchX, y: TILE_GAP + point.row * layout.pitchY };
}

/**
 * The grid position under `(x, y)` (CSS pixels of the grid), the gaps going to the tile after
 * them; with `clamp`, a point outside the grid gives the nearest position, else null.
 */
export function gridPointAt(
    layout: GridLayout,
    x: number,
    y: number,
    clamp = false,
): GridPoint | null {
    const column = Math.floor((x - TILE_GAP) / layout.pitchX);
    const row = Math.floor((y - TILE_GAP) / layout.pitchY);
    const inside = column >= 0 && row >= 0 && column < layout.columns && row < layout.rows;
    if (inside) return { column, row };
    if (!clamp || layout.rows === 0) return null;
    return {
        column: Math.min(Math.max(column, 0), layout.columns - 1),
        row: Math.min(Math.max(row, 0), layout.rows - 1),
    };
}

/** The index in display order of the tile at `point`. */
export function tileIndex(layout: Pick<GridLayout, "columns">, point: GridPoint): number {
    return point.row * layout.columns + point.column;
}

/** The rectangle spanned by two positions, both included. */
export function spanGridRect(a: GridPoint, b: GridPoint): GridRect {
    const column = Math.min(a.column, b.column);
    const row = Math.min(a.row, b.row);
    return {
        column,
        row,
        columns: Math.abs(a.column - b.column) + 1,
        rows: Math.abs(a.row - b.row) + 1,
    };
}

/**
 * Whether the class filter shows `tile`: an empty filter shows every tile, else the tile's
 * class contains the filter's text, ignoring case and the spaces round it.
 */
export function tileMatches(tile: Pick<Tile, "class">, filter: string): boolean {
    const wanted = filter.trim().toLowerCase();
    return wanted === "" || tile.class.toLowerCase().includes(wanted);
}

/** The tile at `point` when there is one there and the filter shows it, else null. */
export function shownTile(
    tileset: Pick<Tileset, "tiles">,
    layout: Pick<GridLayout, "columns">,
    point: GridPoint,
    filter: string,
): Tile | null {
    if (point.column < 0 || point.column >= layout.columns || point.row < 0) return null;
    const tile = tileset.tiles[tileIndex(layout, point)];
    return tile && tileMatches(tile, filter) ? tile : null;
}

/**
 * The stamp of the tiles of `rect`, laid out as in the panel: each shown tile its cell value,
 * hidden tiles and positions without a tile empty. Null when no cell has a tile.
 */
export function selectionStamp(
    tileset: Pick<Tileset, "slot" | "tiles" | "columns">,
    rect: GridRect,
    filter: string,
): Stamp | null {
    const layout = { columns: Math.max(1, tileset.columns) };
    const cells = new Uint32Array(rect.columns * rect.rows);
    let any = false;
    for (let y = 0; y < rect.rows; y++) {
        for (let x = 0; x < rect.columns; x++) {
            const point = { column: rect.column + x, row: rect.row + y };
            const tile = shownTile(tileset, layout, point, filter);
            if (!tile) continue;
            cells[y * rect.columns + x] = cellValue(tileset.slot, tile.id);
            any = true;
        }
    }
    return any ? { width: rect.columns, height: rect.rows, cells } : null;
}

/** The marks a tile carries in the grid (DESIGN §4). */
export interface TileMarks {
    /** It has properties or a class: a corner triangle. */
    readonly data: boolean;
    /** It is animated: `▶`. */
    readonly animated: boolean;
    /** It has collision shapes: an outline square. */
    readonly collision: boolean;
}

export function tileMarks(tile: Pick<Tile, "class" | "properties" | "animation" | "collision">) {
    return {
        data: tile.class !== "" || tile.properties.length > 0,
        animated: tile.animation.length > 0,
        collision: tile.collision.length > 0,
    } satisfies TileMarks;
}

/** A tile as the status bar names it (DESIGN §8.7): `tileset#id`, its class in brackets. */
export function tileLabel(tileset: Pick<Tileset, "name">, tile: Pick<Tile, "id" | "class">) {
    return `${tileset.name}#${tile.id}${tile.class ? ` (${tile.class})` : ""}`;
}
