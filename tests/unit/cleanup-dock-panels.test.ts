import { describe, expect, it } from "vitest";
import { createSessionStore } from "../../src/app/state/session";
import { createShownSession } from "../../src/app/state/shownSession";
import { createMapSession, createProjectSession } from "../../src/core/model";
import { createConformanceProject } from "../support/conformanceProject";

// What the dock's sections show of the session (cleanup; ENGINE §6, tab switch): the session
// at once, a switch to another map after its frame, and no input while they show the map before.

/** A shown session of the conformance project whose waits for a frame the test ends. */
function harness() {
    const session = createProjectSession(createConformanceProject());
    const source = createSessionStore(session);
    const waits: { run(): void; cancelled: boolean }[] = [];
    const shown = createShownSession(source, (update) => {
        const wait = { run: update, cancelled: false };
        waits.push(wait);
        return () => {
            wait.cancelled = true;
        };
    });
    /** Makes `id` the active map, as `activateMap` does. */
    const activate = (id: string) => {
        const map = session.project.maps.find((each) => each.id === id)!;
        if (!session.perMap.has(id)) session.perMap.set(id, createMapSession(map));
        session.activeMapId = id;
        source.getState().touch();
    };
    const [first, second] = session.project.maps.map((map) => map.id) as [string, string];
    return { session, source, shown, waits, activate, first, second };
}

describe("the session the dock's sections show", () => {
    it("follows a change at once while the active map is the one shown", () => {
        const h = harness();
        expect(h.shown.store.getState().mapId).toBe(h.first);
        h.source.getState().touch();
        h.source.getState().touch();
        expect(h.shown.store.getState().revision).toBe(h.source.getState().revision);
        expect(h.shown.current()).toBe(true);
        expect(h.waits).toHaveLength(0);
    });

    it("follows a switch to another map after its frame, with the newest state", () => {
        const h = harness();
        const before = h.shown.store.getState();
        let told = 0;
        h.shown.store.subscribe(() => (told += 1));
        h.activate(h.second);
        // Nothing is told in the task of the switch: the sections do not render in it.
        expect(told).toBe(0);
        expect(h.shown.store.getState()).toBe(before);
        expect(h.shown.current()).toBe(false);
        expect(h.waits).toHaveLength(1);
        // Changes meanwhile wait with it, behind one wait.
        h.source.getState().touch();
        h.source.getState().touch();
        expect(told).toBe(0);
        expect(h.waits).toHaveLength(1);
        h.waits[0]!.run();
        expect(told).toBe(1);
        expect(h.shown.store.getState().mapId).toBe(h.second);
        expect(h.shown.store.getState().revision).toBe(h.source.getState().revision);
        expect(h.shown.current()).toBe(true);
        // At once again from here.
        h.source.getState().touch();
        expect(told).toBe(2);
        expect(h.waits).toHaveLength(1);
    });

    it("stops waiting when the map shown is active again", () => {
        const h = harness();
        h.activate(h.second);
        expect(h.shown.current()).toBe(false);
        h.activate(h.first);
        expect(h.waits[0]!.cancelled).toBe(true);
        expect(h.shown.current()).toBe(true);
        expect(h.shown.store.getState().mapId).toBe(h.first);
        expect(h.shown.store.getState().revision).toBe(h.source.getState().revision);
        // A switch after that waits for its own frame.
        h.activate(h.second);
        expect(h.waits).toHaveLength(2);
        expect(h.shown.store.getState().mapId).toBe(h.first);
    });

    it("follows another project, a closed project and a removed map at once", () => {
        const h = harness();
        h.activate(h.second);
        expect(h.shown.current()).toBe(false);
        // Another project: nothing of the one before is shown.
        const other = createProjectSession(createConformanceProject());
        h.source.getState().replace(other);
        expect(h.waits[0]!.cancelled).toBe(true);
        expect(h.shown.store.getState().session).toBe(other);
        expect(h.shown.store.getState().mapId).toBe(other.activeMapId);
        expect(h.shown.current()).toBe(true);
        // The map shown leaves the project while another becomes active.
        const [gone, next] = other.project.maps.map((map) => map.id) as [string, string];
        other.project.maps = other.project.maps.filter((map) => map.id !== gone);
        other.activeMapId = next;
        h.source.getState().touch();
        expect(h.shown.store.getState().mapId).toBe(next);
        expect(h.waits).toHaveLength(1);
        h.source.getState().close();
        expect(h.shown.store.getState().open).toBe(false);
        expect(h.shown.current()).toBe(true);
    });

    it("stops following when disposed", () => {
        const h = harness();
        h.activate(h.second);
        h.shown.dispose();
        expect(h.waits[0]!.cancelled).toBe(true);
        const revision = h.shown.store.getState().revision;
        h.source.getState().touch();
        expect(h.shown.store.getState().revision).toBe(revision);
    });
});
