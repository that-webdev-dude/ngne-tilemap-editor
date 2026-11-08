// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { setMarkerSelection } from "../../../src/app/markers/markerSelection";
import { tilesetPanel } from "../../../src/app/tilesets/panel/tilesetPanel";
import { createMarkerLayer, findLayer, walkLayers } from "../../../src/core/model";
import type { Layer, Marker, Project, Property } from "../../../src/core/model";
import { load as loadTilesets } from "./te-025-page";

// TE-040 page module: the specs import it into the running editor, so it shares the app's
// stores. It loads the TE-025 project (tilesets "Terrain", 12 tiles of 16 px on 4 columns, and
// "Props") as "Markers" with the map "Overworld":
//
//     Objects (2, marker layer): 1 rectangle "exit" {hp: int 1, tag: string "a"},
//                                2 point "spawn" {hp: int 2, tag: string "a"}       top
//     Ground (1, tile, active)                                                    bottom

const hooks = () => window.__ngneTest!;
const state = () => hooks().session.getState();

export const GROUND = 1;
export const OBJECTS = 2;

function project(): Project {
    return state().session.project;
}

export function load(): string[] {
    const ids = loadTilesets();
    const { session } = state();
    session.project.name = "Markers";
    const map = session.project.maps[0]!;
    map.name = "Overworld";
    map.layers[0]!.name = "Ground";
    const objects = createMarkerLayer(OBJECTS, "Objects");
    const props = (hp: number): Property[] => [
        { name: "hp", type: "int", value: hp },
        { name: "tag", type: "string", value: "a" },
    ];
    const markers: Marker[] = [
        {
            id: 1,
            shape: "rectangle",
            x: 32,
            y: 32,
            width: 16,
            height: 16,
            name: "exit",
            class: "door",
            properties: props(1),
        },
        { id: 2, shape: "point", x: 64, y: 64, name: "spawn", class: "", properties: props(2) },
    ];
    objects.markers.push(...markers);
    map.layers.push(objects);
    map.nextLayerId = 3;
    map.nextMarkerId = 3;
    hooks().assertInvariants();
    session.perMap.get(map.id)!.activeLayerId = GROUND;
    state().touch();
    return ids;
}

/** Selects markers `ids` of the map (no history entry). */
export function selectMarkers(ids: number[]): void {
    setMarkerSelection(ids);
}

/** Makes layer `id` the active layer; an unknown id leaves the map without one. */
export function setActiveLayer(id: number): void {
    const { session, touch } = state();
    session.perMap.get(session.activeMapId)!.activeLayerId = id;
    touch();
}

/** Selects the tiles of tileset `index` from grid position `from` to `to`, as a drag does. */
export function selectTiles(index: number, from: [number, number], to: [number, number]): void {
    const tileset = project().tilesets[index]!;
    tilesetPanel.showTileset(tileset.id);
    tilesetPanel.select(
        tileset.id,
        { column: from[0], row: from[1] },
        { column: to[0], row: to[1] },
    );
}

/** The history: entries to undo and the label of the next undo. */
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

function layerOf(id: number): Layer {
    return findLayer(project().maps[0]!, id)!.layer;
}

/** The properties of what `what` names: "project", "map", "layer:<id>", "marker:<id>", "tile:<i>:<id>", "tileset:<i>". */
export function properties(what: string): Property[] {
    const [kind, a, b] = what.split(":");
    const p = project();
    switch (kind) {
        case "project":
            return p.properties;
        case "map":
            return p.maps[0]!.properties;
        case "layer":
            return layerOf(Number(a)).properties;
        case "marker":
            for (const { layer } of walkLayers(p.maps[0]!.layers)) {
                if (layer.type !== "marker") continue;
                const marker = layer.markers.find((each) => each.id === Number(a));
                if (marker) return marker.properties;
            }
            throw new Error(`no marker ${a}`);
        case "tile":
            return p.tilesets[Number(a)]!.tiles.find((tile) => tile.id === Number(b))!.properties;
        case "tileset":
            return p.tilesets[Number(a)]!.properties;
        default:
            throw new Error(`unknown target ${what}`);
    }
}

/** The names and classes of markers 1 and 2. */
export function markerTexts(): { name: string; class: string }[] {
    const layer = layerOf(OBJECTS);
    if (layer.type !== "marker") throw new Error("not a marker layer");
    return layer.markers.map((marker) => ({ name: marker.name, class: marker.class }));
}

/** The classes of tiles `ids` of tileset `index`. */
export function tileClasses(index: number, ids: number[]): string[] {
    const tiles = project().tilesets[index]!.tiles;
    return ids.map((id) => tiles.find((tile) => tile.id === id)!.class);
}
