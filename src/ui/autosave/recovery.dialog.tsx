import type { RecoveryRequest } from "../../app/autosave/dialogs";
import { commandDialog } from "../dialogs/registry";
import { RecoveryDialog } from "./RecoveryDialog";

/** The recovery dialog shown on launch (TE-048), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<RecoveryRequest>("recovery", "Recovery", RecoveryDialog),
];
