# [TE-043] Terrains panel

Milestone: M5 Terrain · Size: L · Depends on: TE-025, TE-032, TE-041

## Context

Terrain sets are authored in the Terrains tab of the bottom panel: sets and terrains in a list,
tiles marked by clicking their corners and edges (SPEC §5.1, DESIGN §8.6).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §5.1 (editing, type change, assignment, missing combinations).
- [DESIGN.md](../DESIGN.md) §8.6 (Terrains panel), §10.1 (`panel` context).
- [FORMAT.md](../FORMAT.md) §2.4 (TerrainSet, TerrainColor, TerrainTile; limits).
- `core/terrain` analysis (TE-041); Tilesets panel grid (TE-025); `ColourPicker` (TE-032).

## Required work

- Commands: add, rename, delete and reorder sets and terrains; terrain colour and icon tile; a
  set's type change clears indexes the new type does not use in the same entry; assign a terrain
  to one index, clear an index, assign the whole tile.
- Panel: left column (200 px) of the active tileset's sets, each expandable to its terrains
  (colour chip, name, icon tile), type select per set; right the tileset grid with the selected
  set's marks (corner dots, edge bars in terrain colours).
- Click a tile's corner or edge to assign the selected terrain (index picked as the brush picks
  it, SPEC §5.3); right click clears; Shift+click assigns the whole tile.
- "Missing combinations: n" with a disclosure listing them as small diagrams (corner and edge
  sets).

## Acceptance criteria

- [ ] `tests/unit/te-043-terrain-commands.test.ts`: each command passes the TE-006 symmetry
      harness; a type change clears exactly the unused indexes.
- [ ] `tests/e2e/te-043-panel.spec.ts`: assigning corners, edges and whole tiles gives the
      expected `wangId`s; right click clears; marks drawn at the right places (readback);
      the missing count updates.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-043-*`.

## Dependencies and scope

- Depends on TE-025, TE-032, TE-041.
- Out of scope: the terrain brush (TE-044).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
