import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

/**
 * Transient values the status bar shows that no project holds (DESIGN §8.7): the cell under
 * the pointer comes from the viewport, the hint and the feedback from the active tool. The
 * fields that read them register from their own modules (`ui/status/statusFields.ts`).
 */
export interface StatusState {
    /** The cell under the pointer, or null while it is outside the map. */
    cursor: { x: number; y: number } | null;
    /** One-line hint for the active tool's modifiers. */
    hint: string | null;
    /** Transient tool feedback ("Layer is locked"); shown instead of the hint. */
    feedback: string | null;

    setCursor(cursor: { x: number; y: number } | null): void;
    setHint(hint: string | null): void;
    setFeedback(feedback: string | null): void;
}

export function createStatusStore(): StoreApi<StatusState> {
    return createStore<StatusState>((set) => ({
        cursor: null,
        hint: null,
        feedback: null,
        setCursor: (cursor) => set({ cursor }),
        setHint: (hint) => set({ hint }),
        setFeedback: (feedback) => set({ feedback }),
    }));
}

/** The status values of the app. */
export const statusStore = createStatusStore();

export function useStatus<Slice>(selector: (state: StatusState) => Slice): Slice {
    return useStore(statusStore, selector);
}
