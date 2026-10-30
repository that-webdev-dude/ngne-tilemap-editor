# [TE-060] TMJ tileset conversion

Milestone: M8 TMJ import · Size: L · Depends on: TE-022, TE-059

## Context

Tiled tilesets arrive embedded, as `.tsj`, or as `.tsx` (XML), and as image or image-collection
tilesets. Each becomes a project tileset with stable IDs, collision, animations and terrain sets,
or is refused (BRIEF §7, SPEC §13).

## Relevant code and documentation

- [BRIEF.md](../BRIEF.md) §7 (tileset rows).
- [SPEC.md](../SPEC.md) §13 (Tilesets bullet, reuse of already-imported tilesets).
- [reference/tiled.md](../reference/tiled.md) §2 (Tileset, Tile, WangSet), §5 (TSJ).
- [FORMAT.md](../FORMAT.md) §2.4 (`"collection"` source, Tile, TerrainSet).
- Import core (TE-022), map conversion (TE-059).

## Required work

- Read embedded, `.tsj` and `.tsx` tilesets; TSX parsed in `core/` without DOM globals.
- Image tilesets: `margin`, `spacing`, `tileoffset`; IDs are Tiled's local IDs; `nextTileId` =
  tile count.
- Image collections of uniform size → `"collection"` source tileset (source key = image file
  name), `nextTileId` = Tiled's next tile ID; mixed sizes refused; tile sizes above 256 refuse the
  map.
- Tile `type` → class; animations; collision from `objectgroup` (rectangles, ellipses, polygons
  kept; points, polylines, rotation, names and shape properties dropped, reported).
- Wang sets → terrain sets (colours, tiles; class, properties, probabilities dropped, reported);
  terrain-set transformations and tile probability dropped, reported.
- `transparentcolor` (tilesets and image layers) applied as a colour key when pixels are copied;
  `tilerendersize: "grid"` dropped, reported.
- Reuse: an external tileset already imported into this project from a file of the same name with
  the same tile fingerprints is reused; every other becomes a new tileset.
- Pixel limits and packability checked as in TE-022.

## Acceptance criteria

- [ ] `tests/unit/te-060-tilesets.test.ts`: per fixture tileset row, the converted tileset and
      report entries; TSX and TSJ of the same tileset convert identically.
- [ ] Colour key applied; mixed-size collection and > 256 tile size refused.
- [ ] Re-importing a map whose external tileset is already in the project reuses it.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-022, TE-059.
- Out of scope: the dialog and golden reports (TE-061), updating a collection tileset (TE-062).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
