# [TE-042] Terrain fixtures, goldens and Tiled check

Milestone: M5 Terrain · Size: M · Depends on: TE-041

## Context

The port is accepted against Tiled itself: fixture sets with exactly one tile per terrain
combination make Tiled's result deterministic, so hand-traced goldens can be confirmed once in
Tiled 1.12.2 by the owner (SPEC §5.2).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §5.2 (fixtures, automated and manual checks).
- [reference/tiled.md](../reference/tiled.md) §4 (algorithm), §5 (TMJ/TSJ as Tiled writes them).
- `core/terrain` (TE-041).

## Required work

- `tests/fixtures/terrain/`: corner, edge and mixed sets, complete and incomplete, each with
  exactly one tile per terrain combination; a committed script writes the tileset PNGs, TSJ
  tilesets and TMJ maps as Tiled 1.12.2 writes them.
- Scripted strokes per fixture: brush, full-tile and fill mode, described in the folder's README
  as exact cells and terrains so the owner can repeat them in Tiled.
- Golden results, each traced by hand against `wangfiller.cpp` when written, committed as TMJ.
- A test runs each stroke through `core/terrain` and compares with its golden; it reads the
  goldens' `data` arrays directly (csv-encoded TMJ), not through the TMJ importer.

## Acceptance criteria

- [ ] `tests/unit/te-042-goldens.test.ts`: every scripted stroke on every fixture equals its
      golden cell for cell.
- [ ] The fixture script reproduces the committed files byte for byte.
- [ ] Owner check card below passes; a mismatch is a port bug, fixed in this ticket.

**Owner check — terrain goldens in Tiled 1.12.2**

1. Install Tiled 1.12.2. Open each map in `tests/fixtures/terrain/` listed in its README.
2. For each scripted stroke in the README: select the named terrain set and terrain in Tiled's
   Terrain Sets view, choose the Terrain Brush (or Bucket Fill with Terrain mode), and paint the
   listed cells in order.
3. Compare the result with the golden map named for that stroke (open it alongside): every cell
   must show the same tile and orientation.
4. Reply `terrain pass`, or `terrain fail: <fixture> <stroke> <cell x,y>`.

## Validation

- `npm run check`; the owner check above.

## Dependencies and scope

- Depends on TE-041.
- Out of scope: TMJ import of these files into the editor (TE-059 onward).

## Documentation

Adds `tests/fixtures/terrain/README.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
