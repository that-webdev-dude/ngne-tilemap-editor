// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { gridLayout, tileOrigin } from "../../../src/app/tilesets/panel/tileGrid";
import { tilesetPanelStore } from "../../../src/app/tilesets/panel/tilesetPanel";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { cellSlot, cellTileId } from "../../../src/core/cells";
import { walkLayers } from "../../../src/core/model";
import type { Property } from "../../../src/core/model";
import { serialize } from "../../../src/core/project";

// TE-063 page module: the golden path imports it into the running editor, so it shares the
// app's stores. It only reads: where a tile of a panel's grid or a map point is on screen, and
// what the project holds. Every change of the golden path goes through the interface.

const state = () => window.__ngneTest!.session.getState();

/** The grids a tile is clicked in: the Tilesets panel's and the Terrains panel's. */
const GRIDS = {
    tiles: { scroller: "[data-tile-grid]", sizer: ".tilesets-panel__sizer" },
    terrains: { scroller: "[data-terrain-grid]", sizer: ".terrains-panel__sizer" },
} as const;

/**
 * The client position of point `(fx, fy)` (fractions across the tile) of tile `index` (display
 * order) of the tileset a panel shows, scrolled into view first.
 */
export function tileClient(
    grid: keyof typeof GRIDS,
    index: number,
    fx: number,
    fy: number,
): { x: number; y: number } {
    const scroller = document.querySelector<HTMLElement>(GRIDS[grid].scroller);
    const sizer = document.querySelector<HTMLElement>(GRIDS[grid].sizer);
    if (!scroller || !sizer) throw new Error(`te-063: no ${grid} grid`);
    const id = scroller.getAttribute(grid === "tiles" ? "data-tile-grid" : "data-terrain-grid");
    const tileset = state().session.project.tilesets.find((each) => each.id === id);
    if (!tileset) throw new Error(`te-063: the ${grid} grid shows no tileset`);
    const layout = gridLayout(tileset, tilesetPanelStore.getState().zoom);
    const origin = tileOrigin(layout, {
        column: index % layout.columns,
        row: Math.floor(index / layout.columns),
    });
    const x = origin.x + fx * layout.tileWidth;
    const y = origin.y + fy * layout.tileHeight;
    // The scroller's own scroll changes the sizer's box; the point is read after it.
    scroller.scrollTo(
        Math.max(0, x - scroller.clientWidth / 2),
        Math.max(0, y - scroller.clientHeight / 2),
    );
    const box = sizer.getBoundingClientRect();
    return { x: box.left + x, y: box.top + y };
}

/** The client position of map pixel `(x, y)` of the active map as it is on screen. */
export function mapClient(x: number, y: number): { x: number; y: number } {
    const mapping = currentViewMapping();
    if (!mapping) throw new Error("te-063: no view");
    return mapping.mapToClient(x, y);
}

export function history(): { undo: number; label: string | null } {
    const { history } = state();
    return { undo: history.undoCount, label: history.undoLabel ?? null };
}

/** What the golden path checks of one layer. */
export interface LayerSummary {
    type: string;
    name: string;
    /** Tile layers: the non-empty cells as `x,y:slot/tile`, row by row. */
    cells?: string[];
    /** Marker layers: each marker's shape, name and properties. */
    markers?: { shape: string; x: number; y: number; width: number; height: number }[];
    properties: Property[];
    /** Marker layers: the properties of each marker. */
    markerProperties?: Property[][];
}

/** What the golden path checks of the project. */
export interface ProjectSummary {
    name: string;
    tilesets: { name: string; slot: number; tiles: number; tileWidth: number }[];
    terrainSets: {
        tileset: string;
        name: string;
        type: string;
        terrains: number;
        tiles: string[];
    }[];
    maps: { name: string; width: number; height: number; layers: LayerSummary[] }[];
}

export function summary(): ProjectSummary {
    const { project } = state().session;
    return {
        name: project.name,
        tilesets: project.tilesets.map((tileset) => ({
            name: tileset.name,
            slot: tileset.slot,
            tiles: tileset.tiles.length,
            tileWidth: tileset.tileWidth,
        })),
        terrainSets: project.tilesets.flatMap((tileset) =>
            tileset.terrainSets.map((set) => ({
                tileset: tileset.name,
                name: set.name,
                type: set.type,
                terrains: set.colors.length,
                tiles: set.tiles
                    .map((tile) => `${tile.tile}:${tile.wangId.join("")}`)
                    .sort((a, b) => Number.parseInt(a) - Number.parseInt(b)),
            })),
        ),
        maps: project.maps.map((map) => ({
            name: map.name,
            width: map.width,
            height: map.height,
            layers: [...walkLayers(map.layers)].map(({ layer }): LayerSummary => {
                const base = { type: layer.type, name: layer.name, properties: layer.properties };
                if (layer.type === "tile") {
                    const cells: string[] = [];
                    for (let y = 0; y < map.height; y++) {
                        for (let x = 0; x < map.width; x++) {
                            const value = layer.cells.get(x, y);
                            if (value !== 0)
                                cells.push(`${x},${y}:${cellSlot(value)}/${cellTileId(value)}`);
                        }
                    }
                    return { ...base, cells };
                }
                if (layer.type === "marker") {
                    return {
                        ...base,
                        markers: layer.markers.map((marker) => ({
                            shape: marker.shape,
                            x: marker.x,
                            y: marker.y,
                            width: "width" in marker ? marker.width : 0,
                            height: "height" in marker ? marker.height : 0,
                        })),
                        markerProperties: layer.markers.map((marker) => marker.properties),
                    };
                }
                return base;
            }),
        })),
    };
}

/** The project as `.ngtilemap` bytes, base64: what Save writes for it (FORMAT §2). */
export function serialized(): string {
    const bytes = serialize(state().session.project);
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}
