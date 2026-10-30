# [TE-054] Export dialog, Export Again and Export on Save

Milestone: M7 Export, runtime and preview · Size: M · Depends on: TE-047, TE-053

## Context

Users export through a large dialog that shows destination, export name and the file list, then
re-export with one key or on every save (SPEC §10.2, DESIGN §9).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §10.2 (Export…, Export Again, Export on Save), §3 (export settings make
  the project dirty, no history entry).
- [DESIGN.md](../DESIGN.md) §3.3 row `ui/export/AtlasThumbnail.tsx`; §3.4 row
  `ui/export/ExportDialog.tsx`; §9 (Export row); §10.3 (Ctrl+E, Ctrl+Shift+X).
- Export pipeline (TE-053), file workflows (TE-047).

## Required work

- Export… dialog: left destination folder, project export name, Export on save; right the file
  list with sizes grouped (tilemaps, tilesets, images, runtime), tileset atlas thumbnails, errors
  in `--danger`; Close / Export.
- Export Again writes without a dialog when a folder is known and writable; otherwise opens the
  dialog.
- Export on Save: after a successful save, inside the same file operation, never with a dialog;
  any problem is one error toast and the save stands.
- Export settings are plain setters that make the project dirty.

## Acceptance criteria

- [ ] `tests/e2e/te-054-dialog.spec.ts`: the file list and sizes match the plan; thumbnails show
      each packed tileset; Export writes the folder.
- [ ] Export Again with a known folder writes without a dialog; without one it opens the dialog.
- [ ] Export on Save exports after save; a forced export failure shows one toast and the file is
      saved.
- [ ] Changing an export setting marks the project dirty and adds no history entry.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-054-*`.

## Dependencies and scope

- Depends on TE-047, TE-053.
- Out of scope: conformance (TE-055).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
