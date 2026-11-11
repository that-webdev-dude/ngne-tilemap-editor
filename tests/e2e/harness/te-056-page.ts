// Declares `window.__ngneTest` and the preview hooks of the app.
import type {} from "../../../src/app/testing/testHooks";
import type {} from "../../../src/app/preview/mountPreview";
import { cellValue } from "../../../src/core/cells";
import { compositeMap } from "../../../src/core/compositor";
import { cellPatchCommand } from "../../../src/core/history";
import {
    createMapSession,
    drawnOpacity,
    effectiveValues,
    walkLayers,
} from "../../../src/core/model";
import type { Project, ProjectMap, TileLayer } from "../../../src/core/model";
import { encodePng } from "../../../src/core/sprite/png";
import { readUpdateSource, updateFromSourceCommand } from "../../../src/core/tileset";
import { compareImages } from "../../support/conformance";
import type { ImageComparison, Rgba } from "../../support/conformance";
import { createConformanceProject } from "../../support/conformanceProject";

// TE-056 page module: the spec imports it into the running editor (`import("/tests/e2e/harness/
// te-056-page.ts")`), so it shares the app's stores. It opens the TE-055 reference export
// project on its layers map (an image layer, a parallax layer, a group with opacity, large
// tiles), reads the preview's frames back (`probe.onFrame`) and compares them with the
// `core/compositor` reference of the same view: the conformance reference of SPEC §10.3.

/** The map's background colour (opaque); no texel of the project has it. */
export const CLEAR = 0x3b2b5e;
const OPAQUE = 255;
const MAP = "layers";

function hooks() {
    const value = window.__ngneTest;
    if (!value) throw new Error("te-056: no test hooks");
    return value;
}

function probe() {
    const preview = hooks().preview;
    if (!preview) throw new Error("te-056: the preview is not mounted");
    return preview;
}

function project(): Project {
    return hooks().session.getState().session.project;
}

function map(): ProjectMap {
    const found = project().maps.find((each) => each.exportName === MAP);
    if (!found) throw new Error("te-056: no layers map");
    return found;
}

function layerId(name: string): number {
    for (const { layer } of walkLayers(map().layers)) if (layer.name === name) return layer.id;
    throw new Error(`te-056: no layer ${name}`);
}

/**
 * Opens the reference export project on its layers map, with an opaque background and tile 0 of
 * the even tileset animated (itself for 100 ms, then tile 1 for 100 ms).
 */
export function openProject(): { width: number; height: number } {
    const source = createConformanceProject();
    const even = source.tilesets.find((tileset) => tileset.exportName === "even")!;
    even.tiles[0]!.animation = [
        { tile: 0, ms: 100 },
        { tile: 1, ms: 100 },
    ];
    const layers = source.maps.find((each) => each.exportName === MAP)!;
    layers.backgroundColor = ((CLEAR << 8) | OPAQUE) >>> 0;
    const store = hooks().session;
    store.getState().replace({
        project: source,
        activeMapId: layers.id,
        perMap: new Map([[layers.id, createMapSession(layers)]]),
    });
    return { width: layers.width * layers.tileWidth, height: layers.height * layers.tileHeight };
}

/** Moves the viewport's centre on the layers map, in map pixels. */
export function setViewCentre(x: number, y: number): void {
    const store = hooks().session;
    const { session } = store.getState();
    const current = session.perMap.get(map().id) ?? createMapSession(map());
    session.perMap.set(map().id, { ...current, view: { ...current.view, centreX: x, centreY: y } });
    store.getState().touch();
}

/** Makes layer `name` the active layer. */
export function setActiveLayer(name: string): void {
    const store = hooks().session;
    const { session } = store.getState();
    const current = session.perMap.get(map().id) ?? createMapSession(map());
    session.perMap.set(map().id, { ...current, activeLayerId: layerId(name) });
    store.getState().touch();
}

/** Resolves with the readback of the preview's next frame; `wake` asks for one. */
function nextFrame(wake: boolean): Promise<Rgba> {
    const preview = probe();
    return new Promise((resolve) => {
        preview.onFrame = (read) => {
            preview.onFrame = null;
            const image = read();
            resolve({ width: image.width, height: image.height, data: image.data });
        };
        if (wake) preview.wake();
    });
}

/** The camera of the preview (top-left, map pixels) for a view of `width × height`. */
function cameraOf(width: number, height: number): { x: number; y: number } {
    const view = hooks().session.getState().session.perMap.get(map().id)!.view;
    return {
        x: Math.round(view.centreX - width / 2),
        y: Math.round(view.centreY - height / 2),
    };
}

/**
 * The `core/compositor` reference of the preview's view: the map at scale 1 from the camera,
 * over its background, with only the layers `names` when given. As in TE-055, each layer drawn
 * translucently over a pixel allows 1 per channel, 2 where the texel's alpha is partial too.
 */
