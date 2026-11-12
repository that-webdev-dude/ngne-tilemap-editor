// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { toolRegistry } from "../../../src/app/tools/toolRegistry";
import { currentStamp } from "../../../src/app/tools/stamp/currentStamp";
import { tilesetPanelStore } from "../../../src/app/tilesets/panel/tilesetPanel";
import { cellTileId, cellValue } from "../../../src/core/cells";
import {
    assertInvariants,
    createGroupLayer,
    createImageLayer,
    createMap,
    createMapSession,
    createMarkerLayer,
    createProject,
    createProjectSession,
    createTileLayer,
    sequentialIds,
    walkLayers,
} from "../../../src/core/model";
import type { Layer, Tile, TileLayer, Tileset } from "../../../src/core/model";
import { sha256Hex } from "../../support/sha256";

// TE-065 page module: the audit specs import it into the running editor, so it shares the
// app's stores. It loads "Audit", a project that brings every panel, tool set and surface into
// a state where it shows its content:
//
//     Overworld (20 × 15 cells of 16 px), layers top to bottom (Ground with two custom
//     properties, a bool and a colour, so the Properties panel shows rows):
//         Props (6, group)      Detail (7, tile)
//         Sky (5, image)        the image "sky"
//         Areas (4, marker)     a rectangle "exit" and a point "spawn", named
//         Paths (3, tile)       empty
//         Ground (1, tile)      tile 0 left of column 10, tile 3 from it on
//     Cave (10 × 10 cells of 16 px), one tile layer
//
// The tileset "Terrain" (slot 1, 16 tiles of 16 px, a corner set "Ground" of one terrain over
// tiles 1–15; tile 0 has a class, a property, a collision rectangle and two animation frames)
// is shown in the Tilesets panel with tile 0 selected. Both maps are open as tabs.

const SIZE = 16;
export const LAYERS = { ground: 1, paths: 3, areas: 4, sky: 5, props: 6, detail: 7 } as const;
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
    const first = tiles[0]!;
    first.class = "solid";
    first.properties = [{ name: "speed", type: "int", value: 2 }];
    first.collision = [{ shape: "rectangle", x: 2, y: 2, width: 12, height: 12 }];
    first.animation = [
        { tile: 0, ms: 100 },
        { tile: 1, ms: 100 },
    ];
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
                colors: [{ name: "Grass", color: "#30a050ff", tile: 3 }],
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

/** Replaces the project with "Audit"; layer `active` of Overworld is the active layer. */
export function load(active: number = LAYERS.ground): void {
    const newId = sequentialIds("a");
    const project = createProject({
        name: "Audit",
        newId,
        map: { name: "Overworld", width: 20, height: 15, tileWidth: SIZE, tileHeight: SIZE },
    });
    project.properties = [{ name: "author", type: "string", value: "audit" }];
    const tileset = terrainTileset(newId);
    project.tilesets.push(tileset);
    const sky = new Uint8ClampedArray(32 * 32 * 4);
    for (let index = 0; index < 32 * 32; index++) sky.set([90, 140, 220, 255], index * 4);
    project.images.push({
        id: newId(),
        name: "sky",
        exportName: "sky",
        pixels: { width: 32, height: 32, data: sky },
    });

    const map = project.maps[0]!;
    const ground = map.layers[0] as TileLayer;
    ground.name = "Ground";
    ground.properties = [
        { name: "solid", type: "bool", value: true },
        { name: "tint", type: "color", value: "#ff8800ff" },
    ];
    for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++) ground.cells.set(x, y, cellValue(1, x < 10 ? 0 : 3));
    const areas = createMarkerLayer(LAYERS.areas, "Areas");
    areas.markers.push(
        {
            id: 1,
            name: "exit",
            class: "",
            properties: [{ name: "target", type: "string", value: "Cave" }],
            shape: "rectangle",
            x: 160,
            y: 128,
            width: 48,
            height: 32,
        },
        { id: 2, name: "spawn", class: "", properties: [], shape: "point", x: 48, y: 48 },
    );
    const props = createGroupLayer(LAYERS.props, "Props");
    props.layers.push(createTileLayer(LAYERS.detail, "Detail"));
    map.layers.push(
        createTileLayer(LAYERS.paths, "Paths"),
        areas,
        createImageLayer(LAYERS.sky, "Sky", project.images[0]!.id),
        props,
    );
    map.nextLayerId = 8;
    map.nextMarkerId = 3;
    project.maps.push(
        createMap({
            name: "Cave",
            newId,
            width: 10,
            height: 10,
            tileWidth: SIZE,
            tileHeight: SIZE,
            takenExportNames: [map.exportName],
        }),
    );
    assertInvariants(project);

    const session = createProjectSession(project);
    const mapSession = session.perMap.get(map.id) ?? createMapSession(map);
    mapSession.activeLayerId = active;
    mapSession.view = { centreX: 160, centreY: 120, zoom: 2 };
    session.perMap.set(map.id, mapSession);
    state().replace(session);
    tilesetPanelStore.setState({
        activeTilesetId: tileset.id,
        selections: {
            [tileset.id]: { anchor: { column: 0, row: 0 }, focus: { column: 0, row: 0 } },
        },
    });
}

