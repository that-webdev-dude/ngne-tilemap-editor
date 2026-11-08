// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { clipboardStore } from "../../../src/app/clipboard/clipboard";
import { toolState } from "../../../src/app/tools/activeTool";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import {
    assertInvariants,
    createMap,
    createMapSession,
    createMarkerLayer,
    createProject,
    createProjectSession,
    findLayer,
    sequentialIds,
} from "../../../src/core/model";
import type { Marker, MarkerLayer, ProjectMap } from "../../../src/core/model";
import { rectMask } from "../../../src/core/selection";

// TE-039 page module: the specs import it into the running editor, so it shares the app's stores
// and tools. It loads "Markers" with two maps of 16 px cells, each
//
//     Areas (2, marker, active)   top
//     Ground (1, tile)            bottom
//
// "Field" (40 × 30) holds a polygon, a polyline and a rectangle in Areas, next marker ID 4;
// "Other" (20 × 10) holds none, next marker ID 10. The view is at zoom 2 about map (160, 120),
// Show Grid off and Snap to Grid on.

const hooks = () => window.__ngneTest!;
const state = () => hooks().session.getState();

export const AREAS = 2;
export const GROUND = 1;

const base = { name: "", class: "", properties: [] };

/** Field's markers. */
export const FIELD_MARKERS: Marker[] = [
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
        name: "Zone",
        class: "area",
        properties: [{ name: "depth", type: "int", value: 3 }],
    },
    {
        ...base,
        id: 2,
        shape: "polyline",
        x: 160,
        y: 48,
        points: [
            [0, 0],
            [64, 0],
        ],
    },
    { ...base, id: 3, shape: "rectangle", x: 32, y: 128, width: 32, height: 32 },
];

function withAreas(map: ProjectMap, markers: Marker[], next: number): void {
    map.layers[0]!.name = "Ground";
    const areas = createMarkerLayer(AREAS, "Areas");
    areas.markers.push(...structuredClone(markers));
    map.layers.push(areas);
    map.nextLayerId = 3;
    map.nextMarkerId = next;
}

export function load(): string[] {
    const project = createProject({
        name: "Markers",
        newId: sequentialIds("m"),
        map: { name: "Field", width: 40, height: 30, tileWidth: 16, tileHeight: 16 },
    });
    withAreas(project.maps[0]!, FIELD_MARKERS, 4);
    const other = createMap({
        name: "Other",
        width: 20,
        height: 10,
        tileWidth: 16,
        tileHeight: 16,
        newId: sequentialIds("n"),
        takenExportNames: [project.maps[0]!.exportName],
    });
    withAreas(other, [], 10);
    project.maps.push(other);
    assertInvariants(project);
    const session = createProjectSession(project);
    for (const map of project.maps) {
        if (!session.perMap.has(map.id)) session.perMap.set(map.id, createMapSession(map));
        const mapSession = session.perMap.get(map.id)!;
        mapSession.view = { centreX: 160, centreY: 120, zoom: 2 };
        mapSession.activeLayerId = AREAS;
    }
    viewPreferences.getState().set("grid", false);
    viewPreferences.getState().set("snap", true);
    clipboardStore.setState({ content: null, markers: null });
    state().replace(session);
    return project.maps.map((map) => map.id);
}

function activeMapOf(): ProjectMap {
    const { session } = state();
    return session.project.maps.find((map) => map.id === session.activeMapId)!;
}

export function selectTool(id: string): boolean {
    return toolState.select(id);
}

/** Makes map `index` (0 Field, 1 Other) the active map. */
export function switchMap(index: number): void {
    const { session, touch } = state();
    session.activeMapId = session.project.maps[index]!.id;
    touch();
}

/** Makes layer `id` of the active map the active layer. */
export function setActiveLayer(id: number): void {
    const { session, touch } = state();
    session.perMap.get(session.activeMapId)!.activeLayerId = id;
    touch();
}

/** Locks or hides layer `id` of the active map outside the history. */
export function setLayerFlag(id: number, flag: "locked" | "visible", value: boolean): void {
    findLayer(activeMapOf(), id)!.layer[flag] = value;
    state().touch();
}

/** The markers of Areas of the active map, whole. */
export function markers(): Marker[] {
    return structuredClone((findLayer(activeMapOf(), AREAS)!.layer as MarkerLayer).markers);
}

export function nextMarkerId(): number {
    return activeMapOf().nextMarkerId;
}

/** The marker selection of the active map. */
export function selection(): number[] {
    const { session } = state();
    return [...session.perMap.get(session.activeMapId)!.markerSelection];
}

/** Sets the marker selection of the active map outside the history. */
export function setSelection(ids: number[]): void {
    const { session, touch } = state();
    session.perMap.get(session.activeMapId)!.markerSelection = [...ids];
    touch();
}

/** Selects the cells of `rect` on the active map, outside the history. */
export function setTileSelection(x: number, y: number, width: number, height: number): void {
    const { session, touch } = state();
    session.perMap.get(session.activeMapId)!.tileSelection = rectMask({ x, y, width, height });
    touch();
}

/** What the clipboard holds: "cells", "markers" or null, and how many markers. */
export function clipboard(): { kind: string | null; markers: number } {
    const { content, markers: held } = clipboardStore.getState();
    return {
        kind: content ? "cells" : held ? "markers" : null,
        markers: held?.length ?? 0,
    };
}

export function history(): { undo: string | null; redo: string | null } {
    const { history } = state();
    return { undo: history.undoLabel, redo: history.redoLabel };
}

export function undo(): boolean {
    return state().history.undo();
}

export function redo(): boolean {
    return state().history.redo();
}

/** The client position of map point `(x, y)`. */
export function mapClient(x: number, y: number): { x: number; y: number } {
    return currentViewMapping()!.mapToClient(x, y);
}

/** The status bar's feedback. */
export function feedback(): string | null {
    return document.querySelector('[data-status="message"]')?.textContent ?? null;
}

/** The status bar's selection field; "" while it shows nothing. */
export function selectionField(): string {
    return document.querySelector('[data-status="selection"]')?.textContent ?? "";
}

/** The number of entries undo can take back. */
export function undoCount(): number {
    return state().history.undoCount;
}
