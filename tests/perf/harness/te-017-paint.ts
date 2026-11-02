// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { setCurrentStamp } from "../../../src/app/tools/stamp/currentStamp";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { cellValue } from "../../../src/core/cells";
import { createProjectSession } from "../../../src/core/model";
import { createReferenceProject, REFERENCE } from "../../support/referenceProject";

// TE-017 benchmark page module (tests/perf/te-017-paint.perf.ts): the reference map at 100% in
// the editor's viewport, the stamp brush on its top tile layer below the parallax layer. Every
// pointer down or move of a stroke is timed from the event's time stamp to the first frame the
// viewport submits after it, which contains the cells the event painted (the pipeline reports
// them to the viewport in the event's task). The page imports it into the running editor.

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-017 paint: no viewport");
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

/** Milliseconds from each timed event to the frame containing it. */
const samples: number[] = [];
/** The tier of each sample's frame. */
const tiers: string[] = [];

export interface Opened {
    canvas: [number, number];
    tier: string;
    layerId: number;
}

/**
 * Opens the reference map at 100% in its middle, the stamp brush selected with a 1 × 1 stamp
 * on the top layer under the parallax layer, and times every press and drag sample of the
 * stroke from then on.
 */
export async function openReference(): Promise<Opened> {
    const probe = viewport();
    const session = createProjectSession(createReferenceProject());
    const map = session.project.maps[0]!;
    const side = REFERENCE.width * REFERENCE.tileWidth;
    const mapSession = session.perMap.get(session.activeMapId)!;
    Object.assign(mapSession.view, { centreX: side / 2, centreY: side / 2, zoom: 1 });
    const layer = map.layers[REFERENCE.parallaxLayer - 1]!;
    mapSession.activeLayerId = layer.id;
    window.__ngneTest!.session.getState().replace(session);
    await until(() => probe.textureIds().filter((id) => id.startsWith("ed:ts:")).length === 2);
    setCurrentStamp({ width: 1, height: 1, cells: Uint32Array.of(cellValue(1, 5)) });
    if (!toolState.select("stamp")) throw new Error("te-017 paint: no stamp brush");

    const time = (event: PointerEvent) => {
        if ((event.buttons & 1) === 0 || !window.__ngneTest!.tools?.stroking) return;
        const frames = probe.stats.frames;
        void until(() => probe.stats.frames > frames).then(() => {
            samples.push(performance.now() - event.timeStamp);
            tiers.push(probe.stats.tier);
        });
    };
    // After the tools' own listeners on the overlay: the event has painted when this runs.
    window.addEventListener("pointerdown", time);
    window.addEventListener("pointermove", time);
    await until(() => probe.stats.frames > 0);
    return {
        canvas: [probe.canvas.width, probe.canvas.height],
        tier: probe.stats.tier,
        layerId: layer.id,
    };
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

export interface PaintRecord {
    ms: number[];
    tiers: string[];
    /** History entries the stroke made: one. */
    undo: string | null;
}

export function result(): PaintRecord {
    return {
        ms: [...samples],
        tiers: [...tiers],
        undo: window.__ngneTest!.session.getState().history.undoLabel,
    };
}
