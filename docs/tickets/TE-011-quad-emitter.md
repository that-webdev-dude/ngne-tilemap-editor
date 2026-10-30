# [TE-011] Shared quad emitter and tile placement

Milestone: M1 Viewport · Size: M · Depends on: TE-005

## Context

Quad emission is about 70% of the live tier's frame cost (ENGINE §4). The editor's live tier and
the generated runtime share one emitter, `core/runtime/emit.ts`, so the viewport draws what a
game draws (SPEC §11.3). It must place the 8 orientations exactly as FORMAT §1.2–§1.3, odd sizes
included, and allocate nothing per quad.

## Relevant code and documentation

- [FORMAT.md](../FORMAT.md) §1.2 (orientation table), §1.3 (placement, odd-size correction,
  worked example), §3.4 (parallax shift), §3.10 (example cell `(3, 1)`).
- [SPEC.md](../SPEC.md) §11.2 (`drawTilemap` rules: culling, grouping, depth), §11.3.
- [ENGINE.md](../ENGINE.md) §4 (emission order, batching), §7 (gaps).

## Required work

- `core/runtime/emit.ts` with no imports (it is inlined into the generated runtime, TE-050).
- Per-tileset UV tables and an 8-entry orientation table (sign, rotation, centre correction)
  precomputed per tileset.
- Emit one layer into a sink: cells in view only, widened for tiles larger than the grid and
  tile offsets; grouped by tileset, row-major inside a tileset; one depth per layer; scale,
  alpha and colour applied; one reused sprite object.
- Usable with the editor's in-memory cell values and with GIDs (the runtime's), without a
  per-cell allocation.

## Acceptance criteria

- [ ] `tests/unit/te-011-placement.test.ts`: for each FORMAT §1.2 row, a 3 × 2 asymmetric tile
      gives that row's `fx`, `fy`, `θ` and texel mapping; the 15 × 15 example gives quad centres
      `(8, 8)`, `(7, 8)` (flip H) and `(7, 8)` (90° clockwise); the FORMAT §3.10 cell `(3, 1)`
      gives centre `(56, 24)`.
- [ ] fast-check: culling never drops a tile with a pixel in the view, compared with emitting
      every cell.
- [ ] Order: quads arrive grouped by tileset and row-major within a tileset, one depth per layer.
- [ ] Every sink call receives the same sprite object.
- [ ] A test asserts `emit.ts` contains no `import` statement.

## Validation

- `npm run check`; Node benchmark `tests/perf/te-011-emit.perf.ts` (65,536 cells), report-only.

## Dependencies and scope

- Depends on TE-005.
- Out of scope: the viewport (TE-013), `drawTilemap` (TE-051).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
