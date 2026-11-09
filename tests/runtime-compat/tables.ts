// TE-052: the export folder whose `ngne-tilemap.ts` the fixture games import (SPEC 11.4). The
// compat script generates the runtime with these tables; the fixture games load `meadow`.

export const COMPAT_TABLES = {
    tilemaps: ["meadow"],
    tilesets: ["grass"],
    images: ["sky"],
} as const;
