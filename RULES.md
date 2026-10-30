# Rules

Binding for every implementer (human or agent). Docs index: [docs/README.md](docs/README.md).

## Decisions

1. **Decide; don't hand the owner every choice.** When a decision is needed, check in order:
   how Tiled solves it ([docs/reference/tiled.md](docs/reference/tiled.md), then Tiled's
   source and docs), then how ngne-sprite-editor solves it. If either answers it, adopt that,
   write it into the doc it belongs to, and continue. Consult the owner only when both checks
   fail or the decision is critical: it changes a decision in `docs/BRIEF.md` §8, a frozen
   file format, the stack, or the scope.
2. Docs state the current truth only: no revision notes, "superseded" or "amended" markers.
   History lives in git. Never change a doc just to make code pass.
3. A step's scope is binding. If the docs and the step disagree, or acceptance cannot be met,
   apply rule 1; if it stays unresolved, stop and report.

## Code

4. Layer boundaries: `src/core` imports no DOM global, React or `@ngne/core`; only
   `src/engine` imports `@ngne/core`; `src/ui` changes documents only through registered
   commands.
5. Dependencies are exactly those of [docs/SUITE.md](docs/SUITE.md) §5, pinned exactly.
   Anything else needs an owner decision.
6. A feature registers through its registry (commands/keymap/menu, dock, overlay, tools,
   context bar) without editing shared files.
7. Done = every acceptance item backed by a named test or a recorded measurement, and
   `npm run check` plus the step's E2E files pass. Never weaken, skip or delete a test to get
   there.
8. Performance numbers that decide anything come from reference hardware
   ([docs/ENGINE.md](docs/ENGINE.md) §6). SwiftShader/CI numbers are report-only.

## Hygiene

9. **Clean up at the end of every step and every milestone.** Delete what the current repo
   no longer needs: stale or superseded docs, old measurement and evidence files (keep only
   the latest result that a doc cites), logs, scratch files, test output, dead code, unused
   fixtures. Merge duplicate docs. The goal is a repo an implementer reads without meeting
   noise.

## Workflow

10. **Usage check.** Before starting a step, and between phases of a long step, check usage
    (`/usage` or the session usage tool). Start or continue only if the whole step is sure to
    finish in the remaining allowance, judged from the cost of similar steps. If not, stop
    and tell the owner to wait before the next step.
11. **Commits:** only when asked, using the `/commit` skill. One commit per step, one-line
    message prefixed with the step ID: `[TE-015] Stamp brush`, `[S1] Live-tier spike`.
    One branch per step (`te-015`). The owner pushes, merges, tags and deploys.
12. **Report at the end of a step:** files added and changed; each acceptance item met (test
    or measurement) or not met (reason); anything done differently from the docs and why;
    decisions taken under rule 1; measurements left for reference hardware.
