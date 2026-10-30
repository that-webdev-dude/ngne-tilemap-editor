# Provenance

Files copied from ngne-sprite-editor (`se/` = `..\ngne-sprite-editor`, SUITE §1), one row per
file, sorted by path. Kinds as DESIGN §3: **verbatim** files are byte-identical to the `se/`
file at the recorded commit and carry its SHA-256; **adapt** files were copied and then
changed only as the row states. `scripts/drift.ts` reports later changes in `se/` to verbatim
rows.

| Path | `se/` path | Kind | Commit | SHA-256 | Change |
| ---- | ---------- | ---- | ------ | ------- | ------ |
| `.gitattributes` | `.gitattributes` | verbatim | `ea5c91d` | `23302dd90b8bb74b44d365fafef8df20f809b61cb347023951ecf60a88a29651` | |
| `.github/workflows/ci.yml` | `.github/workflows/ci.yml` | adapt | `ea5c91d` | | `check` and E2E jobs only (4 shards + `alone`); E2E needs `check`; `--pass-with-no-tests`. Golden path, README commands and links are later tickets' |
| `.gitignore` | `.gitignore` | verbatim | `ea5c91d` | `5423c7bb6e7fbdf01fa35385d7e8d669842f619049c5dcd7df4b82ff08492150` | |
| `.npmrc` | `.npmrc` | verbatim | `ea5c91d` | `be85cc462e740587626bbcbb1c3ed1c40b26e62ec072e8cbd2768f23915c28e6` | |
| `.prettierignore` | `.prettierignore` | verbatim | `ea5c91d` | `fd8356b420ff96f0e5767647a3552b8c74560812d32cd30bdb0f3566876df1e6` | |
| `.prettierrc.json` | `.prettierrc.json` | verbatim | `ea5c91d` | `d04a16899ab54acc7f6594035de866d26c4abf39686192b3994abdd132351e27` | |
| `LICENSE` | `LICENSE` | verbatim | `ea5c91d` | `4d21bde6e4b9d15aafd5e507b3222205aa1ed73c3546650c524a3bf75685305a` | |
| `eslint.config.js` | `eslint.config.js` | verbatim | `ea5c91d` | `c1e94f474934f5ce280c411e4cde65f97f7edc5098712af70d614bcb7d309ec3` | |
| `index.html` | `index.html` | adapt | `ea5c91d` | | Title and description (SUITE §1); no favicon link until the icons exist (TE-066) |
| `package.json` | `package.json` | adapt | `ea5c91d` | | Name, version `0.0.0`, description; dependencies of SUITE §5 (`@ngne/core` 0.3.0, no `gifenc`) |
| `playwright.config.ts` | `playwright.config.ts` | verbatim | `ea5c91d` | `c54d185e32b18fb3e05cee6fd7c72f924ec93eaaf51d5f36ceaf32d84b03b7a6` | |
| `src/engine/testing/readCanvas.ts` | `src/engine/testing/readCanvas.ts` | verbatim | `ea5c91d` | `27de8812f006a47624b87f2095afcf25c353461832890a3afea774af1951f7f0` | |
| `src/import-meta.d.ts` | `src/import-meta.d.ts` | adapt | `ea5c91d` | | No `SERVICE_WORKER` flag until the PWA build defines it (TE-066) |
| `src/main.tsx` | `src/main.tsx` | adapt | `ea5c91d` | | Renders an empty root that sets `<html data-app-ready>`; no `App`, no service worker |
| `src/raw.d.ts` | `src/raw.d.ts` | verbatim | `ea5c91d` | `b35d4d2d9cf5cfd50c415c801c3f0e0ad000f4bb30009520db02368b12eec131` | |
| `tests/e2e/harness/te-001-smoke.html` | `tests/e2e/harness/smoke.html` | adapt | `ea5c91d` | | Title and script name |
| `tests/e2e/harness/te-001-smoke.ts` | `tests/e2e/harness/smoke.ts` | adapt | `ea5c91d` | | Ticket ID in the comment; both far edges of the rect read; status read before the renderer is disposed |
| `tests/e2e/support/wait.ts` | `tests/e2e/se-006-support.ts`, `se-012-support.ts`, `se-022-support.ts` | adapt | `ea5c91d` | | `openShell` → `openApp` on `data-app-ready`; `afterFrames` as is; `framesSubmitted` and `stableSize` added |
| `tests/e2e/te-001-smoke.spec.ts` | `tests/e2e/se-001-smoke.spec.ts` | adapt | `ea5c91d` | | App start on `data-app-ready`, title and empty `#root`; engine version 0.3.0; TE-001 harness and both far edges |
| `tests/perf/README.md` | `tests/perf/README.md` | adapt | `ea5c91d` | | Running rules only; records under `docs/evidence/`; budgets live in ENGINE §6 and SPEC §14 |
| `tests/perf/record.ts` | `tests/perf/record.ts` | adapt | `ea5c91d` | | Records under `docs/evidence/`; references to this repo's docs and ids |
| `tests/unit/te-001-dependencies.test.ts` | `tests/unit/se-001-dependencies.test.ts` | adapt | `ea5c91d` | | Compares with the SUITE §5 tables and the lockfile |
| `tests/unit/te-001-layers.test.ts` | `tests/unit/se-001-lint-boundaries.test.ts` | adapt | `ea5c91d` | | RULES 4 cases; the same code passes in `src/engine` |
| `tsconfig.json` | `tsconfig.json` | verbatim | `ea5c91d` | `4dd0bfb34ca25b40ad4fc39e95876e50fad6ebdced165919618156742e15081e` | |
| `tsconfig.node.json` | `tsconfig.node.json` | adapt | `ea5c91d` | | `src/gifenc.d.ts` dropped |
| `vite.config.ts` | `vite.config.ts` | adapt | `ea5c91d` | | Ports 5183/4183 (strict); PWA plugin, manifest, file handler and theme colour are TE-066's; base path from the deploy build |
| `vitest.config.ts` | `vitest.config.ts` | verbatim | `ea5c91d` | `4a41581bc1a038dec83a21477c0a1288d693602ee3001af4327f3d08bad5fea4` | |
| `vitest.perf.config.ts` | `vitest.perf.config.ts` | verbatim | `ea5c91d` | `09675eb8bb88964f2e553c15966b99ced61c8910e3363731e977aa05d1955c9c` | |
