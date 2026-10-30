# [TE-014] View navigation, overlay and status bar

Milestone: M1 Viewport · Size: M · Depends on: TE-013

## Context

Navigation is the sprite editor's, with two extra zoom steps for overview (SPEC §4.1). The
Canvas2D overlay takes all pointer input and draws grid and tool chrome through the overlay
registry (ENGINE §4, SUITE §4). The status bar shows cell, tile, zoom and map size.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §4.1 (navigation, zoom steps, grid threshold), §3 (view per map, view
  preferences).
- [DESIGN.md](../DESIGN.md) §3.2 rows `app/overlay/overlayLayers.ts`, `app/view/wheel.ts`;
  §3.3 rows `app/view/*`, `app/overlay/*`; §3.4 rows `app/state/status.ts`,
  `ui/status/statusFields.ts`; §4 (tile grid); §8.7 (status bar); §10.3 (keys 1–6, 0, Space,
  wheel, Ctrl+G).

## Required work

- Copy and adapt the view files: zoom steps 1/32 and 1/16 added below the sprite editor's;
  coordinates in map pixels and cells; wheel zoom about the cursor, Shift+wheel pan, middle drag
  and Space-drag pan; Zoom In, Zoom Out, Fit, 100% (View menu), keys 1–6 and 0.
- Per-map view (centre, zoom) in `MapSession`.
- Overlay controller, draw orders, `gridLines` for the cell grid: 1 device px, 25% alpha,
  shown from 4 device px per cell; Show Grid (View, Ctrl+G) in the view preferences.
- Status bar fields: cell `x, y` (blank off the map), tile under the cursor `tileset#id` and its
  class, zoom with Fit, map size `w × h cells`; right side for tool hints and transient
  feedback in `--warn`. Fields register from their own modules, so later tickets add fields
  without editing a shared file.

## Acceptance criteria

- [ ] `tests/unit/te-014-coordinates.test.ts` (fast-check): screen → map → screen round trips at
      every zoom step and DPR 1 and 1.25.
- [ ] `tests/e2e/te-014-navigation.spec.ts`: wheel zoom keeps the map pixel under the cursor;
      keys 1–6 and 0 set the zoom; Space-drag and middle drag pan; zoom and centre are kept per
      map.
- [ ] Grid lines land on cell edges in a canvas readback and appear only from 4 device px per
      cell; Ctrl+G toggles them and the setting survives reload.
- [ ] Status fields show the hovered cell and tile, and blank off the map.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-014-*`.

## Dependencies and scope

- Depends on TE-013.
- Out of scope: Hand and Zoom tools (TE-016), selection size field (TE-020), marker count
  (TE-039).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
