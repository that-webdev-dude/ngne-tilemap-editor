import { effectiveValues, findLayer, walkLayers } from "../../core/model";
import type { ProjectMap, ProjectSession } from "../../core/model";
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

/**
 * The tile layers of `map` a stroke may write (SPEC §4.1, §4.3: the eraser's all layers):
 * visible and unlocked, under no hidden or locked group, bottom to top.
 */
export function paintableTileLayers(map: ProjectMap): number[] {
    const ids: number[] = [];
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type !== "tile") continue;
        const { visible, unlocked } = effectiveValues(layer, ancestors);
        if (visible && unlocked) ids.push(layer.id);
    }
    return ids;
}
