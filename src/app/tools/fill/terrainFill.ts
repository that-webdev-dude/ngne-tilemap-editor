import { regionBounds } from "../../../core/fill";
import type { Region } from "../../../core/fill";
import { findLayer } from "../../../core/model";
import type { ProjectMap, ProjectSession } from "../../../core/model";
import { TerrainFiller, clockSeed, xorshift32 } from "../../../core/terrain";
import type { TerrainAnalysis, TerrainCell } from "../../../core/terrain";
import type { FillPlan } from "./fillPlan";

// The Terrain fill mode of the bucket and the shape fill (SPEC §5.4): Tiled's `wangFill`
// (`abstracttilefilltool.cpp`, tag v1.12.2). The filler is given the region only (`setRegion`,
// no index painted, so the terrain selected for the brush is not used) with corrections off:
// it seeds the region's border from the cells outside it and resolves the region's cells.
// Cells it cannot resolve are left out of the plan, so they stay as they are.

/** Breaks the filler's ties (SPEC §5.2): seeded from the clock once per session. */
const random = xorshift32(clockSeed());

/** The plan last made, kept while its inputs are the same: the preview is what a press paints. */
interface Known {
    readonly session: ProjectSession;
    readonly revision: number;
    readonly mapId: string;
    readonly layerId: number;
    readonly analysis: TerrainAnalysis;
    readonly region: Region;
    readonly plan: FillPlan | null;
}

let known: Known | null = null;

function sameRegion(a: Region, b: Region): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const x = a[i]!;
        const y = b[i]!;
        if (x.y !== y.y || x.start !== y.start || x.end !== y.end) return false;
    }
    return true;
}

/**
 * The terrain fill of `region` (inside the map) on tile layer `layerId` of `map` with the set
 * `analysis` describes: the resolved cells, drawn as a stamp over the region's bounding box
 * from its top-left. Null when the region is empty, the layer is not a tile layer or no cell
 * was resolved. Kept between calls while the session's revision, the layer, the set and the
 * region stay, so a press paints the tiles its preview showed.
 */
export function terrainFillPlan(
    session: ProjectSession,
    revision: number,
    map: ProjectMap,
    layerId: number,
    analysis: TerrainAnalysis,
    region: Region,
): FillPlan | null {
    const last = known;
    if (
        last &&
        last.session === session &&
        last.revision === revision &&
        last.mapId === map.id &&
        last.layerId === layerId &&
        last.analysis === analysis &&
        sameRegion(last.region, region)
    ) {
        return last.plan;
    }
    const plan = makePlan(map, layerId, analysis, region);
    known = { session, revision, mapId: map.id, layerId, analysis, region, plan };
    return plan;
}

function makePlan(
    map: ProjectMap,
    layerId: number,
    analysis: TerrainAnalysis,
    region: Region,
): FillPlan | null {
    const layer = findLayer(map, layerId)?.layer;
    const bounds = regionBounds(region);
    if (layer?.type !== "tile" || !bounds) return null;
    const filler = new TerrainFiller({
        analysis,
        back: (x, y) => layer.cells.get(x, y),
        width: map.width,
        height: map.height,
        random,
        corrections: false,
    });
    filler.setRegion(region);
    const { cells } = filler.apply();
    if (cells.length === 0) return null;
    const stamp = {
        width: bounds.width,
        height: bounds.height,
        cells: new Uint32Array(bounds.width * bounds.height),
    };
    for (const { x, y, value } of cells) {
        stamp.cells[(y - bounds.y) * bounds.width + (x - bounds.x)] = value;
    }
    const terrain: readonly TerrainCell[] = cells;
    return { region, origin: { x: bounds.x, y: bounds.y }, stamp, terrain };
}
