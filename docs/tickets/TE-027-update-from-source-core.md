# [TE-027] Update tileset from source: matching and apply

Milestone: M3 Tilesets · Size: M · Depends on: TE-023

## Context

Source files change outside the editor; maps must never change silently (BRIEF D6). "Update
tileset from source" re-reads the source and remaps old tiles to new entries by fingerprint and
key (SPEC §6.3). This ticket is the `core/` matcher and the undoable apply.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.3 (matching order, resolutions, history entry, tile-size refusal),
  §3 (history budget).
- [FORMAT.md](../FORMAT.md) §2.4 (source keys, fingerprint).
- Import core (TE-022, TE-023).

## Required work

- Re-read a source with the tileset's recorded parameters (`"image"`, `"sprite"`, `"atlas"`);
  a different tile size refuses ("tile size changed from 16 × 16 to 32 × 32").
- Match in the order of SPEC §6.3: unique fingerprint, same key, ambiguous, missing; unmatched new
  entries become new tiles with new IDs, given the animations the import rules give them.
- Matched tiles keep ID, class, properties, collision and animation.
- Resolutions per ambiguous or missing tile: a candidate, Keep as is (key `null`), Delete (cells
  erased in every map, animation frames on it removed), Replace with a new tile (cells
  rewritten, flags kept).
- Apply as one history entry holding before/after pixels of changed, new and deleted tiles and
  the rewritten cells; counted against the budget like any entry.
- A summary: unchanged, moved, changed, new, ambiguous, missing.

## Acceptance criteria

- [ ] `tests/unit/te-027-match.test.ts`: one case per matching step and per resolution, with
      the expected tile IDs and cells afterwards.
- [ ] Moved and changed tiles keep their IDs; maps change only through Delete and Replace.
- [ ] The apply passes the TE-006 symmetry harness; its `bytes` covers only changed, new and
      deleted tiles and rewritten cells.
- [ ] Tile-size change refused with the message above.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-023.
- Out of scope: the dialog and the 1,024-tile budget (TE-028); `"collection"` sources (TE-062).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
