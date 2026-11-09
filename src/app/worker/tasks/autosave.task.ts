import { AutosaveError, storageError } from "../autosave/errors";
import { takeSnapshot, writeSnapshot } from "../autosave/snapshotProject";
import type { SnapshotInput } from "../autosave/snapshotProject";
import { indexedDbSnapshots } from "../autosave/snapshotStorage";
import type { SnapshotKey, SnapshotRecord, SnapshotStorage } from "../autosave/snapshotStorage";
import { ProjectError, projectToWire, wireBuffers } from "../../../core/project";
import type { ProjectWire } from "../../../core/project";
import { defineTask } from "../task";

// The autosave snapshots of SPEC §10.1 (TE-048) written and read in the worker: the page hands
// over the project without pixels and the changed maps and pixels (`autosave.ts`); the JSON
// entries are made and stored here, so autosave keeps the page's tasks short. Recovery takes a
// snapshot and reads its project here, and the project comes back with its buffers transferred.

export interface SnapshotTakeInput {
    key: SnapshotKey;
    expectedOwner: string;
    owner: string;
}

/** A snapshot taken, its project as plain data (`TakenSnapshot`). */
export type WireTakenSnapshot =
    | { record: SnapshotRecord; project: ProjectWire; problem?: undefined }
    | { record: SnapshotRecord; project: null; problem: string };

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** `writeSnapshot` into the IndexedDB of autosave. */
        "autosave.write": TaskType<
            SnapshotInput,
            "written" | "taken",
            AutosaveError | ProjectError
        >;
        /** Removes every record of a snapshot. */
        "autosave.remove": TaskType<{ key: SnapshotKey }, null, AutosaveError>;
        /** Every snapshot's record, newest first. */
        "autosave.list": TaskType<Record<string, never>, SnapshotRecord[], AutosaveError>;
        /** `takeSnapshot`; the project's chunks and pixels are transferred. */
        "autosave.take": TaskType<
            SnapshotTakeInput,
            WireTakenSnapshot | "taken" | "gone",
            AutosaveError | ProjectError
        >;
        /** Removes a snapshot if its owner is still the one expected. */
        "autosave.discard": TaskType<
            { key: SnapshotKey; expectedOwner: string },
            "removed" | "taken" | "gone",
            AutosaveError
        >;
    }
}

let opened: SnapshotStorage | null | undefined;

/** The worker's connection to the snapshots, opened on first use. */
function storage(): SnapshotStorage {
    if (opened === undefined) opened = indexedDbSnapshots();
    if (!opened) throw new AutosaveError("unavailable", "IndexedDB is not available.");
    return opened;
}

/** Runs `task` with IndexedDB's errors as `AutosaveError`s. */
async function stored<Result>(
    task: (storage: SnapshotStorage) => Promise<Result>,
): Promise<Result> {
    try {
        return await task(storage());
    } catch (error) {
        throw storageError(error);
    }
}

const failures = [AutosaveError, ProjectError];

export const tasks = [
    defineTask("autosave.write", {
        run: (input) => stored((each) => writeSnapshot(each, input)),
        failures,
    }),
    defineTask("autosave.remove", {
        run: ({ key }) => stored(async (each) => (await each.remove(key), null)),
        failures,
    }),
    defineTask("autosave.list", {
        run: () => stored((each) => each.list()),
        failures,
    }),
    defineTask("autosave.take", {
        run: ({ key, expectedOwner, owner }) =>
            stored(async (each) => {
                const taken = await takeSnapshot(each, key, expectedOwner, owner);
                if (taken === "taken" || taken === "gone") return taken;
                if (!taken.project) return taken;
                return { record: taken.record, project: projectToWire(taken.project) };
            }),
        transfer: (result) =>
            typeof result === "string" || !result.project ? [] : wireBuffers(result.project),
        failures,
    }),
    defineTask("autosave.discard", {
        run: ({ key, expectedOwner }) => stored((each) => each.discard(key, expectedOwner)),
        failures,
    }),
];
