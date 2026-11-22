import type { TilesetPropertiesRequest } from "../../app/tilesets/edit/tilesetProperties";
import { commandDialog } from "@ngne/editor-ui/messages";
import { TilesetPropertiesDialog } from "./TilesetPropertiesDialog";

/** The Tileset Properties dialog (TE-026), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<TilesetPropertiesRequest>(
        "tileset-properties",
        "Tileset Properties",
        TilesetPropertiesDialog,
    ),
];
