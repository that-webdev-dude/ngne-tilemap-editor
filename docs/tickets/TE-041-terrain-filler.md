# [TE-041] Terrain set analysis and filler

Milestone: M5 Terrain · Size: L · Depends on: TE-005

## Context

Terrain painting is Tiled's Wang filler ported to `core/terrain` (BRIEF D3, SPEC §5.2). The
brush, the fill mode and the Terrains panel all call it. Probabilities and transformations are
Later, so every candidate weighs 1.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §5.1 (terrain sets), §5.2 (filler, seeded random, invalid region,
  property tests).
- [reference/tiled.md](../reference/tiled.md) §2 (WangSet, WangId), §4 (algorithm, reproduction
  notes).
- [FORMAT.md](../FORMAT.md) §2.4 (TerrainSet, `wangId` index order).
- Tiled `src/tiled/wangfiller.cpp`, `src/libtiled/wangset.cpp`, tag `v1.12.2`.

## Required work

- Per set, recomputed when it changes: candidate list (base tiles only), colour-distance matrix
  by fixed-point relaxation, maximum distance, completeness (C⁴ or C⁸ combinations present),
  missing combinations for corner and edge sets.
- Filler: painting constraints per touched cell (`desired`, `mask`); `setCorner`, `setEdge`,
  full-tile setting; border seeding for fill tools; bounds = region grown by the maximum distance,
  clipped to the map; row-major resolve with the lowest transition penalty; one-step look-ahead
  unless the set is complete (with corrections on); neighbour constraint updates; the corrections
  pass for the brush.
- Seeded `xorshift32` for ties: the session seeds from the clock, tests with a constant.
- Unresolvable cells returned as an invalid region and left unchanged.
- Output as a cell patch usable in a stroke transaction (TE-006).

## Acceptance criteria

- [ ] `tests/unit/te-041-analysis.test.ts`: distance matrices, maximum distance, completeness
      and missing-combination counts for small hand-built corner, edge and mixed sets.
- [ ] `tests/unit/te-041-filler.test.ts` (fast-check): every resolved cell matches its
      constraints; a complete set leaves no invalid cell; nothing outside the bounds changes;
      with a fixed seed two runs give the same result.
- [ ] Unresolvable painting on an incomplete set returns the invalid region and leaves those
      cells unchanged.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-005.
- Out of scope: fixtures, goldens and the Tiled check (TE-042), UI (TE-043 to TE-045);
  probabilities and transformations (Later).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
