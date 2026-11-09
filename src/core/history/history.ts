import type {} from "../../import-meta";
import {
    MEMORY_LIMIT_BYTES,
    MemoryLimitError,
    accountMemory,
    assertCellsWithin,
    assertInvariants,
    assertMemoryWithin,
    memoryWarns,
} from "../model";
import type { Project, ProjectSession } from "../model";
import { defaultAllocator, type Allocator } from "./allocate";
import type { Command, Touched } from "./command";
import { TransactionError } from "./errors";
import { beginTransaction, type Transaction, type TransactionOptions } from "./transaction";

/** Memory budget of a history unless another is given: 256 MB (SPEC §3). */
export const DEFAULT_HISTORY_BUDGET_BYTES = 256 * 1024 * 1024;

/** Checks the project after every do, undo and redo; a failure undoes the step. */
export type ProjectVerifier = (project: Project) => void;

/** Options of a `History`. */
export interface HistoryOptions {
    /** Memory budget in bytes; the default is `DEFAULT_HISTORY_BUDGET_BYTES`. */
    budgetBytes?: number;
    /** Allocates the memory of transactions; a test replaces it to simulate failure. */
    allocate?: Allocator;
    /**
     * Run on the project after every command (SPEC §2.1): `assertInvariants` in development
     * builds and tests, nothing in production. Pass null to run nothing.
     */
    verify?: ProjectVerifier | null;
}

/** What `History.markSaved` records: the position and the export settings of a save. */
export interface SavedState {
    readonly position: number;
    readonly exportOnSave: boolean;
}

/** One step of a history, as reported to its subscribers. */
export interface HistoryChange {
    /** "do" is a new command (executed, or committed by a transaction). */
    kind: "do" | "undo" | "redo";
    /** Label of the command that was done, undone or redone. */
    label: string;
    /** What the step changed (the command's `touched`). */
    touched: Touched;
}

/** Receives every step of a history after the session has changed. */
export type HistoryListener = (change: HistoryChange) => void;

/** Receives the project's memory in bytes when it crosses the warning threshold (SPEC §2.2). */
export type MemoryWarningListener = (bytes: number) => void;

interface Entry {
    command: Command;
    bytes: number;
    /** Position of the history while this entry is the newest done one. */
    position: number;
}

const defaultVerifier: ProjectVerifier | null = import.meta.env.DEV ? assertInvariants : null;

/**
 * The undo history of one project (SPEC §3): every change of the project is a command
 * executed here or a transaction begun here.
 */
export class History {
    /** The session this history changes. */
    readonly session: ProjectSession;
    /** Memory budget in bytes. */
    readonly budgetBytes: number;
    readonly #allocate: Allocator;
    readonly #verify: ProjectVerifier | null;
    /** Oldest first. Entries below `#done` are done; the rest are undone and can be redone. */
    readonly #entries: Entry[] = [];
    #done = 0;
    #bytes = 0;
    /** Position below the oldest retained entry. */
    #floor = 0;
    #lastPosition = 0;
    #savedPosition = 0;
    #savedExportOnSave: boolean;
    #warned: boolean;
    #transaction: Transaction | null = null;
    readonly #listeners = new Set<HistoryListener>();
    readonly #memoryListeners = new Set<MemoryWarningListener>();

    constructor(session: ProjectSession, options: HistoryOptions = {}) {
        this.session = session;
        this.budgetBytes = options.budgetBytes ?? DEFAULT_HISTORY_BUDGET_BYTES;
        this.#allocate = options.allocate ?? defaultAllocator;
        this.#verify = options.verify === undefined ? defaultVerifier : options.verify;
        this.#savedExportOnSave = session.project.exportSettings.exportOnSave;
        this.#warned = memoryWarns(accountMemory(session.project).total);
    }

    /** Number of commands `undo` can still reverse. */
    get undoCount(): number {
        return this.#done;
    }

    /** Number of undone commands `redo` can still repeat. */
    get redoCount(): number {
        return this.#entries.length - this.#done;
    }

    /** True when `undo` has a command to reverse. */
    get canUndo(): boolean {
        return this.undoCount > 0;
    }

    /** True when `redo` has a command to repeat. */
    get canRedo(): boolean {
        return this.redoCount > 0;
    }

    /** Label of the command `undo` would reverse, for menu text; null when there is none. */
    get undoLabel(): string | null {
        return this.#entries[this.#done - 1]?.command.label ?? null;
    }

    /** Label of the command `redo` would repeat, for menu text; null when there is none. */
    get redoLabel(): string | null {
        return this.#entries[this.#done]?.command.label ?? null;
    }

    /**
     * The map the command `undo` would reverse belongs to: its ID, null for a project-wide
     * command, undefined when there is none. The app switches to that map's tab first (SPEC §3).
     */
    get undoMapId(): string | null | undefined {
        return this.#entries[this.#done - 1]?.command.touched.mapId;
    }

    /** As `undoMapId`, for the command `redo` would repeat. */
    get redoMapId(): string | null | undefined {
        return this.#entries[this.#done]?.command.touched.mapId;
    }

    /**
     * Identifies the state of the project: it changes with every do, undo and redo, and
     * has the same value again only when undo or redo is back at the same state. The
     * project is dirty when this differs from the position recorded by `markSaved`.
     */
    get position(): number {
        return this.#entries[this.#done - 1]?.position ?? this.#floor;
    }

