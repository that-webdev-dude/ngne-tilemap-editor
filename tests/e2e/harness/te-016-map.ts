// The TE-016 test map, shared by the page module and the specs (which run in Node and cannot
// import the page module): 40 × 30 cells of 16 pixels; layers tile 1, group 2 holding tile 3,
// marker 4.

export const MAP = { width: 40, height: 30, tile: 16 } as const;

export const LAYERS = { tile: 1, group: 2, grouped: 3, marker: 4 } as const;
