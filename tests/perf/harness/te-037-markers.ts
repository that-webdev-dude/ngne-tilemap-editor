// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { markerRasterPaints } from "../../../src/app/markers/markerDrawing";
import { overlayLayers } from "../../../src/app/overlay/overlayLayers";
import { DEFAULT_OVERLAY_THEME } from "../../../src/app/overlay/types";
import type { OverlayFrame } from "../../../src/app/overlay/types";
import { currentViewMapping } from "../../../src/app/view/viewNavigation";
import { createMarkerLayer, createProjectSession } from "../../../src/core/model";
import type { Marker } from "../../../src/core/model";
import { createReferenceProject } from "../../support/referenceProject";

// TE-037 benchmark page module (tests/perf/te-037-markers.perf.ts): the reference map with a
// marker layer of 2,000 markers in the editor, panned on a script as TE-013's pan. The page
// imports it into the running editor.
//
// The markers lie in the part of the map the view keeps in sight through the whole pan, so every
// frame draws all 2,000: 400 each of rectangles, ellipses, points, polygons of 6 points and
// polylines of 4, each named. Each animation-frame callback moves the view, submits the viewport's
// frame and redraws the overlay as its controller does (clear, then every draw layer bottom to
// top), so the callback's length is the cost of a frame with its markers. Frames more than 25 ms
// apart count the raster work the browser does after the callback.

export interface Prepared {
    /** CSS pixels per map pixel. */
    zoom: number;
    canvas: [number, number];
    /** Sprites of the first frame. */
    sprites: number;
    markers: number;
}

export interface PanRecord {
    /** Milliseconds from the start of each callback to the end of the overlay's redraw. */
    frameMs: number[];
    /** Of those, the viewport's build and submit. */
    submitMs: number[];
    /** Of those, the overlay's redraw. */
    overlayMs: number[];
    /** Milliseconds between the starts of consecutive callbacks. */
    intervalMs: number[];
    /** Times a marker layer was painted into its raster during the pan. */
    rasterPaints: number;
}

/** The tile layers of the reference map and the live tier's budget (as TE-013's pan). */
const LAYERS = 8;
const THRESHOLD = 65_536;
const CELL = 16;
export const MARKERS = 2000;
/** Half the area of the markers about the map centre, map pixels: in sight through the pan. */
const SPREAD = { x: 550, y: 320 };
/** The pan's loop: 200 × 100 map pixels from the centre (TE-013's). */
const LOOP = { x: 200, y: 100 };

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-037 markers: no viewport");
    return probe;
}

/** 2,000 markers of five kinds, spread on a grid about `(cx, cy)`, from ID `first`. */
function markers(cx: number, cy: number, first: number): Marker[] {
    const out: Marker[] = [];
    const columns = 50;
    const rows = MARKERS / columns;
    const stepX = (2 * SPREAD.x) / columns;
    const stepY = (2 * SPREAD.y) / rows;
    for (let k = 0; k < MARKERS; k++) {
        const x = cx - SPREAD.x + (k % columns) * stepX;
        const y = cy - SPREAD.y + Math.floor(k / columns) * stepY;
        const base = { id: first + k, name: `Marker ${k + 1}`, class: "", properties: [] };
        switch (k % 5) {
            case 0:
                out.push({ ...base, shape: "rectangle", x, y, width: 14, height: 9 });
                break;
            case 1:
                out.push({ ...base, shape: "ellipse", x, y, width: 12, height: 10 });
                break;
            case 2:
                out.push({ ...base, shape: "point", x: x + 6, y: y + 10 });
                break;
            case 3:
                out.push({
                    ...base,
                    shape: "polygon",
                    x,
                    y,
                    points: [
                        [0, 0],
                        [8, -2],
                        [14, 4],
                        [12, 12],
                        [4, 14],
                        [-2, 6],
                    ],
                });
                break;
            default:
                out.push({
                    ...base,
                    shape: "polyline",
                    x,
                    y,
                    points: [
                        [0, 0],
                        [5, 8],
                        [10, 0],
                        [15, 8],
                    ],
                });
        }
    }
    return out;
}

