// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { cellValue } from "../../../src/core/cells";
import { cellPatchCommand } from "../../../src/core/history";
import { createProjectSession } from "../../../src/core/model";
import type { TileLayer } from "../../../src/core/model";
import { createReferenceProject, REFERENCE } from "../../support/referenceProject";

// TE-015 benchmark page module (tests/perf/te-015-chunk.perf.ts): the reference map in the
// editor's viewport, zoomed out to the chunk tier. The page imports it into the running editor.

function viewport() {
    const probe = window.__ngneTest?.viewport;
    if (!probe) throw new Error("te-015 chunk: no viewport");
    return probe;
}

/** What the main thread did while something ran. */
export interface MainThread {
    ms: number;
    /** The longest gap between two turns of a message loop: the longest task meanwhile. */
    maxGapMs: number;
}

/** Runs `work` while a message loop measures the gaps between its turns. */
async function measure(work: () => Promise<void>): Promise<MainThread> {
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
    const start = performance.now();
    await work();
    const ms = performance.now() - start;
    running = false;
    loop.port1.close();
    return { ms, maxGapMs };
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

export interface Built extends MainThread {
    /** The chunk tier's own record of the build. */
    buildMs: number;
    maxSliceMs: number;
    texelsPerCell: number;
    chunks: number;
    sets: number;
    /** GPU bytes of the chunk textures. */
    bytes: number;
    canvas: [number, number];
}

function built(thread: MainThread): Built {
    const probe = viewport();
    const stats = probe.chunkStats();
    return {
        ...thread,
        buildMs: stats.lastBuildMs,
        maxSliceMs: stats.maxSliceMs,
        texelsPerCell: stats.texelsPerCell,
        chunks: stats.chunks,
        sets: stats.sets,
        bytes: stats.bytes,
        canvas: [probe.canvas.width, probe.canvas.height],
    };
}

/** The whole map in view: far above the live tier's limit. */
function overview(): { centreX: number; centreY: number; zoom: number } {
    const probe = viewport();
    const side = REFERENCE.width * REFERENCE.tileWidth;
    const scale = Math.min(probe.canvas.width, probe.canvas.height) / side;
    return { centreX: side / 2, centreY: side / 2, zoom: scale / window.devicePixelRatio };
}

/**
 * Opens the reference map (ENGINE §6) at 100% in the middle, as a map opens, and measures the
 * initial build in the background: from the map's opening until the chunk tier is ready. Then
 * zooms out to the whole map, in the chunk tier.
 */
export async function openReference(): Promise<Built> {
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const session = createProjectSession(createReferenceProject());
    const side = REFERENCE.width * REFERENCE.tileWidth;
    const view = session.perMap.get(session.activeMapId)!.view;
    Object.assign(view, { centreX: side / 2, centreY: side / 2, zoom: 1 });
    // The map opens and shows (TE-047 measures that); the build starts with its first frame and
    // runs in the background after it.
    const frames = probe.stats.frames;
    hooks.session.getState().replace(session);
    await until(() => probe.stats.frames > frames);
    const thread = await measure(() => until(() => probe.chunkStats().ready));
    await until(() => probe.textureIds().filter((id) => id.startsWith("ed:ts:")).length === 2);
    Object.assign(view, overview());
    probe.renderNow();
    if (probe.stats.tier !== "chunk") throw new Error("te-015 chunk: not in the chunk tier");
    return built(thread);
}

export interface Rebuilt extends Built {
    /** Frames the editor submitted during the rebuild, and the longest of them in ms. */
    frames: number;
    longestFrameMs: number;
}

/**
 * Changes a layer's opacity at overview (its set is composited again) and measures until the
 * chunk tier is ready. Meanwhile the editor draws the change in the live tier (ENGINE §4).
 */
export async function rebuild(layerIndex: number, opacity: number): Promise<Rebuilt> {
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const state = hooks.session.getState();
    const before = probe.stats.frames;
    let seen = before;
    let longestFrameMs = 0;
    const thread = await measure(async () => {
        state.session.project.maps[0]!.layers[layerIndex]!.opacity = opacity;
        state.touch();
        await until(() => {
            if (probe.stats.frames !== seen) {
                seen = probe.stats.frames;
                longestFrameMs = Math.max(longestFrameMs, probe.stats.lastDrawMs);
            }
            return probe.stats.frames > before && probe.chunkStats().ready;
        });
    });
    return { ...built(thread), frames: probe.stats.frames - before, longestFrameMs };
}

/** A seeded generator, so runs paint the same cells. */
function generator(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
}

export interface PaintRecord {
    /** Milliseconds from the command to its patch settled, per paint. */
    settleMs: number[];
    /** Milliseconds from the command to the next frame submitted, per paint. */
    frameMs: number[];
    tier: string;
}

/**
 * Paints `count` stamps of `side × side` cells on the top layer at random places, one at a time
 * as a tool stroke commits, and measures each until its chunk patch settles. The next frame is
 * submitted at once, as the editor's next animation frame would.
 */
export async function paint(count: number, side: number): Promise<PaintRecord> {
    const hooks = window.__ngneTest!;
    const probe = viewport();
    const next = generator(0x7e015 + side);
    const record: PaintRecord = { settleMs: [], frameMs: [], tier: probe.stats.tier };
    for (let n = 0; n < count; n += 1) {
        const { session, history } = hooks.session.getState();
        const map = session.project.maps[0]!;
        const layer = map.layers[REFERENCE.layers - 2] as TileLayer;
        const x0 = Math.floor(next() * (map.width - side));
        const y0 = Math.floor(next() * (map.height - side));
        const words = new Uint32Array(side * side * 3);
        let at = 0;
        for (let y = y0; y < y0 + side; y += 1) {
            for (let x = x0; x < x0 + side; x += 1) {
                words[at] = y * map.width + x;
                words[at + 1] = layer.cells.get(x, y);
                words[at + 2] = cellValue(1 + (n % 2), (x * 7 + y + n) % REFERENCE.tilesPerTileset);
                at += 3;
            }
        }
        const start = performance.now();
        history.execute(
            cellPatchCommand({
                label: "Paint",
                mapId: map.id,
                layerId: layer.id,
                width: map.width,
                words,
                cellRect: { x: x0, y: y0, width: side, height: side },
            }),
        );
        probe.renderNow();
        record.frameMs.push(performance.now() - start);
        await until(() => probe.chunkStats().pending === 0);
        record.settleMs.push(performance.now() - start);
        // Let the editor's own frame of the settled patch go by before the next paint.
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return record;
}