/** Opens the Cave map's tab and comes back to Overworld, so both are tabs. */
export function openBothTabs(): string[] {
    const { session } = state();
    const ids = session.project.maps.map((map) => map.id);
    for (const id of [...ids].reverse()) {
        session.activeMapId = id;
        if (!session.perMap.has(id)) {
            session.perMap.set(
                id,
                createMapSession(session.project.maps.find((m) => m.id === id)!),
            );
        }
        state().touch();
    }
    return ids;
}

/** Makes the map named `name` the active map. */
export function activateMap(name: string): void {
    const { session } = state();
    const map = session.project.maps.find((each) => each.name === name);
    if (!map) throw new Error(`te-065: no map ${name}`);
    session.activeMapId = map.id;
    if (!session.perMap.has(map.id)) session.perMap.set(map.id, createMapSession(map));
    state().touch();
}

/** Makes layer `id` of the active map the active layer. */
export function activateLayer(id: number): void {
    const { session } = state();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    const found = [...walkLayers(map.layers)].some(
        ({ layer }: { layer: Layer }) => layer.id === id,
    );
    if (!found) throw new Error(`te-065: no layer ${id}`);
    session.perMap.get(map.id)!.activeLayerId = id;
    state().touch();
}

/** Selects markers of Areas by id, both by default (the active layer must be Areas). */
export function selectMarkers(ids: number[] = [1, 2]): void {
    const { session } = state();
    session.perMap.get(session.activeMapId)!.markerSelection = [...ids];
    state().touch();
}

/** The tools the rail offers for the active layer, by id. */
export function offeredTools(): string[] {
    return toolRegistry
        .list()
        .filter((tool) => toolState.offered(tool.id))
        .map((tool) => tool.id);
}

/** Selects a registered tool of the active layer's set; false when it cannot be selected. */
export function selectTool(id: string): boolean {
    return toolState.select(id);
}

export function activeTool(): string {
    return toolState.activeId();
}

/** What the keyboard walk reads: the active map and layer, the panel's selection, the stamp. */
export interface WalkState {
    map: string;
    layer: number;
    /** The Tilesets panel's selection of Terrain, as `column,row-column,row`. */
    tiles: string | null;
    /** The current stamp's cells as tile ids, or null. */
    stamp: string | null;
    history: { undo: number; label: string | null };
}

export function walkState(): WalkState {
    const { session, history } = state();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    const tileset = session.project.tilesets[0]!;
    const selection = tilesetPanelStore.getState().selections[tileset.id];
    const stamp = currentStamp();
    return {
        map: map.name,
        layer: session.perMap.get(map.id)!.activeLayerId,
        tiles: selection
            ? `${selection.anchor.column},${selection.anchor.row}-${selection.focus.column},${selection.focus.row}`
            : null,
        stamp: stamp ? [...stamp.cells].map((cell) => cellTileId(cell)).join(",") : null,
        history: { undo: history.undoCount, label: history.undoLabel ?? null },
    };
}
