import { describe, expect, it } from "vitest";
import { History } from "../../src/core/history";
import type { Command } from "../../src/core/history";
import {
    MEMORY_LIMIT_BYTES,
    MEMORY_WARN_BYTES,
    MemoryLimitError,
    accountMemory,
    assertInvariants,
} from "../../src/core/model";
import type { Tileset } from "../../src/core/model";
import { snapshotProject } from "./support/symmetry";
import {
    LAYER,
    MAP,
    MB,
    NOTHING,
    execute,
    newSession,
    redo,
    rename,
    setup,
    tile,
    tileset,
    undo,
} from "./te-006-support";

// Dirty state (SPEC §3) and the memory guard (SPEC §2.2): refusal above 1 GB with the project
// unchanged, one warning per crossing of 512 MB.

describe("History dirty state", () => {
    it("is clean on a new project and set by a command", () => {
        const history = setup();
        expect(history.dirty).toBe(false);
        execute(history, rename("a"));
        expect(history.dirty).toBe(true);
    });

    it("is cleared by marking saved and set again by undo past the save point", () => {
        const history = setup();
        execute(history, rename("a"));
        execute(history, rename("b"));
        history.markSaved();
        expect(history.dirty).toBe(false);

        undo(history);
        expect(history.dirty).toBe(true);
        redo(history);
        expect(history.dirty).toBe(false);
        execute(history, rename("c"));
        expect(history.dirty).toBe(true);
        undo(history);
        expect(history.dirty).toBe(false);
    });

    it("stays dirty after undoing to the save point and doing a different command", () => {
        const history = setup();
        execute(history, rename("a"));
        history.markSaved();
        undo(history);
        execute(history, rename("a"));
        expect(history.dirty).toBe(true);
    });

    it("is set by an export-settings change and cleared by the next save", () => {
        const history = setup();
        history.markSaved();
        history.session.project.exportSettings.exportOnSave = true;
        expect(history.dirty).toBe(true);
        history.session.project.exportSettings.exportOnSave = false;
        expect(history.dirty).toBe(false);
        const position = history.position;
        history.session.project.exportSettings.exportOnSave = true;
        history.markSaved();
        expect(history.dirty).toBe(false);
        expect(history.position).toBe(position);
    });

    it("is dirty while a committed stroke is not saved", () => {
        const history = setup();
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.set(0, 0, tile(1));
        stroke.commit("Stamp Brush");
        expect(history.dirty).toBe(true);
        history.markSaved();
        expect(history.dirty).toBe(false);
    });
});

/**
 * A tileset whose `pixels` claim `bytes` of memory without allocating them. The invariants
 * refuse it (a valid project holds at most 256 MB of tileset pixels), so the memory-guard
 * tests run with `verify: null`: the guard and the warning are what they test.
 */
function claimedTileset(id: string, slot: number, bytes: number): Tileset {
    const set = tileset(id, slot);
    set.pixels = { width: 1, height: bytes / 4, data: new Uint8ClampedArray(0) };
    return set;
}

/** A command that adds `tileset` to the project. */
function addTileset(set: Tileset, projectBytes?: number): Command {
    return {
        label: `Add ${set.id}`,
        bytes: 0,
        touched: { ...NOTHING, tilesetIds: [set.id], structure: true },
        ...(projectBytes === undefined ? {} : { projectBytes }),
        do(session) {
            session.project.tilesets.push(set);
        },
        undo(session) {
            session.project.tilesets.pop();
        },
    };
}

