import type { ExportOverwriteRequest } from "../../app/export/dialogs";
import { commandDialog } from "../dialogs/registry";
import { ExportOverwriteDialog } from "./ExportOverwriteDialog";

/** The question of the export (TE-053), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<ExportOverwriteRequest>(
        "export-overwrite",
        "Replace files",
        ExportOverwriteDialog,
    ),
];
