# [TE-023] Tileset import core: sprite projects

Milestone: M3 Tilesets · Size: M · Depends on: TE-022

## Context

A tileset drawn in the sprite editor comes in from its `.ngsprite` without an export step, read
and composited by the sprite editor's own code, and stays bound to its frames (BRIEF §2, §5).
Tags become tile animations.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.1 (`.ngsprite` bullet: defaults, tiles, animations, equivalence).
- [FORMAT.md](../FORMAT.md) §2.4 (`"sprite"` source key).
- `src/core/sprite/project/deserialize.ts`, `composite/compositeFrame.ts`,
  `animation/index.ts` (`expandTag`) (TE-002).
- `se/docs/FORMAT.md` §1 (`.ngsprite` v1).

## Required work

- Read with `core/sprite`; a newer version refused naming both versions.
- Composite each frame with `compositeFrame` (visible pixel layers, opacities, blend modes;
  reference layers left out); slice by tile size, margin, spacing.
- Defaults: the sprite's grid (cell size, offset as margin when not negative) when the cell is
  ≤ 256 a side; else the whole canvas when ≤ 256; else none (the caller must supply a size).
- Tiles: each cell of each frame, frames in order, cells row-major, IDs 0..; a cell equal to the
  same cell of an earlier frame is not a new tile; source key `[frameId, column, row]` of the
  first occurrence.
- Animations: each tag expanded with `expandTag` (repeat ≠ 0 imported as looping with a warning);
  several frames and no tag = one tag over all frames; per grid cell whose pixels change within
  the tag, the cell's tile at the tag's first frame animates through that cell's tiles; a tile
  that would host a second animation keeps the first, warned.
- Fixture pair committed under `tests/fixtures/sprite/`: a `.ngsprite` and the atlas the sprite
  editor at `ea5c91d` exports from it (frames all, no trim).

## Acceptance criteria

- [ ] `tests/unit/te-023-ngsprite.test.ts`: defaults for each of the three cases; dedupe of
      repeated cells; source keys; tag expansion incl. reverse and ping-pong; repeat warning;
      second-animation warning; newer version refused.
- [ ] `tests/unit/te-023-equivalence.test.ts`: with one tile per frame, the tileset has the same
      pixels and animations as the one imported from the fixture atlas (TE-022); only source keys
      differ.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-022.
- Out of scope: the dialog (TE-024), update from source (TE-027).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
