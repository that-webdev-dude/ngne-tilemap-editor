// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { newMap, renameMap } from "../../../src/app/maps/maps";
import { mapTabsStore } from "../../../src/app/tabs/tabs";
import { zoomTo } from "../../../src/app/view/viewNavigation";
import { cellValue } from "../../../src/core/cells";
import type { NewMapValues } from "../../../src/core/maps";
import {
    assertInvariants,
    createProject,
    createProjectSession,
    createTileLayer,
    sequentialIds,
} from "../../../src/core/model";
import type { MapView, TileLayer, Tileset } from "../../../src/core/model";

// TE-031 page module: the specs import it into the running editor, so it shares the app's
// stores. It loads a project with one map ("Overworld", 40 × 30 cells of 16 px, tile layers 1
// and 2) and a one-tile tileset, reads the maps, tabs, views and history back, and makes the
// changes that have no control of their own before TE-032: New Map (its dialog), Rename (the
// Maps panel), a painted cell (a stroke), the active layer (the Layers panel).

const hooks = () => window.__ngneTest!;
const state = () => hooks().session.getState();

function tileset(): Tileset {
    const data = new Uint8ClampedArray(16 * 16 * 4).fill(255);
    return {
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
        pixels: { width: 16, height: 16, data },
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
    };
}

/** Loads the test project as a new history. Returns the map's ID. */
export function load(): string {
    const project = createProject({
        name: "Quest",
        newId: sequentialIds("p"),
        map: { name: "Overworld", width: 40, height: 30 },
    });
    const map = project.maps[0]!;
    map.layers.push(createTileLayer(2, "Tile Layer 2"));
    map.nextLayerId = 3;
    project.tilesets.push(tileset());
    assertInvariants(project);
    state().replace(createProjectSession(project));
    return map.id;
}

export interface Snapshot {
    maps: { id: string; name: string }[];
    active: string;
    open: string[];
    undo: number;
    undoLabel: string | null;
    redo: number;
    dirty: boolean;
}

export function snapshot(): Snapshot {
    const { session, history } = state();
    return {
        maps: session.project.maps.map((map) => ({ id: map.id, name: map.name })),
        active: session.activeMapId,
        open: [...mapTabsStore.getState().open],
        undo: history.undoCount,
        undoLabel: history.undoLabel,
        redo: history.redoCount,
        dirty: history.dirty,
    };
}

/** New Map with `values` over the defaults; returns the new map's ID. */
export function addMap(values: Partial<NewMapValues> = {}): string {
    return newMap(values);
}

export function rename(id: string, name: string): boolean {
    return renameMap(id, name);
}

/** Paints tile 0 at cell (`x`, `y`) of the active map's tile layer 1: one history entry. */
export function paint(x: number, y: number): void {
    const { session, history } = state();
    const transaction = history.begin({ mapId: session.activeMapId, layerId: 1 });
    transaction.set(x, y, cellValue(1, 0));
    transaction.commit("Paint");
}

/** The value of cell (`x`, `y`) of tile layer 1 of map `id`. */
export function cell(id: string, x: number, y: number): number {
    const map = state().session.project.maps.find((each) => each.id === id)!;
    return (map.layers[0] as TileLayer).cells.get(x, y);
}

/** Makes layer `id` the active layer of the active map. */
export function setActiveLayer(id: number): void {
    const { session, touch } = state();
    session.perMap.get(session.activeMapId)!.activeLayerId = id;
    touch();
}

/** The active layer and view of map `id`; null fields while it has no session. */
export function mapSession(id: string): { layer: number | null; view: MapView | null } {
    const own = state().session.perMap.get(id);
    return { layer: own?.activeLayerId ?? null, view: own ? { ...own.view } : null };
}

/** Zooms the active map to `scale` device pixels per map pixel about the viewport's centre. */
export function zoom(scale: number): void {
    zoomTo(scale);
}

/** IDs of the tileset textures the viewport holds. */
export function tilesetTextures(): string[] {
    return (hooks().viewport?.textureIds() ?? []).filter((id) => id.startsWith("ed:ts:"));
}
