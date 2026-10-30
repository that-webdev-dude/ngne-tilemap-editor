# [TE-022] Tileset import core: grid PNG and atlas

Milestone: M3 Tilesets · Size: M · Depends on: TE-006, TE-009

## Context

Tilesets enter a project by copying their pixels in and giving every tile a stable project-owned
ID with a source key and fingerprint (BRIEF §5, D6). This ticket covers the two simplest sources,
grid PNGs and `ngne-sprite-atlas` files, as pure `core/` conversions plus the add-tileset command.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.1 (grid PNG, atlas, pixel limits, packability, new tilesets).
- [FORMAT.md](../FORMAT.md) §2.4 (Tileset, Source, Tile, fingerprint), §2.8 (limits).
- [BRIEF.md](../BRIEF.md) §5 (tilesets and stable tile IDs).
- `src/core/sprite/export/validateAtlas.ts`, PNG code (TE-002); `core/pack` packability
  (TE-009).

## Required work

- Grid PNG → tileset: tile width and height, margin, spacing; every whole grid cell a tile, IDs
  0.. row-major; partial cells dropped; source keys `[column, row]`; pixels copied into the
  stored grid without margin or spacing.
- Atlas → tileset: checked with `validateAtlas` rules; every frame a tile, IDs 0.. in `frames`
  order, source key = frame ID; frame rebuilt at `sourceW × sourceH` with its content at
  `offsetX, offsetY`; frames of different source sizes or above 256 refused naming the frames;
  pivots ignored; each animation on the tile of its first entry's frame (`ms` kept), `once`
  imported as looping and a second animation on the same frame dropped, both as warnings.
- Fingerprints: SHA-256 of FORMAT §2.4 (alpha-0 pixels as `0, 0, 0, 0`), computed in `core/`
  without DOM globals.
- Pixel limits of FORMAT §2.8 and packability (TE-009) checked before decoding; refusals name the
  limit.
- Export name: slug of the file name, made unique. Add-tileset command: end of list, lowest free
  slot, undo removes it.

## Acceptance criteria

- [ ] `tests/unit/te-022-grid-png.test.ts`: margin and spacing slicing, partial cells, ID order,
      source keys, stored grid.
- [ ] `tests/unit/te-022-atlas.test.ts`: frame rebuild with offsets; mixed-size and > 256
      refusals name the frames; animation, `once` and duplicate-animation warnings.
- [ ] Fingerprints match a reference SHA-256 and ignore RGB under alpha 0.
- [ ] Limit and packability refusals happen before any pixel is decoded (spy on the decoder).
- [ ] Add-tileset passes the TE-006 symmetry harness.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-006, TE-009.
- Out of scope: `.ngsprite` (TE-023), the dialog (TE-024), collections from TMJ (TE-060).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
