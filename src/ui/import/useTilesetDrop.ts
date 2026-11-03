import { useEffect } from "react";
import { installTilesetDrop } from "../../app/tilesets/import/tilesetDrop";

/** While `active`, a `.ngsprite` dropped on the window opens Import Tileset (SPEC §6.1). */
export function useTilesetDrop(active: boolean): void {
    useEffect(() => (active ? installTilesetDrop() : undefined), [active]);
}
