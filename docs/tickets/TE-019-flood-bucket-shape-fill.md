# [TE-019] Flood fill, bucket fill and shape fill

Milestone: M2 Tile tools · Size: M · Depends on: TE-018

## Context

Bucket fill and shape fill tile the current stamp over a region (SPEC §4.3). `core/fill`
provides the scanline flood fill the magic wand reuses (TE-020) and the shape regions.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §4.3 (bucket fill, shape fill rows, flood fill, ellipse region, fill-mode
  toggle), §14 (bucket fill budget).
- [DESIGN.md](../DESIGN.md) §4 (fill previews), §6 (shape fill variants), §7 (context bars),
  §10.3 (G, U, Shift+U).
- [reference/tiled.md](../reference/tiled.md) §3 (`bucketfilltool.cpp`, `TileFill`).

## Required work

- `core/fill`: queue-based scanline fill, 4-connected, over cells equal by tile and flags,
  bounded by the map or a region, returning row spans; rectangle and ellipse regions (cells whose
  centre lies inside the inscribed ellipse).
- Bucket fill: fills the region of the clicked cell, the stamp tiled from the region's bounding
  box top-left; Shift (or Whole selection): the whole layer when no selection exists; hover
  previews the region.
- Shape fill: drag a rectangle or ellipse (variants U / Shift+U, U toggles); Shift square or
  circle; Alt centred on the press; right click or Escape cancels.
- Context bars with a Fill mode setting holding **Tile** (TE-045 adds Terrain) and the stamp
  transforms; capture (TE-018) enabled for both tools.

## Acceptance criteria

- [ ] `tests/unit/te-019-fill.test.ts`: flood regions and ellipse regions equal golden regions;
      fast-check: a flood region is 4-connected, uniform and maximal.
- [ ] `tests/e2e/te-019-bucket.spec.ts`: fill, undo, redo; stamp tiling origin; Shift whole
      layer; hover preview.
- [ ] `tests/e2e/te-019-shape.spec.ts`: rectangle, ellipse, Shift, Alt, cancel by right click
      and Escape.
- [ ] Measured on reference hardware: bucket fill of a 65,536-cell region, press → frame
      submitted, p95 ≤ 100 ms.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-019-*`; perf page `tests/perf/te-019-*`.

## Dependencies and scope

- Depends on TE-018.
- Out of scope: selection bounds and Shift-fills-selection (TE-020), Terrain fill mode (TE-045).

## Documentation

Fills the bucket-fill cell of SPEC §14 (README, Measurements).

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
