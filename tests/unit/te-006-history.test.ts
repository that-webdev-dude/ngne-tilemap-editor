import { describe, expect, it } from "vitest";
import {
    AllocationError,
    DEFAULT_HISTORY_BUDGET_BYTES,
    History,
    TransactionError,
    compositeCommand,
    mergeTouched,
} from "../../src/core/history";
import type { Command, HistoryChange, Touched } from "../../src/core/history";
import { InvariantError, assertInvariants } from "../../src/core/model";
import { snapshotProject } from "./support/symmetry";
import {
    LAYER,
    MAP,
    MB,
    NOTHING,
    commit,
    execute,
    failingAllocator,
    newSession,
    redo,
    rename,
    setup,
    tile,
    undo,
} from "./te-006-support";

// The undo history of SPEC §3: one per project, undo/redo order, redo cleared by a new
// command, the 256 MB budget that keeps the newest entry, and allocation failure leaving the
// project and the history unchanged.

describe("History", () => {
    it("executes a command on its session and offers it for undo", () => {
        const history = setup();
        expect(history.canUndo).toBe(false);
        expect(history.canRedo).toBe(false);
        expect(history.undoLabel).toBeNull();
        expect(history.redoLabel).toBeNull();

        execute(history, rename("a"));

        expect(history.session.project.name).toBe("a");
        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(0);
        expect(history.canUndo).toBe(true);
        expect(history.canRedo).toBe(false);
        expect(history.undoLabel).toBe("Rename to a");
        expect(history.redoLabel).toBeNull();
    });

    it("undoes and redoes the commands in order, with the labels for menu text", () => {
        const history = setup();
        for (const name of ["a", "b", "c"]) execute(history, rename(name));

        undo(history);
        expect(history.session.project.name).toBe("b");
        expect(history.undoLabel).toBe("Rename to b");
        expect(history.redoLabel).toBe("Rename to c");
        undo(history);
        expect(history.session.project.name).toBe("a");
        undo(history);
        expect(history.session.project.name).toBe("Untitled");
        expect(history.undoLabel).toBeNull();
        expect(history.redoLabel).toBe("Rename to a");
        expect(history.undoCount).toBe(0);
        expect(history.redoCount).toBe(3);

        redo(history);
        expect(history.session.project.name).toBe("a");
        redo(history);
        expect(history.session.project.name).toBe("b");
        redo(history);
        expect(history.session.project.name).toBe("c");
        expect(history.undoLabel).toBe("Rename to c");
        expect(history.redoLabel).toBeNull();
    });

    it("returns false and changes nothing when there is nothing to undo or redo", () => {
        const history = setup();
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));
        const before = snapshotProject(history.session.project);

        expect(history.undo()).toBe(false);
        expect(history.redo()).toBe(false);

        expect(snapshotProject(history.session.project)).toStrictEqual(before);
        expect(changes).toEqual([]);
    });

    it("a new command after undo clears redo", () => {
        const history = setup();
        for (const name of ["a", "b", "c"]) execute(history, rename(name, 10));
        undo(history);
        undo(history);
        expect(history.redoCount).toBe(2);
        expect(history.canRedo).toBe(true);
        expect(history.bytes).toBe(30);

        execute(history, rename("d", 10));

        expect(history.redoCount).toBe(0);
        expect(history.canRedo).toBe(false);
        expect(history.redoLabel).toBeNull();
        expect(history.redo()).toBe(false);
        expect(history.session.project.name).toBe("d");
        expect(history.undoCount).toBe(2);
        expect(history.bytes).toBe(20);
        undo(history);
        expect(history.session.project.name).toBe("a");
        redo(history);
        expect(history.session.project.name).toBe("d");
    });

    it("records the map of each entry, or none for a project-wide command", () => {
        const history = setup();
        const onMap: Touched = { ...NOTHING, mapId: MAP, layerIds: [LAYER] };
        expect(history.undoMapId).toBeUndefined();
        expect(history.redoMapId).toBeUndefined();

        execute(history, rename("a", 0, onMap));
        execute(history, rename("b"));

        expect(history.undoMapId).toBeNull();
        undo(history);
        expect(history.undoMapId).toBe(MAP);
        expect(history.redoMapId).toBeNull();
        undo(history);
        expect(history.undoMapId).toBeUndefined();
        expect(history.redoMapId).toBe(MAP);
    });

    it("reports kind, label and touched of every step to subscribers, after the change", () => {
        const history = setup();
        const touched: Touched = {
            mapId: MAP,
            layerIds: [LAYER],
            cellRects: [{ x: 0, y: 0, width: 2, height: 2 }],
            tilesetIds: ["ts"],
            structure: true,
        };
        const seen: Array<HistoryChange & { name: string }> = [];
        history.subscribe((change) => seen.push({ ...change, name: history.session.project.name }));

        execute(history, rename("a", 0, touched));
        execute(history, rename("b"));
        undo(history);
        undo(history);
        redo(history);

        expect(seen).toEqual([
            { kind: "do", label: "Rename to a", touched, name: "a" },
            { kind: "do", label: "Rename to b", touched: NOTHING, name: "b" },
            { kind: "undo", label: "Rename to b", touched: NOTHING, name: "a" },
            { kind: "undo", label: "Rename to a", touched, name: "Untitled" },
            { kind: "redo", label: "Rename to a", touched, name: "a" },
        ]);
    });

    it("stops calling a listener once it has unsubscribed", () => {
        const history = setup();
        const first: string[] = [];
        const second: string[] = [];
        const unsubscribe = history.subscribe((change) => first.push(change.kind));
        history.subscribe((change) => second.push(change.kind));

        execute(history, rename("a"));
        unsubscribe();
        undo(history);

        expect(first).toEqual(["do"]);
        expect(second).toEqual(["do", "undo"]);
    });

    it("does not record a command whose do throws, and keeps redo", () => {
        const history = setup();
        execute(history, rename("a"));
        execute(history, rename("b"));
        undo(history);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));
        const position = history.position;
        const failing: Command = {
            ...rename("x"),
            do() {
                throw new Error("no");
            },
        };

        expect(() => history.execute(failing)).toThrow("no");

        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(1);
        expect(history.position).toBe(position);
        expect(changes).toEqual([]);
        redo(history);
        expect(history.session.project.name).toBe("b");
    });

    it("keeps its place when undo or redo throws", () => {
        const history = setup();
        let broken = false;
        const base = rename("a");
        const fragile: Command = {
            ...base,
            do(session) {
                if (broken) throw new Error("redo failed");
                base.do(session);
            },
            undo(session) {
                if (broken) throw new Error("undo failed");
                base.undo(session);
            },
        };
        execute(history, fragile);
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        broken = true;
        expect(() => history.undo()).toThrow("undo failed");
        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(0);
        broken = false;
        undo(history);

        broken = true;
        expect(() => history.redo()).toThrow("redo failed");
        expect(history.undoCount).toBe(0);
        expect(history.redoCount).toBe(1);
        broken = false;
        redo(history);

        expect(changes.map((change) => change.kind)).toEqual(["undo", "redo"]);
    });

    it("runs the verifier after every command and reverses a step that breaks an invariant", () => {
        const history = setup();
        const breaking: Command = {
            label: "Blank the name",
            bytes: 0,
            touched: NOTHING,
            do(session) {
                session.project.name = "";
            },
            undo(session) {
                session.project.name = "Untitled";
            },
        };
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        expect(() => history.execute(breaking)).toThrow(InvariantError);

        expect(history.session.project.name).toBe("Untitled");
        expect(history.undoCount).toBe(0);
        expect(changes).toEqual([]);
        assertInvariants(history.session.project);
    });

    it("verifies with assertInvariants by default under tests and development builds", () => {
        const history = new History(newSession());
        const breaking: Command = {
            ...rename("x"),
            do(session) {
                session.project.name = "";
            },
            undo(session) {
                session.project.name = "Untitled";
            },
        };
        expect(() => history.execute(breaking)).toThrow(InvariantError);
        expect(history.session.project.name).toBe("Untitled");
        expect(history.undoCount).toBe(0);
    });

    it("re-does a step whose undo breaks an invariant and keeps it done", () => {
        const history = setup();
        const lopsided: Command = {
            ...rename("a"),
            undo(session) {
                session.project.name = "";
            },
        };
        execute(history, lopsided);
        expect(() => history.undo()).toThrow(InvariantError);
        expect(history.session.project.name).toBe("a");
        expect(history.undoCount).toBe(1);
    });

    it("runs no verifier when told so", () => {
        const history = new History(newSession(), { verify: null });
        history.execute({
            label: "Blank the name",
            bytes: 0,
            touched: NOTHING,
            do(session) {
                session.project.name = "";
            },
            undo(session) {
                session.project.name = "Untitled";
            },
        });
        expect(history.session.project.name).toBe("");
        expect(history.undoCount).toBe(1);
    });

    it("position identifies the project state for the dirty rule", () => {
        const history = setup();
        const start = history.position;
        execute(history, rename("a"));
        const afterA = history.position;
        execute(history, rename("b"));
        const afterB = history.position;
        expect(new Set([start, afterA, afterB]).size).toBe(3);

        undo(history);
        expect(history.position).toBe(afterA);
        redo(history);
        expect(history.position).toBe(afterB);
        undo(history);
        undo(history);
        expect(history.position).toBe(start);

        execute(history, rename("c"));
        expect([start, afterA, afterB]).not.toContain(history.position);
        undo(history);
        expect(history.position).toBe(start);
    });

    it("refuses execute, undo, redo and begin while a transaction is open", () => {
        const history = setup();
        execute(history, rename("a"));
        undo(history);
        history.begin({ mapId: MAP, layerId: LAYER });

        expect(() => history.execute(rename("b"))).toThrow(TransactionError);
        expect(() => history.undo()).toThrow(TransactionError);
        expect(() => history.redo()).toThrow(TransactionError);
        expect(() => history.begin({ mapId: MAP, layerId: LAYER })).toThrow(TransactionError);

        history.transaction!.abort();
        expect(history.transaction).toBeNull();
        redo(history);
        expect(history.session.project.name).toBe("a");
    });
});

