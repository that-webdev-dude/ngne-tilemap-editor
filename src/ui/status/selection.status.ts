import { markersSelected, selectedMarkerIds } from "../../app/markers/markerSelection";
import type { StatusField, StatusFieldInput } from "./statusFields";

// The selection field of the status bar (DESIGN §8.7): the bounding box of the active map's tile
// selection as `w × h` (TE-020); while a marker layer is active and markers are selected, their
// count instead, "1 marker" or "n markers" (TE-039). Empty without either.

export function selectionSize({ session, map }: StatusFieldInput): string {
    if (map && markersSelected(session)) {
        const count = selectedMarkerIds(session, map).length;
        return count === 1 ? "1 marker" : `${count} markers`;
    }
    const selection = map ? session.perMap.get(map.id)?.tileSelection : null;
    return selection ? `${selection.width} × ${selection.height}` : "";
}

export const statusFields: StatusField[] = [{ id: "selection", order: 500, text: selectionSize }];
