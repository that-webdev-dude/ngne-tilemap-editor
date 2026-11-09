import {
    ProjectError,
    deserialize,
    projectFromWire,
    projectToWire,
    serialize,
    wireBuffers,
} from "../../../core/project";
import type { ProjectWire } from "../../../core/project";
import { buffersOf, defineTask } from "../task";

// The `.ngtilemap` writer and reader (`core/project`, FORMAT §2) off the main thread (TE-047):
// Save and Open run them here, so the page spends only the time to hand the project over.

export interface ProjectWriteInput {
    project: ProjectWire;
}

export interface ProjectReadInput {
    bytes: Uint8Array;
}

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** `serialize`; the file's bytes are transferred. */
        "project.write": TaskType<ProjectWriteInput, Uint8Array<ArrayBuffer>, ProjectError>;
        /** `deserialize`; the project's chunks and pixels are transferred. */
        "project.read": TaskType<ProjectReadInput, ProjectWire, ProjectError>;
    }
}

export const tasks = [
    defineTask("project.write", {
        run: ({ project }) => serialize(projectFromWire(project)),
        transfer: (bytes) => buffersOf(bytes),
        failures: [ProjectError],
    }),
    defineTask("project.read", {
        run: async ({ bytes }) => projectToWire(await deserialize(bytes)),
        transfer: (project) => wireBuffers(project),
        failures: [ProjectError],
    }),
];
