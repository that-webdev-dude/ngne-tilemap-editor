import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import type { History } from "../../core/history";
import { sessionStore } from "./session";
import type { SessionState } from "./session";

// A counter of the steps of the session's history (SPEC §3), for what depends on the project
// and not on the view: the session store's `revision` also rises with `touch()`, which every
// pan and zoom calls without changing the project. `step` rises with every do, undo and redo,
// and when the store replaces its history (New Project, Open); never with `touch()`. It follows
// whichever history the store holds.

/** The steps counted so far. */
export interface HistoryStepsState {
    readonly step: number;
}

/** A counter of the steps of `store`'s history. It lives as long as `store`. */
export function createHistorySteps(store: StoreApi<SessionState>): StoreApi<HistoryStepsState> {
    const steps = createStore<HistoryStepsState>(() => ({ step: 0 }));
    const bump = () => steps.setState((state) => ({ step: state.step + 1 }));
    let history: History | null = null;
    let unsubscribe: (() => void) | null = null;
    const follow = (next: History) => {
        if (next === history) return;
        const replaced = history !== null;
        unsubscribe?.();
        history = next;
        unsubscribe = next.subscribe(bump);
        if (replaced) bump();
    };
    follow(store.getState().history);
    store.subscribe((state) => follow(state.history));
    return steps;
}

/** The steps of the app's history. */
export const historySteps = createHistorySteps(sessionStore);
