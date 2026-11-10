import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";

/**
 * The questions of the export (SPEC §10.2; the sprite editor's `app/export/dialogs.ts`): before
 * the first write into a folder that is not the project's, Replace / Cancel. The export asks
 * and waits for the answer; the dialog host shows the dialog registered for the kind
 * (ui/export/export.dialog.tsx).
 */

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

type ExportDialogRequest = ExportOverwriteRequest;

const KINDS: ReadonlySet<string> = new Set<ExportDialogRequest["kind"]>(["export-overwrite"]);

function isExportDialogRequest(request: DialogRequestBase): request is ExportDialogRequest {
    return KINDS.has(request.kind);
}

export interface ExportDialogs {
    /** The open request when it is one of these dialogs, otherwise null. */
    readonly store: DialogView<ExportDialogRequest>;
    /** Attaches a host; until one is, every request is answered with null at once. */
    attachHost(): () => void;
    /** Asks whether to replace the files a folder holds; resolves true to go on. */
    confirmOverwrite(options: Omit<ExportOverwriteRequest, "kind" | "answer">): Promise<boolean>;
}

/** The export dialogs over `requests`: by default requests of their own, for a test to host. */
export function createExportDialogs(
    requests: DialogRequests = createDialogRequests(),
): ExportDialogs {
    return {
        store: dialogView(requests.store, isExportDialogRequest),
        attachHost: () => requests.attachHost(),
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
