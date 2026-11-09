// Declares `window.__ngneTest`, the development-only test hook of the app.
import type {} from "../../../src/app/testing/testHooks";
import {
    AUTOSAVE_MEASURE,
    AUTOSAVE_STORED_MARK,
    AUTOSAVE_THUMBNAIL_MEASURE,
} from "../../../src/app/autosave/autosave";
import type { Command } from "../../../src/core/history";
import { createProjectSession } from "../../../src/core/model";
import type { TileLayer } from "../../../src/core/model";
import { createReferenceProject } from "../../support/referenceProject";

// TE-048 benchmark page module (tests/perf/te-048-autosave.perf.ts): the app's autosave of the
// reference project (ENGINE §6's reference map, two tilesets) after one edit of a cell. Each run
// opens the reference project afresh, edits a cell and waits for the first snapshot (the whole
// project: every map entry and both tilesets' pixels), then edits another cell and waits for
// the next one (that map's entry only). Over each snapshot, from just before its delay ends to
// the moment its record is stored, the main thread's longest task is measured; the page's own
// part of the snapshot (taking the project) is the User Timing measure "ngne-autosave".

/** Starts watching this long before the 2 s delay of autosave ends. */
const LEAD_MS = 300;

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

/** When the newest snapshot was stored (its User Timing mark), or -1 before any. */
function storedAt(): number {
    return performance.getEntriesByName(AUTOSAVE_STORED_MARK).at(-1)?.startTime ?? -1;
}

/** Sets a cell of the reference map's first layer: one undoable step of that map. */
function editCell(x: number, value: number): void {
    const { history, session } = window.__ngneTest!.session.getState();
    const map = session.project.maps[0]!;
    const layer = map.layers.find((each): each is TileLayer => each.type === "tile")!;
    const before = layer.cells.get(x, 0);
    const command: Command = {
        label: "Benchmark edit",
        do: () => void layer.cells.set(x, 0, value),
        undo: () => void layer.cells.set(x, 0, before),
        bytes: 0,
        touched: {
            mapId: map.id,
            layerIds: [layer.id],
            cellRects: [{ x, y: 0, width: 1, height: 1 }],
            tilesetIds: [],
            structure: false,
        },
    };
    history.execute(command);
}

export interface SnapshotTiming {
    /** The longest main-thread task from shortly before the delay ends until the record is stored. */
    longestTaskMs: number;
    /** The page's part of the snapshot: taking the project ("ngne-autosave"). */
    pageMs: number;
    /** The longest thumbnail task of the snapshot ("ngne-autosave:thumbnail"); 0 without one. */
    thumbnailMs: number;
    /** From the end of the delay to the record stored. */
    storedMs: number;
}

/** Edits a cell, then times the snapshot that follows. */
async function snapshotAfterEdit(x: number, delayMs: number): Promise<SnapshotTiming> {
    const measures = performance.getEntriesByName(AUTOSAVE_MEASURE).length;
    const thumbnails = performance.getEntriesByName(AUTOSAVE_THUMBNAIL_MEASURE).length;
    const source = window.__ngneTest!.session.getState().session.project.maps[0]!;
    const layer = source.layers.find((each): each is TileLayer => each.type === "tile")!;
    editCell(x, layer.cells.get((x + 1) % source.width, 0));
    const edited = performance.now();
    await wait(delayMs - LEAD_MS);
    watchTasks();
    while (storedAt() < edited) {
        await wait(10);
        if (performance.now() - edited > 30_000) throw new Error("te-048: no snapshot");
    }
    const longest = longestTask();
    const own = performance.getEntriesByName(AUTOSAVE_MEASURE).slice(measures);
    if (own.length !== 1) throw new Error(`te-048: ${own.length} snapshots taken, expected 1`);
    const drawn = performance.getEntriesByName(AUTOSAVE_THUMBNAIL_MEASURE).slice(thumbnails);
    return {
        longestTaskMs: longest,
        pageMs: own[0]!.duration,
        thumbnailMs: Math.max(0, ...drawn.map((entry) => entry.duration)),
        storedMs: storedAt() - edited - delayMs,
    };
}

export interface Prepared {
    cells: number;
}

/** Opens the reference project; returns how many cells it holds. */
async function openReference(): Promise<number> {
    const project = createReferenceProject();
    window.__ngneTest!.session.getState().replace(createProjectSession(project));
    await frame();
    return project.maps[0]!.layers.reduce(
        (sum, layer) => sum + (layer.type === "tile" ? layer.cells.count : 0),
        0,
    );
}

export interface AutosaveRecord {
    cells: number;
    /** The first snapshot of each run: the whole project. */
    full: SnapshotTiming[];
    /** The second: one map's entry. */
    incremental: SnapshotTiming[];
}

/** `count` runs, `gapMs` apart; `delayMs` is autosave's delay. */
export async function runs(count: number, gapMs: number, delayMs: number): Promise<AutosaveRecord> {
    const record: AutosaveRecord = { cells: 0, full: [], incremental: [] };
    for (let k = 0; k < count; k += 1) {
        record.cells = await openReference();
        await wait(gapMs);
        record.full.push(await snapshotAfterEdit(1, delayMs));
        await wait(gapMs);
        record.incremental.push(await snapshotAfterEdit(2, delayMs));
    }
    return record;
}
