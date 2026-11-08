# Terrain fixtures

Fixtures of the terrain filler (SPEC §5.2): corner, edge and mixed terrain sets, complete and
incomplete, each with exactly one tile per terrain combination it holds, and the strokes the
TE-042 test (`tests/unit/te-042-goldens.test.ts`) paints on them. Every file here is written by
`node scripts/terrain-fixtures.ts` (definitions in `tests/unit/support/terrainFixtures.ts`) as
Tiled 1.12.2 writes it; the test checks that the script reproduces them byte for byte.

## Conventions

- Maps are 8 × 8 cells of 24 px; cell (x,y) counts from the top-left, as Tiled's status bar
  shows it. Vertex (x,y) is the top-left corner of cell (x,y).
- Terrains: 1 Grass (green), 2 Sand (yellow), 3 Water (blue). A tile is drawn in its
  terrains: corner tiles by quadrant, edge tiles by the triangles between the diagonals,
  mixed tiles in a 3 × 3 grid (corners and edges; the middle is dark grey).
- `<set>.tmj` is all Grass; `<set>-fill.tmj` is a golden with some cells erased, the regions
  the fill stroke fills; `<set>-<stroke>.golden.tmj` is the expected result of a stroke.
- Each step is one click: one run of the filler on the map the steps before it left.
- The strokes keep Tiled's random choice out: every index of every cell the filler resolves
  is constrained, so one candidate has the lowest penalty. Fill regions are empty cells
  enclosed by tiles, one cell high for corner sets and one cell for edge and mixed sets (a
  wider region leaves the edges inside it without a wish). The test makes a tie fail.

## Owner check in Tiled 1.12.2

For each stroke below: open its map (reopen it without saving between strokes), select the
terrain set in the Terrain Sets view and, for brush and full-tile strokes, the terrain each
step names; use the named tool and make each step in order. Then open the golden alongside:
every cell must show the same tile. Reply `terrain pass`, or
`terrain fail: <set> <stroke> <cell x,y>`.

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
- Trace: Each click makes Sand a hard constraint at one corner of the four cells around the vertex; their other corners want what they had. The tile with exactly those corners exists (penalty 0, the only one), and it agrees with every neighbour, so no correction runs.

### corner-complete full-tile

- Map: `corner-complete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Sand, full tile, on cell (2,5).
- Step 2: Sand, full tile, on cell (5,1).
- Golden: `corner-complete-full-tile.golden.tmj`.
- Trace: Full tile mode fixes the four corners of the cell and the corners its eight neighbours share with it; every one of the nine cells then has an exact tile.

### corner-complete fill

- Map: `corner-complete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (1,3).
- Golden: `corner-complete-brush.golden.tmj`.
- Trace: The region is the empty strip of row 3. Border seeding gives each of its cells its top corners from row 2 and its bottom corners from row 4 (the strip is one cell high, so every corner is seeded); the exact tile is the only one at penalty 0, and the look-ahead (corner sets are never complete to the filler) keeps it.

## Corner incomplete

Tileset `corner-incomplete.tsj`, terrain set "Corner incomplete" (corner): Grass, Sand, Water; the 31 combinations of Grass–Sand and Sand–Water.

### corner-incomplete brush

- Map: `corner-incomplete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Water at vertex (4,4), the top-left corner of cell (4,4).
- Step 2: Water at vertex (5,4), the top-left corner of cell (5,4).
- Golden: `corner-incomplete-brush.golden.tmj`.
- Trace: Water at a corner leaves only Sand–Water tiles; the three corners that want Grass cost 1 each as Sand and 2 as Water, so each of the four cells takes Sand there: the only tile at the lowest penalty (3 for the first cell; the later ones share corners already fixed by it, so 2, 2 and 1). Corrections then reach the edge neighbours whose shared corners became Sand; each takes its exact Grass–Sand tile, and so on to the diagonal cells. The second click turns vertex (5,4) to Water the same way.

### corner-incomplete full-tile

- Map: `corner-incomplete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Water, full tile, on cell (2,2).
- Step 2: Water, full tile, on cell (5,5).
- Golden: `corner-incomplete-full-tile.golden.tmj`.
- Trace: The cell's four corners are Water; its neighbours keep their shared corners Water and take Sand at the corners that wanted Grass (the cheapest, and the only one). Corrections give the next ring its exact Grass–Sand tiles. In the second click cell (4,4) wants Sand, Grass, Grass beside its Water corner and takes Sand at all three (penalty 2, the only one).

### corner-incomplete fill

- Map: `corner-incomplete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (1,4).
- Golden: `corner-incomplete-brush.golden.tmj`.
- Trace: As for the complete set: the one-cell-high strip of row 4 has every corner seeded from rows 3 and 5, its exact tiles exist, and the look-ahead finds a tile for every neighbour.

## Edge complete

Tileset `edge-complete.tsj`, terrain set "Edge complete" (edge): Grass, Sand; the 16 combinations of Grass–Sand.

### edge-complete brush

- Map: `edge-complete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Sand on the top edge of cell (3,3).
- Step 2: Sand on the right edge of cell (3,3).
- Step 3: Sand on the left edge of cell (5,5).
- Golden: `edge-complete-brush.golden.tmj`.
- Trace: Each click fixes one edge in the two cells that share it; their other edges want what they had and the exact tile exists, so nothing else changes.

### edge-complete full-tile

