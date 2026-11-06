// One tileset file operation at a time (SPEC §6.1, §6.3; the sprite editor's `exclusive` of
// `app/file/workflows.ts`). Import Tileset and Update Tileset from Source read their files
// before they open a dialog. While one runs, the drops, those two commands and the tileset
// dialogs (Edit Collision, Edit Animation, Tileset Properties) are unavailable, so that no
// other dialog takes the place of the one the operation is going to open.

let running = false;
const listeners = new Set<() => void>();

/** Whether a tileset file operation is in progress (its files are read, or its dialog is open). */
export function tilesetWorkflowBusy(): boolean {
    return running;
}

/** Calls `listener` when the busy state changes; returns the function that removes it. */
export function subscribeTilesetWorkflow(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

function setRunning(value: boolean): void {
    running = value;
    for (const listener of [...listeners]) listener();
}

/**
 * Runs `task` unless another operation is in progress; resolves its result, or false without
 * running it when busy. The state is released when the task settles, however it ends.
 */
export async function runTilesetWorkflow(task: () => Promise<boolean>): Promise<boolean> {
    if (running) return false;
    setRunning(true);
    try {
        return await task();
    } finally {
        setRunning(false);
    }
}