    /**
     * True when the project differs from its last save (SPEC §3): the position is not the
     * saved one, or the export settings changed since `markSaved`.
     */
    get dirty(): boolean {
        return (
            this.position !== this.#savedPosition ||
            this.session.project.exportSettings.exportOnSave !== this.#savedExportOnSave
        );
    }

    /** Memory retained by the commands of this history, in bytes. */
    get bytes(): number {
        return this.#bytes;
    }

    /** The open transaction, or null. While one is open, only it may change the session. */
    get transaction(): Transaction | null {
        return this.#transaction;
    }

    /**
     * The state a save records (TE-047): the position and the export settings now. A save
     * takes it before the file is written and passes it to `markSaved` afterwards, so a change
     * made while the bytes are written keeps the project dirty.
     */
    get state(): SavedState {
        return {
            position: this.position,
            exportOnSave: this.session.project.exportSettings.exportOnSave,
        };
    }

    /**
     * Records `state` (by default the current one) as the saved one: the project is clean
     * while it is at that state.
     */
    markSaved(state: SavedState = this.state): void {
        this.#savedPosition = state.position;
        this.#savedExportOnSave = state.exportOnSave;
    }

    /**
     * Does `command` and makes it the newest entry; undone commands can no longer be
     * redone. Throws `MemoryLimitError` when the command would take the project's memory
     * past its limit (SPEC §2.2), `CellLimitError` when it would take a map past its cells
     * (FORMAT §2.8), and rethrows what `command.do` or the verifier throws; the project and the
     * history are then unchanged.
     */
    execute(command: Command): void {
        this.#assertIdle("execute");
        if (command.projectBytes) assertMemoryWithin(this.session.project, command.projectBytes);
        command.do(this.session);
        this.#record(command);
    }

    /** Reverses the newest done command. Returns false when there is none. */
    undo(): boolean {
        this.#assertIdle("undo");
        const entry = this.#entries[this.#done - 1];
        if (!entry) return false;
        entry.command.undo(this.session);
        this.#check(entry.command, "undo");
        this.#done--;
        this.#notify("undo", entry.command);
        return true;
    }

    /** Repeats the command undone last. Returns false when there is none. */
    redo(): boolean {
        this.#assertIdle("redo");
        const entry = this.#entries[this.#done];
        if (!entry) return false;
        entry.command.do(this.session);
        this.#check(entry.command, "do");
        this.#done++;
        this.#notify("redo", entry.command);
        return true;
    }

    /**
     * Begins a tool stroke on a tile layer of a map (SPEC §3). Throws `TransactionError`
     * for a target that is not such a layer; the session is then unchanged.
     */
    begin(options: TransactionOptions): Transaction {
        this.#assertIdle("begin");
        this.#transaction = beginTransaction(this.session, options, {
            allocate: this.#allocate,
            closed: () => {
                this.#transaction = null;
            },
            record: (command) => this.#record(command),
        });
        return this.#transaction;
    }

    /** Calls `listener` after every do, undo and redo. Returns the function that stops it. */
    subscribe(listener: HistoryListener): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    /**
     * Calls `listener` once each time a step takes the project's memory above the warning
     * threshold (SPEC §2.2); it fires again only after the memory fell below it. Returns the
     * function that stops it.
     */
    onMemoryWarning(listener: MemoryWarningListener): () => void {
        this.#memoryListeners.add(listener);
        return () => {
            this.#memoryListeners.delete(listener);
        };
    }

    #assertIdle(call: string): void {
        if (this.#transaction) {
            throw new TransactionError(`${call}: a transaction is open; commit or abort it first.`);
        }
    }

    /**
     * Checks the project after `command` was applied (`step` "do") or reversed ("undo"):
     * the memory limit, the cells-per-map limit (FORMAT §2.8), then the verifier. A failure
     * reverses the step and rethrows.
     */
    #check(command: Command, step: "do" | "undo"): void {
        try {
            const total = accountMemory(this.session.project).total;
            if (total > MEMORY_LIMIT_BYTES) throw new MemoryLimitError(total);
            assertCellsWithin(this.session.project);
            this.#verify?.(this.session.project);
        } catch (error) {
            if (step === "do") command.undo(this.session);
            else command.do(this.session);
            throw error;
        }
    }

    /** Makes a command that is already applied the newest entry. */
    #record(command: Command): void {
        this.#check(command, "do");
        for (const undone of this.#entries.splice(this.#done)) this.#bytes -= undone.bytes;
        this.#entries.push({ command, bytes: command.bytes, position: ++this.#lastPosition });
        this.#done++;
        this.#bytes += command.bytes;
        // Oldest first; the newest entry stays even when it alone exceeds the budget.
        while (this.#bytes > this.budgetBytes && this.#entries.length > 1) {
            const dropped = this.#entries.shift();
            if (!dropped) break;
            this.#bytes -= dropped.bytes;
            this.#floor = dropped.position;
            this.#done--;
        }
        this.#notify("do", command);
    }

    #notify(kind: HistoryChange["kind"], command: Command): void {
        const change: HistoryChange = { kind, label: command.label, touched: command.touched };
        for (const listener of [...this.#listeners]) listener(change);
        this.#warnMemory();
    }

    /** One warning per crossing of the threshold (SPEC §2.2). */
    #warnMemory(): void {
        const total = accountMemory(this.session.project).total;
        const above = memoryWarns(total);
        if (above && !this.#warned) {
            for (const listener of [...this.#memoryListeners]) listener(total);
        }
        this.#warned = above;
    }
}
