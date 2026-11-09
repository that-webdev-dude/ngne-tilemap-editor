import type { StoreApi } from "zustand/vanilla";
import { compositeThumbnail } from "../../core/compositor";
import type { History, Touched } from "../../core/history";
import { randomId } from "../../core/model";
import type { PixelBuffer, Project } from "../../core/model";
import { PROJECT_VERSION, projectToWire, wireBuffers } from "../../core/project";
import type { Notices } from "../notices/notices";
import type { PreferenceStore } from "../preferences/preferences";
import type { SessionState } from "../state/session";
import type { SnapshotBackend } from "./backend";
import { isQuotaError } from "../worker/autosave/errors";
import type { SnapshotInput } from "../worker/autosave/snapshotProject";
import { imagePixels, tilesetPixels } from "../worker/autosave/snapshotStorage";
import type {
    SnapshotKey,
    SnapshotRecord,
    SnapshotThumbnail,
} from "../worker/autosave/snapshotStorage";

// Autosave (SPEC §10.1, TE-048; the sprite editor's SE-042 applied to the one project of the
// window): the open project, while it has unsaved changes, is written to IndexedDB 2 s after
// its last change, as the JSON entries of its project file (`project.json`, `maps/<id>.json`)
// and the raw pixels of its tilesets and images, keyed by ID (`snapshotStorage.ts`). The worker
// makes the entries and writes them (`app/worker/tasks/autosave.task.ts`); the page only hands
// over the project without pixels, the cells of the maps that changed and copies of the pixels
// that changed. A snapshot goes when the project has nothing unsaved any more (a save, an undo
// back to the saved state) and when the project goes (Close Project, New Project, Open, Revert).
// A reload or a crash leaves it, and the next launch offers it for recovery (`recovery.ts`).
//
// What changed is learned from the history (each step's `touched`, SPEC §3): the map a step
// names is written again; a project-wide step that changes cells, layers, tilesets or the
// structure writes every map again, since a map's entry holds its tilesets' first GIDs (FORMAT
// §1.2). A tileset's or an image's pixels are written again when their buffer is not the one
// written: the commands that change pixels replace the buffer (core/tileset, core/images).
// `project.json` is written with every snapshot.
//
// A stroke ends soon; the snapshot waits for it, so that no half stroke is kept. Writes run one
// at a time; a change during a write is written after it. A write that finds its snapshot taken
// by another page (which recovered it) leaves it to that page and writes the project under a
// new key.

/** The delay from the project's last change to its snapshot (SPEC §10.1). */
export const AUTOSAVE_DELAY_MS = 2000;

/** How many maps, first in the list, a snapshot keeps thumbnails of for the recovery dialog. */
export const RECOVERY_THUMBNAILS = 4;

/**
 * User Timing around the part of each snapshot the page does (taking the project): the start
 * mark is cleared once the measure is taken; the measures stay in the page's timeline, where
 * the long-task benchmark finds them.
 */
export const AUTOSAVE_MARK_START = "ngne-autosave:start";
export const AUTOSAVE_MEASURE = "ngne-autosave";
/** As above, around each map thumbnail a snapshot makes. */
export const AUTOSAVE_THUMBNAIL_START = "ngne-autosave:thumbnail-start";
export const AUTOSAVE_THUMBNAIL_MEASURE = "ngne-autosave:thumbnail";
/** Set each time a snapshot is stored (the newest only): the long-task benchmark waits for it. */
export const AUTOSAVE_STORED_MARK = "ngne-autosave:stored";

/** Resolves in a later task. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The toast of a full storage, shown once; autosave is then off for the session. */
export const AUTOSAVE_QUOTA_MESSAGE =
    "Autosave is off until the editor is reloaded: the browser's storage for this site is full.";

/** What autosave hears of saves: a save records the saved state without a store change. */
export interface SaveSource {
    subscribe(listener: () => void): () => void;
}

