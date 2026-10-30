import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { History } from "../../core/history";
import type { HistoryOptions } from "../../core/history";
import { createProject, createProjectSession } from "../../core/model";
import type { ProjectSession } from "../../core/model";

/**
 * The one project of the window (SPEC §3, §10.1). `session` and `history` are the mutable
 * objects of `core`; the state is replaced (with a higher `revision`) on every step of the
 * history and on `touch`, so a subscriber that selects it is told about each change.
 */
export interface SessionState {
    readonly session: ProjectSession;
    /** The only way the project changes (SPEC §3). */
    readonly history: History;
    /** Increases with every change of the project or its session state. */
    readonly revision: number;

    /**
     * Makes `session` the project of the window with a new history: New Project and Open
     * (TE-047). The previous history is dropped.
     */
    replace(session: ProjectSession, options?: HistoryOptions): void;
    /**
     * Tells subscribers that the session changed outside the history: the active map or
     * layer, a selection, the view, or a test hook that set a field.
     */
    touch(): void;
}

/** A store of one project session. The app has one (`sessionStore`); tests create their own. */
export function createSessionStore(
    initial: ProjectSession,
    options?: HistoryOptions,
): StoreApi<SessionState> {
    /** Stops the subscription to the current history. */
    let unsubscribe: (() => void) | null = null;

    return createStore<SessionState>((set, get) => {
        const bump = () => set({ revision: get().revision + 1 });
        /** A history whose every step bumps the revision. */
        const attach = (session: ProjectSession, historyOptions?: HistoryOptions): History => {
            unsubscribe?.();
            const history = new History(session, historyOptions);
            // A throwing history subscriber would make `execute` throw after the change.
            unsubscribe = history.subscribe(() => {
                try {
                    bump();
                } catch (error) {
                    console.error("A subscriber of the session store failed:", error);
                }
            });
            return history;
        };
        return {
            session: initial,
            history: attach(initial, options),
            revision: 0,
            replace(session, historyOptions) {
                set({
                    session,
                    history: attach(session, historyOptions),
                    revision: get().revision + 1,
                });
            },
            touch: bump,
        };
    });
}

/** The project of the app. Until TE-047 adds the empty state, the app starts with a new project. */
export const sessionStore = createSessionStore(createProjectSession(createProject()));

export function useSession<Slice>(selector: (state: SessionState) => Slice): Slice {
    return useStore(sessionStore, selector);
}

/** The history of the app's project. */
export function activeHistory(): History {
    return sessionStore.getState().history;
}
