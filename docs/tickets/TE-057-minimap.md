# [TE-057] Minimap

Milestone: M7 Export, runtime and preview · Size: M · Depends on: TE-015

## Context

The Minimap dock section shows the whole map with the viewport's rectangle and pans by drag
(DESIGN §8.8). It is Canvas2D from `core/compositor` (ENGINE §1).

## Relevant code and documentation

- [DESIGN.md](../DESIGN.md) §8.8 (Minimap).
- [ENGINE.md](../ENGINE.md) §1 (secondary views in Canvas2D).
- `core/compositor` (TE-012), view navigation (TE-014).

## Required work

- Dock section: the whole map composited at the dock width (via the worker or in slices so no
  main-thread task exceeds 16 ms), the viewport rectangle as a 1 px `--accent` outline.
- Drag on the minimap pans the viewport.
- Redrawn after a change settles, at most once per 500 ms; stopped while collapsed.

## Acceptance criteria

- [ ] `tests/e2e/te-057-minimap.spec.ts`: the minimap image matches the compositor at its size;
      the rectangle tracks pan and zoom; drag pans; an edit shows within 500 ms of settling and
      redraws are throttled.
- [ ] No main-thread task over 16 ms while redrawing the reference map (long-task observer).

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-057-*`.

## Dependencies and scope

- Depends on TE-015.
- Out of scope: map PNG export (Later).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
