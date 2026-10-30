# [TE-058] TMJ fixtures and Tiled check

Milestone: M8 TMJ import · Size: M · Depends on: TE-002

## Context

TMJ import is accepted against fixtures authored for this repo (so their licence is the repo's),
covering every row of BRIEF §7 and three realistic maps, each confirmed once to open in Tiled
1.12.2 (SPEC §13).

## Relevant code and documentation

- [BRIEF.md](../BRIEF.md) §7 (input rows).
- [SPEC.md](../SPEC.md) §13 (Fixtures bullet: required coverage, composite maps, README, manual
  check).
- [reference/tiled.md](../reference/tiled.md) §5 (TMJ/TSJ as Tiled writes them, GID encoding),
  §1 (Tiled 1.12.2).
- PNG and zip code in `src/core/sprite` (TE-002); `fflate` for zlib and gzip.

## Required work

- `tests/fixtures/tmj/build.ts` writes every fixture deterministically, with generated tile and
  image PNGs, following Tiled 1.12.2's JSON and TSX layout.
- At least one file per BRIEF §7 row: isometric and hexagonal maps; infinite; csv, base64
  uncompressed, zlib, gzip and zstd data (zstd written as a frame of raw blocks, which needs no
  encoder dependency); all 8 flip combinations and bit 28 set; image and image-collection tilesets,
  uniform and mixed; embedded, `.tsj` and `.tsx` tilesets; every object shape, rotated, tile, text
  and capsule objects; templates; every property type including class, enum, `object` and
  `list`; tint and blend mode; terrain probabilities and transformations; `transparentcolor`;
  `tilerendersize`.
- Composite maps: a 1000 × 40 side-scroller, a 256 × 256 overworld with groups and parallax, a
  small dungeon with markers and collision.
- `tests/fixtures/tmj/README.md`: which file covers which row, and how each should look in Tiled.

## Acceptance criteria

- [ ] Running `build.ts` reproduces the committed fixtures byte for byte (unit test).
- [ ] `tests/unit/te-058-coverage.test.ts`: every BRIEF §7 row and SPEC §13 coverage item is
      named by at least one README entry whose file exists.
- [ ] Owner check card below passes.

**Owner check — TMJ fixtures in Tiled 1.12.2**

1. With Tiled 1.12.2 installed, open each `.tmj` in `tests/fixtures/tmj/` (File → Open).
2. Expected: every map opens without an error dialog and looks as its README entry describes
   (zstd and isometric/hexagonal maps open in Tiled even though the editor refuses them).
3. Reply `tmj pass`, or `tmj fail: <file> <what differs>`.

## Validation

- `npm run check`; the owner check above.

## Dependencies and scope

- Depends on TE-002.
- Out of scope: conversion (TE-059, TE-060), report goldens (TE-061).

## Documentation

Adds `tests/fixtures/tmj/README.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
