# NGNE Tilemap Editor — agent instructions

Binding rules: [RULES.md](RULES.md). This file says how to apply them to a ticket.

## Documents

| File | Role |
| ---- | ---- |
| `docs/README.md` | Doc index and reading order |
| `docs/BRIEF.md` | Scope and decisions; wins when two docs disagree |
| `docs/SPEC.md` | Behaviour and architecture; §15 quality and definition of done |
| `docs/DESIGN.md` | Interface; files copied from the sprite editor (§3) |
| `docs/FORMAT.md` | File formats; wins on the content of a file |
| `docs/ENGINE.md` | NGNE use, viewport tiers, budgets, engine gaps |
| `docs/SUITE.md` | Identity, design system, stack, packaging, conventions |
| `docs/reference/tiled.md` | Tiled behaviour the editor reproduces |
| `docs/tickets/README.md` | Ticket index, owner checks, measurements, parallel rules |
| `docs/tickets/TE-0xx-*.md` | One ticket each: scope and acceptance |
| `docs/PROVENANCE.md` | Files copied from the sprite editor, with commit and hash (from TE-001) |

## Working on a ticket

- Check usage first (RULES 10). Start only if the whole ticket fits the remaining allowance.
- Start only when every "Depends on" ticket is Done.
- Read the ticket, every doc section it lists, and the definition of done in SPEC §15.
- The ticket's scope is binding; "Out of scope" lines are binding.
- If the ticket and the docs disagree, or acceptance cannot be met, decide by RULES 1 (Tiled,
  then the sprite editor) and record the decision in the doc it belongs to. If that does not
  settle it, or it touches a BRIEF §8 decision, a frozen format, the stack or the scope, stop and
  report.
- Never change a doc to make code pass. Edit docs only where the ticket's Documentation section
  names the edit.
- Copies from the sprite editor come from commit `ea5c91d` (`git show ea5c91d:<path>`), never
  from its working tree; record each in `docs/PROVENANCE.md`. Verbatim files stay byte-identical.
- Dependencies are exactly those of SUITE §5, pinned exactly. Anything else stops and reports.
- Layer boundaries (RULES 4): `src/core` imports no DOM global, React or `@ngne/core`;
  `src/core/sprite` imports nothing outside itself; only `src/engine` imports `@ngne/core`;
  `src/ui` changes documents only through registered commands.
- A feature registers through its registry (RULES 6) instead of editing a shared file.
- Done means every acceptance item backed by a named test or a recorded measurement, and
  `npm run check` plus the ticket's E2E files pass. Never weaken, skip or delete a test to get
  there.
- One exception: an earlier ticket's assertion about a placeholder (an empty region, placeholder
  text) may be updated by the ticket whose scope fills that placeholder. Change only that
  assertion, keep it as strict, and list the before and after lines in the report.
- Clean up at the end (RULES 9).

## Tests and measurements

- Test files are named after the ticket: `tests/unit/te-0xx-*.test.ts`,
  `tests/e2e/te-0xx-*.spec.ts`, `tests/perf/te-0xx-*`.
- Benchmarks live under `tests/perf/` and report through `tests/perf/record.ts`; they are not
  part of `npm run check`.
- Record a number only when it was measured on reference hardware (ENGINE §6), alone, as
  `docs/tickets/README.md` (Measurements) describes. SwiftShader and CI numbers are report-only;
  never present one as a reference-hardware result.

## Parallel work

- One ticket per agent, in its own worktree and branch `te-0xx`; E2E uses the port the
  environment gives.
- Change only the modules the ticket names, new files for its feature and its own tests.
- Follow the ordering rules in `docs/tickets/README.md` (Parallel work).
- In a parallel run, write the benchmark and leave the number out; it is measured after merge.
- Do not change a ticket's Status and do not merge.

## Report at the end of a ticket

RULES 13: files added and changed; each acceptance item met (test name or measurement) or not
met (reason); anything done differently from the docs and why; decisions taken under RULES 1;
measurements left for reference hardware.

## Commits

Only when asked, with the `/commit` skill (RULES 11, 12): one commit per ticket, the one-line message
`[TE-0xx] Title` taken unchanged from the ticket's heading, on branch `te-0xx`. The owner pushes,
merges, tags and deploys.
