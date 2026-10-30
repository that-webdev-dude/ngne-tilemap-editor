# [TE-036] Image layers

Milestone: M4 Maps, layers and markers · Size: M · Depends on: TE-035

## Context

Image layers draw one project image at the layer's shift, optionally repeated (SPEC §7.2,
FORMAT §3.4). Images are project-level, deduplicated by pixels and removed with their last use.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §7.2 (image layers, dedupe, removal on last use).
- [FORMAT.md](../FORMAT.md) §2.4 (Image), §2.8 (pixel limits), §3.4 (position, repeat).
- [ENGINE.md](../ENGINE.md) §3 (`ed:img:<layerId>`), §4 (image layers, repeat as a quad grid).
- Worker (TE-010), layer commands (TE-034), panel popover (TE-035).

## Required work

- New Image Layer…: pick an image of the project or import a PNG (≤ 8192 px a side, pixel limits
  checked before decoding, decoded in the worker to straight RGBA8); name from the file, export
  name its slug made unique; a PNG equal to an existing image reuses it.
- An image no layer of any map uses is removed in the command that removed its last use; undo
  restores both.
- Viewport: one texture per image layer, drawn at the layer's shift with opacity; repeat X/Y as a
  quad grid covering the view; included in chunk-tier compositing.
- Popover fields: image and repeat X/Y.

## Acceptance criteria

- [ ] `tests/unit/te-036-images.test.ts`: dedupe by pixels; removal with the last use and
      restore on undo; commands pass the TE-006 symmetry harness.
- [ ] `tests/e2e/te-036-image-layer.spec.ts`: import, repeat X, repeat Y and parallax match the
      compositor reference (readback) in both tiers; a PNG above 8192 px is refused before
      decoding.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-036-*`.

## Dependencies and scope

- Depends on TE-035.
- Out of scope: image export (TE-053).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
