# [TE-010] Background worker

Milestone: M1 Viewport · Size: M · Depends on: TE-009

## Context

Zip, deflate, PNG encode and decode, TMJ decompression and packing must not hold the main
thread past 16 ms (SPEC §1). Imports, save, open, export and autosave all need one worker that
imports only `core/`.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §1 (worker rule), §14 (main-thread task budgets).
- [RULES.md](../../RULES.md) 4 (layers).
- `src/core/sprite` PNG and zip code (TE-002), `core/pack` (TE-009).

## Required work

- `app/worker`: a module worker importing only `src/core/**`; a typed request/response protocol
  with transferable buffers, cancellation and error mapping to typed errors.
- Tasks registered from their own modules (so later tickets add tasks without editing a shared
  file): PNG decode and encode, zip read and write, pack a tileset.
- Main-thread client with a promise API; a worker crash rejects in-flight requests and the next
  request starts a new worker.

## Acceptance criteria

- [ ] `tests/unit/te-010-protocol.test.ts`: each task gives the same result through the
      protocol as the direct `core/` call (run in-process in Node).
- [ ] `tests/e2e/te-010-worker.spec.ts`: decoding a 4096 × 4096 PNG through the worker keeps
      every main-thread task ≤ 16 ms (long-task observer); cancellation stops a running task;
      a crashed worker is replaced.
- [ ] Lint: `src/app/worker` imports nothing outside `src/core` and its own folder.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-010-*`.

## Dependencies and scope

- Depends on TE-009.
- Out of scope: `.ngtilemap` tasks (TE-046), TMJ decompression (TE-061).

## Documentation

Unaffected.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
