# [TE-012] CPU compositor and map thumbnails

Milestone: M1 Viewport · Size: M · Depends on: TE-005

## Context

NGNE has no texture readback (ENGINE §7). The `core/` compositor produces the chunk-tier
textures, thumbnails, the minimap and the pixel references that viewport and export tests
compare against (SPEC §1, §10.3). As a test reference it must not share placement code with the
emitter it checks.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §1 (`core/compositor` row), §10.3 (reference pixels).
- [FORMAT.md](../FORMAT.md) §1.2, §1.3 (placement), §2.5 (effective values), §2.7 (thumbnail
  rules), §3.4 (parallax shift).
- [ENGINE.md](../ENGINE.md) §4 (chunk tier: 32 × 32 cells, T texels per cell, opacity baked in).

## Required work

- `core/compositor`: composite a rectangle of a map (tile and image layers, background colour)
  into straight RGBA8 at 1 pixel per map pixel or at T texels per cell (nearest sampling), with
  orientations, tile offsets, tiles larger than the grid, effective opacity, offsets and parallax
  at a given view centre, image-layer repeat. Source-over blending as NGNE draws it.
- Placement computed from FORMAT §1.2–§1.3 independently of `core/runtime/emit.ts`.
- Recomposite of a dirty rectangle equal to the same rectangle of a full composite.
- Thumbnail of FORMAT §2.7: size rule and nearest mapping, no parallax, markers or animation.

## Acceptance criteria

- [ ] `tests/unit/te-012-compositor.test.ts`: golden images for all 8 orientations of odd and
      even tiles, a tile offset, a tile larger than the grid, layer and group opacity, a
      parallax layer at two view centres, image-layer repeat X and Y.
- [ ] fast-check: dirty-rectangle recomposite equals the full composite in that rectangle.
- [ ] Thumbnails: a 1000 × 40 map of 16 px gives 128 × 5; a map within 128 px keeps its size;
      sampled pixels follow the FORMAT §2.7 formula.
- [ ] Lint or test: `core/compositor` does not import `core/runtime/emit.ts`.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-005.
- Out of scope: chunk textures (TE-015), minimap (TE-057), writing thumbnails to files (TE-046).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
