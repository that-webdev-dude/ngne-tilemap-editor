import { projectFromWire } from "../../core/project";
import { backgroundWorker } from "../worker/client";
import type { WorkerClient } from "../worker/client";
// The task types, so that `run("autosave.write")` is typed outside the worker's own glob.
import type {} from "../worker/tasks/autosave.task";
import type { SnapshotInput, TakenSnapshot } from "../worker/autosave/snapshotProject";
import type { SnapshotKey, SnapshotRecord } from "../worker/autosave/snapshotStorage";

/**
 * The snapshot operations autosave and recovery use (TE-048). The app's run in the background
 * worker (`workerSnapshots`); the unit tests run them on a storage in memory.
 */
export interface SnapshotBackend {
    /**
     * Writes a snapshot (`writeSnapshot`). `transfer`: buffers of `input` that are handed over
     * instead of copied (they are the caller's copies).
     */
    write(input: SnapshotInput, transfer: Transferable[]): Promise<"written" | "taken">;
    remove(key: SnapshotKey): Promise<void>;
    list(): Promise<SnapshotRecord[]>;
    take(
        key: SnapshotKey,
        expectedOwner: string,
        owner: string,
    ): Promise<TakenSnapshot | "taken" | "gone">;
    discard(key: SnapshotKey, expectedOwner: string): Promise<"removed" | "taken" | "gone">;
}

/** The operations in the background worker, on the IndexedDB of autosave. */
export function workerSnapshots(worker: WorkerClient = backgroundWorker): SnapshotBackend {
    return {
        write: (input, transfer) => worker.run("autosave.write", input, { transfer }),
        remove: async (key) => {
            await worker.run("autosave.remove", { key });
        },
        list: () => worker.run("autosave.list", {}),
        take: async (key, expectedOwner, owner) => {
            const taken = await worker.run("autosave.take", { key, expectedOwner, owner });
            if (taken === "taken" || taken === "gone" || !taken.project) return taken;
            return { record: taken.record, project: projectFromWire(taken.project) };
        },
        discard: (key, expectedOwner) => worker.run("autosave.discard", { key, expectedOwner }),
    };
}