/**
 * Loads the reference project with a marker layer of 2,000 markers on top and zooms to `zoom`
 * (CSS pixels per map pixel), or to the live-tier threshold (about 65,536 visible cells, as
 * TE-013) when `zoom` is null. Resolves once the textures are uploaded and a frame drew them.
 */
export async function prepare(zoom: number | null): Promise<Prepared> {
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const [width, height] = [probe.canvas.width, probe.canvas.height];
    const threshold = Math.sqrt((LAYERS * width * height) / (THRESHOLD * CELL * CELL));
    const viewZoom = zoom ?? threshold / window.devicePixelRatio;

    const project = createReferenceProject();
    const map = project.maps[0]!;
    const centreX = (map.width * map.tileWidth) / 2;
    const centreY = (map.height * map.tileHeight) / 2;
    const layer = createMarkerLayer(map.nextLayerId, "Markers");
    layer.markers = markers(centreX, centreY, map.nextMarkerId);
    map.layers.push(layer);
    map.nextLayerId += 1;
    map.nextMarkerId += MARKERS;
    const session = createProjectSession(project);
    session.perMap.get(session.activeMapId)!.view = { centreX, centreY, zoom: viewZoom };
    hooks.viewPreferences.getState().set("grid", false);
    hooks.session.getState().replace(session);

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
    redrawOverlay();
    return {
        zoom: viewZoom,
        canvas: [width, height],
        sprites: probe.stats.sprites,
        markers: layer.markers.length,
    };
}

/** Redraws the overlay as its controller does: clear, then every draw layer bottom to top. */
function redrawOverlay(): void {
    const overlay = window.__ngneTest!.overlay;
    if (!overlay) throw new Error("te-037 markers: no overlay");
    const { canvas } = overlay;
    const context = canvas.getContext("2d")!;
    const session = window.__ngneTest!.session.getState().session;
    const map = session.project.maps.find((each) => each.id === session.activeMapId)!;
    const mapping = currentViewMapping();
    if (!mapping) throw new Error("te-037 markers: no view mapping");
    const size = { width: canvas.width, height: canvas.height };
    context.clearRect(0, 0, size.width, size.height);
    const frame: OverlayFrame = {
        context,
        size,
        map,
        mapping,
        cursor: null,
        theme: DEFAULT_OVERLAY_THEME,
    };
    for (const layer of overlayLayers) {
        context.save();
        try {
            layer.draw(frame);
        } finally {
            context.restore();
        }
    }
}

/**
 * Pans for `ms` milliseconds as TE-013's pan: in each animation-frame callback the view moves along
 * a slow loop, the viewport's frame is built and submitted and the overlay redrawn at once. The
 * view is moved in place without telling the store, so neither asks for a frame of its own.
 */
export function pan(ms: number): Promise<PanRecord> {
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const session = hooks.session.getState().session;
    const view = session.perMap.get(session.activeMapId)!.view;
    const origin = { x: view.centreX, y: view.centreY };
    const record: PanRecord = {
        frameMs: [],
        submitMs: [],
        overlayMs: [],
        intervalMs: [],
        rasterPaints: 0,
    };
    const paintsBefore = markerRasterPaints();
    return new Promise((resolve) => {
        let start = -1;
        let last = -1;
        const step = (now: number) => {
            const begin = performance.now();
            if (start < 0) start = now;
            const t = (now - start) / 1000;
            view.centreX = origin.x + LOOP.x * Math.sin((t * 2 * Math.PI) / 5);
            view.centreY = origin.y + LOOP.y * Math.sin((t * 4 * Math.PI) / 5);
            probe.renderNow();
            const submitted = performance.now();
            redrawOverlay();
            const end = performance.now();
            record.frameMs.push(end - begin);
            record.submitMs.push(submitted - begin);
            record.overlayMs.push(end - submitted);
            if (last >= 0) record.intervalMs.push(now - last);
            last = now;
            if (now - start >= ms) {
                view.centreX = origin.x;
                view.centreY = origin.y;
                record.rasterPaints = markerRasterPaints() - paintsBefore;
                resolve(record);
            } else {
                requestAnimationFrame(step);
            }
        };
        requestAnimationFrame(step);
    });
}
