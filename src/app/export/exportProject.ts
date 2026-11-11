import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";
import { EXPORT_MARKER_FILE, readExportMarker } from "../../core/export";
import type { ExportFile, ExportPreview } from "../../core/export";
import type { Project } from "../../core/model";
import { projectToWire, wireBuffers } from "../../core/project";
import { projectFieldProblems, setProjectFieldsCommand } from "../../core/properties";
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
import type { ExportDestination, ExportDialogs, ExportPreviewState } from "./dialogs";
import { FOLDER_LOAD_TIMEOUT_MS, indexedDbExportFolders } from "./exportFolders";
import type { ExportFolderStorage } from "./exportFolders";
import { setExportOnSave } from "./exportSettings";

// The export pipeline of SPEC §10.2 (the sprite editor's `exportWorkflows.ts`, SE-052), on the
// window's project, and the three ways it starts (TE-054):
//
// - Export… shows the Export dialog: the destination folder, the project's export name and
//   Export on save on the left, the files the export writes with their sizes and the packed
//   tilesets on the right. Its Export button exports into the folder, chosen first when none
//   is known.
// - Export Again exports without the dialog when the project's folder is known, still exists
//   and may be written; otherwise it shows the dialog.
// - Export on Save: after a successful save, inside the same file operation (`onSaved`), when
//   the project's `exportOnSave` is on. It never shows a dialog or asks a question; any problem
//   is one error toast and the save stands.
//
// The export itself:
//
// - The project is taken as it is when the export starts: a snapshot goes to the background
//   worker, which makes every file (`core/export`: packing, PNGs, tilemap JSON, runtime) while
//   the export finds its folder. A stroke in progress stops the export before anything is done.
// - With File System Access the files go into the project's folder: chosen once per project ID
//   with the directory picker and kept in IndexedDB (`exportFolders.ts`); a folder that no
//   longer exists is chosen again. Write permission is asked for once, within the user's
//   gesture.
// - Before writing, the folder's marker is read. A marker of another project, or files of the
//   export's names without a marker, ask Replace / Cancel naming that project (Export on Save
//   reports it instead).
// - Files are written in the plan's order (marker, PNGs, atlases, tilemap JSON, runtime); a file
//   whose bytes equal the folder's is not written again, and nothing is removed. A failed write
//   stops the export with one toast naming the file and those written before it.
// - Without File System Access the files download as `<exportName>.zip`.
//
// Export… and Export Again are file operations (`FileWorkflows.run`): one at a time. Results
// are an info toast; each failed export is one error toast; a picker, a question or a dialog the
// user cancels is not reported.

/** Where the export's files are made: the background worker, or `core` directly in tests. */
export interface ExportMaker {
    /**
     * Takes a snapshot of the project now and returns what makes every file of the folder from
     * it, to be called once; that rejects with `TilesetPackError` when a tileset cannot pack.
     * The project may change in between: the files are those of the snapshot (SPEC §10.2).
     */
    snapshot(project: Project): () => Promise<ExportFile[]>;
    /** A zip archive of the files, in their order. */
    zip(files: readonly ExportFile[]): Promise<Uint8Array<ArrayBuffer>>;
}

/** Makes what the Export dialog shows of a project's export (`core/export` `exportPreview`). */
export type ExportPreviewer = (project: Project) => Promise<ExportPreview>;

/** A snapshot of the project for the worker, and the buffers that move with it. */
function snapshotOf(project: Project) {
    const snapshot = structuredClone(projectToWire(project));
    return { snapshot, transfer: wireBuffers(snapshot) };
}

/**
 * The maker in the background worker. `snapshot` takes the snapshot when it is called
 * (`structuredClone` of the project's plain form); the worker gets it, its buffers
 * transferred, only when the returned function is called, so the project can change meanwhile.
 */
