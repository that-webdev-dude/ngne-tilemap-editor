// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
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
    /** Milliseconds from the start of each animation-frame callback to the return of `render`. */
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

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-013 pan: no viewport");
    return probe;
}

/**
 * Loads the reference project and zooms so that the view shows about `THRESHOLD` cells in all
 * layers: at 1920 × 1080 device pixels that is the whole 100% view. Resolves once the textures
 * are uploaded and a frame has drawn them.
 */
export async function prepare(): Promise<Prepared> {
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const [width, height] = [probe.canvas.width, probe.canvas.height];
    // Visible cells per layer = width × height / (scale × CELL)²; `LAYERS` layers of them.
    const scale = Math.sqrt((LAYERS * width * height) / (THRESHOLD * CELL * CELL));
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
    for (;;) {
        const ids = probe.textureIds();
        if (
            ids.includes("ed:checker") &&
            ids.filter((id) => id.startsWith("ed:ts:")).length === 2
        ) {
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    probe.renderNow();
    return { zoom, canvas: [width, height], sprites: probe.stats.sprites };
}

/**
 * Pans for `ms` milliseconds: in each animation-frame callback the view moves along a slow
 * loop and a frame is built and submitted at once, so the callback's length is the cost of
 * a frame (the budget's "animation-frame callback start → submit"). The view is moved in place
 * without telling the store, so the viewport asks for no frame of its own.
 */
export function pan(ms: number): Promise<PanRecord> {
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const session = hooks.session.getState().session;
    const view = session.perMap.get(session.activeMapId)!.view;
    const origin = { x: view.centreX, y: view.centreY };
    const record: PanRecord = { submitMs: [], buildMs: [], intervalMs: [] };
    return new Promise((resolve) => {
        let start = -1;
        let last = -1;
        const step = (now: number) => {
            const begin = performance.now();
            if (start < 0) start = now;
            const t = (now - start) / 1000;
            // A loop of 400 × 200 map pixels in 5 s: about 60 map pixels a second.
            view.centreX = origin.x + 200 * Math.sin((t * 2 * Math.PI) / 5);
            view.centreY = origin.y + 100 * Math.sin((t * 4 * Math.PI) / 5);
            probe.renderNow();
            record.submitMs.push(performance.now() - begin);
            record.buildMs.push(probe.stats.lastBuildMs);
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
