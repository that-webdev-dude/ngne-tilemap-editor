// Declares `window.__ngneTest` and the minimap hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import type {} from "../../../src/app/minimap/mountMinimap";
import { viewportSize } from "../../../src/app/view/viewportSize";
import { cellValue } from "../../../src/core/cells";
import {
    compositeMap,
    mapPixels,
    minimapRequest,
    minimapViewRect,
} from "../../../src/core/compositor";
import type { Rect } from "../../../src/core/compositor";
import { cellPatchCommand } from "../../../src/core/history";
import { resizeMapCommand } from "../../../src/core/maps";
import { createMapSession } from "../../../src/core/model";
import type { Project, ProjectMap, TileLayer } from "../../../src/core/model";
import { createConformanceProject } from "../../support/conformanceProject";
import { createReferenceProject } from "../../support/referenceProject";

// TE-057 page module: the spec imports it into the running editor (`import("/tests/e2e/harness/
// te-057-page.ts")`), so it shares the app's stores. It opens a project, reads the minimap's
// canvas back and compares it with `core/compositor`'s composite of the whole map at the
// minimap's size, and measures the main thread while the minimap redraws.

/** An opaque background: the canvas keeps straight RGBA exactly only where alpha is 255. */
const BACKGROUND = 0x3b2b5eff;

function hooks() {
    const value = window.__ngneTest;
    if (!value) throw new Error("te-057: no test hooks");
    return value;
}

function probe() {
    const minimap = hooks().minimap;
    if (!minimap) throw new Error("te-057: the minimap is not mounted");
    return minimap;
}

function project(): Project {
    return hooks().session.getState().session.project;
}

function activeMap(): ProjectMap {
    const { session } = hooks().session.getState();
    const found = session.project.maps.find((each) => each.id === session.activeMapId);
    if (!found) throw new Error("te-057: no active map");
    return found;
}

function show(source: Project, map: ProjectMap): void {
    map.backgroundColor = BACKGROUND;
    hooks()
        .session.getState()
        .replace({
            project: source,
            activeMapId: map.id,
            perMap: new Map([[map.id, createMapSession(map)]]),
        });
}

/** Opens the TE-055 reference export project on its layers map (192 × 128 map pixels). */
export function openLayersMap(): { width: number; height: number } {
    const source = createConformanceProject();
    const map = source.maps.find((each) => each.exportName === "layers")!;
    show(source, map);
    return mapPixels(map);
}

/** Opens the reference project of ENGINE §6 (256 × 256 cells of 16 px, 8 layers). */
export function openReferenceMap(): { width: number; height: number } {
    const source = createReferenceProject();
    show(source, source.maps[0]!);
    return mapPixels(source.maps[0]!);
}

export interface ImageReport {
    width: number;
    height: number;
    /** Pixels whose RGBA differs from the composite. */
    wrong: number;
    /** Distinct colours of the reference: more than one shows the map was drawn. */
    colours: number;
}

/** The minimap's canvas compared with the composite of the active map at its size. */
export function compareImage(): ImageReport {
    const { canvas, size } = probe();
    const map = activeMap();
    const context = canvas.getContext("2d")!;
    const read = context.getImageData(0, 0, size.width, size.height).data;
    const expected = compositeMap(project(), map, minimapRequest(map, size, 0, size.height));
    let wrong = 0;
    const colours = new Set<number>();
    for (let i = 0; i < expected.data.length; i += 4) {
        let same = true;
        for (let c = 0; c < 4; c += 1) if (read[i + c] !== expected.data[i + c]) same = false;
        if (!same) wrong += 1;
        colours.add(
            ((expected.data[i]! << 16) | (expected.data[i + 1]! << 8) | expected.data[i + 2]!) >>>
                0,
        );
    }
    return { width: size.width, height: size.height, wrong, colours: colours.size };
}

/** Whether the minimap has drawn the active map and has nothing left to do. */
export function idle(): boolean {
    const minimap = hooks().minimap;
    if (!minimap) return false;
    const stats = minimap.stats();
    return !stats.busy && !stats.pending && minimap.size.width > 0;
}

