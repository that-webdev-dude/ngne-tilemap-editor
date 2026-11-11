// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import { createExportDialogs } from "../../../src/app/export/dialogs";
import { createExportPipeline } from "../../../src/app/export/exportProject";
import type { ExportFolderHandle, ExportPlatform } from "../../../src/app/platform/exportFiles";
import { createProjectSession } from "../../../src/core/model";
import { createReferenceProject } from "../../support/referenceProject";

// TE-053 benchmark page module (tests/perf/te-053-export.perf.ts): export of the reference
// project (ENGINE §6's reference map, two tilesets) through the app's export pipeline and the
// worker, into a folder in memory. Each export is timed from the call to its end (every file in
// place), with the main thread's longest task meanwhile. A fresh folder each run, so every file
// is written; then the same export again into the full folder, where every file is unchanged.

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

/** A folder in memory; `files` holds what was written. */
function memoryFolder(): ExportFolderHandle & { files: Map<string, Uint8Array> } {
    const files = new Map<string, Uint8Array>();
    return {
        name: "reference-export",
        stored: null,
        files,
        canWrite: async () => true,
        requestWrite: async () => true,
        existing: async (names) => names.filter((name) => files.has(name)),
        read: async (name) => files.get(name) ?? null,
        async write(name, bytes) {
            files.set(name, bytes);
        },
        exists: async () => true,
    };
}

let folder = memoryFolder();
const platform: ExportPlatform = {
    canChooseFolder: () => true,
    chooseFolder: async () => folder,
    folderFrom: () => null,
    download: () => {},
    hasUserActivation: () => true,
};
const errors: string[] = [];
/**
 * The app's pipeline and worker on the app's project, with a folder in memory. A pipeline
 * keeps the folder it chose for the project, so each run makes a new one, which chooses
 * `folder` again; nothing is stored.
 */
const newPipeline = () =>
    createExportPipeline({
        platform,
        storage: { load: async () => null, save: async () => {} },
        dialogs: createExportDialogs(),
        notices: { info: () => {}, error: (message) => errors.push(message) },
    });

export interface Prepared {
    cells: number;
}

/** Opens the reference project. */
export async function prepare(): Promise<Prepared> {
    const project = createReferenceProject();
    window.__ngneTest!.session.getState().replace(createProjectSession(project));
    await frame();
    const cells = project.maps[0]!.layers.reduce(
        (sum, layer) => sum + (layer.type === "tile" ? layer.cells.count : 0),
        0,
    );
    return { cells };
}

export interface ExportRecord {
    /** Into an empty folder: every file written. */
    totalMs: number[];
    longestTaskMs: number[];
    /** Again into the full folder: every file compared and found unchanged. */
    unchangedTotalMs: number[];
    unchangedLongestTaskMs: number[];
    files: number;
    bytes: number;
}

async function timed(
    pipeline: ReturnType<typeof newPipeline>,
): Promise<{ total: number; longest: number }> {
    await frame();
    watchTasks();
    const started = performance.now();
    const exported = await pipeline.exportProject();
    const total = performance.now() - started;
    const longest = longestTask();
    if (!exported) throw new Error(`te-053: the export failed: ${errors.join("; ")}`);
    return { total, longest };
}

/** Exports the open project `count` times into a fresh folder and again, `gapMs` apart. */
export async function exports(count: number, gapMs: number): Promise<ExportRecord> {
    const record: ExportRecord = {
        totalMs: [],
        longestTaskMs: [],
        unchangedTotalMs: [],
        unchangedLongestTaskMs: [],
        files: 0,
        bytes: 0,
    };
    for (let k = 0; k < count; k += 1) {
        folder = memoryFolder();
        const pipeline = newPipeline();
        await wait(gapMs);
        const written = await timed(pipeline);
        record.totalMs.push(written.total);
        record.longestTaskMs.push(written.longest);
        await wait(gapMs);
        const unchanged = await timed(pipeline);
        record.unchangedTotalMs.push(unchanged.total);
        record.unchangedLongestTaskMs.push(unchanged.longest);
    }
    record.files = folder.files.size;
    record.bytes = [...folder.files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    return record;
}
