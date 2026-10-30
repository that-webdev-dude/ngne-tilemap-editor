import { CellStore } from "../cells";
import { randomId } from "./ids";
import type { IdGenerator } from "./ids";
import { exportNames, uniqueSlug } from "./slug";
import type {
    GroupLayer,
    ImageLayer,
    LayerBase,
    MapSession,
    MarkerLayer,
    Project,
    ProjectMap,
    ProjectSession,
    TileLayer,
} from "./types";

// Fresh projects, maps, layers and sessions with the defaults of SPEC §2.1 and Tiled's New Map
// (64 × 64 cells of 16 × 16 px, one tile layer named "Tile Layer 1").

export const DEFAULT_MAP_WIDTH = 64;
export const DEFAULT_MAP_HEIGHT = 64;
export const DEFAULT_TILE_WIDTH = 16;
export const DEFAULT_TILE_HEIGHT = 16;
export const DEFAULT_PROJECT_NAME = "Untitled";
export const DEFAULT_MAP_NAME = "Map 1";
export const DEFAULT_LAYER_NAME = "Tile Layer 1";
/** Tiled's default colour for a new object layer. */
export const DEFAULT_MARKER_COLOR = 0xa0a0a4ff;

export interface CreateMapOptions {
    name?: string;
    width?: number;
    height?: number;
    tileWidth?: number;
    tileHeight?: number;
    /** Export names already in use: the map's slug is made unique against them. */
    takenExportNames?: Iterable<string>;
    newId?: IdGenerator;
}

export interface CreateProjectOptions {
    name?: string;
    newId?: IdGenerator;
    /** Options of the project's first map. */
    map?: Omit<CreateMapOptions, "takenExportNames" | "newId">;
}

function layerBase(id: number, name: string): LayerBase {
    return {
        id,
        name,
        class: "",
        visible: true,
        locked: false,
        opacity: 255,
        offsetX: 0,
        offsetY: 0,
        parallaxX: 1,
        parallaxY: 1,
        properties: [],
    };
}

/** An empty tile layer. The caller takes `id` from the map's `nextLayerId`. */
export function createTileLayer(id: number, name: string): TileLayer {
    return { ...layerBase(id, name), type: "tile", cells: new CellStore() };
}

export function createMarkerLayer(id: number, name: string): MarkerLayer {
    return { ...layerBase(id, name), type: "marker", color: DEFAULT_MARKER_COLOR, markers: [] };
}

export function createImageLayer(id: number, name: string, imageId: string): ImageLayer {
    return { ...layerBase(id, name), type: "image", imageId, repeatX: false, repeatY: false };
}

export function createGroupLayer(id: number, name: string): GroupLayer {
    return { ...layerBase(id, name), type: "group", layers: [] };
}

/** A map with one empty tile layer; it belongs to no project yet. */
export function createMap(options: CreateMapOptions = {}): ProjectMap {
    const name = options.name ?? DEFAULT_MAP_NAME;
    return {
        id: (options.newId ?? randomId)(),
        name,
        exportName: uniqueSlug(name, options.takenExportNames ?? [], "map"),
        class: "",
        orientation: "orthogonal",
        width: options.width ?? DEFAULT_MAP_WIDTH,
        height: options.height ?? DEFAULT_MAP_HEIGHT,
        tileWidth: options.tileWidth ?? DEFAULT_TILE_WIDTH,
        tileHeight: options.tileHeight ?? DEFAULT_TILE_HEIGHT,
        backgroundColor: null,
        parallaxOriginX: 0,
        parallaxOriginY: 0,
        nextLayerId: 2,
        nextMarkerId: 1,
        layers: [createTileLayer(1, DEFAULT_LAYER_NAME)],
        properties: [],
    };
}

/** A project with one default map and no tilesets or images. */
export function createProject(options: CreateProjectOptions = {}): Project {
    const newId = options.newId ?? randomId;
    const name = options.name ?? DEFAULT_PROJECT_NAME;
    return {
        id: newId(),
        name,
        exportName: uniqueSlug(name, [], "project"),
        maps: [createMap({ ...options.map, newId })],
        tilesets: [],
        images: [],
        exportSettings: { exportOnSave: false },
        properties: [],
    };
}

/** The export names a new map, tileset or image of `project` must avoid. */
export function takenExportNames(project: Project): string[] {
    return exportNames(project);
}

/** The session of a map as it opens: its bottom layer active, nothing selected, zoom 1. */
export function createMapSession(map: ProjectMap): MapSession {
    const first = map.layers[0];
    return {
        activeLayerId: first ? first.id : 0,
        tileSelection: null,
        markerSelection: [],
        view: {
            centreX: (map.width * map.tileWidth) / 2,
            centreY: (map.height * map.tileHeight) / 2,
            zoom: 1,
        },
    };
}

/** A session on `project` with its first map active. */
export function createProjectSession(project: Project): ProjectSession {
    const first = project.maps[0];
    const perMap = new Map<string, MapSession>();
    if (first) perMap.set(first.id, createMapSession(first));
    return { project, activeMapId: first ? first.id : "", perMap };
}
