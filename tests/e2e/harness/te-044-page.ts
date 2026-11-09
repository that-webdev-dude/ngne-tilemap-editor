// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { resetTerrainBrush } from "../../../src/app/tools/terrain/terrainBrush.tools";
import { currentViewMapping, zoomTo } from "../../../src/app/view/viewNavigation";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import { cellTileId, cellValue } from "../../../src/core/cells";
import {
    createProject,
    createProjectSession,
    findLayer,
    sequentialIds,
} from "../../../src/core/model";
import { rectMask } from "../../../src/core/selection";
import type { Project, TerrainSet, Tile, TileLayer, Tileset } from "../../../src/core/model";
import { sha256Hex } from "../../support/sha256";

// TE-044 page module: the specs import it into the running editor, so it shares the app's
// stores, tools and pipeline. It loads a TE-042 terrain fixture (tests/fixtures/terrain/: an
// 8 × 8 map of 24 px cells, one tileset of slot 1 with one terrain set) as the project, with
// the terrain brush selected, and reads the layer, the history and the overlay back.

const FOLDER = "/tests/fixtures/terrain/";
const SLOT = 1;

interface Tsj {
    columns: number;
    tilecount: number;
    tilewidth: number;
    tileheight: number;
    wangsets: {
        name: string;
        type: TerrainSet["type"];
        colors: { name: string; color: string }[];
        wangtiles: { tileid: number; wangid: number[] }[];
    }[];
}

interface Tmj {
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    layers: { data: number[] }[];
}

const hooks = () => window.__ngneTest!;

async function json<T>(file: string): Promise<T> {
    const response = await fetch(FOLDER + file);
    if (!response.ok) throw new Error(`te-044: ${file}: ${response.status}`);
    return (await response.json()) as T;
}

async function pixels(file: string): Promise<ImageData> {
    const response = await fetch(FOLDER + file);
    const bitmap = await createImageBitmap(await response.blob(), {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

async function tileset(fixture: string, newId: () => string): Promise<Tileset> {
    const tsj = await json<Tsj>(`${fixture}.tsj`);
    const image = await pixels(`${fixture}.png`);
    const { tilewidth: width, tileheight: height, columns } = tsj;
    const tiles: Tile[] = [];
    for (let id = 0; id < tsj.tilecount; id++) {
        const column = id % columns;
        const row = Math.floor(id / columns);
        const own = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
            const from = ((row * height + y) * image.width + column * width) * 4;
            own.set(image.data.subarray(from, from + width * 4), y * width * 4);
        }
        tiles.push({
            id,
            sourceKey: [column, row],
            fingerprint: sha256Hex(own),
            class: "",
            collision: [],
            animation: [],
            properties: [],
        });
    }
    const [wangSet] = tsj.wangsets;
    return {
        id: newId(),
        name: fixture,
        exportName: fixture,
        class: "",
        slot: SLOT,
        tileWidth: width,
        tileHeight: height,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels: { width: image.width, height: image.height, data: image.data },
        nextTileId: tiles.length,
        source: { kind: "image", fileName: `${fixture}.png`, margin: 0, spacing: 0 },
        tiles,
        terrainSets: [
            {
                name: wangSet!.name,
                type: wangSet!.type,
                colors: wangSet!.colors.map(({ name, color }) => ({
                    name,
                    color: `${color}ff`,
                    tile: null,
                })),
                tiles: wangSet!.wangtiles.map(({ tileid, wangid }) => ({
                    tile: tileid,
                    wangId: wangid,
                })),
            },
        ],
        properties: [],
    };
}

/**
 * Replaces the project with fixture `fixture`'s tileset and map file `map`, the terrain brush
 * selected with its line start forgotten, the grid hidden (the overlay then draws the brush
 * only) and the map at 2×, all of it in view.
 */
export async function load(fixture: string, map: string): Promise<void> {
    const newId = sequentialIds();
    const tmj = await json<Tmj>(map);
    const project: Project = createProject({
        newId,
        map: {
            width: tmj.width,
            height: tmj.height,
            tileWidth: tmj.tilewidth,
            tileHeight: tmj.tileheight,
        },
    });
    project.tilesets.push(await tileset(fixture, newId));
    const layer = project.maps[0]!.layers[0] as TileLayer;
    tmj.layers[0]!.data.forEach((gid, i) => {
        if (gid !== 0)
            layer.cells.set(i % tmj.width, Math.floor(i / tmj.width), cellValue(SLOT, gid - 1));
    });
    hooks().session.getState().replace(createProjectSession(project));
    hooks().assertInvariants();
    if (viewPreferences.getState().grid) viewPreferences.setState({ grid: false });
    zoomTo(2);
    if (!toolState.select("terrain")) throw new Error("te-044: no terrain brush");
    resetTerrainBrush();
}

function activeMap() {
    const { session } = hooks().session.getState();
    return session.project.maps.find((each) => each.id === session.activeMapId)!;
}

function layer(): TileLayer {
    const map = activeMap();
    const id = hooks().session.getState().session.perMap.get(map.id)!.activeLayerId!;
    return findLayer(map, id)!.layer as TileLayer;
}

/** The layer as TMJ `data`: GIDs row by row, 0 for an empty cell. */
export function gids(): number[] {
    const map = activeMap();
    const found: number[] = [];
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
            const value = layer().cells.get(x, y);
            found.push(value === 0 ? 0 : cellTileId(value) + 1);
        }
    }
    return found;
}

