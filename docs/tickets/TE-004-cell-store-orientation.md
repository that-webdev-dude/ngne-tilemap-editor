# [TE-004] Cell store and orientation algebra

Milestone: M0 Foundation · Size: M · Depends on: TE-001

## Context

Tile layers keep their cells in a chunked store whose chunk size equals the viewport's chunk
tier, and every flip and rotation goes through one orientation algebra matching Tiled's. Both are
pure `core/` code that the model, tools, viewport, codecs and runtime build on.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §2.2 (cells in memory), §2.3 (orientation algebra), §15 (unit row).
- [FORMAT.md](../FORMAT.md) §1.2 (cell value, spans, orientation table).
- [reference/tiled.md](../reference/tiled.md) §2 (`TileLayer`, rotate tables), §5 (GID encoding).
- [ENGINE.md](../ENGINE.md) §4 (chunk tier uses the same 32 × 32 chunks).

## Required work

- `core/cells`: `CellStore` of 32 × 32 chunks (`Uint32Array`, absent chunk = all empty) keyed by
  chunk coordinates, each with its non-empty count; get, set, clear, iteration over the chunks a
  rectangle touches, the non-empty upper bound for a rectangle in O(chunks).
- In-memory cell value helpers: flags of FORMAT §1.2, slot in bits 20..27, tile ID in bits 0..19,
  0 empty.
- Conversion of a layer between in-memory values and GIDs with a per-map `firstGid` table, both
  directions, O(cells).
- The 8 orientations as 2 × 2 integer matrices; composition; flip H, flip V (toggle the bit,
  `D` untouched), rotate right and left through Tiled's `rotateRightMask` and `rotateLeftMask`.
- Transform of a rectangle of cell values (a stamp): flips mirror positions, quarter turns rotate
  the rectangle and swap width and height, each cell's flags composed.

## Acceptance criteria

- [ ] `tests/unit/te-004-orientation.test.ts`: every entry of both rotate tables equals the
      matrix product; all 64 compositions agree with Tiled's tables; the FORMAT §1.2 table equals
      the composition anti-diagonal, then H, then V.
- [ ] `tests/unit/te-004-cell-store.test.ts` (fast-check): get after set; chunk counts equal a
      brute-force count; the rectangle upper bound is never below the true non-empty count.
- [ ] fast-check: in-memory → GID → in-memory is the identity for every valid value and table;
      bit 28 is never set; empty stays 0.
- [ ] Stamp transforms: four rotations right and two flips are identities; rotate right then
      left is the identity; a `w × h` stamp turns into `h × w`.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-001.
- Out of scope: the project model (TE-005), stamp UI (TE-017, TE-018).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
