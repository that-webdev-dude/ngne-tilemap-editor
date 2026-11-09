import type { StoreApi } from "zustand/vanilla";
import { createProjectSession, randomId } from "../../core/model";
import type { Notices } from "../notices/notices";
import type { SessionState } from "../state/session";
import type { Autosave } from "./autosave";
import type { SnapshotBackend } from "./backend";
import type { RecoveryDialogs, RecoveryEntry, RecoveryOutcome } from "./dialogs";
import type { SnapshotRecord } from "../worker/autosave/snapshotStorage";

// Crash recovery (SPEC §10.1, TE-048; the sprite editor's SE-042): on launch, the snapshots
// autosave left (a reload, a crash, a closed window with unsaved changes) are offered in the
// recovery dialog.
//
// A snapshot names the page that wrote it. Each page holds a Web Lock named after itself for
// as long as it is open (`ngne-tilemap-editor-page:<id>`, SUITE §7), so a snapshot whose page
// still holds its lock belongs to a window that is open, and is not offered: recovering it
// would duplicate a project that is still being edited. Without Web Locks every snapshot of
// another page is offered.
//
// Two pages may offer the same snapshot (a browser restoring its windows after a crash). Recover
// and Discard check again, in the transaction that takes or removes the snapshot, that its
// owner is still the one the dialog listed and that no open page holds it; otherwise the other
// page has it: a toast says so and the row goes.
//
// One project per window (SPEC §10.1): a recovered project takes the window, with an empty
// history and no file, and it stays dirty until it is saved (its file, if it had one, does not
// hold the recovered changes); its snapshot becomes this page's, and autosave writes only what
// changes from it. Recovering is refused while the window's project has unsaved changes, and the
// dialog closes once a project is recovered: the snapshots left stay for the next launch.

const LOCK_PREFIX = "ngne-tilemap-editor-page:";

/** The lock a page holds while it is open. */
export function ownerLock(owner: string): string {
    return `${LOCK_PREFIX}${owner}`;
}

let thisPage: string | null = null;

/**
 * The owner name of this page: a random id, whose lock (`ownerLock`) the page holds until it
 * is closed. Asked for once per page.
 */
export function pageOwner(): string {
    if (thisPage !== null) return thisPage;
    const owner = randomId();
    thisPage = owner;
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    // Held until the page goes: the callback's promise never settles.
    void locks?.request(ownerLock(owner), () => new Promise<void>(() => {}))?.catch(() => {});
    return owner;
}

/** The owners of the pages open now (their locks are held), or null when that is unknown. */
export async function openOwners(): Promise<Set<string> | null> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks) return null;
    try {
        const { held = [] } = await locks.query();
        const owners = new Set<string>();
        for (const lock of held) {
            if (lock.name?.startsWith(LOCK_PREFIX)) owners.add(lock.name.slice(LOCK_PREFIX.length));
        }
        return owners;
    } catch {
        return null;
    }
}

