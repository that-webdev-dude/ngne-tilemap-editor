// The TE-017 test map, shared by the page module and the specs (which run in Node and cannot
// import the page module): 40 × 30 cells of 16 pixels; tile layers Ground and Top, a locked
// tile layer, a hidden group holding a tile layer, and a marker layer. One tileset (slot 1) of
// four opaque tiles in solid colours.

export const MAP = { width: 40, height: 30, tile: 16 } as const;

export const LAYERS = {
    ground: 1,
    top: 2,
    locked: 3,
    hiddenGroup: 4,
    hidden: 5,
    marker: 6,
} as const;

/** The colours of tiles 0..3, as 0xRRGGBB. */
export const TILE_COLOURS = [0xd04020, 0x30a050, 0x2050d0, 0xe0c030] as const;
