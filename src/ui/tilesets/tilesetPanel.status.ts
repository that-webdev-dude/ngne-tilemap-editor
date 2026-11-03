import { gridLayout, shownTile, tileLabel } from "../../app/tilesets/panel/tileGrid";
import {
    selectionRect,
    shownTileset,
    tilesetPanelStore,
} from "../../app/tilesets/panel/tilesetPanel";
import type { StatusField, StatusFieldInput } from "../status/statusFields";

// The Tilesets panel's status field (SPEC §6.2, DESIGN §8.7): the tile under the pointer in the
// panel as `tileset#id` with its class, else the selected tile; a selection of several tiles
// shows the tileset and the selection's size. It sits right after the viewport's tile field,
// which is empty while the pointer is over the panel.

export function panelTile({ session }: StatusFieldInput): string {
    const state = tilesetPanelStore.getState();
    const { project } = session;
    const { hovered } = state;
    if (hovered) {
        const tileset = project.tilesets.find((each) => each.id === hovered.tilesetId);
        const tile = tileset?.tiles[hovered.index];
        if (tileset && tile) return tileLabel(tileset, tile);
    }
    const tileset = shownTileset(project, state);
    const rect = tileset ? selectionRect(tileset, state) : null;
    if (!tileset || !rect) return "";
    if (rect.columns > 1 || rect.rows > 1) return `${tileset.name} ${rect.columns} × ${rect.rows}`;
    const tile = shownTile(tileset, gridLayout(tileset, 1), rect, state.filter);
    return tile ? tileLabel(tileset, tile) : "";
}

export const statusFields: StatusField[] = [
    {
        id: "panelTile",
        order: 210,
        text: panelTile,
        subscribe: (listener) => tilesetPanelStore.subscribe(listener),
    },
];