- Map: `edge-complete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Sand, full tile, on cell (2,5).
- Step 2: Sand, full tile, on cell (5,1).
- Golden: `edge-complete-full-tile.golden.tmj`.
- Trace: Full tile mode on an edge set fixes the cell's four edges and the edge each side neighbour shares with it (diagonal cells are not touched); all five cells have exact tiles.

### edge-complete fill

- Map: `edge-complete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (3,3).
- Step 2: click cell (5,5).
- Golden: `edge-complete-brush.golden.tmj`.
- Trace: Each region is one empty cell, so border seeding gives all four of its edges from its neighbours and its exact tile is the only one at penalty 0. (A region two cells wide would leave the edge between them without a wish, and Tiled would pick at random.)

## Edge incomplete

Tileset `edge-incomplete.tsj`, terrain set "Edge incomplete" (edge): Grass, Sand, Water; the 31 combinations of Grass–Sand and Sand–Water.

### edge-incomplete brush

- Map: `edge-incomplete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Water on the top edge of cell (3,3).
- Step 2: Water on the right edge of cell (3,3).
- Golden: `edge-incomplete-brush.golden.tmj`.
- Trace: Water on an edge leaves only Sand–Water tiles for the two cells sharing it; their other edges want Grass and take Sand (penalty 3, the only one). Corrections give the cells beyond those edges their exact Grass–Sand tiles. The second click turns the right edge of cell (3,3) to Water: cell (3,3) has its exact tile, cell (4,3) takes Sand at its three other edges, and its neighbours are corrected.

### edge-incomplete full-tile

- Map: `edge-incomplete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Water, full tile, on cell (2,5).
- Golden: `edge-incomplete-full-tile.golden.tmj`.
- Trace: The cell's four edges are Water; each side neighbour keeps its shared edge Water and takes Sand at its three other edges (the only tile at penalty 3); corrections give the cells beyond them their exact Grass–Sand tiles.

### edge-incomplete fill

- Map: `edge-incomplete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (3,2).
- Step 2: click cell (4,3).
- Golden: `edge-incomplete-brush.golden.tmj`.
- Trace: One empty cell per click, so all four edges are seeded and the exact tile is the only one at penalty 0; the look-ahead finds a tile for every neighbour (the other empty cell only meets the filled one at a corner, which an edge set ignores).

## Mixed complete

Tileset `mixed-complete.tsj`, terrain set "Mixed complete" (mixed): Grass, Sand; the 256 combinations of Grass–Sand.

### mixed-complete brush

- Map: `mixed-complete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Sand at vertex (3,3), the top-left corner of cell (3,3).
- Step 2: Sand on the left edge of cell (5,4).
- Step 3: Sand on the top edge of cell (2,6).
- Golden: `mixed-complete-brush.golden.tmj`.
- Trace: Both terrains are used at corners and edges, so the brush paints corners and edges (`PaintEdgeAndCorner`). Every combination exists: each painted index lands in exact tiles and nothing else changes.

### mixed-complete full-tile

- Map: `mixed-complete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Sand, full tile, on cell (4,2).
- Golden: `mixed-complete-full-tile.golden.tmj`.
- Trace: All eight indexes of the cell, plus the edge and two corners each side neighbour shares with it and the corner each diagonal neighbour shares; exact tiles for all nine cells.

### mixed-complete fill

- Map: `mixed-complete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (3,3).
- Step 2: click cell (5,4).
- Golden: `mixed-complete-brush.golden.tmj`.
- Trace: One empty cell per click: its edges are seeded from the side neighbours and its corners from the diagonal ones, so its exact tile is the only one at penalty 0. The set is complete to the filler, so there is no look-ahead.

## Mixed incomplete

Tileset `mixed-incomplete.tsj`, terrain set "Mixed incomplete" (mixed): Grass, Sand, Water; the 511 combinations of Grass–Sand and Sand–Water.

### mixed-incomplete brush

- Map: `mixed-incomplete.tmj`. Tool: Terrain Brush (T), one click per step.
- Step 1: Water at vertex (4,4), the top-left corner of cell (4,4).
- Step 2: Water on the top edge of cell (1,6).
- Golden: `mixed-incomplete-brush.golden.tmj`.
- Trace: Water at one index leaves only Sand–Water tiles, and the seven indexes that want Grass take Sand, the only tile at the lowest penalty, in the four cells around the vertex (7 for the first; 5, 5 and 3 for the others, whose shared indexes the first fixed) and then in the two cells sharing the edge (7, then 5). Corrections give the ring around them their exact Grass–Sand tiles; cell (2,5) keeps the Sand corner it got from the first click.

### mixed-incomplete full-tile

- Map: `mixed-incomplete.tmj`. Tool: Terrain Brush (T) with Ctrl held (full tile mode), one click per step.
- Step 1: Water, full tile, on cell (2,2).
- Golden: `mixed-incomplete-full-tile.golden.tmj`.
- Trace: All eight indexes of the cell are Water and its eight neighbours keep the indexes they share with it Water; every other index of theirs takes Sand (the only tile at the lowest penalty). Corrections give the next ring its exact Grass–Sand tiles.

### mixed-incomplete fill

- Map: `mixed-incomplete-fill.tmj`. Tool: Bucket Fill Tool (F) in Terrain Fill Mode, one click per step.
- Step 1: click cell (3,3).
- Step 2: click cell (1,5).
- Golden: `mixed-incomplete-brush.golden.tmj`.
- Trace: One empty cell per click, every index seeded from its eight neighbours (cell (3,3) takes Water at its bottom-right corner from cell (4,4)); the exact tile is the only one at penalty 0 and the look-ahead keeps it.
