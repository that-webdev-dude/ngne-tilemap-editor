// Declares `window.__ngneTest`, the development-only test hook of the app, and its probe.
import type { ViewportProbe } from "../../../src/app/testing/testHooks";
import { createProjectSession } from "../../../src/core/model";
import { createReferenceProject } from "../../support/referenceProject";

// TE-013 benchmark page module (tests/perf/te-013-pan.perf.ts): the reference map in the
// editor's viewport, panned on a script. The page imports it into the running editor.

export interface Prepared {
    /** CSS pixels per map pixel. */
    zoom: number;
    canvas: [number, number];
    /** Sprites of the first frame: at the live-tier threshold this is about 65,536. */
    sprites: number;
}

export interface PanRecord {
    /**
     * Milliseconds from the start of each animation-frame callback to the return of `render`.
     * In a scheduled pan, the viewport's own draw of each frame it submitted (`lastDrawMs`).
     */
    submitMs: number[];
    /** Of those, the milliseconds spent building the frame; the rest is NGNE's `render`. */
    buildMs: number[];
    /** Milliseconds between the starts of consecutive callbacks. */
    intervalMs: number[];
}

/** The tile layers of the reference map, each filled: the visible cells count once per layer. */
const LAYERS = 8;
/** The live tier's budget (ENGINE §4). */
const THRESHOLD = 65_536;
const CELL = 16;

function viewport(): ViewportProbe {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-013 pan: no viewport");
    return probe;
}

/** Resolves once `condition` holds: checked at once, then every 20 ms. */
function when(condition: () => boolean): Promise<void> {
    return new Promise((resolve) => {
        const check = () => {
            if (condition()) resolve();
            else setTimeout(check, 20);
        };
        check();
    });
}

/**
 * Loads the reference project and zooms so that the view shows about `THRESHOLD` cells in all
 * layers: at 1920 × 1080 device pixels that is the whole 100% view. Resolves once the textures
 * are uploaded and a frame has drawn them. `inside` multiplies the zoom: 1.01 shows about 2%
 * fewer cells, so the view stays in the live tier once the chunk tier is ready (TE-068).
 */
export async function prepare(inside = 1): Promise<Prepared> {
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const [width, height] = [probe.canvas.width, probe.canvas.height];
    // Visible cells per layer = width × height / (scale × CELL)²; `LAYERS` layers of them.
    const scale = inside * Math.sqrt((LAYERS * width * height) / (THRESHOLD * CELL * CELL));
    const zoom = scale / window.devicePixelRatio;

    const session = createProjectSession(createReferenceProject());
    const map = session.project.maps[0]!;
    session.perMap.get(session.activeMapId)!.view = {
        centreX: (map.width * map.tileWidth) / 2,
        centreY: (map.height * map.tileHeight) / 2,
        zoom,
    };
    hooks.session.getState().replace(session);

    // Wait for the two tileset textures and the checkerboard, then for a frame that has them.
    await when(() => {
        const ids = probe.textureIds();
        return (
            ids.includes("ed:checker") && ids.filter((id) => id.startsWith("ed:ts:")).length === 2
        );
    });
    probe.renderNow();
    return { zoom, canvas: [width, height], sprites: probe.stats.sprites };
}

/**
 * Pans for `ms` milliseconds: in each animation-frame callback the view moves along a slow
 * loop and a frame is built and submitted at once, so the callback's length is the cost of
 * a frame (the budget's "animation-frame callback start → submit"). The view is moved in place
 * without telling the store, so the viewport asks for no frame of its own.
 *
 * With `scheduled`, each callback moves the view and asks the viewport for a frame instead
 * (`requestRedraw`, as input does), so the viewport's own pacing decides which frames are
 * submitted (ENGINE §4, frames in flight; TE-068).
 */
export function pan(ms: number, scheduled = false): Promise<PanRecord> {
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const session = hooks.session.getState().session;
    const view = session.perMap.get(session.activeMapId)!.view;
    const origin = { x: view.centreX, y: view.centreY };
    const record: PanRecord = { submitMs: [], buildMs: [], intervalMs: [] };
    return new Promise((resolve) => {
        let start = -1;
        let last = -1;
        let frames = probe.stats.frames;
        const step = (now: number) => {
            const begin = performance.now();
            if (start < 0) start = now;
            const t = (now - start) / 1000;
            // A loop of 400 × 200 map pixels in 5 s: about 60 map pixels a second.
            view.centreX = origin.x + 200 * Math.sin((t * 2 * Math.PI) / 5);
            view.centreY = origin.y + 100 * Math.sin((t * 4 * Math.PI) / 5);
            if (scheduled) {
                // The viewport's frames run in their own callbacks, before this one.
                if (probe.stats.frames > frames) {
                    frames = probe.stats.frames;
                    record.submitMs.push(probe.stats.lastDrawMs);
                    record.buildMs.push(probe.stats.lastBuildMs);
                }
                probe.requestRedraw();
            } else {
                probe.renderNow();
                record.submitMs.push(performance.now() - begin);
                record.buildMs.push(probe.stats.lastBuildMs);
            }
            if (last >= 0) record.intervalMs.push(now - last);
            last = now;
            if (now - start >= ms) {
                view.centreX = origin.x;
                view.centreY = origin.y;
                resolve(record);
            } else {
                requestAnimationFrame(step);
            }
        };
        requestAnimationFrame(step);
    });
}
