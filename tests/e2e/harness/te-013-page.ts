// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { activateMap, closeMapTab, mapTabsStore } from "../../../src/app/tabs/tabs";
import { compositeMap } from "../../../src/core/compositor";
import { cellValue } from "../../../src/core/cells";
import { createMap, createProjectSession } from "../../../src/core/model";
import type { TileLayer } from "../../../src/core/model";
import type { Ratio } from "../../../src/core/compositor";
import { checkerColourAt } from "../../../src/engine/viewport/checker";
import { readCanvas } from "../../../src/engine/testing/readCanvas";
import { createViewportSceneProject } from "../../support/viewportScene";
import type { ViewportSceneOptions } from "../../support/viewportScene";

// TE-013 page module: the specs import it into the running editor (`import("/tests/e2e/harness/
// te-013-page.ts")`), so it shares the app's stores. It loads the scene of
// tests/support/viewportScene.ts, places the view so that device pixels and the compositor's
// texels coincide, and compares the canvas with `core/compositor`.

export interface SceneRequest extends ViewportSceneOptions {
    /** CSS pixels per map pixel; the device scale is `zoom × devicePixelRatio`. */
    zoom: number;
    /** Device pixels the map's top-left corner lies from the canvas's top-left corner. */
    originX: number;
    originY: number;
}

export interface Geometry {
    width: number;
    height: number;
    scale: number;
    centreX: number;
    centreY: number;
}

function probe() {
    const viewport = window.__ngneTest?.viewport;
    if (!viewport) throw new Error("te-013: no viewport probe");
    return viewport;
}

/** Replaces the project with the scene and puts the view where `request` says. */
export function loadScene(request: SceneRequest): Geometry {
    const canvas = probe().canvas;
    const { width, height } = canvas;
    const scale = request.zoom * window.devicePixelRatio;
    // The map's top-left corner at (originX, originY) of the canvas: centre·scale − size/2 =
    // −origin, so the first canvas pixel lies on a whole device pixel of the compositor's grid.
    const centreX = (width / 2 - request.originX) / scale;
    const centreY = (height / 2 - request.originY) / scale;
    // The far layer's shift is a whole number of map pixels: parallax 0.5 of a distance of 8.
    const project = createViewportSceneProject({
        background: request.background,
        parallaxOriginX: centreX - 8,
        parallaxOriginY: centreY - 6,
    });
    const hooks = window.__ngneTest!;
    const session = createProjectSession(project);
    session.perMap.get(session.activeMapId)!.view = {
        centreX,
        centreY,
        zoom: request.zoom,
    };
    hooks.session.getState().replace(session);
    return { width, height, scale, centreX, centreY };
}

/** The textures a frame of the scene needs, for the specs to wait for. */
export const SCENE_TEXTURES = ["ed:checker"] as const;

export function textureIds(): string[] {
    return probe().textureIds();
}

export function frames(): number {
    return probe().stats.frames;
}

function themeColour(name: string): number {
    const text = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return parseInt(text.replace("#", ""), 16);
}

/** A ratio of integers for `scale`, with the smallest denominator of 1, 2, 4 or 8. */
function ratioOf(scale: number): Ratio {
    for (const pixels of [1, 2, 4, 8]) {
        const texels = scale * pixels;
        if (Math.abs(texels - Math.round(texels)) < 1e-9)
            return { texels: Math.round(texels), pixels };
    }
    throw new Error(`te-013: scale ${scale} is not a ratio of small integers`);
}

export interface Comparison {
    /** Device pixels compared: those of the map rectangle on the canvas, without the ties. */
    compared: number;
    /** Largest per-channel difference. */
    maxDiff: number;
    /** Pixels differing by more than `tolerance` in some channel. */
    mismatches: number;
    /** The first mismatches: x, y, expected, actual. */
    first: { x: number; y: number; expected: number[]; actual: number[] }[];
    /** Pixel counts by channel difference, 0 up to 4. */
    histogram: number[];
    /** Pixels of the map rectangle left out: their centre lies on the edge between two map pixels. */
    ties: number;
    /** The canvas size in device pixels. */
    size: { width: number; height: number };
    /** The workspace colour and the canvas pixel at the far corner, outside the map. */
    outside: { expected: number[]; actual: number[] };
}

/**
 * Submits a frame and reads the canvas in the same task, then compares the map's rectangle with
 * `core/compositor` over the checkerboard (or the workspace colour outside the map). With
 * `perturb` the expectation is wrong on purpose: the specs' control that the comparison sees it.
 */
