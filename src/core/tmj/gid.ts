import { FLAG_MASK, GID_MASK, MAX_TILE_ID, RESERVED_BIT } from "../cells";
import type { Orientation } from "../cells";

// Tiled's global tile IDs (reference/tiled.md §5, `gidmapper.cpp`; BRIEF §7 GID flip bits):
// read with `>>> 0`; bits 31/30/29 (H, V, D) kept, bit 28 cleared (hexagonal 120° rotation,
// meaningless on orthogonal maps); the tileset is the one with the largest `firstgid` not above
// the GID, the tile its local ID `gid − firstgid`.

export interface DecodedGid {
    /** Index of the tileset in the map's `tilesets`. */
    readonly tileset: number;
    /** Tiled's local tile ID. */
    readonly tileId: number;
    /** The flags as `H<<2 | V<<1 | D`. */
    readonly orientation: Orientation;
    /** Bit 28 was set and is cleared. */
    readonly bit28: boolean;
}

export type GidDecode =
    | { readonly kind: "empty" }
    | ({ readonly kind: "tile" } & DecodedGid)
    /** A GID below every `firstgid`, or a local ID above FORMAT §2.8's largest tile ID. */
    | { readonly kind: "invalid"; readonly gid: number };

const EMPTY: GidDecode = { kind: "empty" };

/**
 * Decodes a cell of a tile layer. `raw` is the number as the file writes it (Tiled writes the
 * unsigned value; a signed one is read the same through `>>> 0`); `firstGids` the map's
 * tilesets' `firstgid`s in ascending order. A cell whose GID bits are 0 is empty whatever its
 * flags, as Tiled reads it.
 */
export function decodeGid(raw: number, firstGids: readonly number[]): GidDecode {
    const value = raw >>> 0;
    const gid = value & GID_MASK;
    if (gid === 0) return EMPTY;
    let low = 0;
    let high = firstGids.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (firstGids[mid]! <= gid) low = mid + 1;
        else high = mid - 1;
    }
    const firstGid = firstGids[high];
    if (firstGid === undefined || gid - firstGid > MAX_TILE_ID) return { kind: "invalid", gid };
    return {
        kind: "tile",
        tileset: high,
        tileId: gid - firstGid,
        orientation: ((value & FLAG_MASK) >>> 29) as Orientation,
        bit28: (value & RESERVED_BIT) !== 0,
    };
}
