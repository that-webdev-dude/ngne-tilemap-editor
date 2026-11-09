import type { StoreApi } from "zustand/vanilla";
import { newMapProblems } from "../../core/maps";
import {
    DEFAULT_MAP_NAME,
    DEFAULT_PROJECT_NAME,
    MAX_IMAGES,
    MAX_MAPS,
    MAX_TEXT_LENGTH,
    MAX_TILESETS,
    createMapSession,
    createProject,
    createProjectSession,
    randomId,
} from "../../core/model";
import type { Project, ProjectSession } from "../../core/model";
import { MAX_CONTENT_BYTES, PROJECT_FILE_EXTENSION } from "../../core/project";
import { fitWhenShown, newMapDefaults } from "../maps/maps";
import { notices as appNotices } from "../notices/notices";
import type { Notices } from "../notices/notices";
import { browserProjectFiles } from "../platform/projectFiles";
import type {
    ChosenFile,
    PermissionAnswer,
    ProjectFileHandle,
    ProjectFilePlatform,
} from "../platform/projectFiles";
import { sessionStore } from "../state/session";
import type { SessionState } from "../state/session";
import { tabsAvailable } from "../tabs/tabs";
import { tilesetWorkflowBusy } from "../tilesets/tilesetWorkflow";
import { fileDialogs as appFileDialogs } from "./dialogs";
import type { FileDialogs, NewProjectProblems, NewProjectValues, ReplaceAction } from "./dialogs";
import { isProjectFileName, projectFileName } from "./fileName";
import { workerProjectCodec } from "./projectCodec";
import type { ProjectCodec } from "./projectCodec";
import { recentFiles } from "./recentFiles";
import type { RecentEntry, RecentFiles } from "./recentFiles";

// The file workflows of SPEC §10.1 (the sprite editor's SPEC §10, SE-041 and SE-047), applied
// to the one project of the window: New Project, Open (picker, drop, recent files), Save,
// Save As, Revert and Close Project. The project remembers the file it was opened from or last
// saved to; with File System Access that is a handle Save writes to again. The file's bytes are
// written and read in the background worker (`projectCodec.ts`).
//
// One project per window: New Project, Open and Close Project take the open project away, so
// they ask Save / Discard / Cancel first when it has unsaved changes; Open asks once the file
// has been read, so a file that cannot be opened changes nothing and asks nothing. Revert asks
// Discard / Cancel.
//
// One operation at a time: while one runs (a picker, a question, a read or a write), `busy` is
// true and the others do nothing. None acts during a stroke or while a tileset is imported or
// updated. Results and failures are reported as notices (toasts): one for each operation that
// fails or is given up after it started, none when the user cancels. A failure leaves the
// project as it was.

/** Zip framing allowed per entry on top of the content of a project (headers, names). */
const ZIP_FRAMING_BYTES_PER_ENTRY = 1024;
/** The end-of-central-directory record with the longest comment a zip can hold. */
const MAX_END_RECORD_BYTES = 22 + 0xffff;
/** The most entries a project file has (FORMAT §2.2): manifest, project, maps, thumbnails, PNGs. */
const MAX_PROJECT_ENTRIES = 2 + 2 * MAX_MAPS + MAX_TILESETS + MAX_IMAGES;

/**
 * The largest file Open reads: the content a project may hold (FORMAT §2.8: 2 GiB) plus 1 KiB
 * of zip framing for each entry it can have. A larger file is refused before it is read.
 */
export const MAX_PROJECT_FILE_BYTES =
    MAX_CONTENT_BYTES + MAX_PROJECT_ENTRIES * ZIP_FRAMING_BYTES_PER_ENTRY + MAX_END_RECORD_BYTES;

/** The file the project was opened from or last saved to. */
export interface ProjectFile {
    /** Its name: what messages call it and what the next save suggests. */
    readonly name: string;
    /** Where Save writes without asking: a File System Access handle; null without one. */
    readonly handle: ProjectFileHandle | null;
    /** Without a handle: the bytes last read or written, which Revert reads again. */
    readonly bytes: Uint8Array | null;
}

