import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import {
    AUTOSAVE_DELAY_MS,
    AUTOSAVE_QUOTA_MESSAGE,
    RECOVERY_THUMBNAILS,
    createAutosave,
} from "../../src/app/autosave/autosave";
import type { Autosave } from "../../src/app/autosave/autosave";
import { createRecoveryDialogs } from "../../src/app/autosave/dialogs";
import type { RecoveryRequest } from "../../src/app/autosave/dialogs";
import { AutosaveError, isQuotaError, storageError } from "../../src/app/worker/autosave/errors";
import {
    RECOVERY_CHECKED_MARK,
    createRecovery,
    elsewhereMessage,
    offerRecovery,
    unsavedMessage,
} from "../../src/app/autosave/recovery";
import {
    projectOfSnapshot,
    snapshotWrite,
    takeSnapshot,
} from "../../src/app/worker/autosave/snapshotProject";
import { imagePixels, tilesetPixels } from "../../src/app/worker/autosave/snapshotStorage";
import { createDialogRequests } from "../../src/app/dialogs/dialogRequests";
import { createPreferenceStore } from "../../src/app/preferences/preferences";
import type { PreferenceStore } from "../../src/app/preferences/preferences";
import { createSessionStore } from "../../src/app/state/session";
import type { SessionState } from "../../src/app/state/session";
import { WorkerError } from "../../src/app/worker/protocol";
import { compositeThumbnail } from "../../src/core/compositor";
import { createProject, createProjectSession, sequentialIds } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import { ProjectError, mapEntry, serialize } from "../../src/core/project";
import { everyMemberProject } from "./te-046-support";
import {
    MemorySnapshots,
    memoryBackend,
    paintCell,
    renameProject,
    repaintTileset,
} from "./te-048-support";

// TE-048: autosave and crash recovery (SPEC §10.1). Snapshots go to a storage in memory here
// with the IndexedDB storage's contract (the E2E spec covers IndexedDB and the worker); the
// storage records every put, which is the store spy of the acceptance.

const TOWN = "map-town";
const DUNGEON = "map-dungeon";

interface Harness {
    sessions: StoreApi<SessionState>;
    storage: MemorySnapshots;
    preferences: PreferenceStore;
    autosave: Autosave;
    errors: string[];
    saved: Set<() => void>;
    /** Tells autosave of a save (the file workflows' listeners). */
    save(): void;
}

function harness(project: Project | null = everyMemberProject(), owner = "page-a"): Harness {
    const sessions = createSessionStore(project && createProjectSession(project), {
        verify: null,
    });
    const storage = new MemorySnapshots();
    const preferences = createPreferenceStore(null);
    const errors: string[] = [];
    const saved = new Set<() => void>();
    const keys = sequentialIds(`${owner}-key`);
    const autosave = createAutosave({
        sessions,
        backend: memoryBackend(storage),
        preferences,
        notices: { error: (message) => errors.push(message) },
        saves: {
            subscribe(listener) {
                saved.add(listener);
                return () => saved.delete(listener);
            },
        },
        owner,
        now: () => Date.now(),
        newKey: keys,
    });
    return {
        sessions,
        storage,
        preferences,
        autosave,
        errors,
        saved,
        save() {
            sessions.getState().history.markSaved();
            for (const listener of saved) listener();
        },
    };
}

/**
 * Waits until every write and removal started so far has ended, letting the tasks a snapshot
 * waits for (one per thumbnail) run: the timers are fake.
 */
async function drain(autosave: Autosave): Promise<void> {
    let done = false;
    void autosave.idle().then(() => {
        done = true;
    });
    // A timer of no delay set while time advances runs at the next millisecond.
    for (let turn = 0; turn < 20 && !done; turn += 1) await vi.advanceTimersByTimeAsync(1);
    if (!done) throw new Error("Autosave did not settle.");
}

