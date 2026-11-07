// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { cellValue } from "../../../src/core/cells";
import {
    assertInvariants,
    createMarkerLayer,
    createProject,
    createProjectSession,
    sequentialIds,
} from "../../../src/core/model";
import type { MarkerLayer, TileLayer } from "../../../src/core/model";

// TE-033 page module: the specs import it into the running editor, so it shares the app's
// stores. It loads "Quest" with one map, "Field" (10 × 6 cells of 16 px), whose tile layer has
// a tile at (0, 0) and at (9, 5) and whose marker layer has a point marker at (24, 40), and
// reads the map, those cells, the marker and the history back.

const hooks = () => window.__ngneTest!;
const state = () => hooks().session.getState();

export function load(): void {
    const project = createProject({
        name: "Quest",
        newId: sequentialIds("p"),
        map: { name: "Field", width: 10, height: 6 },
    });
    project.tilesets.push({
        id: "ts",
        name: "Tiles",
        exportName: "tiles",
        class: "",
        slot: 1,
        tileWidth: 16,
        tileHeight: 16,
        offsetX: 0,
        offsetY: 0,
        columns: 1,
        pixels: { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) },
        nextTileId: 1,
        source: { kind: "image", fileName: "tiles.png", margin: 0, spacing: 0 },
        tiles: [
            {
                id: 0,
                sourceKey: [0, 0],
                fingerprint: "0".repeat(64),
                class: "",
                collision: [],
                animation: [],
                properties: [],
            },
        ],
        terrainSets: [],
        properties: [],
    });
    const map = project.maps[0]!;
    const cells = (map.layers[0] as TileLayer).cells;
    cells.set(0, 0, cellValue(1, 0, 0));
    cells.set(9, 5, cellValue(1, 0, 0));
    const markers = createMarkerLayer(map.nextLayerId++, "Markers");
    markers.markers.push({
        shape: "point",
        x: 24,
        y: 40,
        id: map.nextMarkerId++,
        name: "Spawn",
        class: "",
        properties: [],
    });
    map.layers.push(markers);
    assertInvariants(project);
    state().replace(createProjectSession(project));
}

export interface Snapshot {
    width: number;
    height: number;
    /** The non-empty cells of the tile layer as `[x, y]`, row by row. */
    cells: [number, number][];
    marker: [number, number];
    undo: number;
    undoLabel: string | null;
    redo: number;
}

export function snapshot(): Snapshot {
    const { session, history } = state();
    const map = session.project.maps[0]!;
    const layer = map.layers[0] as TileLayer;
    const cells: [number, number][] = [];
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) if (layer.cells.get(x, y) !== 0) cells.push([x, y]);
    }
    const marker = (map.layers[1] as MarkerLayer).markers[0]!;
    return {
        width: map.width,
        height: map.height,
        cells,
        marker: [marker.x, marker.y],
        undo: history.undoCount,
        undoLabel: history.undoLabel,
        redo: history.redoCount,
    };
}
