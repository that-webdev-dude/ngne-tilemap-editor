# [TE-013] Viewport renderer and live tier

Milestone: M1 Viewport · Size: L · Depends on: TE-007, TE-009, TE-011, TE-012

## Context

The main viewport is a direct `WebGPURenderer` drawing one quad per visible cell up to 65,536
cells (BRIEF D11, spike S1). It owns the renderer lifecycle of ENGINE §2, the textures of
ENGINE §3 and redraw on demand. The chunk tier (TE-015) builds on it.

## Relevant code and documentation

- [ENGINE.md](../ENGINE.md) §1 (rules), §2 (lifecycle), §3 (textures), §4 (camera, live tier,
  redraw on demand, opacity), §6 (budgets).
- [SPEC.md](../SPEC.md) §3 (`touched`), §7.2 (opacity, parallax, offset drawing).
- [DESIGN.md](../DESIGN.md) §3.3 row `engine/viewport/checker.ts`; §3.4 rows
  `ui/viewport/OverlayCanvas.tsx`, `ViewportArea.tsx`, `ViewportProbe.tsx`; `se-design` §6.
- `core/runtime/emit.ts` (TE-011), `core/pack` (TE-009), `core/compositor` (TE-012).
- `tests/support/referenceProject.ts` (TE-005).

## Required work

- `engine/viewport`: create with an abort signal (tab or project switch, teardown), resize
  without re-creation (retry after `ready()` during recovery), lifecycle observer (`ready` →
  redraw from the CPU document; `failed` → failure notice with Reload), teardown
  (unsubscribe, `dispose`).
- Textures: `ed:ts:<tilesetId>` from `core/pack` when an open map uses the tileset, released
  when none does; `ed:checker` (adapted `checker.ts`).
- Camera: quad positions and sizes scaled into device pixels, `pixelSnap = false`; DPR from the
  host.
- Live tier: visible cells of visible tile layers through the shared emitter, layer by layer,
  grouped by tileset, one depth per layer; effective opacity as alpha; offsets and parallax
  relative to the view centre; background colour; checkerboard.
- Redraw on demand from command `touched`, view and lifecycle changes only.
- Viewport host in the Viewport region, a test hook counting submitted frames.

## Acceptance criteria

- [ ] `tests/e2e/te-013-readback.spec.ts`: at DPR 1 and 1.25 the canvas equals the
      `core/compositor` reference for all 8 orientations of odd and even tiles, a tile offset,
      an opacity layer and a parallax layer.
- [ ] Device loss (wrapped `requestDevice`, as `se/` did) recovers and redraws without input;
      a failed renderer shows the notice with Reload (E2E).
- [ ] Ten window resizes create one renderer only (E2E counter).
- [ ] Idle: 0 frames submitted over 2 s without input (E2E).
- [ ] A tileset texture is released when the last open map using it closes (E2E via the store).
- [ ] Measured on reference hardware (README, Measurements): pan at the live-tier threshold,
      1920 × 1080 at DPR 1 and 1.25, p95 ≤ 10 ms; dropped frames ≤ 1% over a 5 s pan.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-013-*`; perf page under `tests/perf/`
  (`te-013-*`) on both reference GPUs; CI report-only.

## Dependencies and scope

- Depends on TE-007, TE-009, TE-011, TE-012.
- Out of scope: navigation and overlay (TE-014), chunk tier (TE-015), image layers (TE-036),
  highlight current layer (TE-034).

## Documentation

Fills the measured cells of the two pan rows of ENGINE §6 (README, Measurements).

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
