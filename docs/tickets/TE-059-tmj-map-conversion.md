# [TE-059] TMJ map conversion

Milestone: M8 TMJ import · Size: L · Depends on: TE-005, TE-058

## Context

`core/tmj` converts a Tiled map into a new project map without touching the project until the
user accepts the report (SPEC §13). This ticket covers the map, its layers, cells, objects and
properties; tilesets are TE-060.

## Relevant code and documentation

- [BRIEF.md](../BRIEF.md) §7 (map, layer, object and property rows).
- [SPEC.md](../SPEC.md) §13 (Conversion bullets for IDs, tile layers, infinite maps, colours,
  object layers, templates, classes, render order).
- [reference/tiled.md](../reference/tiled.md) §5 (TMJ map, layer, object, property, GID).
- [FORMAT.md](../FORMAT.md) §1.2 (cell values), §2.5 (map members, limits).
- Fixtures (TE-058).

## Required work

- Parse `.tmj` / `"type": "map"` JSON (no DOM in `core/`). Refuse non-orthogonal maps and `zstd`
  ("re-save in Tiled with zlib or gzip").
- Tile layers: `csv`, `base64` uncompressed, `zlib`, `gzip` (`fflate`); GIDs decoded with `>>> 0`,
  bits 31/30/29 kept, bit 28 cleared; local IDs via `firstgid`.
- Infinite maps: union of used chunks becomes the map; every layer and marker moves by the same
  offset, reported in cells.
- Layer IDs, object IDs (→ marker IDs), `nextlayerid`, `nextobjectid` kept; groups; image layers;
  colours `#AARRGGBB` / `#RRGGBB`; opacity `round(255 × o)`; fractional offsets rounded
  (reported); parallax.
- Object layers → marker layers (layer `color` kept); templates merged first; rectangles, points,
  ellipses, polygons, polylines kept; rotation dropped; tile, text and capsule objects dropped;
  `visible: false` objects imported visible; all reported.
- Properties: `object`, `list`, class-typed dropped; enums as their value; classes kept as class
  strings; tint and blend mode dropped; `renderorder` other than `right-down` reported.
- A report model: every dropped or changed item grouped by BRIEF §7 row, with counts and
  locations.

## Acceptance criteria

- [ ] `tests/unit/te-059-map.test.ts`: per fixture row, the converted map and report entries;
      refusals for isometric, hexagonal and zstd maps.
- [ ] fast-check: GID decoding keeps H/V/D, clears bit 28 and maps to the right local ID.
- [ ] Infinite map offset applied equally to layers and markers and stated in cells.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-005, TE-058.
- Out of scope: tilesets (TE-060), file picking, dialog and golden reports (TE-061).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
