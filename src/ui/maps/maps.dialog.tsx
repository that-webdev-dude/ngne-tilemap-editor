import type {
    MapPropertiesRequest,
    NewMapRequest,
    ResizeMapRequest,
} from "../../app/maps/mapDialogs";
import { commandDialog } from "../dialogs/registry";
import { MapPropertiesDialog } from "./MapPropertiesDialog";
import { NewMapDialog } from "./NewMapDialog";
import { ResizeMapDialog } from "./ResizeMapDialog";

/** The New Map and Map Properties dialogs (TE-032) and Resize / Offset Map (TE-033). */
export const commandDialogs = [
    commandDialog<NewMapRequest>("new-map", "New Map", NewMapDialog),
    commandDialog<MapPropertiesRequest>("map-properties", "Map Properties", MapPropertiesDialog),
    commandDialog<ResizeMapRequest>("resize-map", "Resize / Offset Map", ResizeMapDialog),
];
