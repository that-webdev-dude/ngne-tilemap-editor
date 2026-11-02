import type { StatusField, StatusFieldInput } from "./statusFields";

// The selection size field of the status bar (DESIGN §8.7, TE-020): the bounding box of the
// active map's tile selection as `w × h`; empty without one. The marker count of a marker
// selection joins it with the marker tickets.

export function selectionSize({ session, map }: StatusFieldInput): string {
    const selection = map ? session.perMap.get(map.id)?.tileSelection : null;
    return selection ? `${selection.width} × ${selection.height}` : "";
}

export const statusFields: StatusField[] = [{ id: "selection", order: 500, text: selectionSize }];
