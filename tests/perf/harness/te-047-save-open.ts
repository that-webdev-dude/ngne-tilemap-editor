// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { createFileDialogs } from "../../../src/app/file/dialogs";
import { createFileWorkflows } from "../../../src/app/file/workflows";
import type {
    ChosenFile,
    ProjectFileHandle,
    ProjectFilePlatform,
} from "../../../src/app/platform/projectFiles";
import { createProjectSession } from "../../../src/core/model";
import { createReferenceProject } from "../../support/referenceProject";

// TE-047 benchmark page module (tests/perf/te-047-save-open.perf.ts): Save and Open of the
// reference project (ENGINE §6's reference map, two tilesets) through the app's file workflows,
// with the worker's codec, on files in memory. Save is timed from the call to its end (the
// bytes written), with the main thread's longest task meanwhile; Open, from the empty state as
// at launch, from the call with the picked file to the frame that draws the opened map with
// both tileset textures uploaded.

function probe() {
    const viewport = window.__ngneTest?.viewport;
    if (!viewport) throw new Error("te-047 save/open: no viewport");
    return viewport;
}

/** The viewport now: none while no project is open. */
const currentViewport = () => window.__ngneTest?.viewport ?? null;
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A message loop measures the main thread, as TE-015's benchmark does: the longest gap between
// two of its turns is the longest task meanwhile.
let loop: MessageChannel | null = null;
let lastTurn = 0;
let longestGapMs = 0;

function watchTasks(): void {
    loop?.port1.close();
    const channel = new MessageChannel();
    loop = channel;
    lastTurn = performance.now();
    longestGapMs = 0;
    channel.port1.onmessage = () => {
        const now = performance.now();
        longestGapMs = Math.max(longestGapMs, now - lastTurn);
        lastTurn = now;
        if (loop === channel) channel.port2.postMessage(null);
    };
    channel.port2.postMessage(null);
}

function longestTask(): number {
    loop?.port1.close();
    loop = null;
    return Math.max(longestGapMs, performance.now() - lastTurn);
}

/** A file in memory the save writes to. */
function memoryHandle(): ProjectFileHandle & { bytes: Uint8Array | null } {
    const handle = {
        name: "reference.ngtilemap",
        bytes: null as Uint8Array | null,
        read: async () => handle.bytes ?? new Uint8Array(),
        requestRead: async () => true,
        requestWrite: async () => true,
        async write(bytes: Uint8Array<ArrayBuffer>) {
            handle.bytes = bytes;
        },
    };
    return handle;
}

const target = memoryHandle();
const platform: ProjectFilePlatform = {
    canChooseSaveTarget: () => true,
    chooseFileToOpen: async () => null,
    chooseSaveTarget: async () => target,
    download: () => {},
    hasUserActivation: () => true,
};
const errors: string[] = [];
/** The app's workflows on the app's project, with a platform of files in memory. */
const workflows = createFileWorkflows({
    platform,
    // No question is asked: every project opened here is clean.
    dialogs: createFileDialogs(),
    notices: { info: () => {}, error: (message) => errors.push(message) },
    recent: { add: async () => {}, remove: async () => {} },
});

async function texturesReady(): Promise<void> {
    const viewport = probe();
    for (;;) {
        const ids = viewport.textureIds();
        const tilesets = ids.filter((id) => id.startsWith("ed:ts:")).length;
        if (ids.includes("ed:checker") && tilesets === 2) return;
        await wait(5);
    }
}

export interface Prepared {
    canvas: [number, number];
    cells: number;
}

/** Opens the reference project and waits until its textures are uploaded. */
export async function prepare(): Promise<Prepared> {
    const project = createReferenceProject();
    window.__ngneTest!.session.getState().replace(createProjectSession(project));
    await texturesReady();
    await frame();
    const viewport = probe();
    const cells = project.maps[0]!.layers.reduce(
        (sum, layer) => sum + (layer.type === "tile" ? layer.cells.count : 0),
        0,
    );
    return { canvas: [viewport.canvas.width, viewport.canvas.height], cells };
}

export interface SaveRecord {
    totalMs: number[];
    longestTaskMs: number[];
    bytes: number;
}

/** Saves the open project `count` times, `gapMs` apart. */
export async function saves(count: number, gapMs: number): Promise<SaveRecord> {
    const record: SaveRecord = { totalMs: [], longestTaskMs: [], bytes: 0 };
    for (let k = 0; k < count; k += 1) {
        await wait(gapMs);
        await frame();
        watchTasks();
        const started = performance.now();
        const saved = await workflows.save();
        const total = performance.now() - started;
        const longest = longestTask();
        if (!saved) throw new Error(`te-047: the save failed: ${errors.join("; ")}`);
        record.totalMs.push(total);
        record.longestTaskMs.push(longest);
    }
    record.bytes = target.bytes?.length ?? 0;
    return record;
}

export interface OpenRecord {
    /** From the call to the first frame the new viewport submits. */
    firstFrameMs: number[];
    /** From the call to the frame that draws the map with both tileset textures uploaded. */
    drawnMs: number[];
    longestTaskMs: number[];
}

/**
 * Opens the file the saves wrote `count` times from the empty state, as at launch: before each
 * open the project is closed, so the viewport, its renderer and its textures are made anew
 * and the tilesets packed cold. `gapMs` apart.
 */
export async function opens(count: number, gapMs: number): Promise<OpenRecord> {
    const bytes = target.bytes;
    if (!bytes) throw new Error("te-047: save before opening");
    const record: OpenRecord = { firstFrameMs: [], drawnMs: [], longestTaskMs: [] };
    for (let k = 0; k < count; k += 1) {
        window.__ngneTest!.session.getState().close();
        while (currentViewport()) await frame();
        await wait(gapMs);
        await frame();
        const file: ChosenFile = {
            name: `reference-${k}.ngtilemap`,
            size: bytes.length,
            read: async () => bytes,
            handle: async () => null,
        };
        watchTasks();
        const started = performance.now();
        const opening = workflows.openFiles([file]);
        // Sampled once per animation frame. An idle viewport submits no frame without a
        // change, so the frame that draws the textures is the last one submitted once they are
        // there: a few frames after, or the one of the frame they were first seen in.
        let frames = 0;
        let first = 0;
        let lastFrame = 0;
        let readyTicks = -1;
        for (;;) {
            const now = await frame().then(() => performance.now());
            const viewport = currentViewport();
            if (!viewport) continue;
            if (viewport.stats.frames !== frames) {
                frames = viewport.stats.frames;
                lastFrame = now;
                if (first === 0) first = now;
            }
            const tilesets = viewport.textureIds().filter((id) => id.startsWith("ed:ts:"));
            if (tilesets.length === 2 && readyTicks < 0) readyTicks = 0;
            if (readyTicks >= 0 && first !== 0 && ++readyTicks > 5) break;
        }
        if (!(await opening)) throw new Error(`te-047: the open failed: ${errors.join("; ")}`);
        record.longestTaskMs.push(longestTask());
        record.firstFrameMs.push(first - started);
        record.drawnMs.push(lastFrame - started);
    }
    return record;
}
