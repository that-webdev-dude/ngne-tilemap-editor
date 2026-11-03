import type { StoreApi } from "zustand/vanilla";
import type { History } from "../../core/history";
import type { Project } from "../../core/model";
import type { SessionState } from "../state/session";

// Steps of the history that add, remove or change tilesets or their tiles (`touched.structure`
// or `touched.tilesetIds`), including undo and redo: what the current stamp and the clipboard
// follow to lose their cells on removed tiles (SPEC §4.2). It follows the history of whichever
// project the store holds.

/**
 * Calls `listener` with the project after every such step of `store`'s history. Returns the
 * function that stops it.
 */
export function onTilesetChange(
    store: StoreApi<SessionState>,
    listener: (project: Project) => void,
): () => void {
    let history: History | null = null;
    let unsubscribe: (() => void) | null = null;
    const follow = (next: History) => {
        if (next === history) return;
        unsubscribe?.();
        history = next;
        unsubscribe = next.subscribe(({ touched }) => {
            if (touched.structure || touched.tilesetIds.length > 0) {
                listener(next.session.project);
            }
        });
    };
    follow(store.getState().history);
    const stop = store.subscribe((state) => follow(state.history));
    return () => {
        stop();
        unsubscribe?.();
    };
}
