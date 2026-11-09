import { markBox } from "../../app/terrains/terrainMarks";
import type { MarkBox } from "../../app/terrains/terrainMarks";
import type { TerrainHover } from "../../app/terrains/terrainsPanel";
import { gridPointAt, shownTile, tileOrigin } from "../../app/tilesets/panel/tileGrid";
import type { GridLayout } from "../../app/tilesets/panel/tileGrid";
import type { TerrainSet, Tileset } from "../../core/model";
import { WANG_INDEXES, typeUsesIndex } from "../../core/terrain";
import type { GridView } from "../tilesets/paintTileGrid";

// Canvas2D painting of the terrain marks over the Terrains panel's tile grid (DESIGN §8.6),
// after `paintTileGrid` has painted the tiles on the same canvas with its transform: for every
// tile of the selected set in view, a dot per corner and a bar per edge that has a terrain, in
// the terrain's colour on a 1 px black halo (as markers, DESIGN §4) so it reads on any tile (boxes of
// `terrainMarks.ts`); then the index a click would assign under the pointer, outlined 2 px in
// `--accent` (as the terrain brush marks it on the viewport, DESIGN §4).

/** The halo round a mark: black, as the markers' (DESIGN §4). */
const OUTLINE = "#000000";

function paintMark(context: CanvasRenderingContext2D, box: MarkBox, colour: string): void {
    if (box.kind === "corner") {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const radius = box.width / 2;
        context.fillStyle = OUTLINE;
        context.beginPath();
        context.arc(cx, cy, radius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = colour;
        context.beginPath();
        context.arc(cx, cy, radius - 1, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.fillStyle = OUTLINE;
    context.fillRect(box.x - 1, box.y - 1, box.width + 2, box.height + 2);
    context.fillStyle = colour;
    context.fillRect(box.x, box.y, box.width, box.height);
}

function outline(context: CanvasRenderingContext2D, box: MarkBox, accent: string): void {
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.strokeRect(box.x - 2, box.y - 2, box.width + 4, box.height + 4);
}

export interface MarksInput {
    tileset: Tileset;
    set: TerrainSet;
    layout: GridLayout;
    view: GridView;
    hover: TerrainHover | null;
    accent: string;
}

/** Paints the marks of `set` over the tiles in `view`; the canvas has the grid's transform. */
export function paintTerrainMarks(context: CanvasRenderingContext2D, input: MarksInput): void {
    const { tileset, set, layout, view, hover, accent } = input;
    const first = gridPointAt(layout, view.x, view.y, true);
    const last = gridPointAt(layout, view.x + view.width, view.y + view.height, true);
    if (!first || !last) return;
    const wangIds = new Map(set.tiles.map((tile) => [tile.tile, tile.wangId]));
    for (let row = first.row; row <= last.row; row++) {
        for (let column = first.column; column <= last.column; column++) {
            const point = { column, row };
            const tile = shownTile(tileset, layout, point, "");
            if (!tile) continue;
            const { x, y } = tileOrigin(layout, point);
            const wangId = wangIds.get(tile.id);
            if (wangId) {
                for (let index = 0; index < WANG_INDEXES; index++) {
                    const terrain = wangId[index]!;
                    if (terrain === 0 || !typeUsesIndex(set.type, index)) continue;
                    const colour = set.colors[terrain - 1]?.color;
                    if (!colour) continue;
                    paintMark(
                        context,
                        markBox(index, x, y, layout.tileWidth, layout.tileHeight),
                        colour,
                    );
                }
            }
            if (
                hover &&
                hover.tilesetId === tileset.id &&
                hover.tileId === tile.id &&
                hover.target !== null
            ) {
                if (hover.target === "tile") {
                    context.strokeStyle = accent;
                    context.lineWidth = 2;
                    context.strokeRect(x + 1, y + 1, layout.tileWidth - 2, layout.tileHeight - 2);
                } else {
                    outline(
                        context,
                        markBox(hover.target, x, y, layout.tileWidth, layout.tileHeight),
                        accent,
                    );
                }
            }
        }
    }
}
