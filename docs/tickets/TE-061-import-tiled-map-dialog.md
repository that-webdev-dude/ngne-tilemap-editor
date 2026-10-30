# [TE-061] Import Tiled Map dialog and report

Milestone: M8 TMJ import · Size: L · Depends on: TE-047, TE-060

## Context

File → Import Tiled Map… gathers the map and its files, converts them in the worker, shows the
import report, and adds the map in one entry only when the user accepts (SPEC §13, DESIGN §9).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §13 (Files, Into the current project, Report, golden reports).
- [DESIGN.md](../DESIGN.md) §5 (File menu), §9 (Import Tiled Map row).
- Conversion (TE-059, TE-060), worker (TE-010), empty state (TE-047).

## Required work

- File picking: a folder via directory picker (relative paths of tilesets, images and templates
  resolve exactly), or without File System Access a multi-select or drop matched by base name;
  missing files listed with Add files…; `.tmj` or `"type": "map"` JSON is a map, `.tsj`/`.tsx`
  tilesets, `.tj` templates.
- Decompression and conversion as worker tasks.
- Large dialog: required files with status, then the report (map size, layers, tilesets,
  markers; dropped or changed items grouped by BRIEF §7 row with counts and locations);
  Cancel adds nothing; Import adds the map (name from the file, export name unique) and new
  tilesets in one entry.
- Empty state's Import Tiled Map action enabled.
- Golden report file per fixture, committed beside the fixtures.

## Acceptance criteria

- [ ] `tests/unit/te-061-reports.test.ts`: each fixture's report equals its committed golden.
- [ ] `tests/e2e/te-061-import.spec.ts`: every fixture imports (or is refused with its message)
      through the dialog; a missing tileset is listed and Add files… completes it; Cancel leaves
      the project unchanged; undo removes the imported map and tilesets.
- [ ] The three composite maps import and render as the compositor reference (readback).

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-061-*`.

## Dependencies and scope

- Depends on TE-047, TE-060.
- Out of scope: TMX import, TMJ export (Later).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
