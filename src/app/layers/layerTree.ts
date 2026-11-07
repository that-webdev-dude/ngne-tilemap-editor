import {
    LAYER_LABELS,
    layerValueProblems,
    placeOf,
    setLayerValuesCommand,
} from "../../core/layers";
import type { LayerValues } from "../../core/layers";
import { compositeCommand } from "../../core/history";
import type { Command } from "../../core/history";
import { findLayer } from "../../core/model";
import type { Layer, Project, ProjectMap } from "../../core/model";

// What the Layers dock section (DESIGN §8.2; TE-035) shows of a map's layer tree and where a
// drag drops, as pure functions of the map: the rows, top of the stack first, and the place a
// drop on a row gives the dragged layer. Also the command the layer properties popover makes
// when it closes.

/** One row of the Layers panel. */
export interface LayerRow {
    readonly id: number;
    readonly type: Layer["type"];
    readonly name: string;
    readonly visible: boolean;
    readonly locked: boolean;
    readonly opacity: number;
    /** Groups above the layer: the row is indented 12 px per level. */
    readonly depth: number;
    /** The group of the layer; null at the top of the map. */
    readonly parentId: number | null;
    /** A group with children (it has a disclosure triangle). */
    readonly hasChildren: boolean;
    /** A group whose children are shown. */
    readonly expanded: boolean;
    /** A group above the layer is hidden or locked: the row's text is muted. */
    readonly muted: boolean;
}

/**
 * The rows of `layers`, top of the stack first; a group's children follow its row, top first,
 * unless the group is in `collapsed`.
 */
export function layerRows(
    layers: readonly Layer[],
    collapsed: ReadonlySet<number>,
    depth = 0,
    parentId: number | null = null,
    muted = false,
): LayerRow[] {
    const rows: LayerRow[] = [];
    for (let index = layers.length - 1; index >= 0; index--) {
        const layer = layers[index]!;
        const group = layer.type === "group";
        const hasChildren = group && layer.layers.length > 0;
        const expanded = hasChildren && !collapsed.has(layer.id);
        rows.push({
            id: layer.id,
            type: layer.type,
            name: layer.name,
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity,
            depth,
            parentId,
            hasChildren,
            expanded,
            muted,
        });
        if (group && expanded) {
            const hides = muted || !layer.visible || layer.locked;
            rows.push(...layerRows(layer.layers, collapsed, depth + 1, layer.id, hides));
        }
    }
    return rows;
}

/** Where on a row a drag is dropped: its upper part, its middle third (groups) or lower part. */
export type DropZone = "above" | "into" | "below";

/**
 * The zone of a row `height` CSS pixels high that a pointer `y` pixels below its top is in: a
 * group row is cut in thirds, the middle one dropping into the group (DESIGN §8.2); another row
 * in halves.
 */
export function dropZone(y: number, height: number, group: boolean): DropZone {
    if (!group) return y < height / 2 ? "above" : "below";
    if (y < height / 3) return "above";
    return y < (height * 2) / 3 ? "into" : "below";
}

/** The place a drop gives a layer: group (null: the map) and index, as `moveLayerToCommand`. */
export interface DropPlace {
    readonly parentId: number | null;
    /** In the group's list, bottom first, counted with the dragged layer taken out. */
    readonly index: number;
}

/**
 * The place layer `id` takes when it is dropped in `zone` of the row of layer `targetId`, or
 * null when the drop moves nothing or is not possible (onto itself, or into a group inside it).
 *
 * - Above a row: right above its layer, in its group.
 * - Below a row: right below its layer, in its group; below the row of an expanded group with
 *   children, at the top of the group, the row shown right below it.
 * - Into a group (the middle third of its row): at the bottom of its children, as Tiled's
 *   `LayerModel::dropMimeData` reparents a layer dropped on a group at index 0 (v1.12.2).
 *
 * `expanded` says whether the target group's children are shown.
 */
export function dropPlace(
    map: ProjectMap,
    id: number,
    targetId: number,
    zone: DropZone,
    expanded: boolean,
): DropPlace | null {
    const dragged = findLayer(map, id);
    const target = findLayer(map, targetId);
    if (!dragged || !target || id === targetId) return null;
    // A group cannot go into itself or a group inside it.
    if (target.ancestors.some((group) => group.id === id)) return null;
    const into = (group: Layer, index: number): DropPlace | null =>
        group.type === "group" ? place(group.id, group.layers, index) : null;
    const place = (parentId: number | null, list: readonly Layer[], raw: number) => {
        const from = list.indexOf(dragged.layer);
        const index = from >= 0 && from < raw ? raw - 1 : raw;
        return from === index ? null : { parentId, index };
    };
    const where = placeOf(map, targetId);
    const parentId = where.parent?.id ?? null;
    switch (zone) {
        case "into":
            return into(target.layer, 0);
        case "above":
            return place(parentId, where.list, where.index + 1);
        case "below":
            if (target.layer.type === "group" && target.layer.layers.length > 0 && expanded) {
                return into(target.layer, target.layer.layers.length);
            }
            return place(parentId, where.list, where.index);
    }
}

/** The fields of the layer properties popover that every layer has (DESIGN §8.2). */
export type LayerPropertiesValues = Pick<
    LayerValues,
    "name" | "class" | "opacity" | "offsetX" | "offsetY" | "parallaxX" | "parallaxY"
>;

export const LAYER_PROPERTIES_KEYS = [
    "name",
    "class",
    "opacity",
    "offsetX",
    "offsetY",
    "parallaxX",
    "parallaxY",
] as const satisfies readonly (keyof LayerPropertiesValues)[];

/** The popover's fields of `layer` as they are now. */
export function layerPropertiesValues(layer: Layer): LayerPropertiesValues {
    return Object.fromEntries(
        LAYER_PROPERTIES_KEYS.map((key) => [key, layer[key]]),
    ) as unknown as LayerPropertiesValues;
}

/**
 * The fields of `values` that differ from `layer`'s and can be set on it; a field that cannot
 * (a name past 255 characters, a number out of range) keeps the layer's value.
 */
export function changedLayerValues(
    layer: Layer,
    values: LayerPropertiesValues,
): Partial<LayerPropertiesValues> {
    const changed: Partial<Record<keyof LayerPropertiesValues, unknown>> = {};
    for (const key of LAYER_PROPERTIES_KEYS) {
        if (values[key] !== layer[key]) changed[key] = values[key];
    }
    const problems = layerValueProblems(changed as Partial<LayerValues>);
    for (const key of Object.keys(problems)) delete changed[key as keyof LayerPropertiesValues];
    return changed as Partial<LayerPropertiesValues>;
}

/**
 * The one history entry the layer properties popover makes when it closes: the changed fields
 * of every layer (`changedLayerValues`) and the commands of the kind-specific fields that
 * changed (`extra`). One part keeps its own label ("Rename Layer", "Layer Opacity"); several
 * are "Layer Properties". Null when nothing changed.
 */
export function layerPropertiesCommand(
    project: Project,
    mapId: string,
    layerId: number,
    values: LayerPropertiesValues,
    extra: readonly Command[] = [],
): Command | null {
    const map = project.maps.find((each) => each.id === mapId);
    const layer = map ? findLayer(map, layerId)?.layer : undefined;
    if (!layer) return null;
    const changed = changedLayerValues(layer, values);
    const parts = [
        ...(Object.keys(changed).length > 0
            ? [setLayerValuesCommand(project, mapId, [layerId], changed)]
            : []),
        ...extra,
    ];
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0]!;
    return compositeCommand(LAYER_LABELS.values, parts);
}
