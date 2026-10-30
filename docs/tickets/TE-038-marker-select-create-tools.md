# [TE-038] Marker select and create tools

Milestone: M4 Maps, layers and markers · Size: L · Depends on: TE-016, TE-037

## Context

Markers are made and arranged with Tiled's object tools for these shapes, with the sprite
editor's keys (SPEC §8, DESIGN §6, §10.3).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §8 (tools, snapping, modifiers).
- [DESIGN.md](../DESIGN.md) §3.3 row `app/selection/transform/handles.ts`; §6 (marker tool
  set); §7 (marker context bars); §10.1 (`markers`, `gesture` contexts); §10.3 (V, U, Shift+U,
  P, Shift+D, L, Enter, Backspace, Escape, Delete).
- [reference/tiled.md](../reference/tiled.md) §3 (object tools).

## Required work

- Select (V): click, Shift-click adds, rubber band; drag moves; 8 handles resize rectangles and
  ellipses (adapted handles); Delete removes.
- Create: Rectangle and Ellipse (U, Shift+U), Point (P), Polygon (Shift+D), Polyline (L): click
  points, Enter finishes, Escape cancels, Backspace removes the last point.
- Snap to grid on by default (context toggle, Snap to Grid view preference); Ctrl inverts while
  moving; Ctrl keeps aspect while resizing; Alt inverts snapping while resizing.
- Context bars: Select shows X, Y, W, H of the selection's box and Snap; create tools show Snap.
- `MapSession.markerSelection`; marker tool rail on marker layers.

## Acceptance criteria

- [ ] `tests/e2e/te-038-create.spec.ts`: each create tool makes its shape with snapped
      coordinates; Enter, Escape and Backspace behave as specified; each creation is one entry.
- [ ] `tests/e2e/te-038-select.spec.ts`: click, Shift-click, rubber band; move and resize with
      every modifier; context-bar fields edit the box; Delete removes; all undoable.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-038-*`.

## Dependencies and scope

- Depends on TE-016, TE-037.
- Out of scope: edit points, nudge and marker clipboard (TE-039).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
