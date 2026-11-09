// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { markBox, markCentre } from "../../../src/app/terrains/terrainMarks";
import { gridLayout, tileOrigin } from "../../../src/app/tilesets/panel/tileGrid";
import { tilesetPanelStore } from "../../../src/app/tilesets/panel/tilesetPanel";
import type { TerrainSet } from "../../../src/core/model";
import { load as loadTilesets } from "./te-025-page";

// TE-043 page module: the specs import it into the running editor, so it shares the app's
// stores. It loads the TE-025 project (tileset "Terrain": 12 tiles of 16 px on 4 columns, shown
// at the Tilesets panel's 2×; "Props") and gives "Terrain" three terrain sets with no tiles yet:
//
//     0 "Cliffs"  corner  Low #ff0000, High #0000ff
//     1 "Roads"   edge    Dirt #00ff00, Stone #ffff00
//     2 "Blend"   mixed   Grass #ff00ff, Water #00ffff

const hooks = () => window.__ngneTest!;
const state = () => hooks().session.getState();

export const SETS: readonly TerrainSet[] = [
    {
        name: "Cliffs",
        type: "corner",
        colors: [
            { name: "Low", color: "#ff0000ff", tile: null },
            { name: "High", color: "#0000ffff", tile: null },
        ],
        tiles: [],
    },
    {
        name: "Roads",
        type: "edge",
        colors: [
            { name: "Dirt", color: "#00ff00ff", tile: null },
            { name: "Stone", color: "#ffff00ff", tile: null },
        ],
        tiles: [],
    },
    {
        name: "Blend",
        type: "mixed",
        colors: [
            { name: "Grass", color: "#ff00ffff", tile: null },
            { name: "Water", color: "#00ffffff", tile: null },
        ],
        tiles: [],
    },
];

export function load(): string[] {
    const ids = loadTilesets();
    const tileset = state().session.project.tilesets[0]!;
    tileset.terrainSets = structuredClone(SETS) as TerrainSet[];
    hooks().assertInvariants();
    state().touch();
    return ids;
}

/** Puts the sets of "Terrain" back as `SETS` with these tiles, outside the history. */
export function setTiles(setIndex: number, tiles: { tile: number; wangId: number[] }[]): void {
    const tileset = state().session.project.tilesets[0]!;
    tileset.terrainSets = tileset.terrainSets.map((set, k) =>
        k === setIndex ? { ...set, tiles } : set,
    );
    hooks().assertInvariants();
    state().touch();
}

/** The terrain sets of "Terrain" as they are. */
export function sets(): TerrainSet[] {
    return structuredClone(state().session.project.tilesets[0]!.terrainSets);
}

/** The WangIds of set `setIndex` of "Terrain", by tile ID. */
export function wangIds(setIndex: number): Record<number, number[]> {
    const set = state().session.project.tilesets[0]!.terrainSets[setIndex]!;
    return Object.fromEntries(set.tiles.map((tile) => [tile.tile, [...tile.wangId]]));
}

export function history(): { undo: number; label: string | null } {
    const { history } = state();
    return { undo: history.undoCount, label: history.undoLabel ?? null };
}

export function undo(): boolean {
    return state().history.undo();
}

export function redo(): boolean {
    return state().history.redo();
}

/** The grid's layout for "Terrain" at the panel's zoom. */
function layout() {
    const tileset = state().session.project.tilesets[0]!;
    return gridLayout(tileset, tilesetPanelStore.getState().zoom);
}

/** Where in the canvas (CSS px) a point `(fx, fy)` of tile `index` (display order) lies. */
export function tilePoint(index: number, fx: number, fy: number): { x: number; y: number } {
    const grid = layout();
    const origin = tileOrigin(grid, {
        column: index % grid.columns,
        row: Math.floor(index / grid.columns),
    });
    return { x: origin.x + fx * grid.tileWidth, y: origin.y + fy * grid.tileHeight };
}

/** The canvas pixel (RGBA) at the middle of the mark of `wangIndex` on tile `index`. */
export function markPixel(index: number, wangIndex: number): number[] {
    const grid = layout();
    const origin = tileOrigin(grid, {
        column: index % grid.columns,
        row: Math.floor(index / grid.columns),
    });
    const box = markBox(wangIndex, origin.x, origin.y, grid.tileWidth, grid.tileHeight);
    const { x, y } = markCentre(box);
    const canvas = document.querySelector<HTMLCanvasElement>("[data-terrain-canvas]")!;
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    return [
        ...canvas.getContext("2d")!.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1)
            .data,
    ];
}
