# [TE-049] Tilemap writer and reader

Milestone: M7 Export, runtime and preview · Size: M · Depends on: TE-009

## Context

Games load `ngne-tilemap` v1, the editor's own strict format (BRIEF D7, FORMAT §3). The editor
writes it with `tilemapFor`; games read it with the generated runtime's `readTilemap`, which is
`validateTilemap` plus the atlas checks (SPEC §11.2). Editor and runtime must carry the same
reader.

## Relevant code and documentation

- [FORMAT.md](../FORMAT.md) §1 (common values), §3 (every member, effective layer values,
  limits, what the editor writes, reading, error codes, example), §4 (atlas rules).
- [SPEC.md](../SPEC.md) §11.2 (`readTilemap`), §15.
- `core/pack` (TE-009), `src/core/sprite/export/validateAtlas.ts` (TE-002).

## Required work

- `src/core/tilemap/tilemapFor`: one map → JSON text of FORMAT §3.7: members in table order,
  four-space indent, `data` one map row per line, ASCII, final line feed; tilesets in project
  order with `firstGid` from §1.2; groups parents first; layers flattened in draw order with
  effective values (§3.4); properties sorted; same project → same bytes.
- `validateTilemap(json, atlases)` of FORMAT §3.8 (order of checks, counts before elements,
  `__proto__` as a plain name, result holding only table members, `data` as `Uint32Array`),
  throwing only `TilemapError` with code and path.
- One implementation: the reader and `TilemapError` live in `src/core/runtime/runtime.ts`
  (no imports, it becomes the generated runtime), and `src/core/tilemap` (including
  `errors.ts`) re-exports them.
- `tests/fixtures/format/meadow.tilemap.json` (the FORMAT §3.10 example) with its atlas.

## Acceptance criteria

- [ ] `tests/unit/te-049-writer.test.ts`: the meadow project writes the fixture byte for byte;
      group effective values; `firstGid` spans; writing twice gives identical bytes.
- [ ] `tests/unit/te-049-reader.test.ts`: one rejection per FORMAT §3.8 step and per error code,
      each with its path; a `version` 2 file refused as `newer-version` before other checks;
      unknown members ignored and absent from the result.
- [ ] Round trip: `tilemapFor` → `validateTilemap` gives the project's cells, flags, properties,
      collision and markers.
- [ ] A test asserts `runtime.ts` contains no `import` statement.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-009.
- Out of scope: runtime data and draw functions (TE-050, TE-051), export files (TE-053).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
