# Terrain fixtures

Fixtures of the terrain filler (SPEC §5.2): corner, edge and mixed terrain sets, complete and
incomplete, each with exactly one tile per terrain combination it holds, and the strokes the
TE-042 test (`tests/unit/te-042-goldens.test.ts`) paints on them. Every file here is written by
`node scripts/terrain-fixtures.ts` (definitions in `tests/unit/support/terrainFixtures.ts`) in
the layout Tiled 1.12.2 saves; the test checks that the script reproduces them byte for byte.

Every golden was captured from Tiled 1.12.2 on 2026-11-16: the stroke's steps made in Tiled on
its start map, and the result saved as JSON.

## Conventions

- Maps are 8 × 8 cells of 24 px; cell (x,y) counts from the top-left, as Tiled's status bar
  shows it. Vertex (x,y) is the top-left corner of cell (x,y).
- Terrains: 1 Grass (green), 2 Sand (yellow), 3 Water (blue). A tile is drawn in its
  terrains: corner tiles by quadrant, edge tiles by the triangles between the diagonals,
  mixed tiles in a 3 × 3 grid (corners and edges; the middle is dark grey).
- `<set>.tmj` is all Grass; `<set>-fill.tmj` is the brush golden with some cells erased, the
  regions the fill stroke fills; `<set>-<stroke>.golden.tmj` is the captured result of a stroke.
- Each step is one click, made on the map the steps before it left. Fill regions are empty
  cells enclosed by tiles: one cell high for corner sets, one cell for edge and mixed sets.

## Making a stroke in Tiled 1.12.2

Open the stroke's map, select the terrain set in the Terrain Sets view and, for brush and
full-tile strokes, the terrain each step names; use the named tool and make each step in order.

- Keep the Terrain Brush's **Fill Full Tiles** toolbar toggle off: Ctrl inverts it, so with
  it on, brush strokes would paint full tiles and full-tile strokes single indexes.
- The brush paints what the cursor is nearest to. Corner sets: the nearest corner. Edge sets:
  the edge of the cell's quarter between its diagonals. Mixed sets: the cell is split 3 × 3;
  hover a corner square for a corner and the middle square of a side for that edge.

## Corner complete

Tileset `corner-complete.tsj`, terrain set "Corner complete" (corner): Grass, Sand; the 16 combinations of Grass–Sand.

### corner-complete brush

- Map: `corner-complete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Sand at vertex (3,3), the top-left corner of cell (3,3).
- Step 2: Sand at vertex (4,3), the top-left corner of cell (4,3).
- Step 3: Sand at vertex (5,5), the top-left corner of cell (5,5).
- Golden: `corner-complete-brush.golden.tmj`.

### corner-complete full-tile

- Map: `corner-complete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Sand, full tile, on cell (2,5).
- Step 2: Sand, full tile, on cell (5,1).
- Golden: `corner-complete-full-tile.golden.tmj`.

### corner-complete fill

- Map: `corner-complete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (1,3).
- Golden: `corner-complete-fill.golden.tmj`.

## Corner incomplete

Tileset `corner-incomplete.tsj`, terrain set "Corner incomplete" (corner): Grass, Sand, Water; the 31 combinations of Grass–Sand and Sand–Water.

### corner-incomplete brush

- Map: `corner-incomplete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Water at vertex (4,4), the top-left corner of cell (4,4).
- Step 2: Water at vertex (5,4), the top-left corner of cell (5,4).
- Golden: `corner-incomplete-brush.golden.tmj`.

### corner-incomplete full-tile

- Map: `corner-incomplete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Water, full tile, on cell (2,2).
- Step 2: Water, full tile, on cell (5,5).
- Golden: `corner-incomplete-full-tile.golden.tmj`.

### corner-incomplete fill

- Map: `corner-incomplete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (1,4).
- Golden: `corner-incomplete-fill.golden.tmj`.

## Edge complete

Tileset `edge-complete.tsj`, terrain set "Edge complete" (edge): Grass, Sand; the 16 combinations of Grass–Sand.

### edge-complete brush

- Map: `edge-complete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Sand on the top edge of cell (3,3).
- Step 2: Sand on the right edge of cell (3,3).
- Step 3: Sand on the left edge of cell (5,5).
- Golden: `edge-complete-brush.golden.tmj`.

### edge-complete full-tile

- Map: `edge-complete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Sand, full tile, on cell (2,5).
- Step 2: Sand, full tile, on cell (5,1).
- Golden: `edge-complete-full-tile.golden.tmj`.

### edge-complete fill

- Map: `edge-complete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (3,3).
- Step 2: click cell (5,5).
- Golden: `edge-complete-fill.golden.tmj`.

## Edge incomplete

Tileset `edge-incomplete.tsj`, terrain set "Edge incomplete" (edge): Grass, Sand, Water; the 31 combinations of Grass–Sand and Sand–Water.

### edge-incomplete brush

- Map: `edge-incomplete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Water on the top edge of cell (3,3).
- Step 2: Water on the right edge of cell (3,3).
- Golden: `edge-incomplete-brush.golden.tmj`.

### edge-incomplete full-tile

- Map: `edge-incomplete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Water, full tile, on cell (2,5).
- Golden: `edge-incomplete-full-tile.golden.tmj`.

### edge-incomplete fill

- Map: `edge-incomplete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (3,2).
- Step 2: click cell (4,3).
- Golden: `edge-incomplete-fill.golden.tmj`.

## Mixed complete

Tileset `mixed-complete.tsj`, terrain set "Mixed complete" (mixed): Grass, Sand; the 256 combinations of Grass–Sand.

### mixed-complete brush

- Map: `mixed-complete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Sand at vertex (3,3), the top-left corner of cell (3,3).
- Step 2: Sand on the left edge of cell (5,4).
- Step 3: Sand on the top edge of cell (2,6).
- Golden: `mixed-complete-brush.golden.tmj`.

### mixed-complete full-tile

- Map: `mixed-complete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Sand, full tile, on cell (4,2).
- Golden: `mixed-complete-full-tile.golden.tmj`.

### mixed-complete fill

- Map: `mixed-complete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (3,3).
- Step 2: click cell (5,4).
- Golden: `mixed-complete-fill.golden.tmj`.

## Mixed incomplete

Tileset `mixed-incomplete.tsj`, terrain set "Mixed incomplete" (mixed): Grass, Sand, Water; the 511 combinations of Grass–Sand and Sand–Water.

### mixed-incomplete brush

- Map: `mixed-incomplete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Water at vertex (4,4), the top-left corner of cell (4,4).
- Step 2: Water on the top edge of cell (1,6).
- Golden: `mixed-incomplete-brush.golden.tmj`.

### mixed-incomplete full-tile

- Map: `mixed-incomplete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Water, full tile, on cell (2,2).
- Golden: `mixed-incomplete-full-tile.golden.tmj`.

### mixed-incomplete fill

- Map: `mixed-incomplete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (3,3).
- Step 2: click cell (1,5).
- Golden: `mixed-incomplete-fill.golden.tmj`.
