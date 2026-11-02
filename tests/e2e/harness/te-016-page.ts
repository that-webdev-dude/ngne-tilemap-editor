// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { toolRegistry } from "../../../src/app/tools/toolRegistry";
import type { ToolSpec } from "../../../src/app/tools/types";
import { currentViewMapping, zoomTo } from "../../../src/app/view/viewNavigation";
import { cellValue } from "../../../src/core/cells";
import {
    createGroupLayer,
    createMarkerLayer,
    createProject,
    createProjectSession,
    createTileLayer,
    findLayer,
    sequentialIds,
} from "../../../src/core/model";
import type { Project, TileLayer } from "../../../src/core/model";
import { LAYERS, MAP } from "./te-016-map";

// TE-016 page module: the specs import it into the running editor (`import("/tests/e2e/harness/
// te-016-page.ts")`), so it shares the app's stores, tool registry and pipeline. It loads a map
// with a tile layer, a group holding a tile layer and a marker layer, registers a probe tool
// that paints one value at every cell its samples carry, and reads cells and the view back.

/** The value the probe paints: tile 0 of slot 1. */
const VALUE = cellValue(1, 0);

const probe: ToolSpec = {
    id: "probe",
    label: "Probe",
    layers: ["tile"],
    paints: true,
    onDown(context, pointer) {
        for (const cell of pointer.cells) context.paint?.set(cell.x, cell.y, VALUE);
    },
    onMove(context, pointer) {
        for (const cell of pointer.cells) context.paint?.set(cell.x, cell.y, VALUE);
    },
};

/** Replaces the project with the test map, its tile layer active, and registers the probe. */
export function load(): void {
    const newId = sequentialIds();
    const project: Project = createProject({
        newId,
        map: { width: MAP.width, height: MAP.height, tileWidth: MAP.tile, tileHeight: MAP.tile },
    });
    const map = project.maps[0]!;
    const group = createGroupLayer(LAYERS.group, "Group");
    group.layers.push(createTileLayer(LAYERS.grouped, "Grouped"));
    map.layers.push(group, createMarkerLayer(LAYERS.marker, "Markers"));
    map.nextLayerId = 5;
    window.__ngneTest!.session.getState().replace(createProjectSession(project), { verify: null });
    if (!toolRegistry.get(probe.id)) toolRegistry.register(probe, "te-016-page.ts");
}

function map() {
    const { session } = window.__ngneTest!.session.getState();
    return session.project.maps.find((each) => each.id === session.activeMapId)!;
}

/** Makes layer `id` the active layer. */
export function setActiveLayer(id: number): void {
    const state = window.__ngneTest!.session.getState();
    state.session.perMap.get(map().id)!.activeLayerId = id;
    state.touch();
}

/** Locks or hides layer `id`. */
export function setLayer(id: number, values: { locked?: boolean; visible?: boolean }): void {
    Object.assign(findLayer(map(), id)!.layer, values);
    window.__ngneTest!.session.getState().touch();
}

/** Selects a registered tool of the active layer's set; false when it cannot be selected. */
export function selectTool(id: string): boolean {
    return toolState.select(id);
}

/** The ids of the rail's buttons, in order, and the pressed one. */
export function rail(): { tools: string[]; active: string | null } {
    const buttons = [
        ...document.querySelectorAll<HTMLElement>('[data-region="tool-rail"] [data-tool]'),
    ];
    const active = buttons.find((button) => button.getAttribute("aria-pressed") === "true");
    return {
        tools: buttons.map((button) => button.dataset.tool!),
        active: active?.dataset.tool ?? null,
    };
}

/** The non-empty cells of tile layer `id` (the first when null), as "x,y", row by row. */
export function painted(id: number | null): string[] {
    const layer = findLayer(map(), id ?? LAYERS.tile)!.layer as TileLayer;
    const found: string[] = [];
    for (let y = 0; y < MAP.height; y++) {
        for (let x = 0; x < MAP.width; x++)
            if (layer.cells.get(x, y) !== 0) found.push(`${x},${y}`);
    }
    return found;
}

/** The client position of the centre of cell `(x, y)` as the map is on screen. */
export function cellClient(x: number, y: number): { x: number; y: number } {
    const mapping = currentViewMapping()!;
    return mapping.mapToClient((x + 0.5) * MAP.tile, (y + 0.5) * MAP.tile);
}

/** Sets the zoom to `scale` device pixels per map pixel, about the viewport's centre. */
export function zoom(scale: number): void {
    zoomTo(scale);
}

/** The view of the active map. */
export function view(): { centreX: number; centreY: number; zoom: number } {
    const { session } = window.__ngneTest!.session.getState();
    return { ...session.perMap.get(map().id)!.view };
}

/** Whether the project's history has an entry to undo. */
export function canUndo(): boolean {
    return window.__ngneTest!.session.getState().history.canUndo;
}
