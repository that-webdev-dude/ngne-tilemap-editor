import type { MapPropertiesRequest, NewMapRequest } from "../../app/maps/mapDialogs";
import { commandDialog } from "../dialogs/registry";
import { MapPropertiesDialog } from "./MapPropertiesDialog";
import { NewMapDialog } from "./NewMapDialog";

/** The New Map and Map Properties dialogs (TE-032), shown by the dialog host. */
export const commandDialogs = [
    commandDialog<NewMapRequest>("new-map", "New Map", NewMapDialog),
    commandDialog<MapPropertiesRequest>("map-properties", "Map Properties", MapPropertiesDialog),
];
