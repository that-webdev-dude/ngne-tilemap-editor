import { walkLayers } from "../model";
import type { ProjectMap } from "../model";

// The performance envelope of BRIEF D1, per map: what the budgets of ENGINE §6 were measured
// for. A map beyond it opens and edits, but is not budgeted; the app warns once per map
// (SPEC §7.2). Its other bounds (side ≤ 4096, tile size 1–256) are hard limits of the format
// already, and the tileset pixels are the project's, not a map's.

export const ENVELOPE = {
    /** Cells of a tile layer: the map's width × height. */
    cellsPerLayer: 65_536,
    /** Layers of the map, groups included. */
    layers: 16,
    markers: 2_000,
} as const;

export type EnvelopeProblem = "cells" | "layers" | "markers";

/** The bounds of the D1 envelope `map` exceeds; empty when it is inside. */
export function envelopeProblems(map: ProjectMap): EnvelopeProblem[] {
    const problems: EnvelopeProblem[] = [];
    if (map.width * map.height > ENVELOPE.cellsPerLayer) problems.push("cells");
    let layers = 0;
    let markers = 0;
    for (const { layer } of walkLayers(map.layers)) {
        layers += 1;
        if (layer.type === "marker") markers += layer.markers.length;
    }
    if (layers > ENVELOPE.layers) problems.push("layers");
    if (markers > ENVELOPE.markers) problems.push("markers");
    return problems;
}
