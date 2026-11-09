import { commandDialogs, createDialogRequests, dialogView } from "../dialogs/dialogRequests";
import type { DialogRequestBase, DialogRequests, DialogView } from "../dialogs/dialogRequests";
import type { NewMapValues } from "../../core/maps";

/**
 * The questions and the dialog of the file workflows (SPEC §10.1; DESIGN §9: discarding an
 * unsaved project is confirmed once). A workflow asks and waits for the answer; the dialog host
 * shows the dialog registered for the kind (ui/file/file.dialog.tsx) and answers.
 *
 * - Revert asks Discard / Cancel (the sprite editor's question): saving first would only write
 *   what Revert then reads back.
 * - New Project, Open and Close Project ask Save / Discard / Cancel: one project per window, so
 *   the open one goes, and its changes can be saved first (Tiled's question before a document
 *   with changes is closed).
 */

/** What would take the unsaved changes away, in the Discard / Cancel question. */
export type DiscardAction = "close" | "open" | "revert";

export interface DiscardChangesRequest {
    kind: "discard-changes";
    /** Name of the project whose unsaved changes are lost. */
    document: string;
    action: DiscardAction;
    /** The file that takes the project's place ("open") or is read again ("revert"). */
    file: string | null;
    /** True to go on and lose the changes, null to keep the project. Closes the dialog. */
    answer(discard: true | null): void;
}

/** What would take the open project away, in the Save / Discard / Cancel question. */
export type ReplaceAction = "new" | "open" | "close";

/** The answer to the Save / Discard / Cancel question; null is Cancel. */
export type SaveChoice = "save" | "discard";

export interface SaveChangesRequest {
    kind: "save-changes";
    /** Name of the project with unsaved changes. */
    project: string;
    action: ReplaceAction;
    /** The file that takes the project's place ("open"). */
    file: string | null;
    /** "save" to save first, "discard" to lose the changes, null to keep the project. */
    answer(choice: SaveChoice | null): void;
}

/** The values of New Project (DESIGN §9): the project's name, then its first map's. */
export interface NewProjectValues {
    name: string;
    map: NewMapValues;
}

/** Problems of New Project's values: the project's name, and the first map's fields. */
export type NewProjectProblems = Partial<Record<"projectName" | keyof NewMapValues, string>>;

export interface NewProjectRequest {
    kind: "new-project";
    initial: NewProjectValues;
    /** Why `values` cannot make a project, by field; empty when they can. */
    problems(values: NewProjectValues): NewProjectProblems;
    /** The values of the new project, or null to cancel. Closes the dialog. */
    answer(values: NewProjectValues | null): void;
}

type FileDialogRequest = DiscardChangesRequest | SaveChangesRequest | NewProjectRequest;

export interface FileDialogs {
    /** The open request when it is a file dialog, otherwise null. */
    readonly store: DialogView<FileDialogRequest>;
    /** Attaches a host; until one is, every request is answered with null at once. */
    attachHost(): () => void;
    /** Asks whether to lose the unsaved changes; resolves true to go on. */
    confirmDiscard(
        options: Pick<DiscardChangesRequest, "document" | "action" | "file">,
    ): Promise<boolean>;
    /** Asks whether to save the unsaved changes first; resolves the choice, null to cancel. */
    confirmSave(
        options: Pick<SaveChangesRequest, "project" | "action" | "file">,
    ): Promise<SaveChoice | null>;
    /** Asks for the values of a new project; resolves null when cancelled. */
    newProject(
        options: Pick<NewProjectRequest, "initial" | "problems">,
    ): Promise<NewProjectValues | null>;
}

const KINDS: ReadonlySet<string> = new Set(["discard-changes", "save-changes", "new-project"]);

function isFileDialogRequest(request: DialogRequestBase): request is FileDialogRequest {
    return KINDS.has(request.kind);
}

/** The file dialogs over `requests`: by default requests of their own, for a test to host. */
export function createFileDialogs(requests: DialogRequests = createDialogRequests()): FileDialogs {
    return {
        store: dialogView(requests.store, isFileDialogRequest),
        attachHost: () => requests.attachHost(),
        async confirmDiscard(options) {
            const answer = await requests.open<true>((answer): DiscardChangesRequest => ({
                kind: "discard-changes",
                ...options,
                answer,
            }));
            return answer === true;
        },
        confirmSave: (options) =>
            requests.open<SaveChoice>((answer): SaveChangesRequest => ({
                kind: "save-changes",
                ...options,
                answer,
            })),
        newProject: (options) =>
            requests.open<NewProjectValues>((answer): NewProjectRequest => ({
                kind: "new-project",
                ...options,
                answer,
            })),
    };
}

/** The file dialogs of the app, shown by the app's one dialog host. */
export const fileDialogs = createFileDialogs(commandDialogs);