export interface FileWorkflowOptions {
    /** The store of the window's project; the default is the app's. */
    sessions?: StoreApi<SessionState>;
    /** How files are chosen, read and written; the default is the page's. */
    platform?: ProjectFilePlatform;
    /** How a project becomes bytes and back; the default runs in the background worker. */
    codec?: ProjectCodec;
    /** Where the questions are asked; the default is the app's dialog host. */
    dialogs?: FileDialogs;
    /** Where results and failures go; the default is the app's toasts. */
    notices?: Pick<Notices, "info" | "error">;
    /** The recent files; the default is the app's. */
    recent?: Pick<RecentFiles, "add" | "remove">;
    /**
     * Whether the project can be taken or saved now: no stroke runs and no tileset is imported
     * or updated. The default reads the app's.
     */
    idle?(): boolean;
    /** Shows a new project's map fitted once the viewport has a size; the default is the app's. */
    fitWhenShown?(mapId: string): void;
    /** The values New Project starts from; the default uses the last new map's sizes. */
    newProjectDefaults?(): NewProjectValues;
}

export interface FileWorkflows {
    /** True while an operation runs; the others do nothing until it ends. */
    readonly busy: boolean;
    /** Calls `listener` when `busy` or the project's file changes, and after every save. */
    subscribe(listener: () => void): () => void;
    /** The project's file, or null when it has none (never saved, not opened, or none open). */
    file(): ProjectFile | null;
    /** Whether an operation can start now: none runs, no stroke, no tileset workflow. */
    canAct(): boolean;
    /** Whether Save and Save As can run now: `canAct` and a project is open. */
    canSave(): boolean;
    /** Asks for the new project's values, then replaces the open project with it. */
    newProject(): Promise<boolean>;
    /** Asks for a project file and opens it in place of the open project. */
    open(): Promise<boolean>;
    /** Opens the first project file among `files` (a drop), as `open` does. */
    openFiles(files: readonly ChosenFile[]): Promise<boolean>;
    /**
     * Opens the file of a recent entry, as `open` does. Read permission is asked for once when
     * it is not granted; refused, or the file gone, the entry is taken off the list.
     */
    openRecent(entry: RecentEntry): Promise<boolean>;
    /** Saves the project to its file, or asks where when it has none. */
    save(): Promise<boolean>;
    /** Saves the project to a file chosen now, which becomes its file. */
    saveAs(): Promise<boolean>;
    /** Reads the project's file again in its place, asking first when it is dirty. */
    revert(): Promise<boolean>;
    /** Closes the project (the empty state), asking first when it is dirty. */
    close(): Promise<boolean>;
    /**
     * Runs `task` as a file operation of its own (an export, TE-054): not while another one
     * runs (it resolves false then), and with `busy` true meanwhile.
     */
    run(task: () => Promise<boolean>): Promise<boolean>;
}

