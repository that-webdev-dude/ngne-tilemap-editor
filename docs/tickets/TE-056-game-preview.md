# [TE-056] Game preview

Milestone: M7 Export, runtime and preview · Size: L · Depends on: TE-015, TE-051

## Context

The Preview dock section runs the current map through the same generated runtime the export
writes, in a `BrowserGame`, so what the user sees is what the game draws (ENGINE §5, SPEC §12).

## Relevant code and documentation

- [ENGINE.md](../ENGINE.md) §1 (one renderer per canvas), §5 (preview architecture), §7
  (BrowserGame gaps).
- [SPEC.md](../SPEC.md) §12 (preview behaviour), §3 (`touched`).
- [DESIGN.md](../DESIGN.md) §3.4 row `ui/preview/PreviewPanel.tsx`; §8.4 (Preview section).
- Runtime source (TE-050, TE-051), `core/pack` (TE-009), `tilemapFor` (TE-049).

## Required work

- `engine/preview`: `BrowserGame` on its own canvas; one scene drawing the current map with
  `drawTilemap`, `pixelSnap` on, animations playing; atlases packed in memory and delivered
  through `SceneDefinition.assets` with an `ImageAsset` loader over in-memory bitmaps.
- Dock section "Preview · NGNE": resolution (320 × 180, 480 × 270, 640 × 360, 1280 × 720),
  integer scale (largest that fits or chosen), play/pause, layer filter (all visible / this
  layer and below); diagnostics in `--warn`.
- One `Tilemap` built by `tilemapFor` and `readTilemap`; on a command's `touched`: changed cells
  written into the layer's `data` and the layer `invalidate`d; other map changes rebuild the
  `Tilemap`; a tileset change restarts the scene.
- Camera follows the viewport centre; stopped while the section is collapsed or the window
  hidden.

## Acceptance criteria

- [ ] `tests/e2e/te-056-preview.spec.ts`: preview readback equals the conformance reference for
      the current map at the chosen resolution and scale; a painted cell appears in the next
      preview frame; a tileset update restarts the scene with the new pixels.
- [ ] Layer filter and play/pause act as specified; animation advances only while playing.
- [ ] Collapsing the section or hiding the window stops frame submission (counter).

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-056-*`.

## Dependencies and scope

- Depends on TE-015, TE-051.
- Out of scope: in-editor playtest (non-goal).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
