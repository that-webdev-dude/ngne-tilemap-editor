import { createMapSession, findLayer } from "../../core/model";
import type { Layer, ProjectMap, ProjectSession } from "../../core/model";
import { plannedTools } from "./planned.tools";
import { railGroups, slotOf } from "./registry";
import type { ToolRegistry } from "./registry";
import type { RailSlot, Tool, ToolLayerKind } from "./types";

// The tool sets of the rail (DESIGN §6): the rail shows the set of the active layer's kind, as
// Tiled enables tools per layer type, and the navigate group in every set. Pure: no store.

/** The kinds of the planned slots, by slot id. */
const plannedLayers = new Map(plannedTools.map((spec) => [spec.id, spec.layers]));

/** The active map of a session, or null when it has none. */
export function activeMap(session: ProjectSession): ProjectMap | null {
    return session.project.maps.find((map) => map.id === session.activeMapId) ?? null;
}

/** The id of the active layer of `map` (its first layer while it has no session yet). */
export function activeLayerId(session: ProjectSession, map: ProjectMap): number {
    return (session.perMap.get(map.id) ?? createMapSession(map)).activeLayerId;
}

/** The active layer of the active map, or null when there is none. */
export function activeLayer(session: ProjectSession): Layer | null {
    const map = activeMap(session);
    return map ? (findLayer(map, activeLayerId(session, map))?.layer ?? null) : null;
}

/** The kind of tool set the active layer has (DESIGN §6). */
export function activeLayerKind(session: ProjectSession): ToolLayerKind {
    const type = activeLayer(session)?.type;
    return type === "tile" || type === "marker" ? type : "none";
}

/** The kinds whose tool set holds `tool`: its own, else its rail slot's planned ones. */
function toolLayers(tool: Tool): readonly ToolLayerKind[] | undefined {
    return tool.layers ?? plannedLayers.get(slotOf(tool));
}

/** Whether the tool set of `kind` holds `tool`. */
export function offersTool(tool: Tool, kind: ToolLayerKind): boolean {
    return toolLayers(tool)?.includes(kind) ?? true;
}

/** Whether the tool set of `kind` holds the rail slot `slot`. */
export function offersSlot(slot: RailSlot, kind: ToolLayerKind): boolean {
    const tool = slot.tool ?? slot.variants[0];
    const layers = tool ? toolLayers(tool) : plannedLayers.get(slot.id);
    return layers?.includes(kind) ?? true;
}

/** The rail's slots of the tool set of `kind`, in the rail's groups (DESIGN §6). */
export function railToolSet(registry: ToolRegistry, kind: ToolLayerKind): RailSlot[][] {
    return railGroups(registry.railSlots().filter((slot) => offersSlot(slot, kind)));
}
