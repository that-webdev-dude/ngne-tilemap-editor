import { statusStore } from "../state/status";
import { FEEDBACK_MS } from "../tools/pipeline";

// Transient status-bar feedback (DESIGN §8.7) of the marker commands and fields that run outside
// a tool stroke (TE-039): a refused nudge, a refused edit of the context bar's fields.

/** Shows `message` in the status bar for as long as tool feedback stays. */
export function markerFeedback(message: string): void {
    statusStore.getState().setFeedback(message);
    setTimeout(() => {
        if (statusStore.getState().feedback === message) statusStore.getState().setFeedback(null);
    }, FEEDBACK_MS);
}
