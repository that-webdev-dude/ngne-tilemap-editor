# [TE-002] Sprite core subtree, provenance and drift report

Milestone: M0 Foundation · Size: M · Depends on: TE-001

## Context

The editor reads `.ngsprite` files, composites frames, expands tags, packs and validates atlases
and codes PNG and zip with the sprite editor's own `core/` code, copied byte-identical
(BRIEF D14, DESIGN §3.1). The closure is about 60 files at `ea5c91d`; it must be recomputed by a
script, recorded, and protected against local edits and upstream drift.

## Relevant code and documentation

- [DESIGN.md](../DESIGN.md) §3 (kinds verbatim/adapt/pattern), §3.1 (entry files, subtree rules).
- [SUITE.md](../SUITE.md) §6 (provenance, drift script).
- [SPEC.md](../SPEC.md) §1 (`core/sprite` row).
- `se/src/core/` at `ea5c91d`: `project/deserialize.ts`, `composite/compositeFrame.ts`,
  `animation/index.ts`, `export/pack.ts`, `export/validateAtlas.ts` and their imports.
- `docs/PROVENANCE.md` (TE-001).

## Required work

- A committed script (`scripts/`) that computes the import closure of the five entry files in
  `se/` at `ea5c91d` (read through git, not the working tree) and copies each file to
  `src/core/sprite/<path below se/src/core/>`, byte-identical.
- Every closure file recorded in `docs/PROVENANCE.md` with its `se/` path, commit and SHA-256.
- Lint: `src/core/sprite` imports nothing outside itself except `fflate` and `fast-png`; only
  `src/core/**` outside `src/core/sprite` may import from it.
- `scripts/drift.ts` (`npm run drift`): for every verbatim row of `docs/PROVENANCE.md`, reports
  whether the file changed in the local `se/` checkout since the recorded commit. Not part of
  `npm run check` (CI has no `se/` checkout).

## Acceptance criteria

- [ ] Running the closure script on a clean tree reproduces `src/core/sprite/` exactly; the file
      count it prints is the count recorded in `docs/PROVENANCE.md`.
- [ ] `tests/unit/te-002-provenance.test.ts`: every verbatim row's file hashes to its recorded
      SHA-256; editing one byte of a copied file fails the test.
- [ ] `tests/unit/te-002-sprite-core.test.ts`: reads a copy of `se/`'s
      `tests/unit/se-040-fixtures/golden-v1.ngsprite`, composites a frame, packs it and passes
      `validateAtlas`.
- [ ] `tests/unit/te-001-layers.test.ts` (extended): an import from `src/app` into
      `src/core/sprite`, and from `src/core/sprite` to another `src/core` module, fail lint.
- [ ] `npm run drift` against `se/` at `ea5c91d` reports no change.

## Validation

- `npm run check`; `npm run drift` locally.

## Dependencies and scope

- Depends on TE-001.
- Out of scope: any use of the subtree beyond the smoke test (TE-009, TE-022, TE-023, TE-046);
  copying UI files (TE-003, TE-007).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
