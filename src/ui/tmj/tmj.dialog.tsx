import type { ImportTiledMapRequest } from "../../app/tmj/importTiledMap";
import { commandDialog } from "@ngne/editor-ui/messages";
import { ImportTiledMapDialog } from "./ImportTiledMapDialog";

/** The Import Tiled Map dialog (TE-061), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<ImportTiledMapRequest>(
        "import-tiled-map",
        "Import Tiled Map",
        ImportTiledMapDialog,
    ),
];
