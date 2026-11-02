import type { Stamp } from "../../../core/cells";
import { floodRegion, rectRegion, regionContains } from "../../../core/fill";
import type { Region } from "../../../core/fill";
import { findLayer } from "../../../core/model";
import type { ProjectMap, ProjectSession } from "../../../core/model";
import type { PixelPoint } from "../../../core/raster/line";
import { sessionStore } from "../../state/session";
import { withCapture } from "../stamp/capture";
import { currentStamp } from "../stamp/currentStamp";
import { stampIsEmpty } from "../stamp/placement";
import { STAMP_TRANSFORM_ACTIONS } from "../stamp/stamp.tools";
import type { ToolSpec } from "../types";
import { FILL_MODE_OPTION, paintPlan, regionPlan } from "./fillPlan";
import type { FillPlan } from "./fillPlan";

// The bucket fill (SPEC §4.3), Tiled's `BucketFillTool` (`src/tiled/bucketfilltool.cpp`,
// checked at v1.12.2) in its Tile fill mode. Its rail slot, key (G) and icon are planned in
// `planned.tools.ts`; the overlay preview is `fillPreview.overlay.ts`.
//
//   hover: the region the press would fill, previewed
//   press: fills the 4-connected region of cells equal to the pressed one (tile and flags), in
//     the map, with the stamp tiled from the region's bounding box top-left (`TileFill`)
//   Shift, or the context bar's Whole selection: the whole layer (the selection, TE-020)
//
// The fill is made at the press (SPEC §14 times it press → frame) and is one history entry
// when the stroke ends; a right click before the release cancels it. A 1 × 1 stamp equal to
// the pressed cell fills nothing, as Tiled's (`computeRegion = false`). A right drag captures
// a stamp (`capture.ts`).

/** The region last computed, kept while the layer and the inputs are the same. */
interface Known {
    readonly session: ProjectSession;
    readonly revision: number;
    readonly mapId: string;
    readonly layerId: number;
    readonly whole: boolean;
    readonly stamp: Stamp;
    readonly region: Region;
}

let known: Known | null = null;
const listeners = new Set<() => void>();
const changed = () => {
    for (const listener of [...listeners]) listener();
};

/** Calls `listener` when a press of the bucket began or ended: its preview hides meanwhile. */
export function subscribeBucket(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * The cells a press on `cell` fills: the flood region of the cell in the active tile layer, or
 * with `whole` the layer's every cell; empty off the map, without a tile layer, or when a 1 × 1
 * stamp equals the cell. Kept between calls while the session's revision, the layer, `whole`
 * and the stamp stay and `cell` lies in it (Tiled's own shortcut: any cell of a flood region
 * floods to the same region).
 */
export function bucketRegion(
    session: ProjectSession,
    revision: number,
    map: ProjectMap,
    layerId: number,
    cell: PixelPoint,
    whole: boolean,
    stamp: Stamp,
): Region {
    const last = known;
    if (
        last &&
        last.session === session &&
        last.revision === revision &&
        last.mapId === map.id &&
        last.layerId === layerId &&
        last.whole === whole &&
        last.stamp === stamp &&
        regionContains(last.region, cell.x, cell.y)
    ) {
        return last.region;
    }
    const layer = findLayer(map, layerId)?.layer;
    const inside = cell.x >= 0 && cell.y >= 0 && cell.x < map.width && cell.y < map.height;
    let region: Region = [];
    if (layer?.type === "tile" && inside) {
        const bounds = { x: 0, y: 0, width: map.width, height: map.height };
        const value = layer.cells.get(cell.x, cell.y);
        if (whole) region = rectRegion(bounds);
        else if (stamp.width !== 1 || stamp.height !== 1 || stamp.cells[0] !== value) {
            region = floodRegion((x, y) => layer.cells.get(x, y), cell, bounds);
        }
    }
    known = { session, revision, mapId: map.id, layerId, whole, stamp, region };
    return region;
}

/**
 * Forgets the region kept between calls, so the next press finds its region itself: SPEC §14
 * times the bucket with the region found after the press.
 */
export function forgetBucketRegion(): void {
    known = null;
}

/**
 * The fill a press on `cell` of the active layer of `map` makes now with the current stamp;
 * null when it fills nothing.
 */
export function bucketPlan(
    map: ProjectMap,
    layerId: number,
    cell: PixelPoint,
    whole: boolean,
): FillPlan | null {
    const stamp = currentStamp();
    if (!stamp || stampIsEmpty(stamp)) return null;
    const { session, revision } = sessionStore.getState();
    return regionPlan(bucketRegion(session, revision, map, layerId, cell, whole, stamp), stamp);
}

export const bucketTool: ToolSpec = withCapture({
    id: "bucket",
    label: "Bucket Fill",
    paints: true,
    hint: "Shift: fill the whole layer",
    options: [
        FILL_MODE_OPTION,
        { kind: "toggle", key: "wholeSelection", label: "Whole selection", default: false },
    ],
    actions: STAMP_TRANSFORM_ACTIONS,
    onDown(context, pointer) {
        const { paint } = context;
        if (!paint || pointer.button !== "primary") return;
        const stamp = currentStamp();
        if (!stamp || stampIsEmpty(stamp)) {
            context.feedback("No stamp");
            return;
        }
        const whole = pointer.modifiers.shift || context.options.wholeSelection === true;
        const plan = bucketPlan(paint.map, paint.layerId, pointer.cell, whole);
        if (plan) paintPlan(paint, plan);
        changed();
    },
    onCommit: changed,
    onCancel: changed,
});

export const tools: ToolSpec[] = [bucketTool];
