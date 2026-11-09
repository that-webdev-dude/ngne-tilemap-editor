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
 *
 * While no project is open (TE-047: the app starts with the empty state, and Close Project
 * returns to it), `open` is false and `session` holds an empty project nobody sees: the
 * interface shows the empty state, and the commands that act on a project are disabled
 * (`app/commands/appCommands.ts`).
 */
export interface SessionState {
    /** Whether a project is open; false on the empty state. */
    readonly open: boolean;
    readonly session: ProjectSession;
    /** The only way the project changes (SPEC §3). */
    readonly history: History;
    /** Increases with every change of the project or its session state. */
    readonly revision: number;

    /**
     * Makes `session` the open project of the window with a new history: New Project, Open
     * and Revert (TE-047). The previous history is dropped.
     */
    replace(session: ProjectSession, options?: HistoryOptions): void;
    /** Closes the project (Close Project, TE-047): the empty state, with an empty history. */
    close(): void;
    /**
     * Tells subscribers that the session changed outside the history: the active map or
     * layer, a selection, the view, or a test hook that set a field.
     */
    touch(): void;
}

/** The project held while none is open: never shown, never saved. */
function closedSession(): ProjectSession {
    return createProjectSession(createProject());
}

/**
 * A store of one project session, open on `initial`, or on the empty state when `initial` is
 * null. The app has one (`sessionStore`); tests create their own.
 */
export function createSessionStore(
    initial: ProjectSession | null,
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
        const first = initial ?? closedSession();
        return {
            open: initial !== null,
            session: first,
            history: attach(first, options),
            revision: 0,
            replace(session, historyOptions) {
                set({
                    open: true,
                    session,
                    history: attach(session, historyOptions),
                    revision: get().revision + 1,
                });
            },
            close() {
                const session = closedSession();
                set({
                    open: false,
                    session,
                    history: attach(session, options),
                    revision: get().revision + 1,
                });
            },
            touch: bump,
        };
    });
}

/** The project of the app: none at launch, the empty state shows (TE-047). */
export const sessionStore = createSessionStore(null);

/** Whether the app has a project open. */
export function projectOpen(): boolean {
    return sessionStore.getState().open;
}

export function useSession<Slice>(selector: (state: SessionState) => Slice): Slice {
    return useStore(sessionStore, selector);
}

/** The history of the app's project. */
export function activeHistory(): History {
    return sessionStore.getState().history;
}
