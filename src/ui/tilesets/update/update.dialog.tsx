import type { UpdateTilesetRequest } from "../../../app/tilesets/update/updateFromSource";
import { commandDialog } from "../../dialogs/registry";
import { UpdateDialog } from "./UpdateDialog";

/** The Update Tileset from Source dialog (TE-028), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<UpdateTilesetRequest>(
        "update-tileset",
        "Update Tileset from Source",
        UpdateDialog,
    ),
];