/** Lets the delay run out and every write end. */
async function settle(each: Harness, ms = AUTOSAVE_DELAY_MS): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await drain(each.autosave);
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("te-048 autosave", () => {
    it("writes the dirty project 2 s after its last change, whole the first time", async () => {
        const each = harness();
        const { project } = each.sessions.getState().session;
        paintCell(each.sessions, TOWN, 0, 0, 0);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
        expect(each.storage.writes).toHaveLength(0);
        // Another change restarts the delay.
        renameProject(each.sessions, "Renamed");
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
        expect(each.storage.writes).toHaveLength(0);
        await settle(each, 1);
        expect(each.storage.writes).toHaveLength(1);
        const [record] = await each.storage.list();
        expect(record).toMatchObject({
            key: "page-a-key1",
            projectId: project.id,
            name: "Renamed",
            owner: "page-a",
            mapIds: [TOWN, DUNGEON],
            tilesetIds: project.tilesets.map((tileset) => tileset.id),
            imageIds: project.images.map((image) => image.id),
        });
        expect(each.storage.writes[0]!.replace).toBe(true);
        expect(each.storage.entryPuts.sort()).toEqual(
            ["project.json", mapEntry(TOWN), mapEntry(DUNGEON)]
                .map((name) => `page-a-key1/${name}`)
                .sort(),
        );
        expect(each.storage.pixelPuts.sort()).toEqual(
            [
                ...project.tilesets.map((tileset) => tilesetPixels(tileset.id)),
                ...project.images.map((image) => imagePixels(image.id)),
            ]
                .map((name) => `page-a-key1/${name}`)
                .sort(),
        );
    });

    it("rewrites only the edited map and project.json after a single-map edit (store spy)", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await settle(each);
        each.storage.clearPuts();

        paintCell(each.sessions, DUNGEON, 0, 0, 0);
        await settle(each);
        expect(each.storage.entryPuts).toEqual([
            "page-a-key1/project.json",
            `page-a-key1/${mapEntry(DUNGEON)}`,
        ]);
        expect(each.storage.pixelPuts).toEqual([]);
        expect(each.storage.writes[0]!.replace).toBe(false);
        // The town's entry is the one written first, still there.
        expect([...each.storage.entries.get("page-a-key1")!.keys()].sort()).toEqual(
            ["project.json", mapEntry(DUNGEON), mapEntry(TOWN)].sort(),
        );
    });

    it("rewrites only the pixels of a tileset whose buffer changed, and every map", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await settle(each);
        each.storage.clearPuts();
        const id = each.sessions.getState().session.project.tilesets[1]!.id;

        repaintTileset(each.sessions, id);
        await settle(each);
        expect(each.storage.pixelPuts).toEqual([`page-a-key1/${tilesetPixels(id)}`]);
        // A step of no map that names a tileset may change every map's first GIDs.
        expect(each.storage.entryPuts.sort()).toEqual(
            ["project.json", mapEntry(TOWN), mapEntry(DUNGEON)]
                .map((name) => `page-a-key1/${name}`)
                .sort(),
        );
        each.storage.clearPuts();
        // Undo gives the old buffer back: written again, as it differs from the one stored.
        each.sessions.getState().history.undo();
        await settle(each);
        expect(each.storage.pixelPuts).toEqual([`page-a-key1/${tilesetPixels(id)}`]);
    });

    it("a project-wide step that changes no map rewrites project.json only", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await settle(each);
        each.storage.clearPuts();
        renameProject(each.sessions, "Other");
        await settle(each);
        expect(each.storage.entryPuts).toEqual(["page-a-key1/project.json"]);
        expect(each.storage.pixelPuts).toEqual([]);
    });

    it("waits for an open stroke and writes once it is committed", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        const { history, session } = each.sessions.getState();
        const layer = session.project.maps[0]!.layers.find((item) => item.type === "tile")!;
        const transaction = history.begin({ mapId: TOWN, layerId: layer.id });
        await settle(each, AUTOSAVE_DELAY_MS * 3);
        expect(each.storage.writes).toHaveLength(0);
        transaction.abort();
        await settle(each);
        expect(each.storage.writes).toHaveLength(1);
    });

    it("removes the snapshot when the project is saved, undone back to its saved state or closed", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await settle(each);
        expect(await each.storage.list()).toHaveLength(1);
        each.save();
        await drain(each.autosave);
        expect(await each.storage.list()).toHaveLength(0);
        expect(each.storage.removals).toEqual(["page-a-key1"]);

        paintCell(each.sessions, TOWN, 2, 1, 0);
        await settle(each);
        expect(await each.storage.list()).toHaveLength(1);
        each.sessions.getState().history.undo();
        await drain(each.autosave);
        expect(await each.storage.list()).toHaveLength(0);

        paintCell(each.sessions, TOWN, 3, 1, 0);
        await settle(each);
        expect(await each.storage.list()).toHaveLength(1);
        each.sessions.getState().close();
        await settle(each);
        expect(await each.storage.list()).toHaveLength(0);
        expect(each.storage.entries.size + each.storage.pixels.size).toBe(0);
    });

    it("a save during a write leaves no snapshot behind", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
        // The write is on its way; the save comes before it lands.
        each.save();
        await drain(each.autosave);
        expect(await each.storage.list()).toHaveLength(0);
    });

    it("a save after the write was handed to the storage leaves no snapshot behind", async () => {
        const each = harness();
        let release!: () => void;
        each.storage.hold = new Promise((resolve) => (release = resolve));
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
        for (let turn = 0; turn < 20 && each.storage.started === 0; turn += 1) {
            await vi.advanceTimersByTimeAsync(1);
        }
        expect(each.storage.started).toBe(1);
        // The write is in the storage's hands; the save comes before it lands.
        each.save();
        release();
        await drain(each.autosave);
        expect(await each.storage.list()).toHaveLength(0);
        expect(each.storage.entries.size + each.storage.pixels.size).toBe(0);
        // Nothing more is written for the saved project.
        await settle(each);
        expect(await each.storage.list()).toHaveLength(0);
    });

    it("writes nothing while the preference is off, and removes the snapshot when it is turned off", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await settle(each);
        expect(await each.storage.list()).toHaveLength(1);
        each.preferences.set("autosave", { enabled: false });
        await drain(each.autosave);
        expect(await each.storage.list()).toHaveLength(0);
        each.storage.clearPuts();
        paintCell(each.sessions, TOWN, 2, 1, 0);
        await settle(each);
        expect(each.storage.writes).toHaveLength(0);
        each.preferences.set("autosave", { enabled: true });
        await settle(each);
        expect(each.storage.writes).toHaveLength(1);
        expect(each.storage.writes[0]!.replace).toBe(true);
    });

    it("turns itself off with one toast when storage is full", async () => {
        const each = harness();
        each.storage.fail = new AutosaveError("quota", "full");
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await settle(each);
        expect(each.autosave.disabled).toBe(true);
        expect(each.errors).toEqual([AUTOSAVE_QUOTA_MESSAGE]);
        paintCell(each.sessions, TOWN, 2, 1, 0);
        await settle(each);
        expect(each.storage.writes).toHaveLength(0);
    });

    it("tries again after a failed write, and writes the project whole", async () => {
        const each = harness();
        each.storage.fail = new Error("blocked");
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await settle(each);
        expect(each.storage.writes).toHaveLength(0);
        await settle(each);
        expect(each.storage.writes).toHaveLength(1);
        expect(each.storage.writes[0]!.replace).toBe(true);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("writes under a new key when another page took the snapshot", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await settle(each);
        await each.storage.take("page-a-key1", "page-a", "page-b");
        paintCell(each.sessions, TOWN, 2, 1, 0);
        await settle(each);
        await settle(each);
        const records = await each.storage.list();
        expect(records.map((record) => [record.key, record.owner]).sort()).toEqual([
            ["page-a-key1", "page-b"],
            ["page-a-key2", "page-a"],
        ]);
        expect(each.storage.writes.at(-1)!.replace).toBe(true);
    });

    it("keeps thumbnails of the first maps, as the file's thumbnails are made", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        await settle(each);
        const [record] = await each.storage.list();
        const { project } = each.sessions.getState().session;
        expect(record!.thumbnails).toHaveLength(Math.min(RECOVERY_THUMBNAILS, project.maps.length));
        record!.thumbnails.forEach((thumbnail, index) => {
            const map = project.maps[index]!;
            expect(thumbnail).toMatchObject({ mapId: map.id, name: map.name });
            expect(thumbnail.image).toEqual(compositeThumbnail(project, map));
        });
    });

    it("a project dirty when autosave starts is written; a clean one is not", async () => {
        const project = everyMemberProject();
        const sessions = createSessionStore(createProjectSession(project), { verify: null });
        paintCell(sessions, TOWN, 1, 1, 0);
        const storage = new MemorySnapshots();
        const autosave = createAutosave({
            sessions,
            backend: memoryBackend(storage),
            preferences: createPreferenceStore(null),
            notices: { error: () => {} },
            owner: "page",
        });
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
        await drain(autosave);
        expect(storage.writes).toHaveLength(1);
        autosave.stop();

        const clean = harness();
        await settle(clean);
        expect(clean.storage.writes).toHaveLength(0);
    });
});

