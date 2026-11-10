import type { StoreApi } from "zustand/vanilla";
import type { ExportPreview } from "../../core/export";
import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";

/**
 * The dialogs of the export (SPEC §10.2, DESIGN §9; the sprite editor's `app/export/dialogs.ts`):
 * the Export dialog, and before the first write into a folder that is not the project's,
 * Replace / Cancel. The export asks and waits for the answer; the dialog host shows the dialog
 * registered for the kind (ui/export/export.dialog.tsx).
 *
 * The Export dialog changes the project while it is open through the functions of its request,
 * which the export made: the export name through the undoable command of the Properties panel,
 * Export on save through the export settings' setter (no history entry; the project becomes
 * dirty, SPEC §3). The dialog changes nothing itself.
 */

/** Where the export goes, as the Export dialog shows it. */
export interface ExportDestination {
    /** "folder": File System Access, into `folder`; "download": a zip download. */
    mode: "folder" | "download";
    /** The name of the project's export folder, or null while none is chosen. */
    folder: string | null;
    /** True while the folder picker is open. */
    choosing: boolean;
}

/** The files the export of the project as it is now would write, as the Export dialog shows them. */
export type ExportPreviewState =
    /** Being made; `previous` is the preview of the project before its last change. */
    | { status: "making"; previous?: ExportPreview }
    | { status: "ready"; preview: ExportPreview }
    /** The message of the failure that keeps the project from being exported. */
    | { status: "failed"; error: string };

export interface ExportDialogRequest {
    kind: "export";
    /** The ID of the project whose export the dialog shows. */
    projectId: string;
    /** The destination, kept up to date while the dialog is open. */
    destination: StoreApi<ExportDestination>;
    /** The files of the export, made again whenever the project changes. */
    preview: StoreApi<ExportPreviewState>;
    /**
     * Sets the project's export name (an undoable command, as in the Properties panel). Returns
     * why it cannot be set (not a slug), or null when it was set or is unchanged.
     */
    setExportName(value: string): string | null;
    /** Sets Export on save: no history entry, the project becomes dirty (SPEC §3). */
    setExportOnSave(on: boolean): void;
    /** Asks for the project's export folder (the folder picker); with File System Access. */
    chooseFolder(): void;
    /** True to export now; null closes the dialog without exporting. */
    answer(values: true | null): void;
}

export interface ExportOverwriteRequest {
    kind: "export-overwrite";
    /** The name of the project being exported. */
    project: string;
    /** The folder's name. */
    folder: string;
    /**
     * The name of the project whose marker the folder holds, or null when it holds files of
     * the export's names without a marker (or with one that cannot be read).
     */
    owner: string | null;
    /** The files of the export that the folder holds already. */
    files: readonly string[];
    /** True to replace them; null to export nothing. */
    answer(values: true | null): void;
}

function isOverwriteRequest(request: DialogRequestBase): request is ExportOverwriteRequest {
    return request.kind === "export-overwrite";
}

function isExportDialogRequest(request: DialogRequestBase): request is ExportDialogRequest {
    return request.kind === "export";
}

export interface ExportDialogs {
    /** The open request when it is the overwrite question, otherwise null. */
    readonly store: DialogView<ExportOverwriteRequest>;
    /** The open request when it is the Export dialog, otherwise null. */
    readonly exportStore: DialogView<ExportDialogRequest>;
    /** Attaches a host; until one is, every request is answered with null at once. */
    attachHost(): () => void;
    /** Shows the Export dialog; resolves true when the user exports, null when not. */
    exportProject(options: Omit<ExportDialogRequest, "kind" | "answer">): Promise<true | null>;
    /** Asks whether to replace the files a folder holds; resolves true to go on. */
    confirmOverwrite(options: Omit<ExportOverwriteRequest, "kind" | "answer">): Promise<boolean>;
}

/** The export dialogs over `requests`: by default requests of their own, for a test to host. */
export function createExportDialogs(
    requests: DialogRequests = createDialogRequests(),
): ExportDialogs {
    return {
        store: dialogView(requests.store, isOverwriteRequest),
        exportStore: dialogView(requests.store, isExportDialogRequest),
        attachHost: () => requests.attachHost(),
        exportProject: (options) =>
            requests.open<true>((answer): ExportDialogRequest => ({
                kind: "export",
                ...options,
                answer,
            })),
        async confirmOverwrite(options) {
            const answer = await requests.open<true>((answer): ExportOverwriteRequest => ({
                kind: "export-overwrite",
                ...options,
                answer,
            }));
            return answer === true;
        },
    };
}

/** The export dialogs of the app, shown by the app's one dialog host. */
export const exportDialogs = createExportDialogs(commandDialogs);
