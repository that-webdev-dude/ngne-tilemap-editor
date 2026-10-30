# [TE-024] Import Tileset dialog and file drop

Milestone: M3 Tilesets · Size: L · Depends on: TE-007, TE-010, TE-023

## Context

Users import grid PNGs, `.ngsprite` files and atlases through one large dialog with a live
preview, or by dropping files (SPEC §6.1, DESIGN §9).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.1 (all import rules, drops).
- [DESIGN.md](../DESIGN.md) §3.3 rows `ui/import/SourcePane.tsx`, `ui/import/PixelCanvas.tsx`;
  §3.4 row `ui/import/ImportDialog.tsx`; §9 (Import Tileset row).
- [SUITE.md](../SUITE.md) §4 (large dialogs 960 px, 86%), §7 (picker types).
- Import core (TE-022, TE-023), worker (TE-010).

## Required work

- File → Import Tileset… with the picker types of SUITE §7; the large dialog of DESIGN §9:
  - grid PNG: image with grid overlay (adapted `SourcePane`), form (tile size, margin, spacing,
    name, export name), "n tiles";
  - `.ngsprite`: composited frame chosen under the pane, "n frames, m tiles, k animations",
    warnings; Import disabled until the tile size is ≤ 256;
  - atlas (`.atlas.json` and its PNG picked together): frame list with sizes, animations,
    warnings.
- Decoding and slicing through the worker; refusals shown in the dialog with their message.
- A `.ngsprite` dropped anywhere in the window opens the dialog for it (a `.ngtilemap` drop is
  TE-047's).
- Import runs the add-tileset command (one entry).

## Acceptance criteria

- [ ] `tests/e2e/te-024-import-png.spec.ts`: grid overlay follows the form; "n tiles" updates;
      Import adds the tileset; undo removes it.
- [ ] `tests/e2e/te-024-import-ngsprite.spec.ts`: defaults applied; counts and warnings shown;
      Import disabled above 256; a dropped `.ngsprite` opens the dialog.
- [ ] `tests/e2e/te-024-import-atlas.spec.ts`: frame list and warnings; mixed sizes refused
      with the frames named.
- [ ] A pixel-limit refusal appears before decoding (no worker decode request sent).

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-024-*`.

## Dependencies and scope

- Depends on TE-007, TE-010, TE-023.
- Out of scope: drop on the Tilesets panel (TE-025), update from source (TE-028).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
