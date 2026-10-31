import { cellSlot, cellTileId } from "../../core/cells";
import { findLayer } from "../../core/model";
import type { ProjectMap } from "../../core/model";
import { viewScale } from "../../app/view/coordinates";
import { activeView } from "../../app/view/viewNavigation";
import type { StatusField, StatusFieldInput } from "./statusFields";

// The status fields of the viewport (DESIGN §8.7): the cell and the tile under the pointer, the
// zoom with Fit, and the size of the map.

/** The widest cell position a map has (width and height are at most 4 digits). */
const CELL_WIDTH = 10;

function formatZoom(scale: number): string {
    return `${Number(scale.toFixed(3))}×`;
}

/**
 * The tile of the active layer under the cursor as "tileset#id" with its class in brackets;
 * empty off the map, on an empty cell, and when the active layer is not a tile layer.
 */
export function tileUnderCursor({ session, map, cursor }: StatusFieldInput): string {
    if (!map || !cursor) return "";
    const layerId = session.perMap.get(map.id)?.activeLayerId;
    const layer = layerId === undefined ? undefined : findLayer(map, layerId)?.layer;
    if (layer?.type !== "tile") return "";
    const value = layer.cells.get(cursor.x, cursor.y);
    if (value === 0) return "";
    const tileset = session.project.tilesets.find((each) => each.slot === cellSlot(value));
    if (!tileset) return "";
    const id = cellTileId(value);
    const tile = tileset.tiles.find((each) => each.id === id);
    return `${tileset.name}#${id}${tile?.class ? ` (${tile.class})` : ""}`;
}

function mapSize(map: ProjectMap | null): string {
    return map ? `${map.width} × ${map.height} cells` : "";
}

export const statusFields: StatusField[] = [
    {
        id: "cell",
        order: 100,
        reserve: CELL_WIDTH,
        text: ({ cursor }) => (cursor ? `${cursor.x}, ${cursor.y}` : ""),
    },
    { id: "tile", order: 200, text: tileUnderCursor },
    {
        id: "zoom",
        order: 300,
        action: { commandId: "view.fit" },
        text: ({ map }) => {
            const view = map ? activeView() : null;
            return view ? formatZoom(viewScale(view, window.devicePixelRatio)) : "";
        },
    },
    { id: "size", order: 400, text: ({ map }) => mapSize(map) },
];
