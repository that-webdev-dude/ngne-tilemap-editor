# [TE-033] Resize / Offset Map

Milestone: M4 Maps, layers and markers · Size: M · Depends on: TE-032

## Context

Tiled's Resize / Offset Map changes a map's size and shifts its content in one step
(SPEC §7.1, DESIGN §9).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §7.1 (Resize / Offset Map), §4.4 (Copy, Cut and Delete inside the map).
- Selection and clipboard: `src/core/selection/`, `src/app/clipboard/clipboard.ts` (TE-020,
  TE-021).
- [DESIGN.md](../DESIGN.md) §3.3 row `ui/sprite/PivotGrid.tsx`; §3.4 row
  `ui/sprite/CanvasSizeDialog.tsx`; §9 (Resize / Offset Map row).
- [FORMAT.md](../FORMAT.md) §2.8 (limits).

## Required work

- Command: new width and height and an offset in cells; cells outside the new bounds removed;
  markers moved by the offset and kept even outside the bounds; the tile selection moved by the
  offset in the same entry, not cut to the new bounds (Tiled's `MapDocument::resizeMap`); one
  entry; limits checked.
- Copy, Cut and Delete act only on the selected cells inside the map (SPEC §4.4).
- Dialog: width, height, offset X/Y, anchor grid (adapted `PivotGrid`) setting the offset, a
  preview of the old map inside the new bounds (from `core/compositor`).

## Acceptance criteria

- [ ] `tests/unit/te-033-resize.test.ts`: grow, shrink and offset on every anchor give the
      expected cells and marker positions; the command passes the TE-006 symmetry harness.
- [ ] `tests/unit/te-033-selection.test.ts`: the selection moves by the offset and undo restores
      it. After a shrink that leaves selected cells outside the map, Copy, Cut and Delete act on
      the selected cells inside the map and throw nothing.
- [ ] `tests/e2e/te-033-dialog.spec.ts`: the anchor grid sets the offset; the preview shows the
      old bounds; Apply is one entry; undo restores.
- [ ] A size above FORMAT §2.8 is refused.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-033-*`.

## Dependencies and scope

- Depends on TE-032.
- Out of scope: infinite maps (Later).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
