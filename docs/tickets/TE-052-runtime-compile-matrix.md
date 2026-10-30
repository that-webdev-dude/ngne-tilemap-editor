# [TE-052] Runtime compile matrix and engine-contract check

Milestone: M7 Export, runtime and preview · Size: M · Depends on: TE-051

## Context

The generated runtime must compile in games on `ngne` 0.1.0, `@ngne/core` 0.2.2 and 0.3.0 under
the strictest game settings, and a weekly check must catch a new NGNE release that breaks the
engine contract (BRIEF §6, SPEC §11.4).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §11.4 (compatibility, engine contract, `latest` check).
- [BRIEF.md](../BRIEF.md) §6 (compiler settings).
- [ENGINE.md](../ENGINE.md) §7 (where a contract break is reported).
- Generator (TE-050), `drawTilemap` (TE-051).

## Required work

- `tests/runtime-compat/<version>/` for `ngne` 0.1.0, `@ngne/core` 0.2.2 and 0.3.0: each its own
  `package.json` and lockfile (not dependencies of the app), a fixture game that imports a
  generated `ngne-tilemap.ts`, calls every exported function and draws in `scene.render`.
- `tsc` per folder under BRIEF §6 settings plus `strict`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`, `noUnusedParameters`.
- `tests/runtime-compat/latest/`: installs the newest published `@ngne/core` (no lockfile) and
  runs the same compile test.
- CI: the three pinned compiles in `ci.yml` (part of the required run); a weekly workflow for
  `latest`, report-only.

## Acceptance criteria

- [ ] The generated runtime compiles without error in each pinned folder (CI job and a local
      `npm` script).
- [ ] The `latest` folder runs locally and in the weekly workflow; its failure does not fail the
      required CI.
- [ ] A deliberate contract break (a renamed sprite field in a local copy of a folder's types)
      fails that folder's compile.

## Validation

- `npm run check`; the compat script; CI after the owner pushes.

## Dependencies and scope

- Depends on TE-051.
- Out of scope: the `latest` conformance draw (TE-055 adds it to the weekly job).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
