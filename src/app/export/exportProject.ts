import type { StoreApi } from "zustand/vanilla";
import { EXPORT_MARKER_FILE, readExportMarker } from "../../core/export";
import type { ExportFile } from "../../core/export";
import type { Project } from "../../core/model";
import { projectToWire, wireBuffers } from "../../core/project";
import { fileWorkflows as appFileWorkflows } from "../file/workflows";
import type { FileWorkflows } from "../file/workflows";
import { notices as appNotices } from "../notices/notices";
import type { Notices } from "../notices/notices";
import { ZIP_FILE, browserExportFiles } from "../platform/exportFiles";
import type { ExportFolderHandle, ExportPlatform } from "../platform/exportFiles";
import { sessionStore } from "../state/session";
import type { SessionState } from "../state/session";
import { toolPipeline } from "../tools/appPipeline";
import { backgroundWorker } from "../worker/client";
import type { WorkerClient } from "../worker/client";
import { reason } from "../worker/errorReason";
// The task types, so that `run("export.files")` and `run("zip.write")` are typed here.
import type {} from "../worker/tasks/export.task";
import type {} from "../worker/tasks/zip.task";
import { exportDialogs as appExportDialogs } from "./dialogs";
import type { ExportDialogs } from "./dialogs";
import { FOLDER_LOAD_TIMEOUT_MS, indexedDbExportFolders } from "./exportFolders";
import type { ExportFolderStorage } from "./exportFolders";

// The export pipeline of SPEC §10.2 (the sprite editor's `exportWorkflows.ts`, SE-052), on the
// window's project. The Export dialog, Export Again and Export on Save (TE-054) start it.
//
// - The project is taken as it is when the export starts: a snapshot goes to the background
//   worker, which makes every file (`core/export`: packing, PNGs, tilemap JSON, runtime) while
//   the export finds its folder. A stroke in progress stops the export before anything is done.
// - With File System Access the files go into the project's folder: chosen once per project ID
//   with the directory picker and kept in IndexedDB (`exportFolders.ts`); a folder that no
//   longer exists is chosen again. Write permission is asked for once, within the user's
//   gesture.
// - Before writing, the folder's marker is read. A marker of another project, or files of the
//   export's names without a marker, ask Replace / Cancel naming that project.
// - Files are written in the plan's order (marker, PNGs, atlases, tilemap JSON, runtime); a file
//   whose bytes equal the folder's is not written again, and nothing is removed. A failed write
//   stops the export with one toast naming the file and those written before it.
// - Without File System Access the files download as `<exportName>.zip`.
//
// It is a file operation (`FileWorkflows.run`): one at a time. Results are an info toast;
// each failed export is one error toast; a picker or a question the user cancels is not
// reported.

