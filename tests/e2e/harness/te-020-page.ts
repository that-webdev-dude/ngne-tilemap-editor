// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import type {} from "../../../src/app/selection/selectionAnts.overlay";
import { toolState } from "../../../src/app/tools/activeTool";
import { createMap, createMapSession } from "../../../src/core/model";
import {
    createMask,
    maskHas,
    rectMask,
    selectionOf,
    tileSelectionOf,
} from "../../../src/core/selection";

// TE-020 page module: the TE-018 page module (test map, history, overlay, oriented cells) and
// what the TE-020 specs read besides: the active map's tile selection and the marching ants,
// and the selection tools' Mode option.

export * from "./te-018-page";

function state() {
    return window.__ngneTest!.session.getState();
}

/**
 * The active map's tile selection: its rectangle and its rows, `#` a selected cell and `.`
 * not; null without one.
 */
export function selection(): {
    x: number;
    y: number;
    width: number;
    height: number;
    rows: string[];
} | null {
    const { session } = state();
    const current = tileSelectionOf(session, session.activeMapId);
    if (!current) return null;
    const rows: string[] = [];
    for (let y = current.y; y < current.y + current.height; y++) {
        let row = "";
        for (let x = current.x; x < current.x + current.width; x++) {
            row += maskHas(current, x, y) ? "#" : ".";
        }
        rows.push(row);
    }
    return { x: current.x, y: current.y, width: current.width, height: current.height, rows };
}

/** Selects the cells of `rect` on the active map, outside the history. */
export function setSelectionRect(x: number, y: number, width: number, height: number): void {
    const { session, touch } = state();
    session.perMap.get(session.activeMapId)!.tileSelection = rectMask({ x, y, width, height });
    touch();
}

/** Sets the Mode option of a selection tool. */
export function setMode(toolId: string, mode: string): void {
    const tool = toolState.registry.get(toolId);
    if (!tool) throw new Error(`te-020: no tool ${toolId}`);
    toolState.setOption(tool, "mode", mode);
}

/** What the marching ants report; null while the overlay holds no ants layer. */
export function ants(): { animating: boolean; ringWork: string } | null {
    const probe = window.__ngneTest!.selectionAnts;
    return probe ? { animating: probe.animating, ringWork: probe.ringWork } : null;
}

/** Selects the `#` cells of `rows`, whose top-left cell is `(x, y)`, outside the history. */
export function setSelectionRows(x: number, y: number, rows: string[]): void {
    const { session, touch } = state();
    const mask = createMask({ x, y, width: rows[0]!.length, height: rows.length });
    rows.forEach((row, v) => {
        [...row].forEach((char, u) => {
            if (char === "#") mask.mask[v * mask.width + u] = 1;
        });
    });
    session.perMap.get(session.activeMapId)!.tileSelection = selectionOf(mask);
    touch();
}

/**
 * Makes `mapId` the active map, adding a second map of 20 × 10 cells first when `mapId` is
 * null; returns the id of the map left and of the map made active.
 */
export function switchMap(mapId: string | null): { left: string; active: string } {
    const { session, touch } = state();
    const left = session.activeMapId;
    let target = mapId;
    if (target === null) {
        const map = createMap({
            name: "Map 2",
            width: 20,
            height: 10,
            tileWidth: 16,
            tileHeight: 16,
            takenExportNames: session.project.maps.map((each) => each.exportName),
        });
        session.project.maps.push(map);
        session.perMap.set(map.id, createMapSession(map));
        target = map.id;
    }
    session.activeMapId = target;
    touch();
    return { left, active: target };
}
