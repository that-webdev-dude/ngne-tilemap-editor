import type { Project } from "../../core/model";
import { projectFromWire, projectToWire, wireBuffers } from "../../core/project";
import { backgroundWorker } from "../worker/client";
import type { WorkerClient } from "../worker/client";
// The task types, so that `run("project.write")` is typed outside the worker's own glob.
import type {} from "../worker/tasks/project.task";

/**
 * How the file workflows turn a project into the bytes of a `.ngtilemap` file and back
 * (FORMAT §2). Tests give the workflows one that runs `core/project` directly.
 */
export interface ProjectCodec {
    /** The file's bytes; rejects with the writer's error (`ProjectError`). */
    write(project: Project): Promise<Uint8Array<ArrayBuffer>>;
    /** The project the bytes hold; rejects with the reader's error (`ProjectError`). */
    read(bytes: Uint8Array): Promise<Project>;
}

/**
 * The codec in the background worker (SPEC §10.1: save and open run in the worker). The page
 * only hands the project over: a snapshot of it (`structuredClone` of its plain form), whose
 * buffers are then transferred, so the project can change while the worker writes. An opened
 * project's chunks and pixels come back transferred and become its own.
 */
export function workerProjectCodec(worker: WorkerClient = backgroundWorker): ProjectCodec {
    return {
        write(project) {
            const snapshot = structuredClone(projectToWire(project));
            return worker.run(
                "project.write",
                { project: snapshot },
                { transfer: wireBuffers(snapshot) },
            );
        },
        async read(bytes) {
            return projectFromWire(await worker.run("project.read", { bytes }));
        },
    };
}
