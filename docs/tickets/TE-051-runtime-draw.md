# [TE-051] Runtime `drawTilemap`

Milestone: M7 Export, runtime and preview · Size: M · Depends on: TE-050

## Context

`drawTilemap` is how a game scene draws a tilemap with no editor code (BRIEF §6). It uses the
shared emitter, never throws, and leaves depth slots for game sprites between map layers
(SPEC §11.2).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §11.2 (`drawTilemap` bullets), §11.3 (allocation-free inner loop),
  §11.4 (engine contract).
- [FORMAT.md](../FORMAT.md) §1.2, §1.3, §3.4 (parallax shift, image layers).
- [ENGINE.md](../ENGINE.md) §7 (gaps the runtime works around).
- `core/runtime/emit.ts` (TE-011), runtime source (TE-050).

## Required work

- `drawTilemap(frame, tilemap, camera, options)`: visible tile and image layers or those
  `options.layers` accepts, bottom to top; layer `i` at engine `layer` `options.layer ?? 0` and
  depth `(options.depth ?? 0) + i`; world units = map pixels × `options.scale`; view = camera
  plus `viewWidth × viewHeight`, its centre giving the parallax shift; culling through the
  emitter.
- Tile animation from `options.elapsedMs` (required), one clock from 0 for all tiles.
- Alpha = layer opacity × `options.alpha`; `options.color` on every sprite.
- Image layers at the layer's shift; repeat as a grid of quads covering the view.
- Missing textures (`options.assets.has(id)` false) skipped and reported once per tilemap and
  tileset through `options.report` (default `console.warn`); never throws.

## Acceptance criteria

- [ ] `tests/unit/te-051-draw.test.ts` with a recording sink: depth and layer per map layer;
      layer filter; scale; parallax shift at two camera positions; animation frame at given
      `elapsedMs`; alpha and colour; image repeat covers the view.
- [ ] A missing tileset texture is skipped and reported once over many frames; nothing throws for
      any malformed `options` value the types allow.
- [ ] The sink receives one reused sprite object.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-050.
- Out of scope: pixel conformance and the runtime budget (TE-055), compile matrix (TE-052).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
