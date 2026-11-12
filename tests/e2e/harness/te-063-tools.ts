// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { setCurrentStamp } from "../../../src/app/tools/stamp/currentStamp";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import { cellValue } from "../../../src/core/cells";
import {
    assertInvariants,
    createMapSession,
    createMarkerLayer,
    createProject,
    createProjectSession,
    createTileLayer,
    sequentialIds,
} from "../../../src/core/model";
import type { Marker, Tile, TileLayer, Tileset } from "../../../src/core/model";
import { serialize } from "../../../src/core/project";
import { sha256Hex } from "../../support/sha256";

// TE-063 page module of te-063-undo-redo.spec.ts: the specs import it into the running editor,
// so it shares the app's stores and tools. It loads "Tools", one map of 20 × 15 cells of 16 px
// with the tileset "Terrain" (slot 1: 16 tiles of 16 px, a corner set "Ground" of one terrain
// complete over tiles 1–15, tile `t` having the terrain at the corners of its bits: TL 1, TR 2,
// BR 4, BL 8) and three layers:
//
//     Areas (3, marker)   a polygon (1) and a rectangle (2)
//     Paths (2, tile)     empty
//     Ground (1, tile)    tile 0 left of column 10, tile 3 from it on
//
// The view is at zoom 2 about the map's centre, Show Grid off and Snap to Grid on. The specs
// read the project (as its `.ngtilemap` bytes) and the map's selections back.

export const LAYERS = { ground: 1, paths: 2, areas: 3 } as const;
const SIZE = 16;
const MAP = { width: 20, height: 15 } as const;
const CORNERS = [
    [7, 1],
    [1, 2],
    [3, 4],
    [5, 8],
] as const;

const state = () => window.__ngneTest!.session.getState();

function terrainTileset(newId: () => string): Tileset {
    const width = 4 * SIZE;
    const data = new Uint8ClampedArray(width * width * 4);
    for (let y = 0; y < width; y++)
        for (let x = 0; x < width; x++) data.set([x * 4, y * 4, 7, 255], (y * width + x) * 4);
    const tiles: Tile[] = Array.from({ length: 16 }, (_, id) => ({
        id,
        sourceKey: [id % 4, Math.floor(id / 4)],
        fingerprint: sha256Hex(Uint8Array.of(id)),
        class: "",
        collision: [],
        animation: [],
        properties: [],
    }));
    return {
        id: newId(),
        name: "Terrain",
        exportName: "terrain",
        class: "",
        slot: 1,
        tileWidth: SIZE,
        tileHeight: SIZE,
        offsetX: 0,
        offsetY: 0,
        columns: 4,
        pixels: { width, height: width, data },
        nextTileId: 16,
        source: { kind: "image", fileName: "terrain.png", margin: 0, spacing: 0 },
        tiles,
        terrainSets: [
            {
                name: "Ground",
                type: "corner",
                colors: [{ name: "Grass", color: "#30a050ff", tile: null }],
                tiles: Array.from({ length: 15 }, (_, k) => {
                    const wangId = [0, 0, 0, 0, 0, 0, 0, 0];
                    for (const [index, bit] of CORNERS) if ((k + 1) & bit) wangId[index] = 1;
                    return { tile: k + 1, wangId };
                }),
            },
        ],
        properties: [],
    };
}

const base = { name: "", class: "", properties: [] };
const MARKERS: Marker[] = [
    {
        ...base,
        id: 1,
        shape: "polygon",
        x: 32,
        y: 32,
        points: [
            [0, 0],
            [64, 0],
            [64, 48],
        ],
    },
    { ...base, id: 2, shape: "rectangle", x: 160, y: 128, width: 48, height: 32 },
];

/** Replaces the project with "Tools"; layer `active` is the active layer. */
export function load(active: number): void {
    const newId = sequentialIds("t");
    const project = createProject({
        name: "Tools",
        newId,
        map: { width: MAP.width, height: MAP.height, tileWidth: SIZE, tileHeight: SIZE },
    });
    project.tilesets.push(terrainTileset(newId));
    const map = project.maps[0]!;
    const ground = map.layers[0] as TileLayer;
    ground.name = "Ground";
    for (let y = 0; y < MAP.height; y++)
        for (let x = 0; x < MAP.width; x++) ground.cells.set(x, y, cellValue(1, x < 10 ? 0 : 3));
    const areas = createMarkerLayer(LAYERS.areas, "Areas");
    areas.markers.push(...structuredClone(MARKERS));
    map.layers.push(createTileLayer(LAYERS.paths, "Paths"), areas);
    map.nextLayerId = 4;
    map.nextMarkerId = 3;
    assertInvariants(project);
    const session = createProjectSession(project);
    const mapSession = session.perMap.get(map.id) ?? createMapSession(map);
    mapSession.view = {
        centreX: (MAP.width * SIZE) / 2,
        centreY: (MAP.height * SIZE) / 2,
        zoom: 2,
    };
    mapSession.activeLayerId = active;
    session.perMap.set(map.id, mapSession);
    viewPreferences.getState().set("grid", false);
    viewPreferences.getState().set("snap", true);
    state().replace(session);
}

/** Selects a registered tool of the active layer's set; false when it cannot be selected. */
export function selectTool(id: string): boolean {
    return toolState.select(id);
}

export function activeTool(): string {
    return toolState.activeId();
}

/** The current stamp: tile `tile` of "Terrain", one cell. */
export function setStamp(tile: number): void {
    setCurrentStamp({ width: 1, height: 1, cells: Uint32Array.of(cellValue(1, tile)) });
}

/** The client position of map pixel `(x, y)`. */
export function mapClient(x: number, y: number): { x: number; y: number } {
    return currentViewMapping()!.mapToClient(x, y);
}

export function history(): { undo: string | null; redo: string | null } {
    const { history } = state();
    return { undo: history.undoLabel, redo: history.redoLabel };
}

/**
 * What a tool changes: the project (its `.ngtilemap` bytes, hashed, but for the map's
 * `nextMarkerId`, which undo never gives back: SPEC §7.2), that ID, and the map's selections.
 */
export interface ToolState {
    project: string;
    nextMarkerId: number;
    tiles: string | null;
    markers: number[];
}

export function snapshot(): ToolState {
    const { session } = state();
    const mapSession = session.perMap.get(session.activeMapId)!;
    const region = mapSession.tileSelection;
    const map = session.project.maps[0]!;
    const { nextMarkerId } = map;
    // Read with the ID at its largest value, then put back in the same task: nothing sees it.
    map.nextMarkerId = 0x7fffffff;
    let project: string;
    try {
        project = sha256Hex(serialize(session.project));
    } finally {
        map.nextMarkerId = nextMarkerId;
    }
    return {
        project,
        nextMarkerId,
        tiles: region
            ? `${region.x},${region.y} ${region.width}×${region.height} ${sha256Hex(region.mask)}`
            : null,
        markers: [...mapSession.markerSelection],
    };
}