function reference(
    width: number,
    height: number,
    names: readonly string[] | null,
): { expected: Rgba; tolerant: Uint8Array; drawn: number } {
    const source = project();
    const shown = map();
    const camera = cameraOf(width, height);
    const unit = { texels: 1, pixels: 1 };
    const request = {
        x: camera.x,
        y: camera.y,
        width,
        height,
        scaleX: unit,
        scaleY: unit,
        viewCentre: { x: camera.x + width / 2, y: camera.y + height / 2 },
        ...(names ? { layerIds: new Set(names.map(layerId)) } : {}),
    };
    const expected = compositeMap(source, shown, { ...request, background: true });
    const tolerant = new Uint8Array(width * height);
    for (const { layer, ancestors } of walkLayers(shown.layers)) {
        if (layer.type !== "tile" && layer.type !== "image") continue;
        if (names && !names.includes(layer.name)) continue;
        const values = effectiveValues(layer, ancestors);
        if (!values.visible) continue;
        const opacity = drawnOpacity(layer, ancestors, values);
        const alone = compositeMap(source, shown, {
            ...request,
            layerIds: new Set([layer.id]),
            background: false,
        });
        for (let i = 0; i < tolerant.length; i += 1) {
            const alpha = alone.data[i * 4 + 3]!;
            if (alpha === 0 || alpha === OPAQUE) continue;
            const both = opacity < OPAQUE && alpha < opacity - 1;
            tolerant[i] = tolerant[i]! + (both ? 2 : 1);
        }
    }
    let drawn = 0;
    for (let i = 0; i < width * height; i += 1) {
        const o = i * 4;
        const rgb =
            (expected.data[o]! << 16) | (expected.data[o + 1]! << 8) | expected.data[o + 2]!;
        if (rgb !== CLEAR) drawn += 1;
    }
    return { expected, tolerant, drawn };
}

export interface FrameReport extends ImageComparison {
    width: number;
    height: number;
    /** Pixels of the reference that are not the background. */
    drawn: number;
}

function report(image: Rgba, names: readonly string[] | null): FrameReport {
    const { expected, tolerant, drawn } = reference(image.width, image.height, names);
    return {
        ...compareImages(image, expected, tolerant),
        width: image.width,
        height: image.height,
        drawn,
    };
}

/** Compares the preview's next frame with the reference, with only the layers `names` if given. */
export async function compareNextFrame(names: string[] | null = null): Promise<FrameReport> {
    return report(await nextFrame(true), names);
}

/**
 * Writes `value` into cell (`x`, `y`) of Ground through the history, as a stroke's command, and
 * compares the very next preview frame (none asked for besides the command's) with the
 * reference. `cell` is the readback's pixels of the cell, row by row, before and after.
 */
export async function paintAndCompare(
    x: number,
    y: number,
    tile: number,
): Promise<FrameReport & { changed: boolean }> {
    const before = await nextFrame(true);
    const shown = map();
    const ground = shown.layers.find((layer) => layer.name === "Ground") as TileLayer;
    const value = cellValue(1, tile, 0);
    const words = Uint32Array.of(y * shown.width + x, ground.cells.get(x, y), value);
    const frame = nextFrame(false);
    hooks()
        .session.getState()
        .history.execute(
            cellPatchCommand({
                label: "Stamp Brush",
                mapId: shown.id,
                layerId: ground.id,
                width: shown.width,
                words,
                cellRect: { x, y, width: 1, height: 1 },
            }),
        );
    const after = await frame;
    // The cell's pixels in the readback: the camera's offset from the map's corner.
    const camera = cameraOf(after.width, after.height);
    let changed = false;
    for (let py = 0; py < shown.tileHeight; py += 1) {
        for (let px = 0; px < shown.tileWidth; px += 1) {
            const cx = x * shown.tileWidth + px - camera.x;
            const cy = y * shown.tileHeight + py - camera.y;
            const o = (cy * after.width + cx) * 4;
            for (let c = 0; c < 3; c += 1)
                if (after.data[o + c] !== before.data[o + c]) changed = true;
        }
    }
    return { ...report(after, null), changed };
}

/**
 * Updates the even tileset from its source (TE-028's Update Tileset from Source), with its red
 * channel inverted.
 */
export async function updateEvenTileset(): Promise<void> {
    const current = project();
    const tileset = current.tilesets.find((each) => each.exportName === "even")!;
    const { width, height, data } = tileset.pixels;
    const recoloured = new Uint8ClampedArray(data);
    for (let i = 0; i < recoloured.length; i += 4) {
        if (recoloured[i + 3]! > 0) recoloured[i] = 255 - recoloured[i]!;
    }
    const png = encodePng({ width, height, data: recoloured });
    const source = await readUpdateSource(current, tileset.id, { kind: "image", png });
    const command = updateFromSourceCommand(current, tileset.id, source);
    if (!command) throw new Error("te-056: the update changes nothing");
    hooks().session.getState().history.execute(command);
}

/** Readbacks of the next `count` frames the preview runs on its own (no wake). */
export async function frameHashes(count: number): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < count; i += 1) {
        const image = await nextFrame(false);
        let hash = 0;
        for (let o = 0; o < image.data.length; o += 1) hash = (hash * 31 + image.data[o]!) | 0;
        out.push(`${hash}`);
    }
    return out;
}

/** Makes the page look hidden (or visible again) to `document.visibilityState`. */
export function setPageHidden(hidden: boolean): void {
    Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (hidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * Updates the even tileset and hides the window as soon as the preview has asked to pop its
 * map scene, before a tick applies the pop; then shows the window again.
 */
export async function updateWhileHiding(): Promise<void> {
    const preview = probe();
    await updateEvenTileset();
    await new Promise<void>((resolve, reject) => {
        const started = performance.now();
        const poll = () => {
            if (preview.mountedKey === null) {
                setPageHidden(true);
                resolve();
            } else if (performance.now() - started > 10_000) {
                reject(new Error("te-056: the scene was never popped"));
            } else {
                setTimeout(poll, 0);
            }
        };
        poll();
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    setPageHidden(false);
}
