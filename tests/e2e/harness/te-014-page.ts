// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { cellValue } from "../../../src/core/cells";
import {
    createMap,
    createMapSession,
    createProject,
    createProjectSession,
    sequentialIds,
} from "../../../src/core/model";
import type { Project, TileLayer, Tileset } from "../../../src/core/model";
import { zoomTo } from "../../../src/app/view/viewNavigation";
import { MAP } from "./te-014-map";

// TE-014 page module: the specs import it into the running editor (`import("/tests/e2e/harness/
// te-014-page.ts")`), so it shares the app's stores and modules. It loads small projects, switches
// the active map and reads the view back.

export interface Loaded {
    /** IDs of the maps, in project order. */
    maps: string[];
}

const FINGERPRINT = "0".repeat(64);

/** A tileset of two 16 × 16 tiles named "Terrain"; tile 1 has the class "grass". */
function tileset(): Tileset {
    return {
        id: "terrain",
        name: "Terrain",
        exportName: "terrain",
        class: "",
        slot: 1,
        tileWidth: MAP.tile,
        tileHeight: MAP.tile,
        offsetX: 0,
        offsetY: 0,
        columns: 2,
        pixels: { width: 32, height: 16, data: new Uint8ClampedArray(32 * 16 * 4).fill(180) },
        nextTileId: 2,
        source: { kind: "image", fileName: "terrain.png", margin: 0, spacing: 0 },
        tiles: [0, 1].map((id) => ({
            id,
            sourceKey: [id, 0] as [number, number],
            fingerprint: FINGERPRINT,
            class: id === 1 ? "grass" : "",
            collision: [],
            animation: [],
            properties: [],
        })),
        terrainSets: [],
        properties: [],
    };
}

/**
 * Replaces the project with `maps` maps of 40 × 30 cells of 16 pixels and, with `tiles`, a
 * tileset and one cell, (20, 15), that holds its tile 1 on the first map.
 */
export function load(options: { maps?: number; tiles?: boolean } = {}): Loaded {
    const newId = sequentialIds();
    const project: Project = createProject({ newId, map: MAP_OPTIONS });
    const count = options.maps ?? 1;
    for (let index = 1; index < count; index += 1) {
        project.maps.push(createMap({ ...MAP_OPTIONS, name: `Map ${index + 1}`, newId }));
    }
    if (options.tiles) {
        project.tilesets.push(tileset());
        const layer = project.maps[0]!.layers[0] as TileLayer;
        layer.cells.set(20, 15, cellValue(1, 1));
    }
    window.__ngneTest!.session.getState().replace(createProjectSession(project));
    return { maps: project.maps.map((map) => map.id) };
}

const MAP_OPTIONS = {
    width: MAP.width,
    height: MAP.height,
    tileWidth: MAP.tile,
    tileHeight: MAP.tile,
};

/** Makes `mapId` the active map, as a tab switch will (TE-031). */
export function activate(mapId: string): void {
    const state = window.__ngneTest!.session.getState();
    if (!state.session.perMap.has(mapId)) {
        const map = state.session.project.maps.find((each) => each.id === mapId)!;
        state.session.perMap.set(mapId, createMapSession(map));
    }
    state.session.activeMapId = mapId;
    state.touch();
}

export interface ViewState {
    centreX: number;
    centreY: number;
    zoom: number;
    dpr: number;
    /** Device pixels per map pixel. */
    scale: number;
    /** The overlay canvas, the viewport in device pixels. */
    width: number;
    height: number;
    mapId: string;
}

/** The active map's view, the pixel ratio and the viewport's size. */
export function view(): ViewState {
    const { session } = window.__ngneTest!.session.getState();
    const mapView = session.perMap.get(session.activeMapId)!.view;
    const canvas = window.__ngneTest!.overlay!.canvasSize;
    return {
        ...mapView,
        dpr: window.devicePixelRatio,
        scale: mapView.zoom * window.devicePixelRatio,
        width: canvas.width,
        height: canvas.height,
        mapId: session.activeMapId,
    };
}

/** Zooms about the viewport's centre to `scale` device pixels per map pixel. */
export function setScale(scale: number): void {
    zoomTo(scale);
}

/** The redraws of the overlay so far, and whether one is waiting. */
export function overlayState(): { redraws: number; pending: boolean } {
    const overlay = window.__ngneTest!.overlay!;
    return { redraws: overlay.redraws, pending: overlay.pending };
}

export interface Lines {
    /** Device columns where the row at `row` has ink, ascending. */
    columns: number[];
    /** Device rows where the column at `column` has ink, ascending. */
    rows: number[];
    /** Alpha (0..255) of the ink pixels, the largest found. */
    alpha: number;
    /** Whether any pixel of the canvas has ink. */
    any: boolean;
}

/**
 * Reads the overlay canvas back: the columns with ink along the row `row`, the rows with ink
 * along the column `column`, and whether anything is drawn at all.
 */
export function readLines(row: number, column: number): Lines {
    const canvas = window.__ngneTest!.overlay!.canvas;
    const context = canvas.getContext("2d")!;
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const columns: number[] = [];
    const rows: number[] = [];
    let alpha = 0;
    let any = false;
    for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i]! > 0) {
            any = true;
            break;
        }
    }
    for (let x = 0; x < width; x += 1) {
        const a = pixels[(row * width + x) * 4 + 3]!;
        if (a > 0) columns.push(x);
        alpha = Math.max(alpha, a);
    }
    for (let y = 0; y < height; y += 1) {
        if (pixels[(y * width + column) * 4 + 3]! > 0) rows.push(y);
    }
    return { columns, rows, alpha, any };
}
