import type { ImportTilesetRequest } from "../../app/tilesets/import/importDialog";
import { commandDialog } from "../dialogs/registry";
import { ImportDialog } from "./ImportDialog";

/** The Import Tileset dialog (TE-024), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<ImportTilesetRequest>("import-tileset", "Import Tileset", ImportDialog),
];
