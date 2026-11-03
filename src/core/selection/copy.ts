import type { CellStore, Stamp } from "../cells";
import type { Region } from "../model";
import { maskHas } from "./mask";

// Copy of the selected cells (SPEC §4.4; TE-021), Tiled's `ClipboardManager::copySelection`:
// the cells of one tile layer inside the selection, over the selection's bounding box; a cell
// of the box outside the selection is empty. Pure.

/**
 * The stamp of the cells of `cells` that `selection` selects: `selection`'s rectangle, which
 * is its bounding box, with every cell outside the mask empty.
 */
export function copySelectedCells(cells: Pick<CellStore, "get">, selection: Region): Stamp {
    const { x, y, width, height } = selection;
    const out = new Uint32Array(width * height);
    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            if (maskHas(selection, x + u, y + v)) out[v * width + u] = cells.get(x + u, y + v);
        }
    }
    return { width, height, cells: out };
}