export function compare(geometry: Geometry, tolerance: number, perturb = false): Comparison {
    const viewport = probe();
    if (!viewport.renderNow()) throw new Error("te-013: the renderer did not submit a frame");
    const image = readCanvas(viewport.canvas);
    const session = window.__ngneTest!.session.getState().session;
    const project = session.project;
    const map = project.maps[0]!;
    const { width, height, scale, centreX, centreY } = geometry;

    // The control: the expected image is made from a map whose cell (1, 0) has another
    // orientation than the one drawn.
    const cells = (map.layers[0] as TileLayer).cells;
    const drawn = cells.get(1, 0);
    if (perturb) cells.set(1, 0, cellValue(1, 1, 3));

    const ratio = ratioOf(scale);
    const x0 = Math.round(centreX * scale - width / 2);
    const y0 = Math.round(centreY * scale - height / 2);
    const composite = compositeMap(project, map, {
        x: x0,
        y: y0,
        width,
        height,
        scaleX: ratio,
        scaleY: ratio,
        viewCentre: { x: centreX, y: centreY },
    });
    if (perturb) cells.set(1, 0, drawn);

    const preferences = window.__ngneTest!.preferences.get("checkerboard");
    const checker = {
        a: themeColour("--check-a"),
        b: themeColour("--check-b"),
        size: preferences.size,
    };
    const workspace = themeColour("--bg-workspace");

    // The map rectangle on the canvas, in whole device pixels.
    const left = Math.max(0, -x0);
    const top = Math.max(0, -y0);
    const right = Math.min(width, Math.round(map.width * map.tileWidth * scale) - x0);
    const bottom = Math.min(height, Math.round(map.height * map.tileHeight * scale) - y0);

    const result: Comparison = {
        compared: 0,
        maxDiff: 0,
        mismatches: 0,
        first: [],
        histogram: [0, 0, 0, 0, 0],
        ties: 0,
        size: { width, height },
        outside: { expected: [], actual: [] },
    };
    // What the compositor gives for the device pixel (x, y), over the checkerboard.
    const expectedAt = (x: number, y: number): number[] => {
        const under = checkerColourAt(
            checker,
            Math.floor(((2 * (x + x0) + 1) * ratio.pixels) / (2 * ratio.texels)),
            Math.floor(((2 * (y + y0) + 1) * ratio.pixels) / (2 * ratio.texels)),
        );
        const at = (y * width + x) * 4;
        const alpha = composite.data[at + 3]! / 255;
        return [0, 1, 2].map((channel) => {
            const base = (under >>> (16 - 8 * channel)) & 255;
            return Math.round(composite.data[at + channel]! * alpha + base * (1 - alpha));
        });
    };
    // A device pixel whose centre lies exactly on the edge between two map pixels is not
    // compared: the sampler's choice there is undefined, and each layer's quad may take a
    // different side (at scale 1.25 every fifth row and column is one). The compositor takes the
    // later map pixel. Every texel is still sampled by other, unambiguous device pixels.
    const tie = (n: number): boolean => ((2 * n + 1) * ratio.pixels) % (2 * ratio.texels) === 0;

    for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
            if (tie(x + x0) || tie(y + y0)) {
                result.ties += 1;
                continue;
            }
            const actual = [0, 1, 2].map((channel) => image.data[(y * width + x) * 4 + channel]!);
            const expected = expectedAt(x, y);
            const diff = Math.max(...expected.map((value, i) => Math.abs(value - actual[i]!)));
            result.compared += 1;
            result.maxDiff = Math.max(result.maxDiff, diff);
            result.histogram[Math.min(diff, 4)] = result.histogram[Math.min(diff, 4)]! + 1;
            if (diff > tolerance) {
                result.mismatches += 1;
                if (result.first.length < 5) result.first.push({ x, y, expected, actual });
            }
        }
    }
    const corner = ((height - 1) * width + (width - 1)) * 4;
    result.outside = {
        expected: [(workspace >>> 16) & 255, (workspace >>> 8) & 255, workspace & 255],
        actual: [image.data[corner]!, image.data[corner + 1]!, image.data[corner + 2]!],
    };
    return result;
}

/** Adds a map that uses only tileset slot 1 and an empty map; returns their IDs. */
export function addMaps(): { partial: string; empty: string; first: string } {
    const hooks = window.__ngneTest!;
    const { session } = hooks.session.getState();
    const first = session.activeMapId;
    const partial = createMap({ name: "Partial", width: 4, height: 4 });
    (partial.layers[0] as TileLayer).cells.set(0, 0, cellValue(1, 0));
    const empty = createMap({ name: "Empty", width: 4, height: 4 });
    session.project.maps.push(partial, empty);
    hooks.session.getState().touch();
    return { partial: partial.id, empty: empty.id, first };
}

/** Shows a map in its tab and closes every other tab (TE-031): it is the only open map. */
export function showMap(id: string): void {
    activateMap(id);
    for (const other of mapTabsStore.getState().open) if (other !== id) closeMapTab(other);
}

/** The IDs of the tilesets of the project, in list order. */
export function tilesetIds(): string[] {
    return window.__ngneTest!.session.getState().session.project.tilesets.map((t) => t.id);
}
