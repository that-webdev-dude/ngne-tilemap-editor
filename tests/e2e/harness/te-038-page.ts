// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { viewPreferences } from "../../../src/app/view/viewPreferences";
import {
    assertInvariants,
    createMarkerLayer,
    createProject,
    createProjectSession,
    findLayer,
    sequentialIds,
} from "../../../src/core/model";
import type { Marker, MarkerLayer } from "../../../src/core/model";

// TE-038 page module: the specs import it into the running editor, so it shares the app's stores
// and tools. It loads "Markers" with one map, 40 × 30 cells of 16 px, whose layers are
//
//     Areas (2, marker, active)   top
//     Ground (1, tile)            bottom
//
// with the view at zoom 2 about map (160, 120), Show Grid off and Snap to Grid on. `withMarkers`
// fills Areas with the select tool's markers.

const hooks = () => window.__ngneTest!;
const state = () => hooks().session.getState();

export const AREAS = 2;

const base = { name: "", class: "", properties: [] };

export function load(withMarkers = false): void {
    const project = createProject({
        name: "Markers",
        newId: sequentialIds("m"),
        map: { name: "Field", width: 40, height: 30, tileWidth: 16, tileHeight: 16 },
    });
    const map = project.maps[0]!;
    map.layers[0]!.name = "Ground";
    const areas = createMarkerLayer(AREAS, "Areas");
    if (withMarkers) {
        areas.markers.push(
            { ...base, id: 1, shape: "rectangle", x: 32, y: 32, width: 32, height: 32 },
            { ...base, id: 2, shape: "rectangle", x: 128, y: 32, width: 32, height: 16 },
            { ...base, id: 3, shape: "ellipse", x: 32, y: 128, width: 48, height: 32 },
            { ...base, id: 4, shape: "point", x: 200, y: 160 },
        );
        map.nextMarkerId = 5;
    }
    map.layers.push(areas);
    map.nextLayerId = 3;
    assertInvariants(project);
    const session = createProjectSession(project);
    const mapSession = session.perMap.get(session.activeMapId)!;
    mapSession.view = { centreX: 160, centreY: 120, zoom: 2 };
    mapSession.activeLayerId = AREAS;
    viewPreferences.getState().set("grid", false);
    viewPreferences.getState().set("snap", true);
    state().replace(session);
}

export function selectTool(id: string): boolean {
    return toolState.select(id);
}

export function activeTool(): string {
    return toolState.activeId();
}

/** The markers of layer `id`, each as its geometry with its ID. */
export function markers(id = AREAS): Record<string, unknown>[] {
    const { session } = state();
    const map = session.project.maps[0]!;
    const layer = findLayer(map, id)!.layer as MarkerLayer;
    return layer.markers.map((marker: Marker) => {
        const geometry: Record<string, unknown> = { ...marker };
        delete geometry.name;
        delete geometry.class;
        delete geometry.properties;
        return geometry;
    });
}

/** The marker selection of the map. */
export function selection(): number[] {
    const { session } = state();
    return [...session.perMap.get(session.activeMapId)!.markerSelection];
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

/** Locks or hides layer `id` outside the history. */
export function setLayerFlag(id: number, flag: "locked" | "visible", value: boolean): void {
    const map = state().session.project.maps[0]!;
    findLayer(map, id)!.layer[flag] = value;
    state().touch();
}

/** Whether the `markers` key context is on. */
export function markersContext(): boolean {
    return hooks().keyContexts.getState().markers;
}

export function snap(): boolean {
    return viewPreferences.getState().snap;
}

/** The status bar's feedback. */
export function feedback(): string | null {
    return document.querySelector('[data-status="message"]')?.textContent ?? null;
}

/** Sets the parallax factor of layer `id` on both axes, outside the history. */
export function setParallax(id: number, factor: number): void {
    const map = state().session.project.maps[0]!;
    const layer = findLayer(map, id)!.layer;
    layer.parallaxX = factor;
    layer.parallaxY = factor;
    state().touch();
}

/** Moves the view's centre to map `(x, y)`, keeping its zoom. */
export function setCentre(x: number, y: number): void {
    const { session } = state();
    const view = session.perMap.get(session.activeMapId)!.view;
    view.centreX = x;
    view.centreY = y;
    state().touch();
}
