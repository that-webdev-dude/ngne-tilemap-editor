# [TE-016] Tool framework and cell pointer pipeline

Milestone: M2 Tile tools · Size: M · Depends on: TE-014

## Context

Every tile and marker tool runs through one pointer pipeline that maps pointer events to cells,
joins drags without gaps, enforces the active-layer rules and wraps a stroke in a transaction
(SPEC §4.1, §3). Tools, the tool rail and the context bar are registries (RULES 6).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §3 (stroke transactions, abort), §4.1 (pointer pipeline, layer rules,
  clipping), §4.3 (Hand, Zoom).
- [DESIGN.md](../DESIGN.md) §3.2 rows `ui/tools/contextBarRegistry.ts`,
  `app/tools/registry.ts`, `app/tools/toolRegistry.ts`; §3.3 rows `ui/tools/*`,
  `core/raster/line.ts`; §3.4 row `app/tools/pipeline.ts` (and siblings); §6 (tool rail);
  §10.1 (`gesture` context); §10.3 (H, Z).
- [reference/tiled.md](../reference/tiled.md) §3 (tools, `pointsOnLine`).

## Required work

- Copy the registries; adapt `VariantToolButton`, `useToolState`, `toolRail.css`,
  `contextBar.css` to this editor's active-tool store.
- Pipeline (pattern of `se/` `pipeline`, `attachToolPointer`, `activeTool`, `options`): map
  pixels through the inverse view transform, cells by `floor`, coalesced events, drags joined by
  `pointsOnLine` (adapted `core/raster/line.ts`, Tiled's endpoints).
- Active-layer rules: a hidden or locked layer, or one under a hidden or locked group, refuses
  with a status-bar message and no change; a tile tool on a non-tile layer does nothing and says
  so; painting clipped to the map.
- Stroke transaction per gesture: commit on release; abort on Escape, pointer cancel or a right
  click during a drag.
- Tool rail by active layer kind (DESIGN §6), each kind keeping its last tool; Hand and Zoom
  tools; context bar host; `gesture` key context while a multi-click gesture is open.

## Acceptance criteria

- [ ] `tests/unit/te-016-line.test.ts`: `pointsOnLine` gives Tiled's cells for a table of
      endpoints, including steep, shallow and reversed lines.
- [ ] `tests/e2e/te-016-pipeline.spec.ts` with a probe tool: a fast drag changes every crossed
      cell; Escape mid-drag restores the cells; a locked layer refuses with "Layer is locked";
      painting outside the map changes nothing.
- [ ] The rail shows the tile tool set on a tile layer and only Hand and Zoom on a group layer;
      switching layer kinds restores each kind's last tool (E2E).
- [ ] Hand drag pans; Zoom click zooms in, Alt+click out; H and Z select them (E2E).

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-016-*`.

## Dependencies and scope

- Depends on TE-014.
- Out of scope: the tile tools themselves (TE-017 to TE-020), marker tools (TE-038).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
