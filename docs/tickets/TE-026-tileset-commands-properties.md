# [TE-026] Tileset commands and Tileset Properties

Milestone: M3 Tilesets · Size: M · Depends on: TE-025

## Context

Tilesets are renamed, reordered, given a tile offset and deleted through undoable commands
(SPEC §6.2), and their fields are edited in the Tileset Properties dialog (DESIGN §9).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.2 (tileset commands, delete refusal), §4.2 (removed tiles; the rule
  of TE-022).
- [FORMAT.md](../FORMAT.md) §2.4 (Tileset members, export names distinct), §1.3 (tile offset).
- [DESIGN.md](../DESIGN.md) §5 (Tileset menu), §9 (Tileset Properties), §10.3 (F2).

## Required work

- Commands: rename, export name (slug, unique), class, tile offset X/Y, move left/right in the
  list, delete (refused while any map uses one of its tiles; the message names the maps; the
  current stamp and the clipboard lose their cells on it, SPEC §4.2).
- Tileset Properties dialog: name, export name, class, tile offset X/Y, source read-only (kind,
  file, tile size, margin, spacing).
- Tileset menu items Tileset Properties…, Delete Tileset, Previous Tileset, Next Tileset; F2
  renames in the panel.
- Moving a tileset changes `firstGid` order only on write; maps are unaffected in memory.

## Acceptance criteria

- [ ] `tests/unit/te-026-commands.test.ts`: every command passes the TE-006 symmetry harness;
      a duplicate export name is refused; delete is refused naming the maps that use it; delete
      and the redo of a delete leave the current stamp and the clipboard with no cell of the
      deleted tileset.
- [ ] `tests/e2e/te-026-properties.spec.ts`: dialog edits apply as one entry each; tile offset
      moves the drawn tiles (readback); source fields are read-only.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-026-*`.

## Dependencies and scope

- Depends on TE-025.
- Out of scope: Update Tileset from Source (TE-027, TE-028); delete with replacement (Later).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
