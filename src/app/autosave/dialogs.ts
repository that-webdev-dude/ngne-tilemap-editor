import type { PixelBuffer } from "../../core/model";
import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";

/**
 * The recovery dialog (DESIGN §9, the sprite editor's DESIGN §7): shown on launch when snapshots
 * of projects with unsaved changes are left (TE-048). It lists them (name, time, map
 * thumbnails), each with Recover and Discard; the dialog host shows it
 * (ui/autosave/recovery.dialog.tsx). The work is done by the request's functions, never by the
 * dialog: Recover opens the project in the window, Discard removes the snapshot permanently.
 * Closing the dialog keeps the snapshots left for the next launch.
 */

/** A map of a snapshot as the dialog shows it. */
export interface RecoveryThumbnail {
    readonly name: string;
    readonly image: PixelBuffer;
}

/** One snapshot as the dialog lists it. */
export interface RecoveryEntry {
    readonly key: string;
    readonly name: string;
    /** When it was written, in milliseconds since the epoch. */
    readonly savedAt: number;
    /** How many maps the project has. */
    readonly mapCount: number;
    /** Its first maps (`RECOVERY_THUMBNAILS`). */
    readonly thumbnails: readonly RecoveryThumbnail[];
}

/**
 * How an action of a row ended: "opened", the project is the window's (the dialog closes);
 * "gone", the row goes (discarded, or had by another page); "failed", the row stays.
 */
export type RecoveryOutcome = "opened" | "gone" | "failed";

export interface RecoveryRequest {
    kind: "recovery";
    /** Newest first. */
    entries: readonly RecoveryEntry[];
    /** Opens the snapshot's project (`Recovery.recover`). */
    recover(key: string): Promise<RecoveryOutcome>;
    /** Removes the snapshot permanently (`Recovery.discard`). */
    discard(key: string): Promise<RecoveryOutcome>;
    /** Closes the dialog. */
    answer(values: null): void;
}

export interface RecoveryDialogs {
    readonly store: DialogView<RecoveryRequest>;
    /** Whether a dialog host shows the requests; until one does, a request is answered at once. */
    readonly hosted: boolean;
    attachHost(): () => void;
    /**
     * Shows the dialog and returns a promise that resolves when it closes; null when it cannot
     * be shown (another dialog is open, or no host).
     */
    show(options: Pick<RecoveryRequest, "entries" | "recover" | "discard">): Promise<void> | null;
    /** Resolves once no dialog is open (at once when none is). */
    free(): Promise<void>;
}

function isRecoveryRequest(request: DialogRequestBase): request is RecoveryRequest {
    return request.kind === "recovery";
}

export function createRecoveryDialogs(
    requests: DialogRequests = createDialogRequests(),
): RecoveryDialogs {
    return {
        store: dialogView(requests.store, isRecoveryRequest),
        get hosted() {
            return requests.hosted;
        },
        attachHost: () => requests.attachHost(),
        show(options) {
            if (!requests.hosted || requests.store.getState().request) return null;
            return requests
                .open<never>((answer): RecoveryRequest => ({
                    kind: "recovery",
                    ...options,
                    answer: () => answer(null),
                }))
                .then(() => {});
        },
        free() {
            if (!requests.store.getState().request) return Promise.resolve();
            return new Promise((resolve) => {
                const stop = requests.store.subscribe(({ request }) => {
                    if (request) return;
                    stop();
                    resolve();
                });
            });
        },
    };
}

/** The recovery dialog of the app, shown by the app's one dialog host. */
export const recoveryDialogs = createRecoveryDialogs(commandDialogs);