/**
 * The terrain at each vertex of the map that the cells around it agree on, row by row
 * (`(width + 1) × (height + 1)`), for a corner set: −1 where they disagree, 0 at the map's
 * vertices no cell names. Read from the cells' tiles' WangIds.
 */
export function vertices(): number[] {
    const map = activeMap();
    const set = hooks().session.getState().session.project.tilesets[0]!.terrainSets[0]!;
    const wangIds = new Map(set.tiles.map((tile) => [tile.tile, tile.wangId]));
    const out: number[] = [];
    for (let vy = 0; vy <= map.height; vy++) {
        for (let vx = 0; vx <= map.width; vx++) {
            const seen = new Set<number>();
            // The cells around the vertex, with the index of their corner on it.
            for (const [dx, dy, index] of [
                [0, 0, 7],
                [-1, 0, 1],
                [-1, -1, 3],
                [0, -1, 5],
            ] as const) {
                const x = vx + dx;
                const y = vy + dy;
                if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
                const value = layer().cells.get(x, y);
                seen.add(value === 0 ? 0 : wangIds.get(cellTileId(value))![index]!);
            }
            out.push(seen.size === 1 ? [...seen][0]! : -1);
        }
    }
    return out;
}

/**
 * The terrain of every edge between two cells, as "x,y:side=terrain" for the right and bottom
 * edges of each cell, read from both cells' WangIds: −1 where they disagree. Edge sets only.
 */
export function edges(): Record<string, number> {
    const map = activeMap();
    const set = hooks().session.getState().session.project.tilesets[0]!.terrainSets[0]!;
    const wangIds = new Map(set.tiles.map((tile) => [tile.tile, tile.wangId]));
    const at = (x: number, y: number, index: number) => {
        const value = layer().cells.get(x, y);
        return value === 0 ? 0 : wangIds.get(cellTileId(value))![index]!;
    };
    const out: Record<string, number> = {};
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
            if (x + 1 < map.width) {
                const a = at(x, y, 2);
                out[`${x},${y}:right`] = a === at(x + 1, y, 6) ? a : -1;
            }
            if (y + 1 < map.height) {
                const a = at(x, y, 4);
                out[`${x},${y}:bottom`] = a === at(x, y + 1, 0) ? a : -1;
            }
        }
    }
    return out;
}

/** History entries and the newest one's label. */
export function history(): { undo: number; label: string | null } {
    const { history } = hooks().session.getState();
    return { undo: history.undoCount, label: history.undoLabel ?? null };
}

export function undo(): boolean {
    return hooks().session.getState().history.undo();
}

/** Selects the cells of `rect` on the active map, outside the history. */
export function selectRect(rect: { x: number; y: number; width: number; height: number }): void {
    const state = hooks().session.getState();
    state.session.perMap.get(state.session.activeMapId)!.tileSelection = rectMask(rect);
    state.touch();
}

/** The client position of map point `(cx, cy)`, in cells with their fraction. */
export function client(cx: number, cy: number): { x: number; y: number } {
    const map = activeMap();
    return currentViewMapping()!.mapToClient(cx * map.tileWidth, cy * map.tileHeight);
}

/** The overlay canvas's pixel (RGBA) at the middle of cell `(x, y)`. */
export function overlayCell(x: number, y: number): number[] {
    const mapping = currentViewMapping()!;
    const point = mapping.cellToDevice(x + 0.5, y + 0.5);
    const canvas = hooks().overlay!.canvas;
    return [
        ...canvas.getContext("2d")!.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1)
            .data,
    ];
}

/**
 * The overlay canvas's pixel (RGBA) at map point `(cx, cy)` (cells, with fraction), moved by
 * `(dx, dy)` device pixels.
 */
export function overlayAt(cx: number, cy: number, dx = 0, dy = 0): number[] {
    const point = currentViewMapping()!.cellToDevice(cx, cy);
    const canvas = hooks().overlay!.canvas;
    return [
        ...canvas
            .getContext("2d")!
            .getImageData(Math.round(point.x) + dx, Math.round(point.y) + dy, 1, 1).data,
    ];
}

/** Selects tool `id`; false when it cannot be selected. */
export function selectTool(id: string): boolean {
    return toolState.select(id);
}

/** A colour token of the page as [r, g, b]. */
export function token(name: string): number[] {
    const text = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const value = parseInt(text.replace("#", ""), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
