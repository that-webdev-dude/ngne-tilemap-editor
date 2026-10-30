# [TE-030] Tile animation editor

Milestone: M3 Tilesets · Size: M · Depends on: TE-025

## Context

A tile is animated when its frame list is not empty; frames are tiles of the same tileset with a
duration (SPEC §6.4, FORMAT §2.4). Imported animations are edited here.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.4 (animation editor).
- [FORMAT.md](../FORMAT.md) §2.4 (AnimationFrame, limits).
- [DESIGN.md](../DESIGN.md) §9 (Animation Editor row).

## Required work

- Dialog from the tile menu or Tileset menu Edit Animation…: frame list (thumbnail, duration
  field, drag handle); add by dragging from the tileset grid or "Add from selection"; default
  100 ms; edit one or many durations; reorder by drag; delete; looping preview at 1×–4×; Close.
- Each edit a command in the project history; limits (1024 frames per tile, 65,536 per tileset)
  refused.

## Acceptance criteria

- [ ] `tests/e2e/te-030-animation.spec.ts`: add from selection, reorder, edit durations (one
      and many), delete; each undoable; the tile gains and loses its animated mark.
- [ ] The preview advances frames at their durations (E2E with a mocked clock).
- [ ] Every animation command passes the TE-006 symmetry harness.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-030-*`.

## Dependencies and scope

- Depends on TE-025.
- Out of scope: playback in the game preview (TE-056).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
