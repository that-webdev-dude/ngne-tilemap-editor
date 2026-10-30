# [TE-033] Resize / Offset Map

Milestone: M4 Maps, layers and markers · Size: M · Depends on: TE-032

## Context

Tiled's Resize / Offset Map changes a map's size and shifts its content in one step
(SPEC §7.1, DESIGN §9).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §7.1 (Resize / Offset Map).
- [DESIGN.md](../DESIGN.md) §3.3 row `ui/sprite/PivotGrid.tsx`; §3.4 row
  `ui/sprite/CanvasSizeDialog.tsx`; §9 (Resize / Offset Map row).
- [FORMAT.md](../FORMAT.md) §2.8 (limits).

## Required work

- Command: new width and height and an offset in cells; cells outside the new bounds removed;
  markers moved by the offset and kept even outside the bounds; one entry; limits checked.
- Dialog: width, height, offset X/Y, anchor grid (adapted `PivotGrid`) setting the offset, a
  preview of the old map inside the new bounds (from `core/compositor`).

## Acceptance criteria

- [ ] `tests/unit/te-033-resize.test.ts`: grow, shrink and offset on every anchor give the
      expected cells and marker positions; the command passes the TE-006 symmetry harness.
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
