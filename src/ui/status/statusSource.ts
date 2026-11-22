import type { StatusBarSource } from "@ngne/editor-ui/shell";
import { sessionStore } from "../../app/state/session";
import { statusStore } from "../../app/state/status";
import type { StatusFieldInput } from "./statusInput";

/**
 * What the package's status bar shows besides its fields' own stores (DESIGN §8.7): the
 * fields read the project's session, its active map and the cell under the pointer; the
 * message at the right end is the active tool's transient feedback, or else its modifier
 * hint. `AppShell` takes it as `status`.
 */
export const statusSource: StatusBarSource<StatusFieldInput> = {
    read() {
        const { session } = sessionStore.getState();
        const map = session.project.maps.find((each) => each.id === session.activeMapId) ?? null;
        return { session, map, cursor: statusStore.getState().cursor };
    },
    hint() {
        const { feedback, hint } = statusStore.getState();
        if (feedback) return { text: feedback, kind: "feedback" };
        return hint ? { text: hint, kind: "hint" } : null;
    },
    subscribe(listener) {
        const stops = [sessionStore.subscribe(listener), statusStore.subscribe(listener)];
        return () => {
            for (const stop of stops) stop();
        };
    },
};
