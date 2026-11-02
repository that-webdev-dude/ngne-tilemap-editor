import { effectiveValues, findLayer } from "../../core/model";
import type { ProjectSession } from "../../core/model";
import { activeLayerId, activeMap } from "./toolSets";

// The target of a painting stroke (SPEC §4.1): the active layer of the active map, when it is
// a tile layer that is visible and unlocked, and so is every group above it. Otherwise the
// stroke is refused with the status-bar message below and nothing changes. Pure: no store.

/** The status-bar messages of a refused stroke. */
export const REFUSALS = {
    notTile: "Not a tile layer",
    hidden: "Layer is hidden",
    locked: "Layer is locked",
} as const;

export type PaintTarget = { mapId: string; layerId: number } | { refused: string };

/** Where a painting stroke on `session` writes, or why it cannot; null without an active map. */
export function resolvePaintTarget(session: ProjectSession): PaintTarget | null {
    const map = activeMap(session);
    if (!map) return null;
    const entry = findLayer(map, activeLayerId(session, map));
    if (entry?.layer.type !== "tile") return { refused: REFUSALS.notTile };
    const { visible, unlocked } = effectiveValues(entry.layer, entry.ancestors);
    if (!visible) return { refused: REFUSALS.hidden };
    if (!unlocked) return { refused: REFUSALS.locked };
    return { mapId: map.id, layerId: entry.layer.id };
}