export interface AutosaveOptions {
    sessions: StoreApi<SessionState>;
    /** Where snapshots are written; null: nowhere (no IndexedDB), autosave does nothing. */
    backend: SnapshotBackend | null;
    /** The autosave preference (TE-008). */
    preferences: Pick<PreferenceStore, "get" | "subscribe">;
    notices: Pick<Notices, "error">;
    /** Saves of the project (the file workflows); without it only store changes are heard. */
    saves?: SaveSource;
    /** The page writing the snapshots (`recovery.ts`). */
    owner: string;
    delayMs?: number;
    now?(): number;
    /** A new snapshot key. */
    newKey?(): SnapshotKey;
}

export interface Autosave {
    /**
     * Makes `record` the snapshot of the open project, which recovery opened from it (and took
     * for this page) and made dirty: its key, maps and pixels are kept, and later snapshots
     * write only what changes.
     */
    adopt(record: SnapshotRecord): void;
    /** Resolves once every write and removal started so far has finished. */
    idle(): Promise<void>;
    /** True after a storage-full error: no snapshot is written for the rest of the session. */
    readonly disabled: boolean;
    /** Stops following the project; a pending snapshot is not written. */
    stop(): void;
}

/** What autosave keeps of the open project. */
interface Tracker {
    readonly history: History;
    /** Changes only when another page took the snapshot. */
    key: SnapshotKey;
    stopHistory(): void;
    timer: ReturnType<typeof setTimeout> | null;
    /** A write of it runs; `again`: another is due once it ends. */
    writing: boolean;
    again: boolean;
    /** Increases with every removal: a write that ends after one records nothing. */
    generation: number;
    /** Maps changed since the snapshot the storage holds. */
    changedMaps: Set<string>;
    /** Every map changed since then. */
    allMaps: boolean;
    exportOnSave: boolean;
    /** The storage may hold records of `key` (a write was started since the last removal). */
    mayExist: boolean;
    /** The storage holds exactly what `maps` and `pixels` say. */
    known: boolean;
    /** The maps the snapshot holds. */
    maps: Set<string>;
    /** The pixels the snapshot holds: the data written, by pixel record name. */
    pixels: Map<string, WeakRef<Uint8ClampedArray>>;
    /** The thumbnails written, by map ID. */
    thumbnails: Map<string, PixelBuffer>;
}

const NO_PIXELS = new Uint8ClampedArray(0);

function mark(name: string): void {
    if (typeof performance !== "undefined") performance.mark(name);
}

/** Measures from the start mark to now, then clears the mark. */
function measure(name: string, start: string): void {
    if (typeof performance === "undefined") return;
    try {
        performance.measure(name, start);
    } catch {
        // The start mark was cleared by someone else: nothing to measure.
    }
    performance.clearMarks(start);
}

/** The pixel records of a project: name, buffer. */
function pixelRecords(project: Project): [string, PixelBuffer][] {
    return [
        ...project.tilesets.map((each): [string, PixelBuffer] => [
            tilesetPixels(each.id),
            each.pixels,
        ]),
        ...project.images.map((each): [string, PixelBuffer] => [imagePixels(each.id), each.pixels]),
    ];
}

/** `pixels` without its data, for `project.json`, which states the size only. */
function sizeOnly(pixels: PixelBuffer): PixelBuffer {
    return { width: pixels.width, height: pixels.height, data: NO_PIXELS };
}

