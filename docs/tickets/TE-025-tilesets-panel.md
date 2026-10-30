# [TE-025] Tilesets panel

Milestone: M3 Tilesets · Size: L · Depends on: TE-017, TE-024

## Context

The Tilesets tab of the bottom panel is where users pick tiles: tabs per tileset, a zoomable
Canvas2D grid, and a click or drag that makes the current stamp (SPEC §6.2, DESIGN §8.5).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §4.2 (stamp from a tileset selection), §6.2 (panel).
- [DESIGN.md](../DESIGN.md) §4 (tile marks), §8.5 (Tilesets panel), §8.7 (status bar tile
  fields), §10.1 (`panel` context), §10.3 (`[`, `]`), §10.4 (keyboard alternatives).
- [ENGINE.md](../ENGINE.md) §1 (secondary views are Canvas2D).

## Required work

- Tabs per tileset (24 px metrics) with New Tileset (+) → Import Tileset…; right side class
  filter and zoom select (1×–8×).
- Canvas2D grid of tiles in display order on the checkerboard, 1 px `--border` gaps; selection
  rectangle with a 2 px `--accent` outline; click or drag a rectangle → current stamp laid out
  as in the panel.
- Keyboard: one tab stop; arrows move, Shift extends, Enter makes the stamp; `[` and `]` previous
  and next tileset (canvas and panel contexts).
- Tile marks: properties or class (corner triangle), animated (`▶`), collision (square).
- Tile menu (Menu key, overflow) as a registry the tile editors (TE-029, TE-030) and Properties
  (TE-040) add to.
- Status bar: ID and class of the hovered and the selected tile.
- Files dropped on the panel import as tilesets.

## Acceptance criteria

- [ ] `tests/e2e/te-025-panel.spec.ts`: a drag over 3 × 2 tiles makes a 3 × 2 stamp that paints
      those tiles; tabs switch tilesets; `[` and `]` cycle; zoom changes the grid scale.
- [ ] Keyboard selection and Enter make the same stamp as the pointer (E2E).
- [ ] Class filter hides non-matching tiles; marks appear for tiles with class, animation and
      collision (canvas readback at known positions).
- [ ] A PNG dropped on the panel opens the import dialog.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-025-*`.

## Dependencies and scope

- Depends on TE-017, TE-024.
- Out of scope: tileset commands and properties (TE-026), Terrains tab (TE-043).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
