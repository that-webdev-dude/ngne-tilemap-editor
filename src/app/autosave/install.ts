import { fileWorkflows } from "../file/workflows";
import { notices } from "../notices/notices";
import { preferences } from "../preferences/preferences";
import { sessionStore } from "../state/session";
import { mapTabsStore } from "../tabs/tabs";
import { createAutosave } from "./autosave";
import { workerSnapshots } from "./backend";
import { recoveryDialogs } from "./dialogs";
import { createRecovery, offerRecovery, pageOwner } from "./recovery";
import { createSessionMemory, indexedDbSessionState } from "./sessionState";

/**
 * Autosave, crash recovery and session state of the app (SPEC §10.1, TE-048): starts autosave
 * over the window's project and the keeping of its session state, and, on launch, offers the
 * snapshots left by an earlier page in the recovery dialog. Without IndexedDB nothing is kept.
 * Returns the function that stops them (the component that installed them went).
 */
export function installAutosave(): () => void {
    const available = typeof indexedDB !== "undefined";
    const backend = available ? workerSnapshots() : null;
    const owner = pageOwner();
    const autosave = createAutosave({
        sessions: sessionStore,
        backend,
        preferences,
        notices,
        saves: fileWorkflows,
        owner,
    });
    const memory = createSessionMemory({
        sessions: sessionStore,
        tabs: mapTabsStore,
        storage: indexedDbSessionState(),
    });
    // Best effort: what is due is written as the page goes.
    const onPageHide = () => memory.flush();
    window.addEventListener("pagehide", onPageHide);
    let stopped = false;
    if (backend) {
        const recovery = createRecovery({
            backend,
            sessions: sessionStore,
            autosave,
            notices,
            owner,
            run: (task) => fileWorkflows.run(task),
        });
        void offerRecovery(recovery, recoveryDialogs, () => stopped);
    }
    return () => {
        stopped = true;
        window.removeEventListener("pagehide", onPageHide);
        autosave.stop();
        memory.stop();
    };
}