/** Sets the active map's view: centre in map pixels, zoom in CSS pixels per map pixel. */
export function setView(centreX: number, centreY: number, zoom: number): void {
    const store = hooks().session;
    const { session } = store.getState();
    const map = activeMap();
    const current = session.perMap.get(map.id) ?? createMapSession(map);
    session.perMap.set(map.id, { ...current, view: { centreX, centreY, zoom } });
    store.getState().touch();
}

export function view(): { centreX: number; centreY: number; zoom: number } {
    const map = activeMap();
    return { ...hooks().session.getState().session.perMap.get(map.id)!.view };
}

export interface FrameReport {
    /** The rectangle the minimap draws, in image pixels. */
    frame: Rect | null;
    /** The rectangle of the view, unrounded, in image pixels. */
    expected: Rect | null;
    /** The frame element's box relative to the canvas, in CSS pixels. */
    box: Rect | null;
    dpr: number;
}

/** The viewport's rectangle as the minimap draws it and as the view puts it. */
export function frameReport(): FrameReport {
    const minimap = probe();
    const map = activeMap();
    const expected = minimapViewRect(
        view(),
        viewportSize.size,
        window.devicePixelRatio,
        mapPixels(map),
        minimap.size,
    );
    const element = document.querySelector<HTMLElement>(".minimap-panel__frame");
    const canvasBox = minimap.canvas.getBoundingClientRect();
    const frameBox = element && !element.hidden ? element.getBoundingClientRect() : null;
    return {
        frame: minimap.frame,
        expected,
        box: frameBox
            ? {
                  x: frameBox.left - canvasBox.left,
                  y: frameBox.top - canvasBox.top,
                  width: frameBox.width,
                  height: frameBox.height,
              }
            : null,
        dpr: window.devicePixelRatio,
    };
}

/** A cell of the active map's first tile layer set to tile `tile` of slot 1, through the history. */
function paint(x: number, y: number, tile: number): void {
    const map = activeMap();
    const layer = map.layers.find((each) => each.type === "tile") as TileLayer;
    const words = Uint32Array.of(y * map.width + x, layer.cells.get(x, y), cellValue(1, tile, 0));
    hooks()
        .session.getState()
        .history.execute(
            cellPatchCommand({
                label: "Stamp Brush",
                mapId: map.id,
                layerId: layer.id,
                width: map.width,
                words,
                cellRect: { x, y, width: 1, height: 1 },
            }),
        );
}

function frame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitIdle(redrawsAfter: number): Promise<void> {
    const started = performance.now();
    while (!(idle() && probe().stats().redraws > redrawsAfter)) {
        if (performance.now() - started > 10_000) throw new Error("te-057: no redraw");
        await frame();
    }
}

export interface EditReport extends ImageReport {
    /** From the step to the image on the canvas, in milliseconds. */
    ms: number;
    redraws: number;
}

/**
 * Paints a cell once the minimap is idle and its last redraw began more than 500 ms ago, and
 * times the step to the redrawn image.
 */
export async function editAndTime(x: number, y: number, tile: number): Promise<EditReport> {
    const minimap = probe();
    for (;;) {
        const stats = minimap.stats();
        const last = stats.starts.at(-1) ?? -Infinity;
        if (idle() && performance.now() - last > 600) break;
        await frame();
    }
    const before = minimap.stats().redraws;
    const started = performance.now();
    paint(x, y, tile);
    await waitIdle(before);
    const stats = minimap.stats();
    return { ...compareImage(), ms: stats.lastEnd - started, redraws: stats.redraws - before };
}

export interface BurstReport extends ImageReport {
    /** Start times of the redraws after the first edit, from it, in milliseconds. */
    starts: number[];
    edits: number;
    /** From the last step to the image on the canvas, in milliseconds. */
    lastShownMs: number;
    /** How long the last redraw took, start to image. */
    lastRedrawMs: number;
}