/** Where the export's files are made: the background worker, or `core` directly in tests. */
export interface ExportMaker {
    /** Every file of the folder; rejects with `TilesetPackError` when a tileset cannot pack. */
    files(project: Project): Promise<ExportFile[]>;
    /** A zip archive of the files, in their order. */
    zip(files: readonly ExportFile[]): Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * The maker in the background worker. `files` takes a snapshot of the project when it is
 * called (`structuredClone` of its plain form), whose buffers are then transferred, so the
 * project can change while the worker works.
 */
export function workerExportMaker(worker: WorkerClient = backgroundWorker): ExportMaker {
    return {
        files(project) {
            const snapshot = structuredClone(projectToWire(project));
            return worker.run(
                "export.files",
                { project: snapshot },
                { transfer: wireBuffers(snapshot) },
            );
        },
        zip(files) {
            // PNG data is compressed already; the text files are deflated.
            const entries = files.map(({ name, bytes }) => ({
                name,
                data: bytes,
                stored: name.endsWith(".png"),
            }));
            return worker.run("zip.write", { entries });
        },
    };
}

export interface ExportProjectOptions {
    /** The store of the window's project; the default is the app's. */
    sessions?: StoreApi<SessionState>;
    /** Where exports go; the default is the page's. */
    platform?: ExportPlatform;
    /** Where the export folders are kept; the default is the page's IndexedDB. */
    storage?: ExportFolderStorage;
    /** Where the question is asked; the default is the app's dialog host. */
    dialogs?: ExportDialogs;
    /** Where results and failures go; the default is the app's toasts. */
    notices?: Pick<Notices, "info" | "error">;
    /** The file operations an export is one of; the default is the app's. */
    files?: Pick<FileWorkflows, "run" | "canSave">;
    /** Where the files are made; the default is the background worker. */
    maker?: ExportMaker;
    /** Whether a stroke is in progress; the default reads the app's history and tools. */
    stroking?(): boolean;
}

export interface ExportPipeline {
    /** Whether an export can start now: a project is open and no file operation or stroke runs. */
    canExport(): boolean;
    /**
     * Exports the window's project as it is now: into its folder (chosen first when none is
     * known), or as a zip download without File System Access. Resolves true once every file
     * is in place, false when it failed (reported) or was cancelled.
     */
    exportProject(): Promise<boolean>;
    /** The name of a project's export folder, if one is known in this session. */
    folderOf(projectId: string): string | null;
}

/** What the messages and the folder check use of the project, as it was when the export started. */
type Exporting = Pick<Project, "id" | "name" | "exportName">;

/** "1 file", "4 files". */
function filesCount(count: number): string {
    return count === 1 ? "1 file" : `${count} files`;
}

/** A reason as the middle of a sentence: without its closing full stop. */
function clause(text: string): string {
    return text.replace(/\.$/, "");
}

/** Whether two files have the same bytes. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let at = 0; at < a.length; at += 1) {
        if (a[at] !== b[at]) return false;
    }
    return true;
}

/** Thrown when the stored folder of a project is not read in time. */
class StorageTimeout extends Error {
    override readonly name = "StorageTimeout";
}

export function createExportPipeline(options: ExportProjectOptions = {}): ExportPipeline {
    const sessions = options.sessions ?? sessionStore;
    const platform = options.platform ?? browserExportFiles();
    const storage = options.storage ?? indexedDbExportFolders();
    const dialogs = options.dialogs ?? appExportDialogs;
    const notices = options.notices ?? appNotices;
    const files = options.files ?? appFileWorkflows;
    const maker = options.maker ?? workerExportMaker();
    const stroking =
        options.stroking ??
        (() => sessions.getState().history.transaction !== null || toolPipeline.stroking);

    /** Export folders by project ID; `null`: looked up in storage, none there. */
    const folders = new Map<string, ExportFolderHandle | null>();

    const failed = (project: string, why: string): false => {
        notices.error(`Could not export “${project}”. ${why}`);
        return false;
    };

    /**
     * The project's folder: from this session, else from storage (once). Throws
     * `StorageTimeout` when storage does not answer within `FOLDER_LOAD_TIMEOUT_MS`; nothing is
     * remembered then, so the next export reads storage again.
     */
    const folderOf = async (id: string): Promise<ExportFolderHandle | null> => {
        if (folders.has(id)) return folders.get(id) ?? null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(
                () => reject(new StorageTimeout("The browser's storage did not answer in time.")),
                FOLDER_LOAD_TIMEOUT_MS,
            );
        });
        let folder: ExportFolderHandle | null = null;
        try {
            const stored = await Promise.race([storage.load(id), timeout]);
            folder = stored ? platform.folderFrom(stored.folder) : null;
        } catch (error) {
            // A record that cannot be read is no folder.
            if (error instanceof StorageTimeout) throw error;
        } finally {
            clearTimeout(timer);
        }
        // A folder chosen while storage was read wins.
        if (!folders.has(id)) folders.set(id, folder);
        return folders.get(id) ?? null;
    };
    const remember = (id: string, folder: ExportFolderHandle): void => {
        folders.set(id, folder);
        void storage.save(id, { folder: folder.stored }).catch(() => {});
    };

    /** The zip download of the files, without File System Access. */
    const download = async (project: Exporting, made: Promise<ExportFile[]>): Promise<boolean> => {
        let bytes: Uint8Array<ArrayBuffer>;
        let count: number;
        try {
            const all = await made;
            count = all.length;
            bytes = await maker.zip(all);
        } catch (error) {
            return failed(project.name, reason(error));
        }
        const zipName = `${project.exportName}.zip`;
        platform.download(zipName, bytes, ZIP_FILE);
        notices.info(`Exported ${filesCount(count)} to “${zipName}”`);
        return true;
    };

    /** The project's folder, chosen now when none is known or it is gone; null: cancelled. */
    const destination = async (id: string): Promise<ExportFolderHandle | null> => {
        const known = await folderOf(id);
        if (known && (await known.exists())) return known;
        const chosen = await platform.chooseFolder();
        if (chosen) remember(id, chosen);
        return chosen;
    };

    /** Whether the app may write into the folder: asked once, within the user's gesture. */
    const writable = async (folder: ExportFolderHandle): Promise<boolean> => {
        try {
            if (await folder.canWrite()) return true;
            return platform.hasUserActivation() && (await folder.requestWrite());
        } catch {
            return false;
        }
    };

    /**
     * Whether the export may write into the folder: it is the project's (its marker names the
     * project), it holds none of the export's files, or the user says to replace them.
     */
    const owned = async (
        project: Exporting,
        folder: ExportFolderHandle,
        all: readonly ExportFile[],
    ): Promise<boolean> => {
        const markerBytes = await folder.read(EXPORT_MARKER_FILE);
        const marker = markerBytes ? readExportMarker(markerBytes) : null;
        if (marker?.projectId === project.id) return true;
        const existing = await folder.existing(all.map((file) => file.name));
        if (existing.length === 0) return true;
        return dialogs.confirmOverwrite({
            project: project.name,
            folder: folder.name,
            owner: marker?.projectName ?? null,
            files: existing,
        });
    };

    /** Writes the files in order, each only when its bytes differ from the folder's. */
    const write = async (
        project: Exporting,
        folder: ExportFolderHandle,
        all: readonly ExportFile[],
    ): Promise<boolean> => {
        const written: string[] = [];
        for (const file of all) {
            try {
                const current = await folder.read(file.name);
                if (current && sameBytes(current, file.bytes)) continue;
                await folder.write(file.name, file.bytes);
            } catch (error) {
                const before =
                    written.length > 0
                        ? ` Written before it: ${written.join(", ")}.`
                        : " Nothing was written before it.";
                notices.error(
                    `Could not export “${project.name}”: writing “${file.name}” to ` +
                        `“${folder.name}” failed: ${clause(reason(error))}.${before}`,
                );
                return false;
            }
            written.push(file.name);
        }
        const unchanged = all.length - written.length;
        notices.info(
            `Exported “${project.name}” to “${folder.name}”: ${filesCount(written.length)} ` +
                `written, ${unchanged} unchanged`,
        );
        return true;
    };

    const exportNow = async (): Promise<boolean> => {
        const state = sessions.getState();
        if (!state.open) return false;
        const { id, name, exportName } = state.session.project;
        const project: Exporting = { id, name, exportName };
        if (stroking()) return failed(name, "A stroke is in progress.");
        // The project as it is now; the worker makes the files while the folder is found.
        const made = maker.files(state.session.project);
        made.catch(() => {});
        if (!platform.canChooseFolder()) return download(project, made);

        let folder: ExportFolderHandle | null;
        try {
            folder = await destination(project.id);
        } catch (error) {
            return failed(project.name, reason(error));
        }
        if (!folder) return false;
        if (!(await writable(folder))) {
            return failed(project.name, `No permission to write to the folder “${folder.name}”.`);
        }
        let all: ExportFile[];
        try {
            all = await made;
            if (!(await owned(project, folder, all))) return false;
        } catch (error) {
            return failed(project.name, reason(error));
        }
        return write(project, folder, all);
    };

    return {
        canExport: () => files.canSave() && !stroking(),
        exportProject: () => files.run(exportNow),
        folderOf: (id) => folders.get(id)?.name ?? null,
    };
}

/** The export pipeline of the app. */
export const exportPipeline = createExportPipeline();
