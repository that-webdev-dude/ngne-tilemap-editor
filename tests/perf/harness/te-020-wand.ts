// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import type {} from "../../../src/app/overlay/mountOverlay";
import { toolState } from "../../../src/app/tools/activeTool";
import { wandShape } from "../../../src/app/selection/tools/selection.tools";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { cellValue } from "../../../src/core/cells";
import { createProjectSession } from "../../../src/core/model";
import type { TileLayer } from "../../../src/core/model";
import { maskSize, selectNoneCommand } from "../../../src/core/selection";
import { createReferenceProject, REFERENCE } from "../../support/referenceProject";

// TE-020 benchmark page module (tests/perf/te-020-wand.perf.ts): the reference map at 100% in
// the editor's viewport, its top tile layer under the parallax layer made one tile everywhere
// (outside the history), so a magic wand press there selects all 65,536 cells. The wand changes
// no cells, so its frame is the overlay's: every press is timed from the event's time stamp to
// the end of the first overlay redraw after it, which draws the selection's ants (the browser
// presents that frame next). The page imports it into the running editor.

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-020 wand: no viewport");
    return probe;
}

function overlay() {
    const probe = window.__ngneTest?.overlay;
    if (!probe) throw new Error("te-020 wand: no overlay");
    return probe;
}

/** Resolves when `condition` holds, checked between tasks. */
function until(condition: () => boolean): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            if (condition()) {
                channel.port1.close();
                resolve();
            } else {
                channel.port2.postMessage(null);
            }
        };
        channel.port2.postMessage(null);
    });
}

/** Milliseconds from each press to the overlay redraw that shows its selection. */
const samples: number[] = [];
/** Milliseconds from each press to the end of the tools' handling of it: the flood. */
const handled: number[] = [];
let layer: TileLayer | null = null;

export interface Opened {
    canvas: [number, number];
    layerId: number;
}

/**
 * Opens the reference map at 100% in its middle with the layer under the parallax layer all
 * tile 5 of slot 1 and active, the magic wand selected, and times every press from then on.
 */
export async function openReference(): Promise<Opened> {
    const probe = viewport();
    const session = createProjectSession(createReferenceProject());
    const map = session.project.maps[0]!;
    const side = REFERENCE.width * REFERENCE.tileWidth;
    const mapSession = session.perMap.get(session.activeMapId)!;
    Object.assign(mapSession.view, { centreX: side / 2, centreY: side / 2, zoom: 1 });
    const target = map.layers[REFERENCE.parallaxLayer - 1] as TileLayer;
    for (let y = 0; y < REFERENCE.height; y++) {
        for (let x = 0; x < REFERENCE.width; x++) target.cells.set(x, y, cellValue(1, 5));
    }
    layer = target;
    mapSession.activeLayerId = target.id;
    window.__ngneTest!.session.getState().replace(session);
    await until(() => probe.textureIds().filter((id) => id.startsWith("ed:ts:")).length === 2);
    if (!toolState.select("wand")) throw new Error("te-020 wand: no magic wand");

    window.addEventListener("pointerdown", (event) => {
        // After the tools' own listeners on the overlay: the press has found its region and
        // asked the ants to show it when this runs.
        if ((event.buttons & 1) === 0 || !window.__ngneTest!.tools?.stroking) return;
        handled.push(performance.now() - event.timeStamp);
        const redraws = overlay().redraws;
        void until(() => overlay().redraws > redraws && !overlay().pending).then(() => {
            samples.push(performance.now() - event.timeStamp);
        });
    });
    await until(() => probe.stats.frames > 0);
    return { canvas: [probe.canvas.width, probe.canvas.height], layerId: target.id };
}

/** Clears the selection (one history entry) and resolves once the overlay has redrawn. */
export async function clear(): Promise<void> {
    const { session, history } = window.__ngneTest!.session.getState();
    const command = selectNoneCommand(session, session.activeMapId);
    if (command) history.execute(command);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await until(() => overlay().pending === false);
}

/** The client position of the centre of cell `(x, y)` as the map is on screen. */
export function cellClient(x: number, y: number): { x: number; y: number } {
    const mapping = currentViewMapping()!;
    return mapping.mapToClient((x + 0.5) * REFERENCE.tileWidth, (y + 0.5) * REFERENCE.tileHeight);
}

/** Resolves when `count` samples are in, and one more animation frame has gone by. */
export async function recorded(count: number): Promise<number> {
    await until(() => samples.length >= count);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return samples.length;
}

/** Milliseconds of one wand shape of the layer from cell `(x, y)`, alone (for the record). */
export function shapeMs(x: number, y: number): { ms: number; cells: number } {
    const { session } = window.__ngneTest!.session.getState();
    const map = session.project.maps[0]!;
    const start = performance.now();
    const shape = wandShape(map, layer!, { x, y });
    return { ms: performance.now() - start, cells: maskSize(shape) };
}

export interface WandRecord {
    ms: number[];
    handledMs: number[];
    selected: number;
    undo: string | null;
    entries: number;
}

export function result(): WandRecord {
    const { session, history } = window.__ngneTest!.session.getState();
    const selection = session.perMap.get(session.activeMapId)?.tileSelection ?? null;
    const selected = selection ? maskSize(selection) : 0;
    const undo = history.undoLabel;
    let entries = 0;
    while (history.canUndo && entries < 1000) {
        history.undo();
        entries++;
    }
    return { ms: [...samples], handledMs: [...handled], selected, undo, entries };
}
