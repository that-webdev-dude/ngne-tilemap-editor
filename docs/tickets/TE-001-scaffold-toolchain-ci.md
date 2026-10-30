# [TE-001] Scaffold, toolchain and CI

Milestone: M0 Foundation · Size: L · Depends on: none

## Context

The repository holds docs only. Every later ticket needs the exact stack of SUITE §5, the layer
lint rules of RULES 4, unit and E2E runners, a perf runner and CI. SUITE §8 also requires shared
E2E wait helpers before the first UI ticket and a suite sharded from day 0.

## Relevant code and documentation

- [SUITE.md](../SUITE.md) §1 (identity, `se/` = `..\ngne-sprite-editor` at `ea5c91d`), §5
  (stack, config files table, scripts, ports), §7 (CI row), §8 (conventions).
- [RULES.md](../../RULES.md) 4, 5, 7.
- [DESIGN.md](../DESIGN.md) §3.2 row `engine/testing/readCanvas.ts`.
- `se/` sources: the config files of SUITE §5, `se/.github/workflows/ci.yml`,
  `se/tests/perf/record.ts`, `se/tests/perf/README.md`, `se/tests/e2e/se-0xx-support.ts`
  helpers, `se/src/raw.d.ts`, `se/src/import-meta.d.ts`.

## Required work

- Take every copy from `se/` at commit `ea5c91d` (`git show ea5c91d:<path>` or a worktree at
  that commit), never from its working tree: the sprite editor's migration has started there.
- `package.json`: name, `private`, MIT, `engines` Node ≥ 24, `"type": "module"`, every runtime
  and dev dependency of SUITE §5 at its exact version (installed now, so later tickets do not
  edit dependencies), the scripts of SUITE §5. `LICENSE` (MIT, "Copyright (c) 2026 Fabio
  Barracano").
- Config files per the SUITE §5 table (copy or adapt as each row states). `vite.config.ts`
  adapted for names, base path and ports 5183/4183; the PWA plugin block is TE-066's.
- `index.html`, `src/main.tsx` rendering an empty root, `src/{core,engine,app,ui}`, ambient
  declarations for `?raw` imports and `import.meta`.
- Lint layer rules of RULES 4 (DOM globals, React and `@ngne/core` barred from `src/core`;
  `@ngne/core` only in `src/engine`).
- Vitest (Node) for `tests/unit`; `vitest.perf.config.ts` and `tests/perf/record.ts` for
  benchmarks (`tests/perf/te-0xx-*`), not part of `npm run check`.
- Playwright on installed Chrome: port from the environment or a free one per checkout,
  SwiftShader flags under CI, projects `parallel` and `alone`, one worker per CI job.
- Shared E2E wait helpers in `tests/e2e/support/` (app ready, N frames submitted, stable element
  size), adapted from the `se/` support files.
- `src/engine/testing/readCanvas.ts` copied verbatim.
- `.github/workflows/ci.yml`: `npm run check`, then E2E in 4 shards plus the `alone` project,
  headed Chrome under xvfb with SwiftShader WebGPU, on push and pull request, Node 24.
- Test files named after their ticket: `tests/unit/te-0xx-*.test.ts`,
  `tests/e2e/te-0xx-*.spec.ts`.
- `docs/PROVENANCE.md`: one row per file copied from `se/` (path here, `se/` path, kind
  verbatim/adapt, commit `ea5c91d`).

## Acceptance criteria

- [ ] `npm ci && npm run check` passes on a clean clone with Node 24.
- [ ] `tests/unit/te-001-dependencies.test.ts`: `dependencies` and `devDependencies` equal the
      SUITE §5 tables, every version exact.
- [ ] `tests/unit/te-001-layers.test.ts`: lint fails on `@ngne/core`, `react` and a DOM global
      in `src/core`, and on `@ngne/core` in `src/app` or `src/ui`; passes on the same code in
      `src/engine`.
- [ ] `tests/e2e/te-001-smoke.spec.ts`: the dev build creates a `WebGPURenderer` (0.3.0), draws
      one rectangle, and `readCanvas` returns the expected colour at the expected pixel.
- [ ] `npm run dev` serves on 5183 and `npm run preview` on 4183.
- [ ] `docs/PROVENANCE.md` lists every copied file of this ticket.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-001-*` (hardware WebGPU locally).
- CI green on GitHub after the owner pushes (SwiftShader).

## Dependencies and scope

- First ticket.
- Out of scope: `src/core/sprite` and `scripts/drift.ts` (TE-002), any UI (TE-003), PWA plugin,
  icons and service worker (TE-066), README and deploy workflow (TE-067), the weekly runtime
  compatibility job (TE-052).

## Documentation

Creates `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
