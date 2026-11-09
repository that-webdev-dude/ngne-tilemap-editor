import type { TerrainSet, Tileset } from "../../../core/model";
import type { TerrainAnalysis } from "../../../core/terrain";

// Where the terrain brush reads the set and terrain it paints, and where right-click sampling
// puts the terrain it picks. The tool module (`terrainBrush.tools.ts`) is loaded by the tool
// registry, which the panel stores behind the brush's terrain depend on through the active
// tool, so it cannot import them: `brushTerrain.ts` provides itself here when it is loaded (by
// the brush's overlay and context bar). Until then the brush has no terrain set.

/** What the brush paints now. */
export interface BrushTerrain {
    readonly tileset: Tileset;
    /** The set's index in the tileset. */
    readonly setIndex: number;
    readonly set: TerrainSet;
    readonly analysis: TerrainAnalysis;
    /** The terrain, 1-based; 0 erases. */
    readonly color: number;
}

export interface BrushSource {
    /** The set and terrain the brush paints; null when there is no terrain set. */
    current(): BrushTerrain | null;
    /** Makes `color` the brush's terrain in its set: 0 erases. */
    choose(color: number): void;
}

let source: BrushSource = { current: () => null, choose: () => undefined };

/** Makes `next` the brush's source. */
export function provideBrushSource(next: BrushSource): void {
    source = next;
}

/** The brush's source as provided. */
export const brushSource: BrushSource = {
    current: () => source.current(),
    choose: (color) => source.choose(color),
};