describe("History memory budget", () => {
    it("is 256 MB unless another budget is given", () => {
        expect(DEFAULT_HISTORY_BUDGET_BYTES).toBe(256 * MB);
        expect(setup().budgetBytes).toBe(268_435_456);
        expect(setup({ budgetBytes: 1000 }).budgetBytes).toBe(1000);
    });

    it("keeps every command while the total is within the budget", () => {
        const history = setup();
        execute(history, rename("a", 128 * MB));
        execute(history, rename("b", 128 * MB));

        expect(history.bytes).toBe(256 * MB);
        expect(history.undoCount).toBe(2);
    });

    it("exceeding the budget drops the oldest commands only", () => {
        const history = setup();
        execute(history, rename("a", 100 * MB));
        execute(history, rename("b", 100 * MB));
        expect(history.undoCount).toBe(2);

        execute(history, rename("c", 100 * MB));

        expect(history.undoCount).toBe(2);
        expect(history.bytes).toBe(200 * MB);
        expect(history.session.project.name).toBe("c");
        expect(history.undoLabel).toBe("Rename to c");
        undo(history);
        expect(history.undoLabel).toBe("Rename to b");

        redo(history);
        for (const name of ["d", "e", "f"]) {
            execute(history, rename(name, 100 * MB));
            expect(history.undoCount).toBe(2);
            expect(history.bytes).toBe(200 * MB);
        }
        undo(history);
        undo(history);
        expect(history.session.project.name).toBe("d");
    });

    it("drops as many of the oldest commands as the newest one needs", () => {
        const history = setup({ budgetBytes: 100 });
        for (const name of ["a", "b", "c", "d"]) execute(history, rename(name, 25));
        expect(history.undoCount).toBe(4);

        execute(history, rename("e", 60));

        // 25 + 25 + 25 + 25 + 60 = 160: "a", "b" and "c" go, "d" and "e" (85) stay.
        expect(history.undoCount).toBe(2);
        expect(history.bytes).toBe(85);
        undo(history);
        undo(history);
        expect(history.session.project.name).toBe("c");
        expect(history.canUndo).toBe(false);
    });

    it("undo stops at the oldest retained command", () => {
        const history = setup();
        const start = history.position;
        for (const name of ["a", "b", "c"]) execute(history, rename(name, 100 * MB));

        undo(history);
        undo(history);

        expect(history.session.project.name).toBe("a");
        expect(history.canUndo).toBe(false);
        expect(history.undoLabel).toBeNull();
        expect(history.undo()).toBe(false);
        expect(history.session.project.name).toBe("a");
        expect(history.position).not.toBe(start);

        redo(history);
        redo(history);
        expect(history.session.project.name).toBe("c");
    });

    it("keeps a single command larger than the budget as the newest entry, still undoable", () => {
        const history = setup();
        execute(history, rename("a", 10 * MB));
        execute(history, rename("b", 300 * MB));

        expect(history.undoCount).toBe(1);
        expect(history.bytes).toBe(300 * MB);
        expect(history.undoLabel).toBe("Rename to b");
        undo(history);
        expect(history.session.project.name).toBe("a");
        expect(history.undo()).toBe(false);
        redo(history);
        expect(history.session.project.name).toBe("b");
    });

    it("frees the memory of entries that eviction and a new command drop", () => {
        const history = setup({ budgetBytes: 100 });
        execute(history, rename("a", 40));
        execute(history, rename("b", 40));
        undo(history);
        execute(history, rename("c", 50));
        expect(history.bytes).toBe(90);
        execute(history, rename("d", 50));
        expect(history.bytes).toBe(100);
        expect(history.undoCount).toBe(2);
    });
});