export function workerExportMaker(worker: WorkerClient = backgroundWorker): ExportMaker {
    return {
        snapshot(project) {
            const { snapshot, transfer } = snapshotOf(project);
            return () => worker.run("export.files", { project: snapshot }, { transfer });
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

/** The previewer in the background worker, on a snapshot of the project as `files` takes one. */
export function workerExportPreviewer(worker: WorkerClient = backgroundWorker): ExportPreviewer {
    return (project) => {
        const { snapshot, transfer } = snapshotOf(project);
        return worker.run("export.preview", { project: snapshot }, { transfer });
    };
}

export interface ExportProjectOptions {
    /** The store of the window's project; the default is the app's. */
    sessions?: StoreApi<SessionState>;
    /** Where exports go; the default is the page's. */
    platform?: ExportPlatform;
    /** Where the export folders are kept; the default is the page's IndexedDB. */
    storage?: ExportFolderStorage;
    /** Where the dialogs are shown; the default is the app's dialog host. */
    dialogs?: ExportDialogs;
    /** Where results and failures go; the default is the app's toasts. */
    notices?: Pick<Notices, "info" | "error">;
    /** The file operations an export is one of; the default is the app's. */
    files?: Pick<FileWorkflows, "run" | "canSave">;
    /** Where the files are made; the default is the background worker. */
    maker?: ExportMaker;
    /** Where the Export dialog's files are made; the default is the background worker. */
    previewer?: ExportPreviewer;
    /** Whether a stroke is in progress; the default reads the app's history and tools. */
    stroking?(): boolean;
}

export interface ExportPipeline {
    /** Whether an export can start now: a project is open and no file operation or stroke runs. */
    canExport(): boolean;
    /**
     * Exports the window's project as it is now, as the Export dialog's Export does once the
     * dialog is closed, without the dialog: into its folder (chosen first when none is known),
     * or as a zip download without File System Access. Resolves true once every file is in
     * place, false when it failed (reported) or was cancelled. No command calls it; the tests
     * and the export benchmark start an export with it.
     */
    exportProject(): Promise<boolean>;
    /** Export…: the Export dialog, then the export when the user says so. */
    exportWithDialog(): Promise<boolean>;
    /**
     * Export Again: the export without the dialog when the project's folder is known, exists
     * and may be written (or without File System Access, the download); otherwise the dialog.
     */
    exportAgain(): Promise<boolean>;
    /**
     * What a successful save runs, inside its file operation (`FileWorkflows.onSaved`): the
     * export, when the project's `exportOnSave` is on. Never shows a dialog or asks; a problem
     * is one error toast.
     */
    exportOnSave(): Promise<void>;
    /** The name of a project's export folder, if one is known in this session. */
    folderOf(projectId: string): string | null;
}

/** How an export was started: what it does without a folder, permission or ownership. */
type Mode = "dialog" | "again" | "save";

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
    const previewer = options.previewer ?? workerExportPreviewer();
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

    /**
     * Whether the export may write into the folder: it is the project's (its marker names the
     * project), it holds none of the export's files, or the user says to replace them. Export on
     * Save asks nothing: it reports the files and stops.
     */
    const owned = async (
        project: Exporting,
        folder: ExportFolderHandle,
        all: readonly ExportFile[],
        mode: Mode,
    ): Promise<boolean> => {
        const markerBytes = await folder.read(EXPORT_MARKER_FILE);
        const marker = markerBytes ? readExportMarker(markerBytes) : null;
        if (marker?.projectId === project.id) return true;
        const existing = await folder.existing(all.map((file) => file.name));
        if (existing.length === 0) return true;
        if (mode === "save") {
            const owner = marker ? ` of “${marker.projectName}”` : "";
            return failed(
                project.name,
                `The folder “${folder.name}”${owner} holds files this export would replace ` +
                    `(${existing.join(", ")}). Use Export… to confirm replacing them.`,
            );
        }
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

    /**
     * Exports the project as it is now. `mode` says what happens without a folder or permission:
     * the dialog's export chooses a folder and reports a refusal; Export Again shows the dialog;
     * Export on Save reports both. `ready` is the files of the project as it is now when they
     * are made already (the Export dialog's preview).
     */
    const deliver = async (
        mode: Mode,
        ready: Promise<ExportFile[]> | null = null,
    ): Promise<boolean> => {
        const state = sessions.getState();
        if (!state.open) return false;
        const { id, name, exportName } = state.session.project;
        const project: Exporting = { id, name, exportName };
        // A stroke in progress stops the export; Export on Save stops for an edit made after the
        // save (not what was saved).
        if (stroking()) return failed(name, "A stroke is in progress.");
        if (mode === "save" && state.history.dirty) {
            return failed(name, "It changed after it was saved. Use Export Again.");
        }
        // The export reads the project as of now (SPEC §10.2): its snapshot is taken here.
        // Export… and the download make the files from it while the folder is found. Export
        // Again and Export on Save make them once a folder that may be written is settled:
        // where there is none they show the dialog or stop, and the worker is not kept busy for
        // nothing.
        const job = ready ? null : maker.snapshot(state.session.project);
        const make = (): Promise<ExportFile[]> => {
            const files = job!();
            files.catch(() => {});
            return files;
        };
        // A failure is reported where the files are awaited; an export that stops before then
        // leaves it unread.
        ready?.catch(() => {});
        let made = ready;
        if (!made && (mode === "dialog" || !platform.canChooseFolder())) made = make();
        if (!platform.canChooseFolder()) return download(project, made!);

        let folder: ExportFolderHandle | null = null;
        let gone: string | null = null;
        try {
            const known = await folderOf(project.id);
            if (known && (await known.exists())) folder = known;
            else if (known) gone = known.name;
        } catch (error) {
            return failed(name, reason(error));
        }
        if (!folder) {
            if (mode === "again") return dialogExport();
            if (mode === "save") {
                return failed(
                    name,
                    gone === null
                        ? "No export folder is chosen yet. Use Export…."
                        : `The folder “${gone}” no longer exists. Use Export….`,
                );
            }
            try {
                folder = await platform.chooseFolder();
            } catch (error) {
                return failed(name, reason(error));
            }
            if (!folder) return false;
            remember(project.id, folder);
        }

        // Permission first: the browser prompts only within the user's gesture. One prompt;
        // without a gesture there is none.
        let allowed: boolean;
        let lapsed = false;
        try {
            allowed = await folder.canWrite();
            if (!allowed) {
                if (platform.hasUserActivation()) allowed = await folder.requestWrite();
                else lapsed = true;
            }
        } catch {
            allowed = false;
        }
        if (!allowed) {
            if (mode === "again") return dialogExport();
            const denied = `No permission to write to the folder “${folder.name}”.`;
            return failed(name, lapsed && mode === "save" ? `${denied} Use Export Again.` : denied);
        }

        made ??= make();
        let all: ExportFile[];
        try {
            all = await made;
            if (!(await owned(project, folder, all, mode))) return false;
        } catch (error) {
            return failed(name, reason(error));
        }
        return write(project, folder, all);
    };

    /** Shows the Export dialog for the open project; exports when the user says so. */
    const dialogExport = async (): Promise<boolean> => {
        const state = sessions.getState();
        if (!state.open) return false;
        const project = state.session.project;
        const { id } = project;
        const folderApi = platform.canChooseFolder();
        let known: ExportFolderHandle | null = null;
        if (folderApi) {
            try {
                known = await folderOf(id);
            } catch {
                // Storage did not answer: the dialog shows no folder, and Export asks for one.
            }
        }
        const destination = createStore<ExportDestination>(() => ({
            mode: folderApi ? "folder" : "download",
            folder: known?.name ?? null,
            choosing: false,
        }));
        const preview = createStore<ExportPreviewState>(() => ({ status: "making" }));

        // The files are made again whenever the project changes (a step of its history): the
        // newest result wins, and an earlier one that arrives later is dropped. The newest is
        // kept: Export writes its files when the project has not changed since.
        let shown: { project: Project; position: number; made: Promise<ExportPreview> } | null =
            null;
        let generation = 0;
        const refresh = () => {
            const now = sessions.getState();
            if (!now.open || now.session.project.id !== id) return;
            const position = now.history.position;
            if (shown?.project === now.session.project && shown.position === position) return;
            const made = previewer(now.session.project);
            shown = { project: now.session.project, position, made };
            const mine = ++generation;
            const before = preview.getState();
            preview.setState(
                before.status === "ready"
                    ? { status: "making", previous: before.preview }
                    : { status: "making" },
                true,
            );
            made.then(
                (result) => {
                    if (mine === generation)
                        preview.setState({ status: "ready", preview: result }, true);
                },
                (error: unknown) => {
                    if (mine === generation) {
                        preview.setState({ status: "failed", error: reason(error) }, true);
                    }
                },
            );
        };
        /**
         * The files of the last preview when it is of the project as it is now (made or still
         * being made), so Export does not make them a second time; null otherwise.
         */
        const previewFiles = (): Promise<ExportFile[]> | null => {
            const now = sessions.getState();
            if (shown === null || !now.open || shown.project !== now.session.project) return null;
            if (shown.position !== now.history.position) return null;
            return shown.made.then((result) => [...result.plan]);
        };
        const stop = sessions.subscribe(refresh);
        refresh();

        let answer: true | null;
        try {
            answer = await dialogs.exportProject({
                projectId: id,
                destination,
                preview,
                setExportName(value) {
                    const now = sessions.getState();
                    if (!now.open || now.session.project.id !== id) return null;
                    const problem = projectFieldProblems({ exportName: value }).exportName;
                    if (problem) return problem;
                    if (now.session.project.exportName === value) return null;
                    if (stroking()) return "A stroke is in progress.";
                    try {
                        now.history.execute(setProjectFieldsCommand({ exportName: value }));
                    } catch (error) {
                        return reason(error);
                    }
                    return null;
                },
                setExportOnSave(on) {
                    const now = sessions.getState();
                    if (now.open && now.session.project.id === id) setExportOnSave(sessions, on);
                },
                chooseFolder() {
                    if (!folderApi || destination.getState().choosing) return;
                    destination.setState({ choosing: true });
                    void (async () => {
                        try {
                            const folder = await platform.chooseFolder();
                            if (folder) {
                                remember(id, folder);
                                destination.setState({ folder: folder.name });
                            }
                        } catch (error) {
                            failed(project.name, reason(error));
                        } finally {
                            destination.setState({ choosing: false });
                        }
                    })();
                },
            });
        } finally {
            stop();
            generation += 1;
        }
        if (!answer) return false;
        return deliver("dialog", previewFiles());
    };

    /** Runs an export as a file operation; what it throws is one error toast. */
    const operation = (task: () => Promise<boolean>): Promise<boolean> =>
        files.run(async () => {
            try {
                return await task();
            } catch (error) {
                const state = sessions.getState();
                return failed(state.session.project.name, reason(error));
            }
        });

    return {
        canExport: () => files.canSave() && !stroking(),
        exportProject: () => files.run(() => deliver("dialog")),
        exportWithDialog: () => operation(dialogExport),
        exportAgain: () => operation(() => deliver("again")),
        async exportOnSave() {
            const state = sessions.getState();
            if (!state.open || !state.session.project.exportSettings.exportOnSave) return;
            try {
                await deliver("save");
            } catch (error) {
                failed(state.session.project.name, reason(error));
            }
        },
        folderOf: (id) => folders.get(id)?.name ?? null,
    };
}

/** The export pipeline of the app. */
export const exportPipeline = createExportPipeline();
