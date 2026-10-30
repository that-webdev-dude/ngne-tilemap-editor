import { CELL_INDEX_MASK, CHUNK_BITS, CellStore } from "./store";
import { FLAG_MASK, GID_MASK, MAX_SLOT, MAX_TILE_ID, RESERVED_BIT, SLOT_SHIFT } from "./value";

// Conversion between in-memory values (slot and tile ID) and GIDs (FORMAT §1.2) with a map's
// `firstGid` table. Saving and export convert to GIDs, opening converts back (SPEC §2.2).

/** One tileset of a map's table: its session slot, `firstGid` and `nextTileId`. */
export interface GidTableEntry {
    readonly slot: number;
    readonly firstGid: number;
    readonly nextTileId: number;
}

/** A map's validated `firstGid` table, entries in ascending `firstGid`. */
export interface GidTable {
    readonly entries: readonly GidTableEntry[];
    /** Entry by slot; undefined for a slot the map does not list. */
    readonly bySlot: readonly (GidTableEntry | undefined)[];
}

/** Thrown when a table or layer is malformed or a value or GID has no tile in its table. */
export class CellConversionError extends Error {
    override readonly name = "CellConversionError";
}

function assertLayerSize(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new CellConversionError(
            `Layer size must be positive integers, got ${width}x${height}.`,
        );
    }
}

/**
 * Builds a table from entries in any order. Throws `CellConversionError` unless every slot is
 * 1..255 and distinct, every `nextTileId` 1..1 048 576, every `firstGid` at least 1, and the
 * spans `firstGid .. firstGid + nextTileId − 1` do not overlap and end at or below 0x0FFFFFFF.
 */
export function createGidTable(entries: readonly GidTableEntry[]): GidTable {
    const sorted = [...entries].sort((a, b) => a.firstGid - b.firstGid);
    const bySlot: (GidTableEntry | undefined)[] = new Array(MAX_SLOT + 1).fill(undefined);
    let end = 0;
    for (const entry of sorted) {
        const { slot, firstGid, nextTileId } = entry;
        if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOT || bySlot[slot]) {
            throw new CellConversionError(`Slot ${slot} is not a free slot 1..${MAX_SLOT}.`);
        }
        if (!Number.isInteger(nextTileId) || nextTileId < 1 || nextTileId > MAX_TILE_ID + 1) {
            throw new CellConversionError(
                `nextTileId ${nextTileId} of slot ${slot} is out of range.`,
            );
        }
        if (!Number.isInteger(firstGid) || firstGid <= end) {
            throw new CellConversionError(`firstGid ${firstGid} of slot ${slot} overlaps a span.`);
        }
        end = firstGid + nextTileId - 1;
        if (end > GID_MASK) {
            throw new CellConversionError(`The span of slot ${slot} ends past ${GID_MASK}.`);
        }
        bySlot[slot] = { slot, firstGid, nextTileId };
    }
    return { entries: sorted.map((entry) => bySlot[entry.slot]!), bySlot };
}

/**
 * The table a writer lists (FORMAT §1.2): the given tilesets in their order, from `firstGid`
 * 1, each span starting where the previous ends.
 */
export function assignFirstGids(
    tilesets: readonly { readonly slot: number; readonly nextTileId: number }[],
): GidTable {
    let firstGid = 1;
    return createGidTable(
        tilesets.map(({ slot, nextTileId }) => {
            const entry = { slot, firstGid, nextTileId };
            firstGid += nextTileId;
            return entry;
        }),
    );
}

/** The GID form of an in-memory value; 0 stays 0, the flags are kept. */
export function valueToGid(value: number, table: GidTable): number {
    if (value === 0) return 0;
    const slot = (value >>> SLOT_SHIFT) & MAX_SLOT;
    const tileId = value & MAX_TILE_ID;
    const entry = table.bySlot[slot];
    if ((value & RESERVED_BIT) !== 0 || entry === undefined || tileId >= entry.nextTileId) {
        throw new CellConversionError(
            `Cell value 0x${value.toString(16)} has no GID in the table.`,
        );
    }
    return ((value & FLAG_MASK) | (entry.firstGid + tileId)) >>> 0;
}

/** The in-memory form of a GID cell value; 0 stays 0, the flags are kept. */
export function gidToValue(cell: number, table: GidTable): number {
    if (cell === 0) return 0;
    if (!Number.isInteger(cell) || cell < 0 || cell > 0xffffffff) {
        throw new CellConversionError(`Cell ${cell} is not an unsigned 32-bit integer.`);
    }
    const gid = cell & GID_MASK;
    const entries = table.entries;
    let low = 0;
    let high = entries.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (entries[mid]!.firstGid <= gid) low = mid + 1;
        else high = mid - 1;
    }
    const entry = entries[high];
    if (
        (cell & RESERVED_BIT) !== 0 ||
        entry === undefined ||
        gid - entry.firstGid >= entry.nextTileId
    ) {
        throw new CellConversionError(`Cell 0x${cell.toString(16)} names no tile of the table.`);
    }
    return ((cell & FLAG_MASK) | (entry.slot << SLOT_SHIFT) | (gid - entry.firstGid)) >>> 0;
}

/**
 * A `width × height` layer's GID cells, row by row from the top-left (FORMAT §2.5 `data`).
 * O(cells). Throws `CellConversionError` when a value has no GID or lies outside the layer.
 */
export function cellsToGids(
    store: CellStore,
    width: number,
    height: number,
    table: GidTable,
): Uint32Array {
    assertLayerSize(width, height);
    const data = new Uint32Array(width * height);
    let converted = 0;
    for (const chunk of store.chunksIn({ x: 0, y: 0, width, height })) {
        const ox = chunk.cx << CHUNK_BITS;
        const oy = chunk.cy << CHUNK_BITS;
        for (let index = 0; index < chunk.cells.length; index += 1) {
            const value = chunk.cells[index]!;
            if (value === 0) continue;
            const x = ox + (index & CELL_INDEX_MASK);
            const y = oy + (index >> CHUNK_BITS);
            if (x >= width || y >= height) continue;
            data[y * width + x] = valueToGid(value, table);
            converted += 1;
        }
    }
    if (converted !== store.count) {
        throw new CellConversionError(`Cells lie outside the ${width}x${height} layer.`);
    }
    return data;
}

/**
 * The cell store of a `width × height` layer from its GID cells, row by row from the
 * top-left. O(cells). Throws `CellConversionError` when the length is not `width × height` or
 * a cell names no tile of the table.
 */
export function gidsToCells(
    data: ArrayLike<number>,
    width: number,
    height: number,
    table: GidTable,
): CellStore {
    assertLayerSize(width, height);
    if (data.length !== width * height) {
        throw new CellConversionError(
            `A ${width}x${height} layer has ${width * height} cells, got ${data.length}.`,
        );
    }
    const store = new CellStore();
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const cell = data[y * width + x]!;
            if (cell !== 0) store.set(x, y, gidToValue(cell, table));
        }
    }
    return store;
}
