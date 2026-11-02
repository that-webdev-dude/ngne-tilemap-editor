// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { toolState } from "../../../src/app/tools/activeTool";
import { forgetBucketRegion } from "../../../src/app/tools/fill/bucket.tools";
import { setCurrentStamp } from "../../../src/app/tools/stamp/currentStamp";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { cellValue } from "../../../src/core/cells";
import { floodRegion, regionSize } from "../../../src/core/fill";
import { createProjectSession } from "../../../src/core/model";
import type { TileLayer } from "../../../src/core/model";
import { createReferenceProject, REFERENCE } from "../../support/referenceProject";

// TE-019 benchmark page module (tests/perf/te-019-bucket.perf.ts): the reference map at 100% in
// the editor's viewport, its top tile layer under the parallax layer made one tile everywhere
// (outside the history), so a bucket press there fills all 65,536 cells. Every press is timed
// from the event's time stamp to the first frame the viewport submits after it, which contains
// the filled cells. The page imports it into the running editor.

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-019 bucket: no viewport");
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

/** Milliseconds from each press to the frame containing its fill. */
const samples: number[] = [];
/** Milliseconds from each press to the end of the tools' handling of it: the fill itself. */
const handled: number[] = [];
const tiers: string[] = [];
let layer: TileLayer | null = null;

export interface Opened {
    canvas: [number, number];
    tier: string;
    layerId: number;
}

/**
 * Opens the reference map at 100% in its middle with the layer under the parallax layer all
 * tile 5 of slot 1 and active, the bucket selected, and times every press from then on.
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
    if (!toolState.select("bucket")) throw new Error("te-019 bucket: no bucket fill");

    window.addEventListener("pointerdown", (event) => {
        // After the tools' own listeners on the overlay: the press has filled when this runs.
        if ((event.buttons & 1) === 0 || !window.__ngneTest!.tools?.stroking) return;
        handled.push(performance.now() - event.timeStamp);
        const frames = probe.stats.frames;
        void until(() => probe.stats.frames > frames).then(() => {
            samples.push(performance.now() - event.timeStamp);
            tiers.push(probe.stats.tier);
        });
    });
    await until(() => probe.stats.frames > 0);
    return {
        canvas: [probe.canvas.width, probe.canvas.height],
        tier: probe.stats.tier,
        layerId: target.id,
    };
}

/**
 * Makes a 1 × 1 stamp of `tile` current, the tile the next press fills with, and resolves
 * after the overlay redrew its preview, which finds the region on hover (as in Tiled). With
 * `cold` the region is then forgotten, so the press finds it again (SPEC §14).
 */
export async function useTile(tile: number, cold: boolean): Promise<void> {
    setCurrentStamp({ width: 1, height: 1, cells: Uint32Array.of(cellValue(1, tile)) });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await until(() => window.__ngneTest!.overlay?.pending === false);
    if (cold) forgetBucketRegion();
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

/** Milliseconds of one flood of the layer's region from cell `(x, y)`, alone (for the record). */
export function floodMs(x: number, y: number): { ms: number; cells: number } {
    const cells = layer!.cells;
    const start = performance.now();
    const region = floodRegion(
        (cx, cy) => cells.get(cx, cy),
        { x, y },
        {
            x: 0,
            y: 0,
            width: REFERENCE.width,
            height: REFERENCE.height,
        },
    );
    return { ms: performance.now() - start, cells: regionSize(region) };
}

export interface BucketRecord {
    ms: number[];
    handledMs: number[];
    tiers: string[];
    undo: string | null;
    entries: number;
}

export function result(): BucketRecord {
    const { history } = window.__ngneTest!.session.getState();
    let entries = 0;
    while (history.canUndo && entries < 1000) {
        history.undo();
        entries++;
    }
    return {
        ms: [...samples],
        handledMs: [...handled],
        tiers: [...tiers],
        undo: history.redoLabel,
        entries,
    };
}
