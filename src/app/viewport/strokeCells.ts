import type { Touched } from "../../core/history";

// Cells a tool stroke wrote, or put back at its abort, before any history entry tells of them
// (SPEC §3): the pointer pipeline reports them here and the bound viewport draws them
// (`viewportBinding.ts`), as it draws the cells of a recorded command.

type Listener = (touched: Touched) => void;

const listeners = new Set<Listener>();

/** Tells every listener about cells a stroke changed. */
export function noteStrokeCells(touched: Touched): void {
    for (const listener of [...listeners]) listener(touched);
}

/** Calls `listener` with the cells of every stroke change; returns the function that stops it. */
export function subscribeStrokeCells(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
