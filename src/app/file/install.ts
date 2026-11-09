import type { StoreApi } from "zustand/vanilla";
import { OVERLAY_SELECTOR } from "../keymap/environment";
import { carriesFiles, droppedFiles } from "../platform/projectFiles";
import { sessionStore } from "../state/session";
import type { SessionState } from "../state/session";
import { isSpriteName } from "../tilesets/import/importSources";
import { isProjectFileName } from "./fileName";
import { fileWorkflows } from "./workflows";
import type { FileWorkflows } from "./workflows";

/** The part of `window` the file workflows listen on; tests pass an `EventTarget`. */
export interface FileEventTarget {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface FileWorkflowInstall {
    /** Where the page's events arrive; the default is `window`. */
    target?: FileEventTarget;
    /** The store of the window's project; the default is the app's. */
    sessions?: StoreApi<SessionState>;
    /**
     * What a dropped file is handed to, and what reports a save (the saved state changes the
     * store not); the default is the app's workflows.
     */
    workflows?: Pick<FileWorkflows, "busy" | "openFiles" | "subscribe">;
    /** Whether a menu, dialog or popover is open; the default reads the page. */
    overlayOpen?(): boolean;
}

/** The part of a drag event the drop reads. */
interface DragLike extends Event {
    dataTransfer: DataTransfer | null;
}

/**
 * The page-wide parts of the file workflows (SPEC §10.1; the sprite editor's
 * `app/file/install.ts`):
 *
 * - While the open project is dirty, a `beforeunload` listener asks the browser to confirm
 *   before the page is left (closing the tab, reloading). Otherwise no listener is there.
 * - A drop of files on the window opens the first `.ngtilemap` among them (`openFiles`). A
 *   `.ngsprite` without one, while a project is open, is the tileset import's
 *   (`app/tilesets/import/tilesetDrop.ts`); any other drop is reported as not a project.
 *   Every file drag has its default prevented, so a dropped file never replaces the app; a
 *   drop while a menu or dialog is open, or while a file operation runs, does nothing.
 *
 * Returns the function that removes the listeners.
 */
export function installFileWorkflows(install: FileWorkflowInstall = {}): () => void {
    const target: FileEventTarget = install.target ?? window;
    const sessions = install.sessions ?? sessionStore;
    const workflows = install.workflows ?? fileWorkflows;
    const overlayOpen =
        install.overlayOpen ?? (() => document.querySelector(OVERLAY_SELECTOR) !== null);

    const onBeforeUnload = (event: Event) => {
        event.preventDefault();
        // Chrome before 119 asks only when `returnValue` is set.
        (event as Event & { returnValue: unknown }).returnValue = true;
    };
    let guarded = false;
    const guard = () => {
        const { open, history } = sessions.getState();
        const unsaved = open && history.dirty;
        if (unsaved === guarded) return;
        guarded = unsaved;
        if (unsaved) target.addEventListener("beforeunload", onBeforeUnload);
        else target.removeEventListener("beforeunload", onBeforeUnload);
    };
    guard();
    const stopSessions = sessions.subscribe(guard);
    const stopWorkflows = workflows.subscribe(guard);

    const accepts = () => !overlayOpen() && !workflows.busy;
    const onDragOver = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!carriesFiles(dataTransfer) || !dataTransfer) return;
        event.preventDefault();
        dataTransfer.dropEffect = accepts() ? "copy" : "none";
    };
    const onDrop = (event: Event) => {
        const { dataTransfer } = event as DragLike;
        if (!carriesFiles(dataTransfer) || !dataTransfer) return;
        event.preventDefault();
        if (!accepts()) return;
        const files = droppedFiles(dataTransfer);
        const names = files.map((file) => file.name);
        if (
            !names.some(isProjectFileName) &&
            sessions.getState().open &&
            names.some(isSpriteName)
        ) {
            return;
        }
        void workflows.openFiles(files);
    };
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);

    return () => {
        stopSessions();
        stopWorkflows();
        if (guarded) target.removeEventListener("beforeunload", onBeforeUnload);
        guarded = false;
        target.removeEventListener("dragover", onDragOver);
        target.removeEventListener("drop", onDrop);
    };
}
