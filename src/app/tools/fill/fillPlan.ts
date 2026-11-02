import type { Stamp } from "../../../core/cells";
import { forEachTileFillCell, regionBounds } from "../../../core/fill";
import type { Region } from "../../../core/fill";
import type { Region as CellMask } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster/line";
import { intersectMask, maskSpans, spansMask } from "../../../core/selection";
import type { PaintStroke, ToolOptionSpec } from "../types";

// What the bucket and the shape fill paint (SPEC §4.3): the current stamp tiled over a region
// from a fixed cell (Tiled's `TileFill`), and the context bar setting both share. The overlay
// preview (`fillPreview.overlay.ts`) draws the same plan the tool paints.

/**
 * The Fill mode of the context bar (DESIGN §7, SPEC §4.3): Tile paints the stamp. TE-045 adds
 * Terrain.
 */
export const FILL_MODE_OPTION: ToolOptionSpec = {
    kind: "choice",
    key: "fillMode",
    label: "Fill",
    choices: [{ value: "tile", label: "Tile" }],
    default: "tile",
};

/** A fill: the cells it writes and where the stamp is tiled from. */
export interface FillPlan {
    /** The cells the fill writes, inside the map. */
    readonly region: Region;
    /** The cell the stamp's top-left cell is tiled from: the whole shape's top-left. */
    readonly origin: PixelPoint;
    readonly stamp: Stamp;
}

/** The plan of `stamp` over `region`, tiled from its bounding box's top-left; null when empty. */
export function regionPlan(region: Region, stamp: Stamp): FillPlan | null {
    const bounds = regionBounds(region);
    return bounds ? { region, origin: { x: bounds.x, y: bounds.y }, stamp } : null;
}

/** Writes `plan` into the stroke: empty stamp cells leave the map as it is. */
export function paintPlan(paint: PaintStroke, plan: FillPlan): void {
    forEachTileFillCell(plan.stamp, plan.region, plan.origin, (x, y, value) =>
        paint.set(x, y, value),
    );
}

/**
 * The part of `plan` inside the tile selection `selection`, the stamp still tiled from the
 * plan's origin: what a stroke clipped to the selection writes (SPEC §4.1). Null when none of
 * it is selected.
 */
export function selectedPlan(plan: FillPlan, selection: CellMask): FillPlan | null {
    const region = maskSpans(intersectMask(spansMask(plan.region), selection));
    return region.length > 0 ? { ...plan, region } : null;
}
