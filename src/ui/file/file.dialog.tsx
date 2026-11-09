import type {
    DiscardChangesRequest,
    NewProjectRequest,
    SaveChangesRequest,
} from "../../app/file/dialogs";
import { commandDialog } from "../dialogs/registry";
import { DiscardChangesDialog } from "./DiscardChangesDialog";
import { NewProjectDialog } from "./NewProjectDialog";
import { SaveChangesDialog } from "./SaveChangesDialog";

/** The questions and the New Project dialog of the file workflows (TE-047). */
export const commandDialogs = [
    commandDialog<DiscardChangesRequest>(
        "discard-changes",
        "Discard unsaved changes",
        DiscardChangesDialog,
    ),
    commandDialog<SaveChangesRequest>("save-changes", "Save changes", SaveChangesDialog),
    commandDialog<NewProjectRequest>("new-project", "New Project", NewProjectDialog),
];