/** Paints `count` cells `everyMs` apart, then waits until the minimap is idle. */
export async function editBurst(count: number, everyMs: number): Promise<BurstReport> {
    const minimap = probe();
    while (!idle()) await frame();
    const first = performance.now();
    let lastEdit = first;
    for (let i = 0; i < count; i += 1) {
        lastEdit = performance.now();
        paint(i % 8, Math.floor(i / 8), (i % 3) + 1);
        await new Promise((resolve) => setTimeout(resolve, everyMs));
    }
    while (!idle()) await frame();
    const stats = minimap.stats();
    const starts = stats.starts.filter((start) => start >= first).map((start) => start - first);
    return {
        ...compareImage(),
        starts,
        edits: count,
        lastShownMs: stats.lastEnd - lastEdit,
        lastRedrawMs: stats.lastEnd - stats.starts.at(-1)!,
    };
}

export interface MainThreadRecord {
    /** Durations of the `longtask` entries (tasks over 50 ms) observed meanwhile. */
    longTasks: number[];
    /** The longest gap between two steps of a message loop on the main thread. */
    maxGapMs: number;
    /** The longest slice of the redraw, as the minimap timed it (0 for the control). */
    maxSliceMs: number;
    slices: number;
    ms: number;
}

/**
 * Measures the main thread (TE-010's method) while the minimap redraws the active map in full,
 * or while it runs `controlMs` of work in one task (the positive control).
 */
export async function measureRedraw(controlMs = 0): Promise<MainThreadRecord> {
    const minimap = probe();
    while (!idle()) await frame();
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: "longtask" });
    const loop = new MessageChannel();
    let running = true;
    let last = performance.now();
    let maxGapMs = 0;
    loop.port1.onmessage = () => {
        const now = performance.now();
        maxGapMs = Math.max(maxGapMs, now - last);
        last = now;
        if (running) loop.port2.postMessage(null);
    };
    loop.port2.postMessage(null);
    const before = minimap.stats();
    const started = performance.now();
    if (controlMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const until = performance.now() + controlMs;
        while (performance.now() < until) {
            // The control: one long task.
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    } else {
        minimap.redrawNow();
        await waitIdle(before.redraws);
    }
    const ms = performance.now() - started;
    await new Promise<void>((resolve) => {
        running = false;
        const step = loop.port1.onmessage!;
        loop.port1.onmessage = (event) => {
            step.call(loop.port1, event);
            resolve();
        };
    });
    loop.port1.close();
    // Long-task entries arrive after the task; give the observer a frame.
    await frame();
    longTasks.push(...observer.takeRecords().map((entry) => entry.duration));
    observer.disconnect();
    const after = minimap.stats();
    return {
        longTasks,
        maxGapMs,
        maxSliceMs: controlMs > 0 ? 0 : after.lastMaxSliceMs,
        slices: after.slices - before.slices,
        ms,
    };
}

export interface ResizeReport {
    /** The frame right after the step, before the redraw; and where the shown image puts the view. */
    staleFrame: Rect | null;
    staleExpected: Rect | null;
    /** The same after the redraw, against the resized map. */
    frame: Rect | null;
    expected: Rect | null;
    image: ImageReport;
}

/**
 * Doubles the active map's width through the history and reads the frame before the minimap's
 * redraw has run (a microtask later: its slices are tasks) and after it.
 */
export async function resizeAndReport(): Promise<ResizeReport> {
    const minimap = probe();
    while (!idle()) await frame();
    const map = activeMap();
    const oldPixels = mapPixels(map);
    const oldSize = { ...minimap.size };
    const before = minimap.stats().redraws;
    const command = resizeMapCommand(project(), map.id, {
        width: map.width * 2,
        height: map.height,
        offsetX: 0,
        offsetY: 0,
    })!;
    hooks().session.getState().history.execute(command);
    await Promise.resolve();
    const staleFrame = minimap.frame;
    const staleExpected = minimapViewRect(
        view(),
        viewportSize.size,
        window.devicePixelRatio,
        oldPixels,
        oldSize,
    );
    await waitIdle(before);
    const after = frameReport();
    return {
        staleFrame,
        staleExpected,
        frame: after.frame,
        expected: after.expected,
        image: compareImage(),
    };
}
