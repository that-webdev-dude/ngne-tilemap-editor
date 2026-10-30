import { describe, expect, it } from "vitest";
import type { Command } from "../../src/core/history";
import { expectSymmetric } from "./support/symmetry";
import { LAYER, MAP, NOTHING, rename, setup, tile, tileLayer } from "./te-006-support";

// The do/undo symmetry harness of `tests/unit/support/symmetry.ts`: passes on a sample
// command and on a committed stroke, fails on a deliberately asymmetric one.

describe("expectSymmetric", () => {
    it("passes on a command whose undo reverses its do exactly", () => {
        const history = setup();
        const command = expectSymmetric(history, rename("a"), { rounds: 2 });
        expect(command.label).toBe("Rename to a");
        expect(history.session.project.name).toBe("a");
        expect(history.undoCount).toBe(1);
    });

    it("passes on a cell patch made by a stroke, replayed from a factory", () => {
        const history = setup();
        expectSymmetric(history, (session) => {
            const layer = tileLayer(session.project);
            const before = layer.cells.get(2, 2);
            return {
                label: "Paint",
                bytes: 12,
                touched: {
                    ...NOTHING,
                    mapId: MAP,
                    layerIds: [LAYER],
                    cellRects: [{ x: 2, y: 2, width: 1, height: 1 }],
                },
                do: () => void layer.cells.set(2, 2, tile(1)),
                undo: () => void layer.cells.set(2, 2, before),
            };
        });
        expect(tileLayer(history.session.project).cells.get(2, 2)).toBe(tile(1));
    });

    it("fails on a command whose undo leaves a trace", () => {
        const history = setup();
        const asymmetric: Command = {
            ...rename("a"),
            undo(session) {
                session.project.name = "Untitled ";
            },
        };
        expect(() => expectSymmetric(history, asymmetric)).toThrow(/undo 1 restores the project/);
    });

    it("fails on a command whose redo differs from its do", () => {
        const history = setup();
        let runs = 0;
        const drifting: Command = {
            ...rename("a"),
            do(session) {
                session.project.name = `a${++runs}`;
            },
            undo(session) {
                session.project.name = "Untitled";
            },
        };
        expect(() => expectSymmetric(history, drifting)).toThrow(/redo 1 repeats the change/);
    });

    it("fails on a command that leaves a cell the undo does not clear", () => {
        const history = setup();
        const leaking: Command = {
            label: "Leak",
            bytes: 0,
            touched: { ...NOTHING, mapId: MAP, layerIds: [LAYER] },
            do(session) {
                tileLayer(session.project).cells.set(0, 0, tile(0));
                tileLayer(session.project).cells.set(5, 5, tile(1));
            },
            undo(session) {
                tileLayer(session.project).cells.set(0, 0, 0);
            },
        };
        expect(() => expectSymmetric(history, leaking)).toThrow(/undo 1 restores the project/);
    });

    it("fails on a command that breaks an invariant", () => {
        const history = setup();
        const invalid: Command = {
            ...rename("a"),
            do(session) {
                session.project.name = "";
            },
        };
        expect(() => expectSymmetric(history, invalid)).toThrow(/project-name/);
    });
});
