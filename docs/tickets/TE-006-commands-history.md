# [TE-006] Commands, transactions and project history

Milestone: M0 Foundation · Size: L · Depends on: TE-005

## Context

Every change to a project is an undoable command in one history per project (SPEC §3). Tool
strokes are transactions that record cell patches. The sprite editor's history is adapted from
pixel patches to cell patches.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §2.1 (invariants after every command), §2.2 (memory warn/refuse), §3
  (commands, transactions, budget, `touched`, dirty).
- [DESIGN.md](../DESIGN.md) §3.3 row `core/history/*`.
- `se/src/core/history/command.ts`, `transaction.ts`, `history.ts`, `allocate.ts`, `errors.ts`.
- `core/model` (TE-005).

## Required work

- Adapt the `se/` history files (recorded in `docs/PROVENANCE.md`): `Command` of SPEC §3 with
  `label`, `do`, `undo`, `bytes`, `touched` (maps, layers, dirty cell rectangles, tilesets,
  structure); each entry records the map it changed or none.
- One history per project; budget 256 MB, oldest dropped first, newest kept even above the
  budget; a new command clears redo; a command that cannot allocate aborts cleanly with a typed
  error and no change.
- Stroke transactions: `begin` snapshots nothing; writes record `(layer, index, before, after)`
  on a cell's first change (12 bytes a cell); `commit` makes one command; `abort` restores; a
  stroke that changes nothing makes no entry.
- Dirty state: history position differs from the saved one, or export settings changed since the
  save.
- Memory guard: a command that would take the project above 1 GB is refused with a typed error
  and the project unchanged; crossing 512 MB raises one warning event (SPEC §2.2).
- `assertInvariants` after every command in development builds and tests.
- A reusable do/undo symmetry harness (`tests/unit/support/`) that later tickets run on each
  command they add.

## Acceptance criteria

- [ ] `tests/unit/te-006-history.test.ts`: undo/redo order; redo cleared by a new command;
      budget eviction keeps the newest entry; allocation failure leaves project and history
      unchanged.
- [ ] Transactions: abort restores every changed cell; a no-change stroke adds no entry; a
      stroke's `bytes` is 12 per changed cell plus a fixed overhead.
- [ ] Dirty: set by a command, cleared by marking saved, set again by undo past the save point,
      set by an export-settings change.
- [ ] Memory guard: refusal above 1 GB leaves the project unchanged; the 512 MB warning fires
      once per crossing.
- [ ] The symmetry harness passes on a sample command and fails on a deliberately asymmetric one.

## Validation

- `npm run check`.

## Dependencies and scope

- Depends on TE-005.
- Out of scope: undo switching map tabs (TE-031), the app session store (TE-007).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
