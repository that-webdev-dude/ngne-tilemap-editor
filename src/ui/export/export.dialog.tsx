import type { ExportDialogRequest, ExportOverwriteRequest } from "../../app/export/dialogs";
import { commandDialog } from "../dialogs/registry";
import { ExportDialog } from "./ExportDialog";
import { ExportOverwriteDialog } from "./ExportOverwriteDialog";

/** The Export dialog (TE-054) and the question of the export (TE-053), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<ExportDialogRequest>("export", "Export", ExportDialog),
    commandDialog<ExportOverwriteRequest>(
        "export-overwrite",
        "Replace files",
        ExportOverwriteDialog,
    ),
];
