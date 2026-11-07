import { expect } from "vitest";
import type { Command, History } from "../../../src/core/history";
import { assertInvariants } from "../../../src/core/model";
import type { Project, ProjectSession } from "../../../src/core/model";

// Do/undo symmetry harness (SPEC §15: "do/undo symmetry of every command"). A ticket that adds
// a command runs `expectSymmetric` on it: the command is executed through a history, undone,
// redone and undone again, and after every step the project must equal the snapshot taken at
// the same state and satisfy the invariants. After an undo a map's `nextLayerId` or
// `nextMarkerId` may stay above its value before the command, since undo does not give those
// IDs back; neither ever goes down. An assertion failure is the usual Vitest error.

/** A command, or a factory that makes one from the session as it is before the step. */
export type CommandSource = Command | ((session: ProjectSession) => Command);

/** The layer and marker ID counters of a project: `nextLayerId`, `nextMarkerId` per map. */
function counters(project: Project): Map<string, number> {
    const out = new Map<string, number>();
    for (const map of project.maps) {
        out.set(`map ${map.id} nextLayerId`, map.nextLayerId);
        out.set(`map ${map.id} nextMarkerId`, map.nextMarkerId);
    }
    return out;
}

/**
 * Expects `project` to equal `snapshot` except that a map's layer or marker ID counter may stay
 * above the snapshot's: undo does not give those IDs back (SPEC §7.2, as in Tiled).
 * Every other member, and every counter that is not above, must be equal.
 */
function expectUndone(project: Project, snapshot: Project, message: string): void {
    const now = counters(project);
    const copy = snapshotProject(snapshot);
    for (const map of copy.maps) {
        map.nextLayerId = Math.max(map.nextLayerId, now.get(`map ${map.id} nextLayerId`) ?? 0);
        map.nextMarkerId = Math.max(map.nextMarkerId, now.get(`map ${map.id} nextMarkerId`) ?? 0);
    }
    expect(snapshotProject(project), message).toStrictEqual(copy);
}

/** Expects no ID counter of `project` to be below its highest value in `highest`; raises them. */
function expectCountersGrow(project: Project, highest: Map<string, number>, step: string): void {
    for (const [key, value] of counters(project)) {
        const seen = highest.get(key);
        if (seen !== undefined)
            expect(value, `${step}: ${key} went back`).toBeGreaterThanOrEqual(seen);
        highest.set(key, Math.max(value, seen ?? value));
    }
}

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

    const highest = counters(session.project);
    history.execute(command);
    assertInvariants(session.project);
    expectCountersGrow(session.project, highest, "execute");
    const after = snapshotProject(session.project);
    const bytes = command.bytes;
    const touched = structuredClone(command.touched);
    expect(history.undoCount, "execute adds one entry").toBe(undoCount + 1);

    const rounds = 1 + (options.rounds ?? 1);
    for (let round = 1; round <= rounds; round++) {
        expect(history.undo(), `undo ${round}`).toBe(true);
        assertInvariants(session.project);
        expectUndone(session.project, before, `undo ${round} restores the project`);
        expectCountersGrow(session.project, highest, `undo ${round}`);
        expect(history.redo(), `redo ${round}`).toBe(true);
        assertInvariants(session.project);
        expect(snapshotProject(session.project), `redo ${round} repeats the change`).toStrictEqual(
            after,
        );
        expectCountersGrow(session.project, highest, `redo ${round}`);
        expect(command.bytes, `bytes after round ${round}`).toBe(bytes);
        expect(command.touched, `touched after round ${round}`).toStrictEqual(touched);
    }
    return command;
}
