import { describe, expect, it } from "vitest";
import { currentCollidables } from "../../src/app/tilesets/collision/collision.overlay";
import { createHistorySteps } from "../../src/app/state/historySteps";
import { createSessionStore, sessionStore } from "../../src/app/state/session";
import type { Shape } from "../../src/core/model";
import { setCollisionCommand } from "../../src/core/tileset";
import { newSession } from "./te-006-support";

// TE-029: the index of collision shapes behind Show Collision is rebuilt after a step of the
// history or a new project, and reused when only the view changed (`touch`): a pan or zoom
// must not scan every tile of every tileset.

const RECT: Shape = { shape: "rectangle", x: 1, y: 2, width: 3, height: 4 };

/** Puts a fresh session in the app's store, so each test starts from an empty history. */
function start() {
    sessionStore.getState().replace(newSession());
    return sessionStore.getState();
}

describe("history steps", () => {
    it("rise on do, undo and redo and on replace, not on touch", () => {
        const store = createSessionStore(newSession());
        const steps = createHistorySteps(store);
        const step = () => steps.getState().step;
        expect(step()).toBe(0);
        store.getState().touch();
        expect(step()).toBe(0);
        store.getState().history.execute(setCollisionCommand("ts", [0], [RECT], "add"));
        expect(step()).toBe(1);
        store.getState().history.undo();
        expect(step()).toBe(2);
        store.getState().history.redo();
        expect(step()).toBe(3);
        store.getState().touch();
        expect(step()).toBe(3);
        store.getState().replace(newSession());
        expect(step()).toBe(4);
        // The new history is followed, the dropped one is not.
        store.getState().history.execute(setCollisionCommand("ts", [0], [RECT], "add"));
        expect(step()).toBe(5);
    });
});

describe("collision index of Show Collision", () => {
    it("is the same index after touch()", () => {
        start();
        const index = currentCollidables();
        sessionStore.getState().touch();
        sessionStore.getState().touch();
        expect(currentCollidables()).toBe(index);
    });

    it("is rebuilt after a collision command, its undo and its redo", () => {
        const { history } = start();
        const empty = currentCollidables();
        expect(empty.size).toBe(0);

        history.execute(setCollisionCommand("ts", [0], [RECT], "add"));
        const added = currentCollidables();
        expect(added).not.toBe(empty);
        expect(added.get(1)?.shapes.get(0)).toStrictEqual([RECT]);
        sessionStore.getState().touch();
        expect(currentCollidables()).toBe(added);

        history.undo();
        const undone = currentCollidables();
        expect(undone).not.toBe(added);
        expect(undone.size).toBe(0);

        history.redo();
        const redone = currentCollidables();
        expect(redone).not.toBe(undone);
        expect(redone.get(1)?.shapes.get(0)).toStrictEqual([RECT]);
    });

    it("is rebuilt for another project after replace()", () => {
        const { history } = start();
        history.execute(setCollisionCommand("ts", [0], [RECT], "add"));
        const first = currentCollidables();
        expect(first.size).toBe(1);
        sessionStore.getState().replace(newSession());
        const second = currentCollidables();
        expect(second).not.toBe(first);
        expect(second.size).toBe(0);
    });
});