describe("te-048 snapshot round trip", () => {
    it("a recovered snapshot holds the project as it was written, byte for byte as a file", async () => {
        const each = harness();
        paintCell(each.sessions, TOWN, 1, 1, 0);
        paintCell(each.sessions, DUNGEON, 0, 0, 0);
        await settle(each);
        const original = each.sessions.getState().session.project;
        const taken = await takeSnapshot(each.storage, "page-a-key1", "page-a", "page-b");
        if (typeof taken === "string" || !taken.project) throw new Error(String(taken));
        expect(taken.record.owner).toBe("page-b");
        expect(serialize(taken.project)).toEqual(serialize(original));
    });

    it("refuses a snapshot whose pixels are missing or of another size, as the reader does", () => {
        const project = createProject({ name: "P", newId: sequentialIds("p") });
        const write = snapshotWrite({
            record: {
                key: "k",
                projectId: project.id,
                name: "P",
                savedAt: 0,
                owner: "o",
                version: 1,
                mapIds: project.maps.map((map) => map.id),
                tilesetIds: [],
                imageIds: [],
                thumbnails: [],
            },
            replace: true,
            project: structuredClone({ ...project, maps: [] }) as never,
            maps: [],
            deleteMaps: [],
            putPixels: new Map(),
            deletePixels: [],
        });
        // No map entry: the reader's "missing-entry".
        expect(() =>
            projectOfSnapshot({
                record: write.record,
                entries: write.putEntries,
                pixels: new Map(),
            }),
        ).toThrow(ProjectError);
    });
});

