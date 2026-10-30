# [TE-046] `.ngtilemap` reader and writer

Milestone: M6 Persistence · Size: L · Depends on: TE-002, TE-012

## Context

A project is one `.ngtilemap` zip holding every map, tileset, image and thumbnail (BRIEF D5).
The file is untrusted and frozen at 1.0.0, so the codec must check everything before use and
write the same bytes for the same project (FORMAT §2).

## Relevant code and documentation

- [FORMAT.md](../FORMAT.md) §1 (common values), §2 (container, entries, JSON rules, every
  member table, images, thumbnails, limits, reading order, migrations).
- [SPEC.md](../SPEC.md) §2.2 (slots ↔ GIDs on save and open), §15 (codec tests).
- `src/core/sprite` zip, PNG and strict JSON code (TE-002); thumbnails (TE-012).

## Required work

- `src/core/project`: `serialize` and `deserialize`; container rules of FORMAT §2.1; entries of
  §2.2 in the writer's order; JSON rules (no missing or unknown member, no repeated name, BOM
  skipped); every member of §2.3–§2.5 checked for type and range; IDs, slugs and cross-references;
  `data` with one map row per line.
- Cell conversion: in-memory slot values → GIDs with the per-map `firstGid` table on write, back
  on read.
- PNG entries per §2.6 (header checked before decoding); thumbnails per §2.7.
- Limits of §2.8 exported as constants and checked before inflating, decoding or allocating; the
  writer refuses a project it could not read back, naming the entry.
- Reading order of §2.9; every problem a `ProjectError` (`errors.ts`) with a code and the entry.
- `migrations.ts` with the version-1 identity step; a newer `version` refused naming both.
- `tests/fixtures/format/golden-v1.ngtilemap` committed.

## Acceptance criteria

- [ ] `tests/unit/te-046-roundtrip.test.ts`: serialize → deserialize equals the project for the
      reference project and a project using every member; serializing twice gives identical
      bytes; the golden file reads and re-serializes to the same bytes.
- [ ] `tests/unit/te-046-rejections.test.ts`: one case per FORMAT §2.1 container rule, §2.2 JSON
      rule, §2.8 limit and §2.9 step, each with its error code and entry; limit refusals occur
      before inflating or decoding (spies).
- [ ] fast-check: cell values and GID conversion round-trip through the file.
- [ ] Thumbnails follow FORMAT §2.7.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-002, TE-012.
- Out of scope: file workflows (TE-047), autosave (TE-048).

## Documentation

Unaffected (FORMAT governs; never edited to fit code).

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
