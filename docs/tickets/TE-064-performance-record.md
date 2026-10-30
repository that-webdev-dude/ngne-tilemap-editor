# [TE-064] Performance record on reference hardware

Milestone: M9 Hardening and release · Size: M · Depends on: TE-063

## Context

Budgets are enforced on reference hardware (RULES 8). Feature tickets measured their own rows;
three ENGINE §6 rows belong to no single feature, and the release needs every row re-measured on
the finished build.

## Relevant code and documentation

- [ENGINE.md](../ENGINE.md) §6 (reference hardware, reference map, editor and runtime budgets).
- [SPEC.md](../SPEC.md) §14 (feature budgets).
- [RULES.md](../../RULES.md) 8, 9.
- Perf pages and benchmarks under `tests/perf/` from earlier tickets.

## Required work

- New benchmarks: cold load to interactive (production build, local) ≤ 2 s; idle editor frames
  per second = 0; plus any ENGINE §6 or SPEC §14 row without a benchmark.
- Run every benchmark on both reference GPUs, alone, with CPU, power plan and refresh rate
  recorded; update every "Measured" cell; keep only the latest raw files (RULES 9).
- A missed budget is reported with its numbers; the ticket does not change the budget.

## Acceptance criteria

- [ ] Every row of ENGINE §6 and SPEC §14 has a current measured value from both reference GPUs,
      backed by a raw file under `docs/evidence/`.
- [ ] Cold load ≤ 2 s and idle = 0 frames per second, measured.
- [ ] CI runs the perf pages report-only.

## Validation

- `npx vitest run --config vitest.perf.config.ts`; perf pages on reference hardware.

## Dependencies and scope

- Depends on TE-063.
- Out of scope: optimisation work for a missed budget (a new ticket, on the owner's decision).

## Documentation

Fills ENGINE §6 and SPEC §14 measured cells; replaces older evidence files.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
