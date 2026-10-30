# [TE-009] Tileset packing and packability check

Milestone: M1 Viewport · Size: M · Depends on: TE-002, TE-005

## Context

Export, the viewport's tileset textures and the game preview all use one packed atlas per
tileset, produced by the sprite editor's own packer (BRIEF D8, ENGINE §3, SPEC §10.2). Imports
must refuse tilesets that could not be packed (SPEC §6.1), checked without pixels.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §6.1 (packability), §10.2 (packing, why no gap).
- [FORMAT.md](../FORMAT.md) §4 (tileset atlas rules).
- [ENGINE.md](../ENGINE.md) §3 (`ed:ts:<tilesetId>` uses the packed atlas).
- `src/core/sprite/export/pack.ts`, `src/core/sprite/export/validateAtlas.ts` (TE-002).

## Required work

- `core/pack`: pack a tileset with `pack` of `core/sprite`, unchanged, given the tiles in ID
  order and `layout: "grid"`, `padding: 0`, `extrude: 1`, `trim: false`,
  `mergeDuplicates: true`; turn the result into the atlas of FORMAT §4 (frame IDs
  `<name>-<tileId>`, `sourceW/H` = tile size, offsets 0, even `w`/`h`, pivot `[0, 1]`, one
  `loop` animation per animated tile).
- Expose the same result as image + UV table for the viewport and preview.
- Packability check from the packer's layout only, without pixels: `⌈√r⌉ × (w + 2) ≤ 8192` and
  `⌈r / ⌈√r⌉⌉ × (h + 2) ≤ 8192` for `r` distinct tiles of even size `w × h`.
- An image above 8192 px fails with an error naming the tileset.

## Acceptance criteria

- [ ] `tests/unit/te-009-pack.test.ts`: every packed atlas passes `validateAtlas` and FORMAT §4;
      same tileset → same bytes; identical tiles share one rectangle; an odd tile's extra column
      and row and its ring are transparent.
- [ ] Packability: 961 tiles of 256 × 256 pass, 962 are refused with the limit in the message.
- [ ] fast-check: the layout-only check agrees with a real pack on random tile counts and sizes.
- [ ] Overflow error names the tileset.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-002, TE-005.
- Out of scope: export files (TE-053), viewport upload (TE-013), import refusal UI (TE-024).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
