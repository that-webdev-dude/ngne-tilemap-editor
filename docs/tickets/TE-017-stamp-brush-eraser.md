# [TE-017] Current stamp, stamp brush and eraser

Milestone: M2 Tile tools · Size: L · Depends on: TE-016

## Context

Painting starts with the current stamp, the stamp brush and the eraser (SPEC §4.2, §4.3). This
ticket also sets the paint-latency budget of ENGINE §6.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §4.2 (current stamp, anchor), §4.3 (stamp brush, eraser rows).
- [DESIGN.md](../DESIGN.md) §2 (stamp preview in the rail), §4 (stamp and erase previews), §7
  (context bars), §10.3 (B, E).
- [ENGINE.md](../ENGINE.md) §6 (paint budget).
- [reference/tiled.md](../reference/tiled.md) §3 (`stampbrush.cpp`, eraser).

## Required work

- Current stamp: a rectangle of cell values (empty allowed), anchor `floor(w/2), floor(h/2)`;
  settable from code until the Tilesets panel (TE-025) and clipboard (TE-021) feed it.
- Overlay preview: stamp tiles at 60% opacity over the cells they would paint, 1 px `--accent`
  outline; erase preview 1 px `--danger` outline. Rail stamp preview (≤ 28 × 28 px; a click
  selects the stamp brush).
- Stamp brush: press and drag paint at each crossed cell; empty stamp cells leave the map;
  Shift+click a line of stamps from the last painted point; Ctrl+Shift+click an ellipse of stamps
  centred on the last painted point through the cursor.
- Eraser: drag erases (line-interpolated); right drag erases a rectangle; Shift (or the context
  bar's All layers) erases on all unlocked visible tile layers.
- Context bars: stamp size readout; eraser All layers. Status-bar modifier hints.

## Acceptance criteria

- [ ] `tests/e2e/te-017-stamp-brush.spec.ts`: paint, undo, redo; one entry per stroke; empty
      stamp cells keep the map; Shift line and Ctrl+Shift ellipse paint the cells Tiled paints
      for the same points (golden cell lists).
- [ ] `tests/e2e/te-017-eraser.spec.ts`: drag, right-drag rectangle and Shift all-layers erase,
      each one entry; locked layers untouched.
- [ ] Preview drawn at the cursor and absent off the map (overlay readback).
- [ ] Measured on reference hardware: paint, pointer event → frame containing it submitted,
      p95 ≤ 33 ms on the reference map.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-017-*`; perf page `tests/perf/te-017-*`.

## Dependencies and scope

- Depends on TE-016.
- Out of scope: stamp transforms and capture (TE-018), selection clipping (TE-020).

## Documentation

Fills the measured cell of the paint row of ENGINE §6.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
