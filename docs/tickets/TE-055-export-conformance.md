# [TE-055] Export conformance

Milestone: M7 Export, runtime and preview · Size: L · Depends on: TE-052, TE-053

## Context

Export is accepted only when a real NGNE game draws it pixel for pixel as the compositor does,
for every orientation and odd size, with no neighbour texel bleeding (SPEC §10.3). The same game
measures the runtime budget (ENGINE §6, spike S4).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §10.2 (why no gap is needed), §10.3 (conformance conditions), §11.4
  (`latest` check runs the conformance draw).
- [FORMAT.md](../FORMAT.md) §1.2, §1.3, §4.
- [ENGINE.md](../ENGINE.md) §6 (game runtime budget).
- `se/tests/fixtures/ngne-consumer/game.ts`, `se/tests/e2e/harness/se-053-*` (pattern).
- Export pipeline (TE-053), `core/compositor` (TE-012), compat folders (TE-052).

## Required work

- Reference export project and FORMAT fixtures covering all 8 orientations of odd and even tile
  sizes, a tile larger than the grid, a tile offset, a parallax layer, an opacity layer.
- `tests/fixtures/game` (`@ngne/core` 0.3.0): imports the exported `ngne-tilemap.ts`, draws every
  map at scale 1 and 3 with `pixelSnap` on, and at scale 1.25.
- Checks: every atlas passes `validateAtlas` and FORMAT §4; every tilemap passes
  `validateTilemap`; export → `readTilemap` round trip equals the project; canvas readback equals
  the `core/compositor` reference at scales 1 and 3 (opacity within 1 per channel); at 1.25 every
  drawn pixel's colour belongs to the tile drawn there; at DPR 1.25 as well.
- The weekly `latest` job (TE-052) also runs this draw, report-only.
- Runtime budget page: stacked HUD scene, `pixelSnap` on, animations on, panning.

## Acceptance criteria

- [ ] `tests/e2e/te-055-conformance.spec.ts`: the three conditions of SPEC §10.3 hold for every
      fixture, locally and under CI SwiftShader.
- [ ] `tests/unit/te-055-roundtrip.test.ts`: cells, flags, properties, collision and markers
      equal after export → `readTilemap`.
- [ ] The `latest` weekly job includes the conformance draw.
- [ ] Measured on reference hardware: 480 × 270 ×3 p95 `game.stats.renderMs` ≤ 8 ms on Intel UHD;
      1920 × 1080 ×1 with 8 full layers recorded.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-055-*`; perf page `tests/perf/te-055-*`.

## Dependencies and scope

- Depends on TE-052, TE-053.
- Out of scope: the in-editor preview (TE-056).

## Documentation

Fills the measured cells of the game runtime rows of ENGINE §6.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