describe("History memory guard", () => {
    it("refuses a command that declares more memory than the limit allows, before do", () => {
        const history = new History(newSession(), { verify: null });
        const before = snapshotProject(history.session.project);
        let ran = false;
        const huge: Command = {
            ...rename("x"),
            projectBytes: MEMORY_LIMIT_BYTES + 1,
            do() {
                ran = true;
            },
        };

        expect(() => history.execute(huge)).toThrow(MemoryLimitError);

        expect(ran).toBe(false);
        expect(snapshotProject(history.session.project)).toStrictEqual(before);
        expect(history.undoCount).toBe(0);
        assertInvariants(history.session.project);
    });

    it("refuses a command that took the project past the limit, undoing it", () => {
        const history = new History(newSession(), { verify: null });
        const before = snapshotProject(history.session.project);
        const warnings: number[] = [];
        history.onMemoryWarning((bytes) => warnings.push(bytes));

        expect(() =>
            history.execute(addTileset(claimedTileset("big", 2, MEMORY_LIMIT_BYTES + 4 * MB))),
        ).toThrow(MemoryLimitError);

        expect(snapshotProject(history.session.project)).toStrictEqual(before);
        expect(history.undoCount).toBe(0);
        expect(history.dirty).toBe(false);
        expect(warnings).toEqual([]);
    });

    it("refuses a redo that would pass the limit and keeps the entry undone", () => {
        const history = new History(newSession(), { verify: null });
        history.execute(addTileset(claimedTileset("first", 2, 600 * MB)));
        expect(history.undo()).toBe(true);
        history.session.project.tilesets.push(claimedTileset("meanwhile", 3, 600 * MB));
        const before = snapshotProject(history.session.project);

        expect(() => history.redo()).toThrow(MemoryLimitError);

        expect(snapshotProject(history.session.project)).toStrictEqual(before);
        expect(history.redoCount).toBe(1);
        expect(history.undoCount).toBe(0);
        history.session.project.tilesets.pop();
        expect(history.redo()).toBe(true);
        expect(history.session.project.tilesets.map((set) => set.id)).toEqual(["ts", "first"]);
    });

    it("refuses a stroke whose chunks pass the limit and restores its cells", () => {
        const history = new History(newSession(64, 64), { verify: null });
        history.execute(addTileset(claimedTileset("near", 2, MEMORY_LIMIT_BYTES - 2048)));
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.set(0, 0, tile(1));

        expect(() => stroke.commit("Stamp Brush")).toThrow(MemoryLimitError);

        expect(history.session.project.maps[0]!.layers[0]).toMatchObject({ type: "tile" });
        expect(accountMemory(history.session.project).cellBytes).toBe(0);
        expect(history.undoCount).toBe(1);
        expect(history.transaction).toBeNull();
    });

    it("warns once per crossing of 512 MB", () => {
        const history = new History(newSession(), { verify: null });
        const warnings: number[] = [];
        history.onMemoryWarning((bytes) => warnings.push(bytes));

        history.execute(addTileset(claimedTileset("a", 2, 300 * MB)));
        expect(warnings).toEqual([]);
        history.execute(addTileset(claimedTileset("b", 3, 300 * MB)));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toBeGreaterThan(MEMORY_WARN_BYTES);
        history.execute(addTileset(claimedTileset("c", 4, 100 * MB)));
        expect(warnings).toHaveLength(1);

        expect(history.undo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(warnings).toHaveLength(1);
        expect(history.redo()).toBe(true);
        expect(warnings).toHaveLength(2);
        expect(history.undo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(warnings).toHaveLength(3);
    });

    it("does not warn for a project already above the threshold when the history opens", () => {
        const session = newSession();
        session.project.tilesets.push(claimedTileset("a", 2, 600 * MB));
        const history = new History(session, { verify: null });
        const warnings: number[] = [];
        history.onMemoryWarning((bytes) => warnings.push(bytes));

        history.execute(rename("a"));
        expect(warnings).toEqual([]);
        history.execute(addTileset(claimedTileset("b", 3, 100 * MB)));
        expect(warnings).toEqual([]);
    });

    it("stops warning a listener that unsubscribed", () => {
        const history = new History(newSession(), { verify: null });
        const warnings: number[] = [];
        const stop = history.onMemoryWarning((bytes) => warnings.push(bytes));
        stop();
        history.execute(addTileset(claimedTileset("a", 2, 600 * MB)));
        expect(warnings).toEqual([]);
    });
});
