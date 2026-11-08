// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { setMarkerSelection } from "../../../src/app/markers/markerSelection";
import { toolState } from "../../../src/app/tools/activeTool";
import { MARKERS, prepare } from "./te-037-markers";
import type { Prepared } from "./te-037-markers";

// Benchmark page module of tests/perf/cleanup-pan-selection.perf.ts: TE-037's reference map with
// 2,000 markers, panned through the app's own path instead of TE-037's direct render. Each step
// writes the view and touches the session store, as `viewNavigation.panBy` does, so every store
// listener runs (the Properties panel, the status bar, the marker key context) and the viewport
// and the overlay draw in their own animation-frame callbacks.
//
// Per frame it times two parts:
// - frame: the app's callbacks of the frame, between a callback requested before the step and
//   one requested after it (callbacks run in the order they were requested);
// - step: the store touch and what it runs at once, up to microtasks queued after it (React
//   flushes a store-driven render in a microtask).

export type Setup = "none" | "selected";

export interface PreparedSelection extends Prepared {
    selected: number;
    tool: string;
}

export interface SelectionPanRecord {
    /** Milliseconds of the app's animation-frame callbacks, per frame. */
    frameMs: number[];
    /** Milliseconds of the store touch and its microtasks, per frame. */
    stepMs: number[];
    /** Their sum, per frame. */
    totalMs: number[];
    /** Milliseconds between consecutive frames. */
    intervalMs: number[];
}

/** The pan's loop: 200 × 100 map pixels from the centre (TE-013's). */
const LOOP = { x: 200, y: 100 };

function state() {
    const hooks = window.__ngneTest;
    if (!hooks) throw new Error("cleanup pan selection: no test hooks");
    return hooks.session.getState();
}

/**
 * TE-037's map and view (`zoom` null: the live-tier threshold), the marker layer active and the
 * marker select tool chosen; with "selected", every marker is selected.
 */
export async function prepareSelection(
    zoom: number | null,
    setup: Setup,
): Promise<PreparedSelection> {
    const prepared = await prepare(zoom);
    const { session, touch } = state();
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    const layer = map.layers[map.layers.length - 1]!;
    if (layer.type !== "marker") throw new Error("cleanup pan selection: no marker layer on top");
    session.perMap.get(map.id)!.activeLayerId = layer.id;
    touch();
    if (!toolState.select("markerSelect")) throw new Error("cleanup pan selection: no select tool");
    if (setup === "selected")
        setMarkerSelection(
            layer.markers.map((marker) => marker.id),
            map.id,
        );
    const selected = session.perMap.get(map.id)!.markerSelection.length;
    if (selected !== (setup === "selected" ? MARKERS : 0)) {
        throw new Error(`cleanup pan selection: ${selected} markers selected`);
    }
    // Let React and the overlay settle before the pan.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { ...prepared, selected, tool: toolState.activeId() };
}

/** Waits for the microtasks queued so far, and those they queue, to run. */
function afterMicrotasks(callback: () => void): void {
    queueMicrotask(() => queueMicrotask(() => queueMicrotask(callback)));
}

/** Pans for `ms` milliseconds along TE-013's loop through the session store. */
export function panSelection(ms: number): Promise<SelectionPanRecord> {
    const { session, touch } = state();
    const mapSession = session.perMap.get(session.activeMapId)!;
    const origin = { x: mapSession.view.centreX, y: mapSession.view.centreY };
    const record: SelectionPanRecord = { frameMs: [], stepMs: [], totalMs: [], intervalMs: [] };
    return new Promise((resolve) => {
        let start = -1;
        let last = -1;
        let before = -1;
        const move = (t: number) => {
            mapSession.view = {
                ...mapSession.view,
                centreX: origin.x + LOOP.x * Math.sin((t * 2 * Math.PI) / 5),
                centreY: origin.y + LOOP.y * Math.sin((t * 4 * Math.PI) / 5),
            };
            touch();
        };
        const step = (now: number) => {
            const entered = performance.now();
            const frame = before < 0 ? null : entered - before;
            if (start < 0) start = now;
            if (last >= 0) record.intervalMs.push(now - last);
            last = now;
            if (now - start >= ms) {
                mapSession.view = { ...mapSession.view, centreX: origin.x, centreY: origin.y };
                touch();
                resolve(record);
                return;
            }
            // Requested before the step: runs first in the next frame, before the app's callbacks.
            requestAnimationFrame(() => {
                before = performance.now();
            });
            const stepStart = performance.now();
            move((now - start) / 1000);
            afterMicrotasks(() => {
                const stepMs = performance.now() - stepStart;
                if (frame !== null) {
                    record.frameMs.push(frame);
                    record.stepMs.push(stepMs);
                    record.totalMs.push(frame + stepMs);
                }
                // Requested after the step: runs last in the next frame.
                requestAnimationFrame(step);
            });
        };
        requestAnimationFrame(step);
    });
}