describe("History allocation failure", () => {
    it("leaves the project and the history unchanged when a stroke cannot be stored", () => {
        const history = setup({ allocate: failingAllocator });
        execute(history, rename("a"));
        const before = snapshotProject(history.session.project);
        const position = history.position;
        const changes: HistoryChange[] = [];
        history.subscribe((change) => changes.push(change));

        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.set(1, 1, tile(0));
        stroke.set(2, 2, tile(1));
        expect(() => stroke.commit("Stamp Brush")).toThrow(AllocationError);

        expect(stroke.open).toBe(false);
        expect(history.transaction).toBeNull();
        expect(snapshotProject(history.session.project)).toStrictEqual(before);
        expect(history.undoCount).toBe(1);
        expect(history.redoCount).toBe(0);
        expect(history.bytes).toBe(0);
        expect(changes).toEqual([]);
        expect(history.position).toBe(position);
        undo(history);
        expect(history.session.project.name).toBe("Untitled");
    });

    it("names the bytes it could not get and keeps the platform's cause", () => {
        const history = setup({ allocate: failingAllocator });
        const stroke = history.begin({ mapId: MAP, layerId: LAYER });
        stroke.set(0, 0, tile(1));
        let error: unknown;
        try {
            commit(history, "Stamp Brush");
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(AllocationError);
        expect((error as AllocationError).bytes).toBe(12);
        expect((error as AllocationError).cause).toBeInstanceOf(RangeError);
    });
});

describe("compositeCommand and mergeTouched", () => {
    it("does its parts in order and undoes them in reverse as one entry", () => {
        const history = setup();
        const order: string[] = [];
        const part = (name: string): Command => ({
            label: name,
            bytes: 5,
            touched: { ...NOTHING, mapId: MAP, layerIds: [1] },
            do: () => void order.push(`do ${name}`),
            undo: () => void order.push(`undo ${name}`),
        });
        const composite = compositeCommand("Both", [part("a"), part("b")]);
        expect(composite.bytes).toBe(10);
        expect(composite.touched).toEqual({ ...NOTHING, mapId: MAP, layerIds: [1] });

        execute(history, composite);
        undo(history);
        expect(order).toEqual(["do a", "do b", "undo b", "undo a"]);
        expect(history.undoCount).toBe(0);
    });

    it("reverses the parts already done when a later part throws", () => {
        const history = setup();
        const good = rename("a");
        const bad: Command = {
            ...rename("b"),
            do() {
                throw new Error("bad part");
            },
        };
        expect(() => history.execute(compositeCommand("Both", [good, bad]))).toThrow("bad part");
        expect(history.session.project.name).toBe("Untitled");
        expect(history.undoCount).toBe(0);
    });

    it("merges touched records: IDs and rectangles once, one map or none", () => {
        const a: Touched = {
            mapId: MAP,
            layerIds: [1, 2],
            cellRects: [{ x: 0, y: 0, width: 1, height: 1 }],
            tilesetIds: ["ts"],
            structure: false,
        };
        const b: Touched = {
            mapId: MAP,
            layerIds: [2, 3],
            cellRects: [
                { x: 0, y: 0, width: 1, height: 1 },
                { x: 4, y: 4, width: 2, height: 2 },
            ],
            tilesetIds: [],
            structure: true,
        };
        expect(mergeTouched([a, b])).toEqual({
            mapId: MAP,
            layerIds: [1, 2, 3],
            cellRects: [
                { x: 0, y: 0, width: 1, height: 1 },
                { x: 4, y: 4, width: 2, height: 2 },
            ],
            tilesetIds: ["ts"],
            structure: true,
        });
        expect(mergeTouched([a, { ...b, mapId: "other" }]).mapId).toBeNull();
        expect(mergeTouched([a, NOTHING]).mapId).toBe(MAP);
        expect(mergeTouched([]).mapId).toBeNull();
    });
});
