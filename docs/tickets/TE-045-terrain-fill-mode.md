# [TE-045] Terrain fill mode

Milestone: M5 Terrain · Size: S · Depends on: TE-019, TE-044

## Context

Bucket fill and shape fill share a Fill mode toggle: Tile (stamp) or Terrain. In Terrain mode
they fill their region with the selected terrain (SPEC §5.4, §4.3).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §4.3 (fill-mode toggle), §5.4 (Terrain fill mode).
- [DESIGN.md](../DESIGN.md) §7 (Fill: Tile / Terrain).
- Fill tools (TE-019), terrain brush context (TE-044), `core/terrain` (TE-041).

## Required work

- Add **Terrain** to the Fill mode control of bucket fill and shape fill, with the terrain set
  and terrain pickers of the brush.
- Terrain mode: the region painted with every index of every cell set, border seeding from
  outside neighbours, corrections off; one entry.

## Acceptance criteria

- [ ] `tests/e2e/te-045-terrain-fill.spec.ts`: on the TE-042 fixtures (loaded through a test
      hook), the scripted fill-mode strokes (bucket and shape fill) give the goldens; undo
      restores.
- [ ] The mode persists per tool across tool switches (E2E).

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-045-*`.

## Dependencies and scope

- Depends on TE-019, TE-044.
- Out of scope: automapping (Later).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
