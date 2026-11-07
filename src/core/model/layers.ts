import type { GroupLayer, Layer, ProjectMap } from "./types";

// Walking a map's layer tree and the effective values of a layer under its groups
// (FORMAT §2.5): visible and unlocked only if every ancestor is; opacity and parallax
// multiply; offsets add, as in Tiled.

/** A layer with the groups above it, outermost first. */
export interface LayerEntry {
    layer: Layer;
    ancestors: GroupLayer[];
}

/** Every layer of the tree, depth first, bottom to top, each with its ancestors. */
export function* walkLayers(
    layers: readonly Layer[],
    ancestors: GroupLayer[] = [],
): Generator<LayerEntry> {
    for (const layer of layers) {
        yield { layer, ancestors };
        if (layer.type === "group") yield* walkLayers(layer.layers, [...ancestors, layer]);
    }
}

/** The layer with `id` anywhere in the map's tree, with its ancestors; undefined when none. */
export function findLayer(map: ProjectMap, id: number): LayerEntry | undefined {
    for (const entry of walkLayers(map.layers)) {
        if (entry.layer.id === id) return entry;
    }
    return undefined;
}

/** What a layer's groups make of its own values. */
export interface EffectiveLayerValues {
    /** The layer and every ancestor are visible. */
    visible: boolean;
    /** The layer and every ancestor are unlocked. */
    unlocked: boolean;
    /** 0..255, the product of the opacities as fractions of 255; not rounded. */
    opacity: number;
    offsetX: number;
    offsetY: number;
    parallaxX: number;
    parallaxY: number;
}

/** The effective values of `layer` under `ancestors`, outermost first. */
export function effectiveValues(
    layer: Layer,
    ancestors: readonly GroupLayer[],
): EffectiveLayerValues {
    const chain = [...ancestors, layer];
    let visible = true;
    let unlocked = true;
    let opacity = 1;
    let offsetX = 0;
    let offsetY = 0;
    let parallaxX = 1;
    let parallaxY = 1;
    for (const node of chain) {
        visible &&= node.visible;
        unlocked &&= !node.locked;
        opacity *= node.opacity / 255;
        offsetX += node.offsetX;
        offsetY += node.offsetY;
        parallaxX *= node.parallaxX;
        parallaxY *= node.parallaxY;
    }
    return { visible, unlocked, opacity: opacity * 255, offsetX, offsetY, parallaxX, parallaxY };
}

/**
 * Highlight Current Layer (SPEC §7.2): every layer outside the current layer and its children is
 * drawn at `factor` of its opacity.
 */
export interface LayerHighlight {
    /** The current layer; a group highlights its children with it. */
    readonly layerId: number;
    /** 0..1. */
    readonly factor: number;
}

/**
 * The opacity a layer is drawn with, 0..255 rounded: its effective opacity, times the highlight's
 * factor when a highlight is given and the layer is neither the current one nor inside it.
 */
export function drawnOpacity(
    layer: Layer,
    ancestors: readonly GroupLayer[],
    values: EffectiveLayerValues,
    highlight?: LayerHighlight | null,
): number {
    let opacity = values.opacity;
    if (
        highlight &&
        layer.id !== highlight.layerId &&
        !ancestors.some((group) => group.id === highlight.layerId)
    ) {
        opacity *= highlight.factor;
    }
    return Math.max(0, Math.min(255, Math.round(opacity)));
}

/** The effective values of the layer with `id` in the map; undefined when none. */
export function effectiveLayerValues(
    map: ProjectMap,
    id: number,
): EffectiveLayerValues | undefined {
    const entry = findLayer(map, id);
    return entry && effectiveValues(entry.layer, entry.ancestors);
}
