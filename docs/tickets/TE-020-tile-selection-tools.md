# [TE-020] Tile selection tools

Milestone: M2 Tile tools · Size: M · Depends on: TE-019

## Context

The tile selection is a cell mask per map that clips painting (SPEC §4.4, §4.1). Three tools
make it, with Tiled's modifier modes.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §4.1 (selection clipping), §4.3 (rectangle select, magic wand, select
  same tile rows), §4.4 (selection), §14 (magic wand budget).
- [DESIGN.md](../DESIGN.md) §3.3 rows `core/selection/*`, `app/selection/*` (ants);
  §4 (cell selection); §5 (Select menu); §7 (Mode control); §8.7 (selection size);
  §10.3 (M, W, S, Ctrl+A, Ctrl+D, Ctrl+I, Escape).

## Required work

- Adapt `core/selection` (mask, operations, boundary) to cell masks; marching ants around
  selected cells.
- Rectangle select, magic wand (reuses `core/fill`), select same tile (empty included when the
  clicked cell is empty; dragging adds each further value hovered). Modes: none = replace (or the
  context bar's locked mode), Shift add, Ctrl subtract, Ctrl+Shift intersect; right click clears.
- Select All, Select None, Invert Selection; Escape with a tile tool active clears.
- The selection clips stamp brush, eraser, bucket fill (also bounds its region) and shape fill;
  Shift bucket fill fills the whole selection.
- Selection per map, applies to the active tile layer, not saved. Status bar selection size.

## Acceptance criteria

- [ ] `tests/unit/te-020-mask.test.ts`: replace, add, subtract, intersect, invert against
      golden masks.
- [ ] `tests/e2e/te-020-select.spec.ts`: each tool in each mode; Select menu commands and keys;
      Escape clears.
- [ ] `tests/e2e/te-020-clipping.spec.ts`: each paint tool changes only selected cells; Shift
      bucket fills exactly the selection.
- [ ] Measured on reference hardware: magic wand of a 65,536-cell region, press → frame
      submitted, p95 ≤ 100 ms.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-020-*`; perf page `tests/perf/te-020-*`.

## Dependencies and scope

- Depends on TE-019.
- Out of scope: clipboard (TE-021); Crop to Selection, New Layer from Selection (Later).

## Documentation

Adds rows to `docs/PROVENANCE.md`; fills the magic-wand cell of SPEC §14.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
