// In-memory cell values (SPEC §2.2): the flag bits of FORMAT §1.2 unchanged, the tileset's
// session slot in bits 20..27 and the tile ID in bits 0..19; 0 is an empty cell. Values are
// unsigned 32-bit integers, so every result is taken back with `>>> 0`.

/** `H`: flip horizontally (FORMAT §1.2). */
export const FLIP_H = 0x80000000;
/** `V`: flip vertically. */
export const FLIP_V = 0x40000000;
/** `D`: flip anti-diagonally (swap x and y). */
export const FLIP_D = 0x20000000;
/** Reserved bit 28, always 0. */
export const RESERVED_BIT = 0x10000000;
/** The three flag bits. */
export const FLAG_MASK = 0xe0000000;
/** Everything below the flags: the GID in a file, slot and tile ID in memory. */
export const GID_MASK = 0x0fffffff;

/** First bit of the slot. */
export const SLOT_SHIFT = 20;
/** Largest slot; slots are 1..255 (SPEC §2.1). */
export const MAX_SLOT = 255;
/** Largest tile ID (FORMAT §2.8). */
export const MAX_TILE_ID = 0xfffff;

/** Index of an orientation, `H<<2 | V<<1 | D`, 0..7 (SPEC §2.3). */
export type Orientation = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * The cell value of tile `tileId` of the tileset in `slot`, drawn in `orientation`. Throws
 * `RangeError` when the slot is not 1..255, the tile ID not 0..1 048 575 or the orientation
 * not 0..7.
 */
export function cellValue(slot: number, tileId: number, orientation: Orientation = 0): number {
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOT) {
        throw new RangeError(`Tileset slot must be an integer 1..${MAX_SLOT}, got ${slot}.`);
    }
    if (!Number.isInteger(tileId) || tileId < 0 || tileId > MAX_TILE_ID) {
        throw new RangeError(`Tile ID must be an integer 0..${MAX_TILE_ID}, got ${tileId}.`);
    }
    if (!Number.isInteger(orientation) || orientation < 0 || orientation > 7) {
        throw new RangeError(`Orientation must be an integer 0..7, got ${orientation}.`);
    }
    return ((orientation << 29) | (slot << SLOT_SHIFT) | tileId) >>> 0;
}

/** The slot of a non-empty value. */
export function cellSlot(value: number): number {
    return (value >>> SLOT_SHIFT) & MAX_SLOT;
}

/** The tile ID of a non-empty value. */
export function cellTileId(value: number): number {
    return value & MAX_TILE_ID;
}

/** The orientation of a value: its flag bits as `H<<2 | V<<1 | D`. */
export function cellOrientation(value: number): Orientation {
    return (value >>> 29) as Orientation;
}

/** `value` with its flags replaced by `orientation`; empty stays empty. */
export function withOrientation(value: number, orientation: Orientation): number {
    return value === 0 ? 0 : ((orientation << 29) | (value & GID_MASK)) >>> 0;
}

/**
 * Whether `value` is a valid in-memory cell value: 0, or a slot 1..255 and no reserved bit.
 * Whether the slot and tile exist is the project's to check.
 */
export function isCellValue(value: number): boolean {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return false;
    if (value === 0) return true;
    return (value & RESERVED_BIT) === 0 && cellSlot(value) !== 0;
}
