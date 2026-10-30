# [TE-063] Golden path and E2E regression suite

Milestone: M9 Hardening and release · Size: M · Depends on: TE-008, TE-021, TE-029, TE-030, TE-033, TE-036, TE-039, TE-040, TE-045, TE-048, TE-054, TE-055, TE-056, TE-057, TE-062

## Context

Before release the whole loop must run end to end, repeatedly, and the E2E suite must cover every
row of SPEC §15 (SUITE §7: golden path ×10 in CI).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §15 (E2E row, definition of done).
- [SUITE.md](../SUITE.md) §7 (CI row).
- `se/tests/e2e/se-070-*` (pattern).

## Required work

- Golden path E2E: new project → import a grid PNG and a `.ngsprite` → paint with stamp, fill and
  terrain brush → layers, markers, properties → save → reopen → export → the fixture game draws
  it equal to the compositor reference.
- CI job running the golden path 10 times in a row.
- Coverage audit: map each SPEC §15 E2E item to an existing spec file; add a spec for any gap.
- Flake audit: every spec passes 5 consecutive full runs under CI settings; any frame-counting
  spec is tagged `@alone`.

## Acceptance criteria

- [ ] `tests/e2e/te-063-golden-path.spec.ts` passes 10 consecutive runs locally and in CI.
- [ ] `tests/e2e/README.md` lists each SPEC §15 E2E item with its spec file; none missing.
- [ ] 5 consecutive full suite runs under `CI=1` pass with no retry.

## Validation

- `npm run check`; `npx playwright test`; CI after the owner pushes.

## Dependencies and scope

- Depends on every feature ticket without a later dependant (listed above).
- Out of scope: reference-hardware measurements (TE-064), audit (TE-065).

## Documentation

Adds `tests/e2e/README.md`.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
