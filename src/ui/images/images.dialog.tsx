import type { NewImageLayerRequest } from "../../app/images/imageLayers";
import { commandDialog } from "../dialogs/registry";
import { NewImageLayerDialog } from "./NewImageLayerDialog";

/** New Image Layer (TE-036). */
export const commandDialogs = [
    commandDialog<NewImageLayerRequest>("new-image-layer", "New Image Layer", NewImageLayerDialog),
];
