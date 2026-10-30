# [TE-028] Update Tileset from Source dialog

Milestone: M3 Tilesets · Size: M · Depends on: TE-026, TE-027

## Context

The user runs "Update Tileset from Source…", picks or drops the source, and resolves ambiguous
and missing tiles in a large dialog before one undoable apply (SPEC §6.3, DESIGN §9).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.3 (command, file picking, dialog), §14 (budget).
- [DESIGN.md](../DESIGN.md) §5 (Tileset menu), §9 (Update Tileset from Source row).
- Matcher (TE-027), worker (TE-010), import dialog patterns (TE-024).

## Required work

- Tileset menu command; the picker opens with the recorded file name; drop works too.
- Read and match through the worker. Nothing ambiguous or missing → apply at once with a toast.
- Otherwise the large dialog: summary line; rows for ambiguous and missing tiles with old
  picture, usage per map ("Overworld: 120 cells"), a choice per row (candidates, Keep as is,
  Delete, Replace with… picker); Cancel changes nothing, Apply makes one entry.
- The viewport texture of the tileset is replaced after apply and after undo.

## Acceptance criteria

- [ ] `tests/e2e/te-028-update.spec.ts`: an edited source with moved and changed tiles applies
      at once; a source with a duplicate and a removed tile opens the dialog; each choice gives
      the cells TE-027 specifies; Cancel leaves the project unchanged; undo restores pixels and
      cells and the viewport (readback).
- [ ] Measured on reference hardware: update of a 1,024-tile tileset ≤ 1 s.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-028-*`; perf page `tests/perf/te-028-*`.

## Dependencies and scope

- Depends on TE-026, TE-027.
- Out of scope: `"collection"` sources (TE-062).

## Documentation

Fills the update-from-source cell of SPEC §14.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
