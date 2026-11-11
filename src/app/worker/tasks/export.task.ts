import { exportFiles, exportPreview } from "../../../core/export";
import type { ExportFile, ExportPreview } from "../../../core/export";
import { TilesetPackError } from "../../../core/pack";
import { projectFromWire } from "../../../core/project";
import type { ProjectWire } from "../../../core/project";
import { buffersOf, defineTask } from "../task";

// The export plan (`core/export`, SPEC §10.2) off the main thread: packing, PNG encoding, the
// tilemap JSON and the runtime of a whole project are far longer than one frame.

export interface ExportFilesInput {
    project: ProjectWire;
}

declare module "../protocol" {
    interface WorkerTaskTypes {
        /** `exportFiles`; every file's bytes are transferred. */
        "export.files": TaskType<ExportFilesInput, ExportFile[], TilesetPackError>;
        /** `exportPreview`, for the Export dialog; every file's bytes are transferred. */
        "export.preview": TaskType<ExportFilesInput, ExportPreview, TilesetPackError>;
    }
}

export const tasks = [
    defineTask("export.files", {
        run: ({ project }) => exportFiles(projectFromWire(project)),
        transfer: (files) => buffersOf(...files.map((file) => file.bytes)),
        failures: [TilesetPackError],
    }),
    defineTask("export.preview", {
        run: ({ project }) => exportPreview(projectFromWire(project)),
        // The atlases' PNGs are files of the plan: their buffers are listed once.
        transfer: (preview) =>
            buffersOf(
                ...preview.plan.map((file) => file.bytes),
                ...preview.atlases.map((atlas) => atlas.png),
            ),
        failures: [TilesetPackError],
    }),
];
