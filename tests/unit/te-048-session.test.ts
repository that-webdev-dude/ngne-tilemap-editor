import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import {
    SESSION_WRITE_DELAY_MS,
    applySessionRecord,
    createSessionMemory,
    sessionRecordOf,
} from "../../src/app/autosave/sessionState";
import type { SessionRecord, SessionStateStorage } from "../../src/app/autosave/sessionState";
import { createSessionStore } from "../../src/app/state/session";
import { followSession } from "../../src/app/tabs/tabs";
import type { MapTabsState } from "../../src/app/tabs/tabs";
import { createMapSession, createProjectSession } from "../../src/core/model";
import type { Project } from "../../src/core/model";
import { everyMemberProject } from "./te-046-support";

// TE-048: the session state kept per project ID, best effort (SPEC §10.1): open map tabs and
// the active one, each map's view and active layer, restored when the project is opened again.

const TOWN = "map-town";
const DUNGEON = "map-dungeon";

class MemorySessionState implements SessionStateStorage {
    readonly records = new Map<string, SessionRecord>();
    puts = 0;
    async get(projectId: string) {
        return this.records.get(projectId);
    }
    async put(record: SessionRecord) {
        this.puts++;
        this.records.set(record.projectId, structuredClone(record));
    }
}

function setup() {
    const sessions = createSessionStore(null, { verify: null });
    const tabs = createStore<MapTabsState>(() => ({ open: [] }));
    const stopTabs = followSession(sessions, tabs);
    const storage = new MemorySessionState();
    const memory = createSessionMemory({ sessions, tabs, storage });
    return { sessions, tabs, storage, memory, stopTabs };
}

/** The same project as a file read again gives it: another object, the same ID. */
function reopened(): Project {
    return everyMemberProject();
}