describe("te-048 errors", () => {
    it("knows a full storage however it is reported", () => {
        const quota = new DOMException("full", "QuotaExceededError");
        expect(isQuotaError(quota)).toBe(true);
        expect(isQuotaError(storageError(quota))).toBe(true);
        const remote = new WorkerError("failed", "autosave.write", "full", {
            name: "AutosaveError",
            message: "full",
            code: "quota",
        } as never);
        expect(isQuotaError(remote)).toBe(true);
        expect(isQuotaError(new Error("other"))).toBe(false);
        expect(storageError(new ProjectError("invalid-map", "x"))).toBeInstanceOf(ProjectError);
    });
});

describe("te-048 recovery", () => {
    /** A snapshot left by page "old" of a project with an edit in each map. */
    async function leftSnapshot(): Promise<{ storage: MemorySnapshots; edited: Project }> {
        const each = harness(everyMemberProject(), "old");
        paintCell(each.sessions, TOWN, 1, 1, 0);
        paintCell(each.sessions, DUNGEON, 0, 0, 0);
        await settle(each);
        each.autosave.stop();
        return { storage: each.storage, edited: each.sessions.getState().session.project };
    }

    function recoveryOf(storage: MemorySnapshots, open: Set<string> | null = new Set()) {
        const page = harness(null, "new");
        // The page's autosave writes to the same storage as the old page's.
        page.autosave.stop();
        const infos: string[] = [];
        const errors: string[] = [];
        const autosave = createAutosave({
            sessions: page.sessions,
            backend: memoryBackend(storage),
            preferences: page.preferences,
            notices: { error: () => {} },
            owner: "new",
            newKey: sequentialIds("new-key"),
        });
        const recovery = createRecovery({
            backend: memoryBackend(storage),
            sessions: page.sessions,
            autosave,
            notices: { info: (m) => infos.push(m), error: (m) => errors.push(m) },
            owner: "new",
            openOwners: async () => open,
        });
        return { sessions: page.sessions, autosave, recovery, infos, errors };
    }

    it("offers the snapshots of pages no longer open; recovering gives the edited project, dirty", async () => {
        const { storage, edited } = await leftSnapshot();
        const { sessions, autosave, recovery, infos } = recoveryOf(storage);
        const offered = await recovery.offered();
        expect(offered.map((record) => record.key)).toEqual(["old-key1"]);
        expect(await recovery.recover("old-key1")).toBe("opened");
        expect(infos).toEqual([`Recovered ${edited.name}`]);
        const state = sessions.getState();
        expect(state.open).toBe(true);
        expect(state.history.dirty).toBe(true);
        expect(state.history.undoCount).toBe(0);
        expect(serialize(state.session.project)).toEqual(serialize(edited));
        // The snapshot is this page's now, under the same key, and nothing is rewritten for it.
        storage.clearPuts();
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
        await drain(autosave);
        expect(storage.writes).toHaveLength(0);
        expect((await storage.list()).map((record) => [record.key, record.owner])).toEqual([
            ["old-key1", "new"],
        ]);
        // The next edit of one map writes that map only, into the adopted snapshot.
        paintCell(sessions, TOWN, 4, 1, 0);
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
        await drain(autosave);
        expect(storage.entryPuts).toEqual(["old-key1/project.json", `old-key1/${mapEntry(TOWN)}`]);
        expect(storage.pixelPuts).toEqual([]);
    });

    it("does not offer the snapshot of a page that is still open", async () => {
        const { storage } = await leftSnapshot();
        const { recovery } = recoveryOf(storage, new Set(["old"]));
        expect(await recovery.offered()).toEqual([]);
    });

    it("refuses while the window's project has unsaved changes", async () => {
        const { storage } = await leftSnapshot();
        const { sessions, recovery, errors } = recoveryOf(storage);
        await recovery.offered();
        sessions.getState().replace(createProjectSession(createProject({ name: "Mine" })));
        renameProject(sessions, "Mine 2");
        expect(await recovery.recover("old-key1")).toBe("failed");
        expect(errors).toEqual([unsavedMessage("Every member", "Mine 2")]);
        expect((await storage.list())[0]!.owner).toBe("old");
    });

    it("a snapshot another page recovered first: its row goes, nothing opens", async () => {
        const { storage } = await leftSnapshot();
        const first = recoveryOf(storage);
        const second = recoveryOf(storage);
        await first.recovery.offered();
        await second.recovery.offered();
        expect(await first.recovery.recover("old-key1")).toBe("opened");
        expect(await second.recovery.recover("old-key1")).toBe("gone");
        expect(second.errors).toEqual([elsewhereMessage("Every member")]);
        expect(second.sessions.getState().open).toBe(false);
    });

    it("a snapshot that cannot be read stays offered and can still be discarded", async () => {
        const { storage } = await leftSnapshot();
        // A damaged map entry: the reader refuses it.
        storage.entries.get("old-key1")!.set(mapEntry(DUNGEON), new TextEncoder().encode("{"));
        const { sessions, recovery, errors } = recoveryOf(storage);
        await recovery.offered();
        expect(await recovery.recover("old-key1")).toBe("failed");
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/^Could not recover “Every member”\./);
        expect(sessions.getState().open).toBe(false);
        // Tried again, it fails the same way, not as another window's.
        expect(await recovery.recover("old-key1")).toBe("failed");
        expect(errors[1]).toMatch(/^Could not recover “Every member”\./);
        expect(await recovery.discard("old-key1")).toBe("gone");
        expect(errors).toHaveLength(2);
        expect(await storage.list()).toEqual([]);
        expect(storage.entries.size + storage.pixels.size).toBe(0);
    });

    it("Discard removes the snapshot permanently", async () => {
        const { storage } = await leftSnapshot();
        const { recovery } = recoveryOf(storage);
        await recovery.offered();
        expect(await recovery.discard("old-key1")).toBe("gone");
        expect(await storage.list()).toEqual([]);
        expect(storage.entries.size + storage.pixels.size).toBe(0);
    });

    it("the launch check shows the dialog with the snapshots and marks how many it offered", async () => {
        const { storage } = await leftSnapshot();
        const { recovery } = recoveryOf(storage);
        const requests = createDialogRequests();
        const dialogs = createRecoveryDialogs(requests);
        requests.attachHost();
        const marks: unknown[] = [];
        const markSpy = vi.spyOn(performance, "mark").mockImplementation((name, options) => {
            if (name === RECOVERY_CHECKED_MARK) marks.push(options?.detail);
            return undefined as never;
        });
        const offered = offerRecovery(recovery, dialogs, () => false);
        await vi.advanceTimersByTimeAsync(0);
        const request = dialogs.store.getState().request as RecoveryRequest;
        expect(request.entries).toHaveLength(1);
        expect(request.entries[0]).toMatchObject({
            key: "old-key1",
            name: "Every member",
            mapCount: 2,
        });
        expect(request.entries[0]!.thumbnails.map((each) => each.name)).toHaveLength(2);
        expect(await offered).toBe(1);
        expect(marks).toEqual([{ offered: 1 }]);
        markSpy.mockRestore();
    });
});
