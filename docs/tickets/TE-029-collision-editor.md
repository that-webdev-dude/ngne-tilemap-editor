# [TE-029] Tile collision editor and Show Collision

Milestone: M3 Tilesets · Size: L · Depends on: TE-025

## Context

Each tile carries collision shapes (rectangle, ellipse, polygon) that games read through the
runtime (BRIEF §4, §6). They are edited in a dialog per tile and shown on the map with
View → Show Collision (SPEC §6.4, DESIGN §4).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.4 (collision editor), §3 (view preferences).
- [FORMAT.md](../FORMAT.md) §1.5 (shapes), §2.4 (Tile `collision` limits and range).
- [DESIGN.md](../DESIGN.md) §3.3 rows `app/selection/transform/handles.ts`,
  `ui/import/PixelCanvas.tsx`; §4 (collision outlines); §9 (Collision Editor row).

## Required work

- Large dialog from the tile menu, Tileset menu Edit Collision… or a double click on a tile:
  tool strip (select, edit points, rectangle, ellipse, polygon, snap), tile canvas
  (`PixelCanvas`, zoom 1–32), shape list with X/Y/W/H fields; Close.
- Tools: rectangle, ellipse, polygon (click points; Enter or a click on the first point closes;
  Backspace removes the last point; Escape cancels); select/move/resize with handles; edit
  points (drag a vertex; double click on an edge adds; Delete removes, never below three).
- Snap to whole pixels by default; Ctrl inverts while held. Shapes may extend outside the tile
  within FORMAT limits.
- Each edit is a command in the project history; with several tiles selected, applying copies the
  shape list to each (one entry).
- Show Collision (View, off by default, view preference): 1 px `--accent` outlines of every
  visible tile's shapes, transformed with the tile's orientation, on the overlay.

## Acceptance criteria

- [ ] `tests/e2e/te-029-collision.spec.ts`: draw each shape kind, edit points, move and resize;
      undo/redo each; multi-tile apply is one entry; limits (64 shapes, 1024 points) refused.
- [ ] Show Collision outlines a flipped and a rotated tile's shapes where FORMAT §1.2 places
      them (overlay readback); the setting survives reload.
- [ ] Every collision command passes the TE-006 symmetry harness.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-029-*`.

## Dependencies and scope

- Depends on TE-025.
- Out of scope: runtime collision functions (TE-050).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
