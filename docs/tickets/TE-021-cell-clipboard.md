# [TE-021] Cell clipboard

Milestone: M2 Tile tools · Size: S · Depends on: TE-020

## Context

Copy, cut, paste and delete of selected cells work as in Tiled: paste makes the clipboard the
current stamp (SPEC §4.4).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §4.4 (copy, cut, delete, paste, clipboard scope).
- [DESIGN.md](../DESIGN.md) §5 (Edit menu), §10.3 (Ctrl+X, Ctrl+C, Ctrl+V, Delete).

## Required work

- Editor-owned clipboard, shared by all maps of the project, holding slots and tile IDs.
- Copy: the selected cells of the active layer as a stamp (bounding box, cells outside the
  selection empty). Cut: copy and erase, one entry. Delete: erase the selected cells. Paste:
  clipboard → current stamp, stamp brush selected.
- Edit menu items and keys.

## Acceptance criteria

- [ ] `tests/e2e/te-021-clipboard.spec.ts`: copy then paste reproduces the selected shape with
      empty cells outside the mask; cut and delete are one entry each and undo restores; paste
      selects the stamp brush.
- [ ] `tests/unit/te-021-clipboard.test.ts`: the clipboard content is the same whichever map of
      the project is active.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-021-*`.

## Dependencies and scope

- Depends on TE-020.
- Out of scope: marker clipboard (TE-039); clearing when another project opens (TE-047).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
