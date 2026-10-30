# [TE-005] Project model and invariants

Milestone: M0 Foundation · Size: M · Depends on: TE-004

## Context

Every feature edits the in-memory project of SPEC §2.1. Its types, invariants, ID and slug rules,
effective layer values and memory accounting must exist before commands, codecs and views. Later
benchmarks need the ENGINE §6 reference map built in code.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §2.1 (types, invariants), §2.2 (slots, memory), §3 (session types).
- [FORMAT.md](../FORMAT.md) §1.1 (ID, slug), §1.4 (property), §1.5 (shape), §2.4 (distinct
  IDs and export names), §2.5 (group composition).
- [ENGINE.md](../ENGINE.md) §6 (reference map), [BRIEF.md](../BRIEF.md) D1.
- `core/cells` (TE-004).

## Required work

- `core/model`: the types of SPEC §2.1 and the session types of SPEC §3 (`ProjectSession`,
  `MapSession`; `Command` is TE-006's).
- ID (UUID) and slug helpers: slug from a name, made unique case-insensitively against the
  project's export names, `ngne-tilemap` reserved.
- `createProject` and `createMap` (defaults 64 × 64 cells of 16 × 16, one tile layer).
- Slot assignment: lowest free slot 1..255 when a project opens or a tileset is added.
- Effective layer values: visible and unlocked only if every ancestor is; opacity and parallax
  multiply; offsets add (FORMAT §2.5).
- `assertInvariants(project)` for every invariant of SPEC §2.1, naming the one that fails.
- Memory accounting of tileset pixels and allocated cells (SPEC §2.2).
- Test support `tests/support/referenceProject.ts`: the ENGINE §6 reference map (256 × 256,
  16 px, 8 full layers, two tilesets, 12.5% of cells flipped or rotated, one parallax layer),
  deterministic, also loadable by E2E perf pages.

## Acceptance criteria

- [ ] `tests/unit/te-005-invariants.test.ts`: a project breaking each SPEC §2.1 invariant fails
      `assertInvariants` with that invariant named; `createProject()` passes.
- [ ] Slug tests: unique case-insensitively, `ngne-tilemap` never produced, length ≤ 64,
      pattern `[a-z0-9][a-z0-9_-]*`.
- [ ] Slot tests: lowest free slot; 256th tileset refused.
- [ ] Effective-value tests for nested groups (visibility, lock, opacity, parallax, offsets).
- [ ] The reference project has the ENGINE §6 shape and passes `assertInvariants`.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-004.
- Out of scope: commands and history (TE-006), file limits constants (TE-046).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