/** The deepest layer ID of the dungeon map that is not its first layer. */
function otherLayer(project: Project, mapId: string): number {
    const map = project.maps.find((each) => each.id === mapId)!;
    return map.layers.at(-1)!.id;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("te-048 session state", () => {
    it("reopening a project restores its tabs, active map, views and active layers", async () => {
        const { sessions, tabs, storage, memory } = setup();
        sessions.getState().replace(createProjectSession(reopened()));
        await memory.idle();
        const { session, touch } = sessions.getState();
        // Both maps shown, the dungeon active with another layer and a view of its own.
        const dungeon = session.project.maps.find((map) => map.id === DUNGEON)!;
        session.perMap.set(DUNGEON, {
            ...createMapSession(dungeon),
            activeLayerId: otherLayer(session.project, DUNGEON),
            view: { centreX: 40, centreY: 24, zoom: 4 },
        });
        session.perMap.get(TOWN)!.view = { centreX: 10, centreY: 12, zoom: 0.5 };
        session.activeMapId = DUNGEON;
        touch();
        tabs.setState({ open: [DUNGEON, TOWN] });
        await vi.advanceTimersByTimeAsync(SESSION_WRITE_DELAY_MS);
        await memory.idle();
        expect(storage.records.get("project-1")).toMatchObject({
            tabs: [DUNGEON, TOWN],
            activeMapId: DUNGEON,
        });

        // Closed, then opened again from its file.
        sessions.getState().close();
        sessions.getState().replace(createProjectSession(reopened()));
        expect(sessions.getState().session.activeMapId).toBe(TOWN);
        await memory.idle();
        const restored = sessions.getState().session;
        expect(restored.activeMapId).toBe(DUNGEON);
        expect(tabs.getState().open).toEqual([DUNGEON, TOWN]);
        expect(restored.perMap.get(DUNGEON)).toMatchObject({
            activeLayerId: otherLayer(restored.project, DUNGEON),
            view: { centreX: 40, centreY: 24, zoom: 4 },
        });
        expect(restored.perMap.get(TOWN)!.view).toEqual({ centreX: 10, centreY: 12, zoom: 0.5 });
    });

    it("keeps what the project showed when another project takes the window", async () => {
        const { sessions, tabs, storage, memory } = setup();
        sessions.getState().replace(createProjectSession(reopened()));
        await memory.idle();
        sessions.getState().session.perMap.get(TOWN)!.view.zoom = 3;
        sessions.getState().touch();
        tabs.setState({ open: [TOWN] });
        // No delay: the project goes at once.
        sessions.getState().close();
        await memory.idle();
        expect(storage.records.get("project-1")!.maps).toEqual([
            expect.objectContaining({ mapId: TOWN, view: expect.objectContaining({ zoom: 3 }) }),
        ]);
    });

    it("Revert (the same project ID again) restores nothing", async () => {
        const { sessions, storage, memory } = setup();
        storage.records.set("project-1", {
            projectId: "project-1",
            savedAt: 0,
            tabs: [DUNGEON],
            activeMapId: DUNGEON,
            maps: [],
        });
        sessions.getState().replace(createProjectSession(reopened()));
        await memory.idle();
        expect(sessions.getState().session.activeMapId).toBe(DUNGEON);
        sessions.getState().session.activeMapId = TOWN;
        sessions.getState().touch();
        sessions.getState().replace(createProjectSession(reopened()));
        await memory.idle();
        expect(sessions.getState().session.activeMapId).toBe(TOWN);
    });

    it("a restore that comes after the user moved to another map changes nothing", async () => {
        const { sessions, storage, memory } = setup();
        storage.records.set("project-1", {
            projectId: "project-1",
            savedAt: 0,
            tabs: [TOWN],
            activeMapId: TOWN,
            maps: [{ mapId: TOWN, view: { centreX: 1, centreY: 2, zoom: 8 }, activeLayerId: 0 }],
        });
        sessions.getState().replace(createProjectSession(reopened()));
        // The user shows the dungeon before the stored state is read.
        const { session } = sessions.getState();
        session.perMap.set(DUNGEON, createMapSession(session.project.maps[1]!));
        session.activeMapId = DUNGEON;
        sessions.getState().touch();
        await memory.idle();
        expect(sessions.getState().session.activeMapId).toBe(DUNGEON);
        expect(sessions.getState().session.perMap.get(TOWN)!.view.zoom).toBe(1);
    });

    it("applies only what still exists: maps, layers, valid views", () => {
        const session = createProjectSession(reopened());
        const tabsOpen = applySessionRecord(session, {
            projectId: "project-1",
            savedAt: 0,
            tabs: ["gone", DUNGEON, DUNGEON],
            activeMapId: "gone",
            maps: [
                { mapId: "gone", view: { centreX: 1, centreY: 1, zoom: 1 }, activeLayerId: 1 },
                { mapId: DUNGEON, view: { centreX: 1, centreY: 2, zoom: 0 }, activeLayerId: 9999 },
            ],
        });
        expect(tabsOpen).toEqual([DUNGEON, TOWN]);
        expect(session.activeMapId).toBe(TOWN);
        const dungeon = session.perMap.get(DUNGEON)!;
        expect(dungeon.view).toEqual(createMapSession(session.project.maps[1]!).view);
        expect(dungeon.activeLayerId).toBe(
            createMapSession(session.project.maps[1]!).activeLayerId,
        );
        expect(
            applySessionRecord(createProjectSession(reopened()), {
                projectId: "project-1",
                savedAt: 0,
                tabs: ["gone"],
                activeMapId: "gone",
                maps: [],
            }),
        ).toBeNull();
    });

    it("records only maps of the project", () => {
        const session = createProjectSession(reopened());
        session.perMap.set("gone", createMapSession(session.project.maps[0]!));
        const record = sessionRecordOf(session, [TOWN, "gone"], 5);
        expect(record).toEqual({
            projectId: "project-1",
            savedAt: 5,
            tabs: [TOWN],
            activeMapId: TOWN,
            maps: [
                {
                    mapId: TOWN,
                    view: session.perMap.get(TOWN)!.view,
                    activeLayerId: session.perMap.get(TOWN)!.activeLayerId,
                },
            ],
        });
    });
});
