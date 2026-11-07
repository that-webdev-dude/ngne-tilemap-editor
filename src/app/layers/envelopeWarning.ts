import { envelopeProblems } from "../../core/layers";
import type { EnvelopeProblem } from "../../core/layers";
import type { ProjectMap } from "../../core/model";
import { notices } from "../notices/notices";
import type { Notices } from "../notices/notices";
import type { SessionState } from "../state/session";
import type { StoreApi } from "zustand/vanilla";

// The D1 envelope warning of SPEC §7.2: the first time a map shown in the editor is beyond the
// tested envelope (BRIEF D1) — when it opens so, or when a command takes it there — a notice
// says so, once per map for the session of the app. The map stays editable.

export const ENVELOPE_WARNING = "This map is beyond the editor's tested envelope";

const DETAILS: Record<EnvelopeProblem, string> = {
    cells: "more than 65,536 cells per layer",
    layers: "more than 16 layers",
    markers: "more than 2,000 markers",
};

/** The text of the notice for `map`; null when the map is inside the envelope. */
export function envelopeWarning(map: ProjectMap): string | null {
    const problems = envelopeProblems(map);
    if (problems.length === 0) return null;
    return `${ENVELOPE_WARNING}: ${problems.map((problem) => DETAILS[problem]).join(", ")}.`;
}

/**
 * Watches the active map of `store` and reports `envelopeWarning` through `sink` once per map.
 * Returns the function that stops watching.
 */
export function watchEnvelope(
    store: StoreApi<SessionState>,
    sink: Pick<Notices, "info"> = notices,
): () => void {
    const warned = new Set<string>();
    const check = () => {
        const { session } = store.getState();
        const id = session.activeMapId;
        if (warned.has(id)) return;
        const map = session.project.maps.find((each) => each.id === id);
        if (!map) return;
        const message = envelopeWarning(map);
        if (message === null) return;
        warned.add(id);
        sink.info(message);
    };
    check();
    return store.subscribe(check);
}
