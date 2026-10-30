import { expect } from "vitest";
import type { Command, History } from "../../../src/core/history";
import { assertInvariants } from "../../../src/core/model";
import type { Project, ProjectSession } from "../../../src/core/model";

// Do/undo symmetry harness (SPEC §15: "do/undo symmetry of every command"). A ticket that adds
// a command runs `expectSymmetric` on it: the command is executed through a history, undone,
// redone and undone again, and after every step the project must equal the snapshot taken at
// the same state and satisfy the invariants. An assertion failure is the usual Vitest error.

/** A command, or a factory that makes one from the session as it is before the step. */
export type CommandSource = Command | ((session: ProjectSession) => Command);

/**
 * A deep copy of the project for comparison. Typed arrays, maps and the cell stores copy by
 * value; comparing two snapshots with `toStrictEqual` compares every cell.
 */
export function snapshotProject(project: Project): Project {
    return structuredClone(project);
}

export interface SymmetryOptions {
    /** How many undo–redo rounds to run after the first; the default is 1. */
    rounds?: number;
}

/**
 * Executes `source` on `history`, then undoes and redoes it `1 + rounds` times, checking
 * after each step that the project equals its snapshot at that state (before, after),
 * satisfies the invariants, and that the command reports the same `bytes` and `touched`
 * throughout. Returns the command. Fails as a Vitest assertion.
 */
export function expectSymmetric(
    history: History,
    source: CommandSource,
    options: SymmetryOptions = {},
): Command {
    const { session } = history;
    const command = typeof source === "function" ? source(session) : source;
    const before = snapshotProject(session.project);
    const undoCount = history.undoCount;

    history.execute(command);
    assertInvariants(session.project);
    const after = snapshotProject(session.project);
    const bytes = command.bytes;
    const touched = structuredClone(command.touched);
    expect(history.undoCount, "execute adds one entry").toBe(undoCount + 1);

    const rounds = 1 + (options.rounds ?? 1);
    for (let round = 1; round <= rounds; round++) {
        expect(history.undo(), `undo ${round}`).toBe(true);
        assertInvariants(session.project);
        expect(
            snapshotProject(session.project),
            `undo ${round} restores the project`,
        ).toStrictEqual(before);
        expect(history.redo(), `redo ${round}`).toBe(true);
        assertInvariants(session.project);
        expect(snapshotProject(session.project), `redo ${round} repeats the change`).toStrictEqual(
            after,
        );
        expect(command.bytes, `bytes after round ${round}`).toBe(bytes);
        expect(command.touched, `touched after round ${round}`).toStrictEqual(touched);
    }
    return command;
}
