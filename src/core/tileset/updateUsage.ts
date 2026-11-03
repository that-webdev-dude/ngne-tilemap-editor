import { cellSlot, cellTileId } from "../cells";
import { walkLayers } from "../model";
import type { Project } from "../model";

// The usage the Update Tileset from Source dialog shows per ambiguous or missing tile (SPEC
// §6.3, DESIGN §9: "Overworld: 120 cells"): the cells of each map, in every tile layer, that
// hold the tile, whatever their flags. One pass over the cells of every map.

/** The cells of one map that hold a tile. */
export interface MapUsage {
    mapId: string;
    mapName: string;
    cells: number;
}

/**
 * The usage of each of `tileIds` of the tileset in `slot`, by tile ID: the maps that use it,
 * in project order, with their cell counts; an unused tile has an empty list.
 */
export function tileUsage(
    project: Project,
    slot: number,
    tileIds: Iterable<number>,
): Map<number, MapUsage[]> {
    const usage = new Map<number, MapUsage[]>();
    for (const id of tileIds) usage.set(id, []);
    if (usage.size === 0) return usage;
    for (const map of project.maps) {
        const counts = new Map<number, number>();
        const bounds = { x: 0, y: 0, width: map.width, height: map.height };
        for (const { layer } of walkLayers(map.layers)) {
            if (layer.type !== "tile") continue;
            for (const chunk of layer.cells.chunksIn(bounds)) {
                for (const value of chunk.cells) {
                    if (value === 0 || cellSlot(value) !== slot) continue;
                    const id = cellTileId(value);
                    if (usage.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
                }
            }
        }
        for (const [id, cells] of counts) {
            usage.get(id)!.push({ mapId: map.id, mapName: map.name, cells });
        }
    }
    return usage;
}
