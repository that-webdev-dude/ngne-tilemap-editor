# [TE-044] Terrain brush

Milestone: M5 Terrain · Size: L · Depends on: TE-042, TE-043

## Context

The terrain brush paints terrain corners and edges and lets the filler choose tiles, as Tiled's
`wangbrush.cpp` does (SPEC §5.3).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §5.3 (brush), §14 (terrain brush budget).
- [DESIGN.md](../DESIGN.md) §4 (terrain brush look), §7 (context bar), §10.3 (T).
- [reference/tiled.md](../reference/tiled.md) §4 (brush specifics).
- `core/terrain` (TE-041), tool framework (TE-016).

## Required work

- Context bar: terrain set select, terrain swatches (Erase first), Full tile toggle (Ctrl inverts
  while held).
- Index picking within the cell: corner sets round to the nearest corner; edge sets pick by the
  cell's diagonals; mixed sets use the 3 × 3 grid (centre paints nothing).
- Drag paints continuously; Shift draws a line from the press; full-tile mode; Alt adds the 180°
  symmetric index at `(width − x − 1, height − y − 1)`; right click samples the terrain into the
  context bar.
- The filler runs with corrections at each step; one stroke one entry; invalid cells shown with a
  35% `--danger` fill and left unchanged; painted corner or edge marked on the overlay.

## Acceptance criteria

- [ ] `tests/e2e/te-044-brush.spec.ts`: on the TE-042 fixtures (loaded through a test hook),
      the scripted brush and full-tile strokes give the goldens; Shift line, Alt symmetry and
      right-click sampling work; one entry per stroke.
- [ ] Invalid cells on an incomplete set are drawn red and unchanged (readback).
- [ ] Measured on reference hardware: terrain brush step on a complete 4-terrain corner set,
      pointer event → frame submitted, p95 ≤ 33 ms.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-044-*`; perf page `tests/perf/te-044-*`.

## Dependencies and scope

- Depends on TE-042, TE-043.
- Out of scope: Terrain fill mode (TE-045).

## Documentation

Fills the terrain-brush cell of SPEC §14.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
