import { createMapSession, walkLayers } from "../../core/model";
import type { ProjectMap, ProjectSession } from "../../core/model";
import type { TilemapLayer } from "../../core/runtime/runtime";
import type { PreviewResolution, PreviewScale } from "./previewState";

// What the Preview section shows of the map besides its content (SPEC §12, DESIGN §8.4): the
// canvas size on the page, the camera that follows the viewport, the background, and the layer
// filter.

export interface PreviewDisplay {
    /** Device pixels per game pixel: a whole number, or 1/n when "fit" finds no whole one. */
    scale: number;
    /** CSS size of the canvas: `scale × resolution / ratio`. */
    width: number;
    height: number;
}

/**
 * The display of a game of `resolution` in a stage of `stage` device pixels at the device
 * pixel ratio `ratio`. A chosen scale is used as it is. "fit" takes the largest whole scale at
 * which the game fits, as the sprite editor's preview does (DESIGN §3.4); a game larger than
 * the stage at 1 is shown at 1/n, the largest such scale that fits; a stage not laid out yet
 * shows 1:1.
 */
export function previewDisplay(
    resolution: { width: number; height: number },
    stage: { width: number; height: number },
    ratio: number,
    choice: PreviewScale,
): PreviewDisplay {
    let scale: number;
    if (choice !== "fit") {
        scale = Number(choice);
    } else {
        const fit = Math.min(stage.width / resolution.width, stage.height / resolution.height);
        if (!(fit > 0)) scale = 1;
        else if (fit >= 1) scale = Math.floor(fit);
        else scale = 1 / Math.ceil(1 / fit);
    }
    return {
        scale,
        width: (scale * resolution.width) / ratio,
        height: (scale * resolution.height) / ratio,
    };
}

/**
 * The top-left corner of a view of `resolution` centred on the viewport's centre of `map`
 * (SPEC §12), on whole map pixels.
 */
export function previewCamera(
    session: ProjectSession,
    map: ProjectMap,
    resolution: PreviewResolution,
): { x: number; y: number } {
    const view = session.perMap.get(map.id)?.view ?? createMapSession(map).view;
    return {
        x: Math.round(view.centreX - resolution.width / 2),
        y: Math.round(view.centreY - resolution.height / 2),
    };
}

/** Behind a map without a background colour, as the sprite editor's preview (DESIGN §3.4). */
export const PREVIEW_BACKGROUND = 0x202020;

/**
 * The colour the preview clears to, 0xRRGGBB: the map's background colour (0xRRGGBBAA) over
 * `PREVIEW_BACKGROUND`, or that colour alone.
 */
export function previewBackground(map: ProjectMap): number {
    const colour = map.backgroundColor;
    if (colour === null) return PREVIEW_BACKGROUND;
    const alpha = (colour & 255) / 255;
    let out = 0;
    for (const shift of [24, 16, 8]) {
        const over = (colour >>> shift) & 255;
        const under = (PREVIEW_BACKGROUND >>> (shift - 8)) & 255;
        out = (out << 8) | Math.round(over * alpha + under * (1 - alpha));
    }
    return out;
}

/**
 * The index in the map's tilemap layers (its tile, marker and image layers bottom to top,
 * FORMAT §3.4) of the highest layer at or under layer `layerId`: the layer itself, the top
 * layer inside a group, or the layer under an empty group. −1 when there is none.
 */
export function layerCutoff(map: ProjectMap, layerId: number): number {
    let index = -1;
    let cutoff = -1;
    for (const { layer, ancestors } of walkLayers(map.layers)) {
        if (layer.type === "group") {
            if (layer.id === layerId) cutoff = index;
            continue;
        }
        index += 1;
        if (layer.id === layerId) return index;
        if (ancestors.some((group) => group.id === layerId)) cutoff = index;
    }
    return cutoff;
}

/**
 * The layer filter "this layer and below" (SPEC §12): the visible layers at or under the
 * active layer of `map`. Null for "all visible" (`drawTilemap`'s own choice).
 */
export function layerFilter(
    session: ProjectSession,
    map: ProjectMap,
    below: boolean,
): ((layer: TilemapLayer, index: number) => boolean) | null {
    if (!below) return null;
    const active = (session.perMap.get(map.id) ?? createMapSession(map)).activeLayerId;
    const cutoff = layerCutoff(map, active);
    return (layer, index) => layer.visible && index <= cutoff;
}