/** What went wrong, for a message: a worker task's own error, or the error's. */
function reason(error: unknown): string {
    const remote = (error as { remote?: { message?: unknown } } | null)?.remote;
    if (remote && typeof remote.message === "string" && remote.message !== "") {
        return remote.message;
    }
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/** The toast when another page has the snapshot. */
export function elsewhereMessage(name: string): string {
    return `“${name}” is open in another window.`;
}

/** The toast when the window's project has unsaved changes. */
export function unsavedMessage(name: string, open: string): string {
    return `Could not recover “${name}”. Save or close “${open}” first.`;
}

export interface RecoveryOptions {
    backend: SnapshotBackend;
    sessions: StoreApi<SessionState>;
    autosave: Pick<Autosave, "adopt">;
    notices: Pick<Notices, "info" | "error">;
    /** This page (`pageOwner`). */
    owner: string;
    /**
     * Runs a file operation (`FileWorkflows.run`): not while another runs (it resolves false
     * then). The default runs it at once.
     */
    run?(task: () => Promise<boolean>): Promise<boolean>;
    /** The owners of the pages open now; the default asks Web Locks (`openOwners`). */
    openOwners?(): Promise<Set<string> | null>;
}

export interface Recovery {
    /** The snapshots to offer, newest first: those of no page open now. */
    offered(): Promise<SnapshotRecord[]>;
    /** Opens an offered snapshot's project in the window (`RecoveryOutcome`). */
    recover(key: string): Promise<RecoveryOutcome>;
    /** Removes an offered snapshot permanently: "gone" once it is no longer offered. */
    discard(key: string): Promise<RecoveryOutcome>;
}

export function createRecovery(options: RecoveryOptions): Recovery {
    const { backend, sessions, autosave, notices, owner } = options;
    const owners = options.openOwners ?? openOwners;
    const run = options.run ?? ((task) => task());
    /** The offered snapshots as this page saw them: who owned each. */
    const seen = new Map<string, SnapshotRecord>();
    /** Whether another open page holds the snapshot `record` (its owner is open). */
    const heldElsewhere = async (record: SnapshotRecord) =>
        record.owner !== owner && ((await owners())?.has(record.owner) ?? false);
    /** The name of the window's project when it has unsaved changes, else null. */
    const unsaved = () => {
        const { open, history, session } = sessions.getState();
        return open && history.dirty ? session.project.name : null;
    };

    const recoverNow = async (key: string, listed: SnapshotRecord): Promise<RecoveryOutcome> => {
        const { name } = listed;
        if (await heldElsewhere(listed)) {
            notices.error(elsewhereMessage(name));
            return "gone";
        }
        const open = unsaved();
        if (open !== null) {
            notices.error(unsavedMessage(name, open));
            return "failed";
        }
        const taken = await backend.take(key, listed.owner, owner);
        if (taken === "taken") {
            notices.error(elsewhereMessage(name));
            return "gone";
        }
        if (taken === "gone") {
            notices.error(`Could not recover “${name}”. Its snapshot is no longer stored.`);
            return "gone";
        }
        // This page's from now on, opened or not: Recover and Discard ask for this owner.
        seen.set(key, taken.record);
        if (!taken.project) {
            notices.error(`Could not recover “${name}”. ${taken.problem}`);
            return "failed";
        }
        const later = unsaved();
        if (later !== null) {
            notices.error(unsavedMessage(name, later));
            return "failed";
        }
        const { project } = taken;
        sessions.getState().replace(createProjectSession(project));
        // Dirty now, so autosave keeps the snapshot it takes over.
        autosave.adopt(taken.record);
        const { history, touch } = sessions.getState();
        // Dirty until saved: no history position is -1.
        history.markSaved({ position: -1, exportOnSave: project.exportSettings.exportOnSave });
        touch();
        seen.delete(key);
        notices.info(`Recovered ${name}`);
        return "opened";
    };

    return {
        async offered() {
            const [records, open] = await Promise.all([backend.list(), owners()]);
            const offered = records.filter(
                (record) => record.owner !== owner && !(open?.has(record.owner) ?? false),
            );
            for (const record of offered) seen.set(record.key, record);
            return offered;
        },

        async recover(key) {
            const listed = seen.get(key);
            const name = listed?.name ?? "the project";
            let outcome: RecoveryOutcome | null = null;
            try {
                if (!listed) throw new Error("It was not offered.");
                await run(async () => {
                    outcome = await recoverNow(key, listed);
                    return outcome === "opened";
                });
            } catch (error) {
                notices.error(`Could not recover “${name}”. ${reason(error)}`);
                return "failed";
            }
            if (outcome === null) {
                notices.error(`Could not recover “${name}”. Another file operation is running.`);
                return "failed";
            }
            return outcome;
        },

        async discard(key) {
            const listed = seen.get(key);
            const name = listed?.name ?? "the project";
            try {
                if (!listed) return "gone";
                if (await heldElsewhere(listed)) {
                    notices.error(elsewhereMessage(name));
                    return "gone";
                }
                const result = await backend.discard(key, listed.owner);
                if (result === "taken") notices.error(elsewhereMessage(name));
                seen.delete(key);
                return "gone";
            } catch (error) {
                notices.error(`Could not discard “${name}”. ${reason(error)}`);
                return "failed";
            }
        },
    };
}

/** The dialog's entries for `records`. */
export function recoveryEntries(records: readonly SnapshotRecord[]): RecoveryEntry[] {
    return records.map(({ key, name, savedAt, mapIds, thumbnails }) => ({
        key,
        name,
        savedAt,
        mapCount: mapIds.length,
        thumbnails: thumbnails.map(({ name: mapName, image }) => ({ name: mapName, image })),
    }));
}

/**
 * The User Timing mark set once the launch check is done; its detail says how many snapshots
 * it offered. It stays in the page's timeline: the E2E specs read it.
 */
export const RECOVERY_CHECKED_MARK = "ngne-autosave:recovery-checked";

/**
 * The launch check: offers the snapshots of no open page in the recovery dialog. Waits for the
 * dialog host (it attaches after the first render) for up to `hostWaitMs`; while another dialog
 * is open, waits for it to close. `cancelled` stops it (the component that started it went).
 * Resolves with the number of snapshots offered.
 */
export async function offerRecovery(
    recovery: Recovery,
    dialogs: Pick<RecoveryDialogs, "hosted" | "show" | "free">,
    cancelled: () => boolean,
    hostWaitMs = 5000,
): Promise<number> {
    let records: SnapshotRecord[] = [];
    try {
        records = await recovery.offered();
    } catch (error) {
        console.warn("Recovery could not read the autosave snapshots:", error);
    }
    for (let waited = 0; !dialogs.hosted && waited < hostWaitMs; waited += 50) {
        if (cancelled()) return 0;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    let offered = 0;
    while (records.length > 0 && dialogs.hosted) {
        if (cancelled()) return 0;
        const closed = dialogs.show({
            entries: recoveryEntries(records),
            recover: (key) => recovery.recover(key),
            discard: (key) => recovery.discard(key),
        });
        if (closed) {
            offered = records.length;
            break;
        }
        // Another dialog is open: offered once it closes.
        await dialogs.free();
    }
    if (cancelled()) return 0;
    if (typeof performance !== "undefined") {
        performance.mark(RECOVERY_CHECKED_MARK, { detail: { offered } });
    }
    return offered;
}