export function createAutosave(options: AutosaveOptions): Autosave {
    const { sessions, backend, preferences, notices, saves, owner } = options;
    const delayMs = options.delayMs ?? AUTOSAVE_DELAY_MS;
    const now = options.now ?? (() => Date.now());
    const newKey = options.newKey ?? randomId;
    let tracker: Tracker | null = null;
    let disabled = false;
    let stopped = false;
    let tail: Promise<void> = Promise.resolve();

    const enabled = () =>
        !stopped && !disabled && backend !== null && preferences.get("autosave").enabled;

    /** Keeps `idle()` after `task`. */
    const follow = (task: Promise<unknown>): void => {
        tail = Promise.all([tail, task.catch(() => {})]).then(() => {});
    };

    const cancel = (each: Tracker) => {
        if (each.timer !== null) clearTimeout(each.timer);
        each.timer = null;
    };

    const arm = (each: Tracker) => {
        cancel(each);
        if (stopped) return;
        each.timer = setTimeout(() => fire(each), delayMs);
    };

    /** The project can differ from its snapshot now: it is written after the delay. */
    const changed = (each: Tracker) => arm(each);

    const noteTouched = (each: Tracker, touched: Touched) => {
        if (touched.mapId !== null) {
            each.changedMaps.add(touched.mapId);
            return;
        }
        const { structure, layerIds, cellRects, tilesetIds } = touched;
        if (structure || layerIds.length > 0 || cellRects.length > 0 || tilesetIds.length > 0) {
            each.allMaps = true;
        }
    };

    /** Forgets what the storage holds of the tracker's snapshot. */
    const forget = (each: Tracker) => {
        each.mayExist = false;
        each.known = false;
        each.generation++;
        each.maps.clear();
        each.pixels.clear();
        each.thumbnails.clear();
    };

    /** Forgets what the storage holds of the tracker's snapshot and removes it there. */
    const removeSnapshot = (each: Tracker) => {
        if (!each.mayExist || !backend) return;
        forget(each);
        follow(
            backend.remove(each.key).catch((error: unknown) => {
                console.warn("Autosave could not remove a snapshot:", error);
            }),
        );
    };

    const fire = (each: Tracker) => {
        each.timer = null;
        if (!enabled() || tracker !== each) return;
        if (each.writing) {
            each.again = true;
            return;
        }
        write(each);
    };

    /** Takes the project as it is now and writes it, if it is still due. */
    const write = (each: Tracker) => {
        if (!backend) return;
        const { history } = each;
        if (!history.dirty) return;
        // A stroke ends soon: its snapshot waits for it.
        if (history.transaction) {
            arm(each);
            return;
        }
        mark(AUTOSAVE_MARK_START);
        let input: SnapshotInput;
        let transfer: Transferable[];
        const changedBefore = each.changedMaps;
        const allBefore = each.allMaps;
        const writtenPixels = new Map<string, WeakRef<Uint8ClampedArray>>();
        const thumbnails = new Map<string, PixelBuffer>();
        const firstMaps: { mapId: string; name: string; kept: PixelBuffer | null }[] = [];
        let mapIds: string[];
        try {
            const { project } = history.session;
            mapIds = project.maps.map((map) => map.id);
            const fresh = !each.known;
            const maps = mapIds.filter(
                (id) => fresh || allBefore || changedBefore.has(id) || !each.maps.has(id),
            );
            const writtenMaps = new Set(maps);
            const deleteMaps = fresh ? [] : [...each.maps].filter((id) => !mapIds.includes(id));
            const putPixels = new Map<string, PixelBuffer>();
            transfer = [];
            for (const [name, pixels] of pixelRecords(project)) {
                writtenPixels.set(name, new WeakRef(pixels.data));
                const held = fresh ? undefined : each.pixels.get(name)?.deref();
                if (held === pixels.data) continue;
                const data = pixels.data.slice();
                putPixels.set(name, { width: pixels.width, height: pixels.height, data });
                transfer.push(data.buffer);
            }
            const deletePixels = fresh
                ? []
                : [...each.pixels.keys()].filter((name) => !writtenPixels.has(name));
            // A thumbnail is kept while neither its map nor any pixels changed.
            for (const map of project.maps.slice(0, RECOVERY_THUMBNAILS)) {
                const held = each.thumbnails.get(map.id);
                const kept = held && !writtenMaps.has(map.id) && putPixels.size === 0;
                firstMaps.push({ mapId: map.id, name: map.name, kept: kept ? held : null });
            }
            // A snapshot of the project as it is now: what the worker gets cannot change.
            const wire = structuredClone(
                projectToWire({
                    ...project,
                    tilesets: project.tilesets.map((each) => ({
                        ...each,
                        pixels: sizeOnly(each.pixels),
                    })),
                    images: project.images.map((each) => ({
                        ...each,
                        pixels: sizeOnly(each.pixels),
                    })),
                    maps: project.maps.map((map) =>
                        writtenMaps.has(map.id) ? map : { ...map, layers: [] },
                    ),
                }),
            );
            transfer.push(...wireBuffers(wire));
            input = {
                record: {
                    key: each.key,
                    projectId: project.id,
                    name: project.name,
                    savedAt: now(),
                    owner,
                    version: PROJECT_VERSION,
                    mapIds,
                    tilesetIds: project.tilesets.map((tileset) => tileset.id),
                    imageIds: project.images.map((image) => image.id),
                    // Made in the tasks that follow (`thumbnailsOf`).
                    thumbnails: [],
                },
                replace: fresh,
                project: wire,
                maps,
                deleteMaps,
                putPixels,
                deletePixels,
            };
        } finally {
            measure(AUTOSAVE_MEASURE, AUTOSAVE_MARK_START);
        }

        // What this write covers; given back when it does not land.
        const generation = each.generation;
        each.changedMaps = new Set();
        each.allMaps = false;
        const giveBack = () => {
            for (const id of changedBefore) each.changedMaps.add(id);
            each.allMaps ||= allBefore;
        };
        each.mayExist = true;
        each.writing = true;
        /**
         * The thumbnails of the first maps, each one made in a task of its own after the one that
         * took the project, so that no task of autosave composites more than one map. A
         * thumbnail is a picture for the recovery dialog: it shows the map as it is then.
         */
        const thumbnailsOf = async (): Promise<SnapshotThumbnail[]> => {
            const shown: SnapshotThumbnail[] = [];
            for (const { mapId, name, kept } of firstMaps) {
                if (kept) {
                    thumbnails.set(mapId, kept);
                    shown.push({ mapId, name, image: kept });
                    continue;
                }
                await nextTask();
                if (stopped || tracker !== each) return shown;
                const { project } = each.history.session;
                const map = project.maps.find((item) => item.id === mapId);
                if (!map) continue;
                mark(AUTOSAVE_THUMBNAIL_START);
                const image = compositeThumbnail(project, map);
                measure(AUTOSAVE_THUMBNAIL_MEASURE, AUTOSAVE_THUMBNAIL_START);
                thumbnails.set(mapId, image);
                shown.push({ mapId, name: map.name, image });
            }
            return shown;
        };
        const done = thumbnailsOf()
            .then((shown) =>
                // Saved, closed or stopped meanwhile: nothing is written.
                stopped || tracker !== each || each.generation !== generation
                    ? null
                    : backend.write(
                          { ...input, record: { ...input.record, thumbnails: shown } },
                          transfer,
                      ),
            )
            .then(
                (result) => {
                    if (result === null) return;
                    if (result === "taken") {
                        // Another page recovered this snapshot: it is that page's. This page's
                        // project is written in full under a key of its own.
                        giveBack();
                        if (each.generation === generation) {
                            forget(each);
                            each.key = newKey();
                            arm(each);
                        }
                        return;
                    }
                    // Removed meanwhile (saved, closed): the removal may have run before this
                    // write landed, so it is removed again. A later write of the key starts only
                    // after this one has ended (`writing`), so it is not affected.
                    if (each.generation !== generation) {
                        follow(
                            backend.remove(input.record.key).catch((error: unknown) => {
                                console.warn("Autosave could not remove a snapshot:", error);
                            }),
                        );
                        return;
                    }
                    each.known = true;
                    each.maps = new Set(mapIds);
                    each.pixels = writtenPixels;
                    each.thumbnails = thumbnails;
                    // Only the newest stays in the timeline.
                    if (typeof performance !== "undefined")
                        performance.clearMarks(AUTOSAVE_STORED_MARK);
                    mark(AUTOSAVE_STORED_MARK);
                },
                (error: unknown) => {
                    giveBack();
                    if (isQuotaError(error)) {
                        if (!disabled) {
                            disabled = true;
                            if (tracker) cancel(tracker);
                            notices.error(AUTOSAVE_QUOTA_MESSAGE);
                        }
                        return;
                    }
                    console.warn("Autosave could not write a snapshot:", error);
                    // Tried again after the delay.
                    if (tracker === each) arm(each);
                },
            );
        follow(
            done.finally(() => {
                each.writing = false;
                if (each.again) {
                    each.again = false;
                    fire(each);
                }
            }),
        );
    };

    /** Follows the history of an open project. */
    const track = (history: History): Tracker => {
        const each: Tracker = {
            history,
            key: newKey(),
            stopHistory: () => {},
            timer: null,
            writing: false,
            again: false,
            generation: 0,
            changedMaps: new Set(),
            allMaps: false,
            exportOnSave: history.session.project.exportSettings.exportOnSave,
            mayExist: false,
            known: false,
            maps: new Set(),
            pixels: new Map(),
            thumbnails: new Map(),
        };
        each.stopHistory = history.subscribe((change) => {
            noteTouched(each, change.touched);
            changed(each);
        });
        return each;
    };

    const untrack = (each: Tracker) => {
        each.stopHistory();
        cancel(each);
        each.again = false;
        removeSnapshot(each);
    };

    /** Brings the tracker in step with the store: another project, a save, export settings. */
    const check = () => {
        if (stopped) return;
        const state = sessions.getState();
        if (tracker && tracker.history !== state.history) {
            untrack(tracker);
            tracker = null;
        }
        if (!state.open) return;
        if (!tracker) tracker = track(state.history);
        const each = tracker;
        // Saved, or back at the saved state: its file holds it.
        if (!each.history.dirty) {
            cancel(each);
            each.again = false;
            removeSnapshot(each);
            return;
        }
        const exportOnSave = each.history.session.project.exportSettings.exportOnSave;
        if (exportOnSave !== each.exportOnSave) {
            each.exportOnSave = exportOnSave;
            changed(each);
        } else if (!each.mayExist && each.timer === null && !each.writing) {
            // Dirty with no snapshot and none due: one is written after the delay.
            changed(each);
        }
    };

    check();
    const stopSessions = sessions.subscribe(check);
    const stopSaves = saves?.subscribe(check);
    const stopPreferences = preferences.subscribe((key, values) => {
        if (key !== "autosave" || !tracker) return;
        // Off: this page's snapshot would only grow stale; it goes.
        if (!values.autosave.enabled) {
            cancel(tracker);
            tracker.again = false;
            removeSnapshot(tracker);
        } else if (tracker.history.dirty) {
            arm(tracker);
        }
    });

    return {
        adopt(record) {
            const state = sessions.getState();
            if (!state.open) return;
            if (tracker && tracker.history !== state.history) {
                untrack(tracker);
                tracker = null;
            }
            // Tracked under a key of its own since it opened, with nothing written yet.
            if (tracker) untrack(tracker);
            const each = track(state.history);
            tracker = each;
            const { project } = state.session;
            each.key = record.key;
            each.mayExist = true;
            each.known = true;
            each.maps = new Set(record.mapIds);
            for (const [name, pixels] of pixelRecords(project)) {
                each.pixels.set(name, new WeakRef(pixels.data));
            }
            for (const thumbnail of record.thumbnails) {
                each.thumbnails.set(thumbnail.mapId, thumbnail.image);
            }
        },
        idle: () => tail,
        get disabled() {
            return disabled;
        },
        stop() {
            stopped = true;
            stopSessions();
            stopSaves?.();
            stopPreferences();
            if (tracker) {
                tracker.stopHistory();
                cancel(tracker);
            }
            tracker = null;
        },
    };
}
