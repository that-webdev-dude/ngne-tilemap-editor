import type { Command } from "../../core/history";
import { markerLayerColorCommand } from "../../core/markers";
import type { Project } from "../../core/model";

// Marker layers in the app (SPEC §8; TE-037). The layer popover's colour field builds its command
// here (ui/layers/layerFields.ts: a field calls an app function, never builds a command).

/** The command of the popover's colour field: marker layer `layerId` draws in `color`. */
export function markerColourFieldCommand(
    project: Project,
    mapId: string,
    layerId: number,
    color: number,
): Command {
    return markerLayerColorCommand(project, mapId, layerId, color);
}
