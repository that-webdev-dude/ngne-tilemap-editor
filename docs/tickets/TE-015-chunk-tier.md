# [TE-015] Chunk tier and tier switching

Milestone: M1 Viewport · Size: L · Depends on: TE-014

## Context

Zoomed out, a D1 map shows up to ~524k cells, far above the live tier's 65,536 (BRIEF D11). The
chunk tier draws flattened CPU-composited 32 × 32-cell chunk textures patched by `updateTexture`
(ENGINE §4, spike S2). Painting at overview stays visible on the next frame through live quads.

## Relevant code and documentation

- [ENGINE.md](../ENGINE.md) §3 (editable texture rules, `ed:chunk:*`), §4 (tier choice,
  hysteresis, chunk tier, painting at overview), §6 (budgets, S2 results).
- [SPEC.md](../SPEC.md) §2.2 (cell-store chunk counts), §3 (`touched`).
- `core/compositor` (TE-012), `engine/viewport` (TE-013).

## Required work

- Tier choice from cell-store chunk counts of the view (O(chunks)): enter the chunk tier above
  65,536 once it is built, return at 58,982 or below; live tier draws while the chunk tier
  builds.
- Chunk sets: visible layers sharing parallax and offset flattened into one set with opacity
  baked in; a layer with its own parallax or offset gets its own set.
- Resolution T: largest power of two ≤ device pixels per cell at the switch zoom, reduced until
  chunk GPU memory ≤ 64 MB.
- Build in the background after a map opens, one chunk per slice (≤ 16 ms); rebuild after a
  layer visibility, opacity, parallax or offset change.
- Painting at overview: changed cells drawn as live quads over their chunk on the next frame;
  one `updateTexture` in flight per chunk, later edits coalesced; live quads dropped when the
  patch settles. Each chunk has its own source canvas, unchanged until its update settles.
- Failure handling of ENGINE §3: re-create and repopulate on a dropped registration;
  re-composite and retry on a rejected update; release on eviction, map close, layer delete.

## Acceptance criteria

- [ ] `tests/e2e/te-015-readback.spec.ts`: in the chunk tier at DPR 1 and 1.25, the canvas
      equals the `core/compositor` chunk reference.
- [ ] A pan back and forth across the threshold changes tier at most once each way (E2E).
- [ ] A cell changed by a command at overview is visible in the next submitted frame and in the
      chunk after the patch settles (E2E).
- [ ] A rejected `updateTexture` (test hook) is recovered by re-compositing; no stale pixels.
- [ ] Measured on reference hardware: chunk patch settled after a paint p95 ≤ 100 ms; chunk GPU
      memory ≤ 64 MB; overview rebuild ≤ 500 ms with no task over 16 ms; initial build with no
      task over 16 ms.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-015-*`; perf pages `tests/perf/te-015-*`
  on both reference GPUs; CI report-only.

## Dependencies and scope

- Depends on TE-014.
- Out of scope: painting tools (TE-017 onward drive the same path through commands).

## Documentation

Fills the measured cells of the chunk rows of ENGINE §6.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
