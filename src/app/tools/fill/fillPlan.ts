import type { Stamp } from "../../../core/cells";
import { forEachTileFillCell, regionBounds } from "../../../core/fill";
import type { Region } from "../../../core/fill";
import type { Region as CellMask } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster/line";
import { intersectMask, maskSpans, spansMask } from "../../../core/selection";
import type { TerrainCell } from "../../../core/terrain";
import type { PaintStroke, ToolOptionSpec, ToolOptionValue } from "../types";

// What the bucket and the shape fill paint (SPEC §4.3): the current stamp tiled over a region
// from a fixed cell (Tiled's `TileFill`), and the context bar setting both share. The overlay
// preview (`fillPreview.overlay.ts`) draws the same plan the tool paints.

/**
 * The Fill mode of the context bar (DESIGN §7, SPEC §4.3): Tile paints the stamp, Terrain the
 * tiles of the brush's terrain set (SPEC §5.4, `terrainFill.ts`).
 */
export const FILL_MODE_OPTION: ToolOptionSpec = {
    kind: "choice",
    key: "fillMode",
    label: "Fill",
    choices: [
        { value: "tile", label: "Tile" },
        { value: "terrain", label: "Terrain" },
    ],
    default: "tile",
};

export type FillMode = "tile" | "terrain";

/** The fill mode a tool's option values hold. */
export function fillModeOf(options: Readonly<Record<string, ToolOptionValue>>): FillMode {
    return options.fillMode === "terrain" ? "terrain" : "tile";
}

/** A fill: the cells it writes and where the stamp is tiled from. */
export interface FillPlan {
    /** The cells the fill writes, inside the map. */
    readonly region: Region;
    /** The cell the stamp's top-left cell is tiled from: the whole shape's top-left. */
    readonly origin: PixelPoint;
    /** What is drawn: the current stamp, or a terrain fill's cells over its bounding box. */
    readonly stamp: Stamp;
    /**
     * A terrain fill (SPEC §5.4): the cells the filler resolved, each written as it is (an
     * empty one too); absent for a stamp fill.
     */
    readonly terrain?: readonly TerrainCell[];
}

/** The plan of `stamp` over `region`, tiled from its bounding box's top-left; null when empty. */
export function regionPlan(region: Region, stamp: Stamp): FillPlan | null {
    const bounds = regionBounds(region);
    return bounds ? { region, origin: { x: bounds.x, y: bounds.y }, stamp } : null;
}

/**
 * Writes `plan` into the stroke: empty stamp cells leave the map as it is; a terrain fill
 * writes the cells it resolved.
 */
export function paintPlan(paint: PaintStroke, plan: FillPlan): void {
    if (plan.terrain) {
        for (const { x, y, value } of plan.terrain) paint.set(x, y, value);
        return;
    }
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