/** What went wrong, for a message: the task's own error through the worker, or the error's. */
export function reason(error: unknown): string {
    const remote = (error as { remote?: { message?: unknown } } | null)?.remote;
    if (remote && typeof remote.message === "string" && remote.message !== "") {
        return remote.message;
    }
    return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/** The file a handle names is gone: moved or deleted since it was chosen. */
function isNotFound(error: unknown): boolean {
    return error instanceof DOMException && error.name === "NotFoundError";
}

/** Why New Project cannot make a project of `values`, by field; empty when it can. */
export function newProjectProblems(values: NewProjectValues): NewProjectProblems {
    const problems: NewProjectProblems = newMapProblems(values.map);
    if (values.name.trim() === "") problems.projectName = "A project needs a name.";
    else if (values.name.length > MAX_TEXT_LENGTH) {
        problems.projectName = `A project name has at most ${MAX_TEXT_LENGTH} characters.`;
    }
    return problems;
}

/** The project New Project makes: its name and one map of the values given (SPEC §10.1). */
export function newProjectOf(values: NewProjectValues): Project {
    return createProject({ name: values.name, map: values.map });
}

/**
 * The session of a project read again in place of `previous` (Revert): each map that is still
 * there keeps its view, and the active map stays active when it is still there. Selections and
 * active layers start afresh, as for an opened project.
 */
export function revertedSession(project: Project, previous: ProjectSession): ProjectSession {
    const session = createProjectSession(project);
    for (const map of project.maps) {
        const view = previous.perMap.get(map.id)?.view;
        if (!view) continue;
        session.perMap.set(map.id, { ...createMapSession(map), view: { ...view } });
    }
    if (project.maps.some((map) => map.id === previous.activeMapId)) {
        session.activeMapId = previous.activeMapId;
        const active = project.maps.find((map) => map.id === previous.activeMapId)!;
        if (!session.perMap.has(active.id)) session.perMap.set(active.id, createMapSession(active));
    }
    return session;
}

export function createFileWorkflows(options: FileWorkflowOptions = {}): FileWorkflows {
    const sessions = options.sessions ?? sessionStore;
    const platform = options.platform ?? browserProjectFiles();
    const codec = options.codec ?? workerProjectCodec();
    const dialogs = options.dialogs ?? appFileDialogs;
    const notices = options.notices ?? appNotices;
    const recent = options.recent ?? recentFiles;
    const idle = options.idle ?? (() => tabsAvailable() && !tilesetWorkflowBusy());
    const fit = options.fitWhenShown ?? fitWhenShown;
    const defaults =
        options.newProjectDefaults ??
        (() => ({
            name: DEFAULT_PROJECT_NAME,
            map: { ...newMapDefaults(), name: DEFAULT_MAP_NAME },
        }));
    /** Lists a file in the recent files; a failure there never fails the operation. */
    const remember = (handle: ProjectFileHandle | null) => {
        if (handle) void recent.add(handle).catch(() => {});
    };

    let file: ProjectFile | null = null;
    const listeners = new Set<() => void>();
    let busy = false;

    const changed = () => {
        for (const listener of [...listeners]) listener();
    };
    const setFile = (next: ProjectFile | null) => {
        file = next;
        changed();
    };
    // A project closed or replaced by another route (a test, a later ticket) has no file.
    let project = sessions.getState().session.project;
    sessions.subscribe((state) => {
        if (state.session.project === project) return;
        project = state.session.project;
        if (file) setFile(null);
    });

    /** Runs `task` unless another operation runs; `busy` meanwhile. */
    const exclusive = async (task: () => Promise<boolean>): Promise<boolean> => {
        if (busy) return false;
        busy = true;
        changed();
        try {
            return await task();
        } finally {
            busy = false;
            changed();
        }
    };

    /** Shows `session` as the open project, with `next` as its file. */
    const show = (session: ProjectSession, next: ProjectFile | null) => {
        sessions.getState().replace(session);
        project = session.project;
        setFile(next);
    };

    /** Why an operation that started cannot go on: a stroke or a tileset workflow began. */
    const notIdle = () =>
        tilesetWorkflowBusy()
            ? "A tileset is being imported or updated."
            : "A stroke is in progress.";

    /** Reads a project; reports what keeps it from opening and returns null then. */
    const read = async (
        name: string,
        bytesOf: () => Promise<Uint8Array>,
        verb: string,
    ): Promise<{ bytes: Uint8Array; project: Project } | null> => {
        try {
            const bytes = await bytesOf();
            return { bytes, project: await codec.read(bytes) };
        } catch (error) {
            notices.error(`Could not ${verb} “${name}”. ${reason(error)}`);
            return null;
        }
    };

    /** Whether `handle` names the project's own file. */
    const isOwnFile = async (handle: ProjectFileHandle | null): Promise<boolean> => {
        const own = file?.handle ?? null;
        if (!handle || !own) return false;
        return own === handle || ((await own.isSame?.(handle)) ?? false);
    };

    /**
     * Writes the project to its file, or to one chosen now (`as`, or no file yet). Runs inside
     * an operation. Returns whether the file was written.
     */
    const saveProject = async (as: boolean): Promise<boolean> => {
        const state = sessions.getState();
        if (!state.open) return false;
        const known = file;
        const suggested = known?.name ?? projectFileName(state.session.project.name);
        const failed = (name: string, why: string) => {
            notices.error(`Could not save “${name}”. ${why}`);
            return false;
        };
        if (!idle()) return failed(suggested, notIdle());

        let target = as ? null : (known?.handle ?? null);
        try {
            // Permission is settled before the bytes are made: the browser prompts only
            // within the user's gesture. Refused, Save asks where to save, as Save As does,
            // while the gesture lasts; the picker needs it too.
            if (target && !(await target.requestWrite())) {
                if (!platform.hasUserActivation()) {
                    notices.error(`No permission to write “${target.name}”. Use Save As…`);
                    return false;
                }
                target = null;
            }
            if (!target && platform.canChooseSaveTarget()) {
                target = await platform.chooseSaveTarget(suggested);
                if (!target) return false;
            }
        } catch (error) {
            return failed(target?.name ?? suggested, reason(error));
        }
        // Save As to another file than the project's: the project becomes that file's, under a
        // new ID written into it, so the copy shares nothing kept by ID (its autosave and its
        // export folder) with the file it came from (the sprite editor's SE-047 review).
        // Without File System Access Save As downloads as Save does, and the ID stays.
        let nextId: string | null = null;
        if (as && known && target && !(await isOwnFile(target))) nextId = randomId();

        // A picker or a prompt may have been open for a while: the project is taken as it is
        // now, if it is still the one and no stroke has begun.
        const current = sessions.getState();
        if (current.session.project !== state.session.project) {
            return failed(target?.name ?? suggested, "The project was closed meanwhile.");
        }
        if (!idle()) return failed(target?.name ?? suggested, notIdle());
        // The state the bytes hold: a change made while they are written keeps it dirty.
        const saved = current.history.state;
        let bytes: Uint8Array<ArrayBuffer>;
        try {
            const written = current.session.project;
            bytes = await codec.write(nextId ? { ...written, id: nextId } : written);
        } catch (error) {
            return failed(target?.name ?? suggested, reason(error));
        }
        try {
            if (target) await target.write(bytes);
            else platform.download(suggested, bytes);
        } catch (error) {
            const kept = target !== null && target === known?.handle;
            if (!target || !kept || !isNotFound(error)) {
                return failed(target?.name ?? suggested, reason(error));
            }
            // The project's file was moved or deleted: ask where to save while the gesture
            // lasts, as Save As does.
            if (!platform.hasUserActivation()) {
                return failed(target.name, "The file no longer exists. Use Save As…");
            }
            try {
                target = await platform.chooseSaveTarget(suggested);
                if (!target) return false;
                await target.write(bytes);
            } catch (retry) {
                return failed(target?.name ?? suggested, reason(retry));
            }
        }
        const name = target?.name ?? suggested;
        const after = sessions.getState();
        if (after.session.project === current.session.project) {
            if (nextId) after.session.project.id = nextId;
            // Recorded without a change of the store, which would redraw the viewport: the
            // workflows' listeners (`subscribeDirty`) are told by `setFile`.
            after.history.markSaved(saved);
            setFile({ name, handle: target, bytes: target ? null : bytes });
        }
        remember(target);
        notices.info(`Saved ${name}`);
        return true;
    };

    /**
     * Before the open project goes (`action`): nothing to ask when it is clean or none is
     * open; otherwise Save / Discard / Cancel, and Save saves it first. True to go on.
     */
    const mayReplace = async (action: ReplaceAction, incoming: string | null): Promise<boolean> => {
        const state = sessions.getState();
        if (!state.open || !state.history.dirty) return true;
        const choice = await dialogs.confirmSave({
            project: state.session.project.name,
            action,
            file: incoming,
        });
        if (choice === null) return false;
        if (choice === "save") return saveProject(false);
        return true;
    };

    const openChosen = async (chosen: ChosenFile): Promise<boolean> => {
        const failed = (why: string) => {
            notices.error(`Could not open “${chosen.name}”. ${why}`);
            return false;
        };
        // A file no project can be is not read into memory at all.
        if (chosen.size > MAX_PROJECT_FILE_BYTES) {
            return failed(
                `The file is too large to be a tilemap project: ${chosen.size} bytes; the ` +
                    `limit is ${MAX_PROJECT_FILE_BYTES} bytes.`,
            );
        }
        // The file is read first: a file that cannot be opened changes nothing.
        const opened = await read(chosen.name, () => chosen.read(), "open");
        if (!opened) return false;
        const handle = await chosen.handle();
        // The project's own file: nothing changes (Revert reads it again).
        if (sessions.getState().open && (await isOwnFile(handle))) {
            remember(handle);
            notices.info(`${chosen.name} is open already`);
            return true;
        }
        if (!(await mayReplace("open", chosen.name))) return false;
        if (!idle()) return failed(notIdle());
        show(createProjectSession(opened.project), {
            name: chosen.name,
            handle,
            bytes: handle ? null : opened.bytes,
        });
        remember(handle);
        notices.info(`Opened ${chosen.name}`);
        return true;
    };

    const canAct = () => !busy && idle();

    return {
        get busy() {
            return busy;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        file: () => file,
        canAct,
        canSave: () => canAct() && sessions.getState().open,

        newProject: () =>
            exclusive(async () => {
                if (!idle()) return false;
                const values = await dialogs.newProject({
                    initial: defaults(),
                    problems: newProjectProblems,
                });
                if (!values) return false;
                if (!(await mayReplace("new", null))) return false;
                if (!idle()) {
                    notices.error(`Could not create “${values.name}”. ${notIdle()}`);
                    return false;
                }
                let session: ProjectSession;
                try {
                    session = createProjectSession(newProjectOf(values));
                } catch (error) {
                    notices.error(`Could not create “${values.name}”. ${reason(error)}`);
                    return false;
                }
                show(session, null);
                fit(session.activeMapId);
                return true;
            }),

        open: () =>
            exclusive(async () => {
                if (!idle()) {
                    notices.error(`Could not open a file. ${notIdle()}`);
                    return false;
                }
                let chosen: ChosenFile | null;
                try {
                    chosen = await platform.chooseFileToOpen();
                } catch (error) {
                    notices.error(`Could not open a file. ${reason(error)}`);
                    return false;
                }
                return chosen ? openChosen(chosen) : false;
            }),

        openFiles: (chosen) =>
            exclusive(async () => {
                const project = chosen.find((each) => isProjectFileName(each.name));
                if (project) return openChosen(project);
                const [first] = chosen;
                if (first) {
                    notices.error(
                        `“${first.name}” is not a tilemap project (${PROJECT_FILE_EXTENSION}).`,
                    );
                }
                return false;
            }),

        openRecent: (entry) =>
            exclusive(async () => {
                const { handle } = entry;
                const failed = (why: string) => {
                    notices.error(`Could not open “${entry.name}”. ${why}`);
                    return false;
                };
                // The list changes in the background: storage never holds up the operation.
                const forget = (why: string) => {
                    void recent.remove(entry.key).catch(() => {});
                    return failed(`${why} It was removed from the recent files.`);
                };
                if (!idle()) return failed(notIdle());
                // Asked once, within the gesture of the command. Refused ("denied"), the entry
                // goes; a prompt dismissed without an answer keeps it.
                let permission: PermissionAnswer;
                try {
                    permission = handle.requestReadPermission
                        ? await handle.requestReadPermission()
                        : (await handle.requestRead())
                          ? "granted"
                          : "denied";
                } catch (error) {
                    return failed(reason(error));
                }
                if (permission === "denied") return forget("No permission to read the file.");
                if (permission !== "granted") {
                    return failed(
                        "Read permission was not given. The file stays in the recent files.",
                    );
                }
                let size: number;
                try {
                    size = (await handle.size?.()) ?? 0;
                } catch (error) {
                    return isNotFound(error)
                        ? forget("The file no longer exists.")
                        : failed(reason(error));
                }
                return openChosen({
                    name: entry.name,
                    size,
                    read: () => handle.read(),
                    handle: async () => handle,
                });
            }),

        save: () => exclusive(() => saveProject(false)),
        saveAs: () => exclusive(() => saveProject(true)),

        revert: () =>
            exclusive(async () => {
                const state = sessions.getState();
                const known = file;
                if (!state.open || !known) return false;
                const failed = (why: string) => {
                    notices.error(`Could not revert to “${known.name}”. ${why}`);
                    return false;
                };
                if (!idle()) return failed(notIdle());
                if (state.history.dirty) {
                    const discard = await dialogs.confirmDiscard({
                        document: state.session.project.name,
                        action: "revert",
                        file: known.name,
                    });
                    if (!discard) return false;
                }
                const { handle, bytes } = known;
                // Read permission can lapse: asked again, within the gesture of the command or
                // of the question's Discard.
                try {
                    if (handle && !(await handle.requestRead())) {
                        notices.error(`No permission to read “${known.name}”.`);
                        return false;
                    }
                } catch (error) {
                    return failed(reason(error));
                }
                const opened = await read(
                    known.name,
                    async () => (handle ? handle.read() : (bytes ?? new Uint8Array())),
                    "revert to",
                );
                if (!opened) return false;
                const current = sessions.getState();
                if (current.session.project !== state.session.project) {
                    return failed("The project was closed meanwhile.");
                }
                if (!idle()) return failed(notIdle());
                show(revertedSession(opened.project, current.session), {
                    name: known.name,
                    handle,
                    bytes: handle ? null : opened.bytes,
                });
                notices.info(`Reverted to ${known.name}`);
                return true;
            }),

        close: () =>
            exclusive(async () => {
                const state = sessions.getState();
                if (!state.open || !idle()) return false;
                if (!(await mayReplace("close", null))) return false;
                if (!idle()) {
                    notices.error(`Could not close “${state.session.project.name}”. ${notIdle()}`);
                    return false;
                }
                sessions.getState().close();
                project = sessions.getState().session.project;
                setFile(null);
                return true;
            }),

        run: (task) => exclusive(task),
    };
}

/** The file workflows of the app. */
export const fileWorkflows = createFileWorkflows();

/**
 * Calls `listener` whenever the app's project may have become dirty or clean: a change of the
 * session store (a step of the history, another project) or a save, which records the saved
 * state without changing the store. Returns the function that stops it.
 */
export function subscribeDirty(listener: () => void): () => void {
    const stopSessions = sessionStore.subscribe(() => listener());
    const stopWorkflows = fileWorkflows.subscribe(listener);
    return () => {
        stopSessions();
        stopWorkflows();
    };
}

/** Whether the app's project is open and differs from its last save. */
export function projectDirty(): boolean {
    const { open, history } = sessionStore.getState();
    return open && history.dirty;
}
