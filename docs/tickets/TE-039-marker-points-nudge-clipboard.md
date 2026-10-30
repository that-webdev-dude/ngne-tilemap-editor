# [TE-039] Marker edit points, nudge and clipboard

Milestone: M4 Maps, layers and markers · Size: M · Depends on: TE-038

## Context

Polygons and polylines are reshaped vertex by vertex; markers nudge with the arrows and copy
between maps with new IDs (SPEC §8).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §8 (edit points, nudge, copy/paste rules).
- [DESIGN.md](../DESIGN.md) §4 (vertices as 5 px squares), §8.7 (marker count), §10.3 (O,
  arrows, Shift+arrows, Ctrl+X/C/V, Delete), §10.4 (vertex keyboard alternative).
- Cell clipboard (TE-021).

## Required work

- Edit points (O): drag a vertex; double click on an edge inserts one; delete a vertex (a polygon
  keeps at least 3 points, a polyline at least 2); arrow nudge on the selected vertex.
- Arrows nudge selected markers 1 px, Shift+arrows one cell (`markers` context).
- Copy, cut, paste of markers within and between maps: geometry and positions kept, new IDs.
  Paste into the active layer when it is an unlocked visible marker layer, selecting the pasted
  markers; otherwise refused with a status-bar message. The clipboard holds cells or markers:
  the last copy wins.
- Status bar shows the marker selection count.

## Acceptance criteria

- [ ] `tests/e2e/te-039-edit-points.spec.ts`: drag, insert, delete with the minimums; vertex
      nudge by keyboard; each undoable.
- [ ] `tests/e2e/te-039-clipboard.spec.ts`: copy between two maps gives new IDs at the same
      positions; paste on a tile layer is refused with the message; a cell copy after a marker
      copy replaces it.
- [ ] Nudge by 1 px and by one cell (E2E).

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-039-*`.

## Dependencies and scope

- Depends on TE-038.
- Out of scope: marker rotation (Later).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
