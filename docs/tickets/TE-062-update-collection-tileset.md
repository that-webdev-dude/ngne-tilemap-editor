# [TE-062] Update a collection tileset from source

Milestone: M8 TMJ import · Size: S · Depends on: TE-028, TE-061

## Context

A `"collection"` tileset (from a TMJ image collection) updates from its TSJ, TSX or TMJ and its
tile images, picked as TMJ import picks files (SPEC §6.3).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.3 (collection sources), §13 (file picking).
- [FORMAT.md](../FORMAT.md) §2.4 (`"collection"` source key = image file name).
- Update matcher and dialog (TE-027, TE-028), TMJ file picking (TE-061), tileset conversion
  (TE-060).

## Required work

- Update Tileset from Source… on a `"collection"` tileset asks for its TSJ, TSX or TMJ and the
  tile images, with TE-061's file picking; re-reads them with TE-060's conversion; matches and
  resolves with TE-027 and TE-028 (source key = image file name).

## Acceptance criteria

- [ ] `tests/e2e/te-062-collection-update.spec.ts`: a collection tileset imported from a fixture
      updates from an edited copy (one image changed, one renamed, one removed): changed in place,
      matched by fingerprint, listed as missing respectively; Apply and undo behave as TE-028.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-062-*`.

## Dependencies and scope

- Depends on TE-028, TE-061.

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
