// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { setCurrentStamp } from "../../../src/app/tools/stamp/currentStamp";
import { resetStampBrush } from "../../../src/app/tools/stamp/stamp.tools";
import { currentViewMapping, zoomTo } from "../../../src/app/view/viewNavigation";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import { cellValue, cellTileId } from "../../../src/core/cells";
import {
    createGroupLayer,
    createMarkerLayer,
    createProject,
    createProjectSession,
    createTileLayer,
    findLayer,
    sequentialIds,
} from "../../../src/core/model";
import type { Project, Tile, Tileset, TileLayer } from "../../../src/core/model";
import { sha256Hex } from "../../support/sha256";
import { LAYERS, MAP, TILE_COLOURS } from "./te-017-map";

// TE-017 page module: the specs import it into the running editor (`import("/tests/e2e/harness/
// te-017-page.ts")`), so it shares the app's stores, tools and pipeline. It loads the test map,
// sets the current stamp from code (SPEC §4.2), reads cells and the history back, and reads the
// overlay canvas.

function tileset(newId: () => string): Tileset {
    const size = MAP.tile;
    const columns = TILE_COLOURS.length;
    const width = columns * size;
    const data = new Uint8ClampedArray(width * size * 4);
    const tiles: Tile[] = TILE_COLOURS.map((colour, id) => {
        const own = new Uint8ClampedArray(size * size * 4);
        for (let i = 0; i < size * size; i++) {
            own.set([(colour >> 16) & 255, (colour >> 8) & 255, colour & 255, 255], i * 4);
        }
        for (let y = 0; y < size; y++)
            data.set(own.subarray(y * size * 4, (y + 1) * size * 4), (y * width + id * size) * 4);
        return {
            id,
            sourceKey: [id, 0],
            fingerprint: sha256Hex(own),
            class: "",
            collision: [],
            animation: [],
            properties: [],
        };
    });
    return {
        id: newId(),
        name: "Colours",
        exportName: "colours",
        class: "",
        slot: 1,
        tileWidth: size,
        tileHeight: size,
        offsetX: 0,
        offsetY: 0,
        columns,
        pixels: { width, height: size, data },
        nextTileId: tiles.length,
        source: { kind: "image", fileName: "colours.png", margin: 0, spacing: 0 },
        tiles,
        terrainSets: [],
        properties: [],
    };
}

/**
 * Replaces the project with the test map, Ground active, the stamp brush forgotten, no stamp,
 * the grid hidden (the overlay then draws the previews only) and the map at half size, all of
 * it in view.
 */
export function load(): void {
    reopen();
    resetStampBrush();
}

/** As `load`, without telling the stamp brush: the same project ids come back, as on a reopen. */
export function reopen(): void {
    const newId = sequentialIds();
    const project: Project = createProject({
        newId,
        map: { width: MAP.width, height: MAP.height, tileWidth: MAP.tile, tileHeight: MAP.tile },
    });
    project.tilesets.push(tileset(newId));
    const map = project.maps[0]!;
    map.layers[0]!.name = "Ground";
    const top = createTileLayer(LAYERS.top, "Top");
    const locked = createTileLayer(LAYERS.locked, "Locked");
    locked.locked = true;
    const group = createGroupLayer(LAYERS.hiddenGroup, "Hidden group");
    group.visible = false;
    group.layers.push(createTileLayer(LAYERS.hidden, "Hidden"));
    map.layers.push(top, locked, group, createMarkerLayer(LAYERS.marker, "Markers"));
    map.nextLayerId = 7;
    window.__ngneTest!.session.getState().replace(createProjectSession(project));
    setCurrentStamp(null);
    if (viewPreferences.getState().grid) viewPreferences.setState({ grid: false });
    zoomTo(0.5);
}

function map() {
    const { session } = window.__ngneTest!.session.getState();
    return session.project.maps.find((each) => each.id === session.activeMapId)!;
}

function tileLayer(id: number): TileLayer {
    return findLayer(map(), id)!.layer as TileLayer;
}

/** Sets the current stamp: `tiles` row by row, a tile id of slot 1 or null for an empty cell. */
export function setStamp(width: number, height: number, tiles: (number | null)[]): void {
    setCurrentStamp({
        width,
        height,
        cells: Uint32Array.from(tiles, (tile) => (tile === null ? 0 : cellValue(1, tile))),
    });
}

/** Selects a registered tool of the active layer's set; false when it cannot be selected. */
export function selectTool(id: string): boolean {
    return toolState.select(id);
}

/** Makes layer `id` the active layer. */
export function setActiveLayer(id: number): void {
    const state = window.__ngneTest!.session.getState();
    state.session.perMap.get(map().id)!.activeLayerId = id;
    state.touch();
}

/** Writes tile `tile` of slot 1 into every cell of `rect` of tile layer `id`, outside the history. */
export function fill(
    id: number,
    rect: { x: number; y: number; width: number; height: number },
    tile: number,
): void {
    const layer = tileLayer(id);
    for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++)
            layer.cells.set(x, y, cellValue(1, tile));
    }
    window.__ngneTest!.session.getState().touch();
}

/** The non-empty cells of tile layer `id`, as "x,y:tile", row by row. */
export function cells(id: number): string[] {
    const layer = tileLayer(id);
    const found: string[] = [];
    for (let y = 0; y < MAP.height; y++) {
        for (let x = 0; x < MAP.width; x++) {
            const value = layer.cells.get(x, y);
            if (value !== 0) found.push(`${x},${y}:${cellTileId(value)}`);
        }
    }
    return found;
}

/** What the history offers to undo and redo. */
export function history(): { undo: string | null; redo: string | null } {
    const { history } = window.__ngneTest!.session.getState();
    return { undo: history.undoLabel, redo: history.redoLabel };
}

/** Undoes the newest entry; false when there was none. */
export function undo(): boolean {
    const { history } = window.__ngneTest!.session.getState();
    if (!history.canUndo) return false;
    history.undo();
    return true;
}

/** Redoes the newest undone entry; false when there was none. */
export function redo(): boolean {
    const { history } = window.__ngneTest!.session.getState();
    if (!history.canRedo) return false;
    history.redo();
    return true;
}

/** The client position of the centre of cell `(x, y)` as the map is on screen. */
export function cellClient(x: number, y: number): { x: number; y: number } {
    const mapping = currentViewMapping()!;
    return mapping.mapToClient((x + 0.5) * MAP.tile, (y + 0.5) * MAP.tile);
}

/** The device rectangle of cell `(x, y)` on the overlay canvas, edges rounded. */
export function cellDevice(
    x: number,
    y: number,
): { x: number; y: number; width: number; height: number } {
    const mapping = currentViewMapping()!;
    const start = mapping.cellToDevice(x, y);
    const end = mapping.cellToDevice(x + 1, y + 1);
    const left = Math.round(start.x);
    const top = Math.round(start.y);
    return { x: left, y: top, width: Math.round(end.x) - left, height: Math.round(end.y) - top };
}

/** The overlay canvas's pixel at device `(x, y)`, as RGBA. */
export function overlayPixel(x: number, y: number): number[] {
    const canvas = window.__ngneTest!.overlay!.canvas;
    return [...canvas.getContext("2d")!.getImageData(x, y, 1, 1).data];
}

/** How many pixels of the overlay canvas are drawn (alpha above 0). */
export function overlayInk(): number {
    const canvas = window.__ngneTest!.overlay!.canvas;
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count++;
    return count;
}

/** A colour token of the page as 0xRRGGBB. */
export function token(name: string): number {
    const text = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return parseInt(text.replace("#", ""), 16);
}
