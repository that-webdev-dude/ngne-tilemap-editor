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
| `eslint.config.js` | `eslint.config.js` | adapt | `ea5c91d` | | `src/core/sprite` imports only itself, `fflate` and `fast-png`; only `src/core` imports `src/core/sprite` (DESIGN §3.1) |
| `index.html` | `index.html` | adapt | `ea5c91d` | | Title and description (SUITE §1); no favicon link until the icons exist (TE-066) |
| `package.json` | `package.json` | adapt | `ea5c91d` | | Name, version `0.0.0`, description; dependencies of SUITE §5 (`@ngne/core` 0.3.0, no `gifenc`); `drift` script |
| `playwright.config.ts` | `playwright.config.ts` | verbatim | `ea5c91d` | `c54d185e32b18fb3e05cee6fd7c72f924ec93eaaf51d5f36ceaf32d84b03b7a6` | |
| `src/core/sprite/animation/expandTag.ts` | `src/core/animation/expandTag.ts` | verbatim | `ea5c91d` | `b72b0e96d9ed95b79d090f436e7b070752fb28438f162fcbccda5ca84cdadf0b` | |
| `src/core/sprite/animation/index.ts` | `src/core/animation/index.ts` | verbatim | `ea5c91d` | `4f38e8b4add97270be649f06776753a8fa0d2d01fee8f27bfdee2f9bbde93897` | |
| `src/core/sprite/animation/playbackClock.ts` | `src/core/animation/playbackClock.ts` | verbatim | `ea5c91d` | `b2d057b570c42f31d91f6cffb436f2287904224ad07eaaedaee7e8959cf30d9b` | |
| `src/core/sprite/cels/celPlan.ts` | `src/core/cels/celPlan.ts` | verbatim | `ea5c91d` | `2270ed7706e8e526ad398919f231af7871fa4417507c5cc4d64f0d5847304a3b` | |
| `src/core/sprite/cels/commands.ts` | `src/core/cels/commands.ts` | verbatim | `ea5c91d` | `2941c46111b22073380bcff2c1cff0b1d0df6faddec62d4e4132ff7a6fee29b8` | |
| `src/core/sprite/cels/errors.ts` | `src/core/cels/errors.ts` | verbatim | `ea5c91d` | `e6078acb719093e9fcd1d584f61d8b7fec5fca1644acfb1d6bf620b63f2fb995` | |
| `src/core/sprite/cels/index.ts` | `src/core/cels/index.ts` | verbatim | `ea5c91d` | `6c3cfcefb0fd14c4c3f3c4a77d081e044158844a2273d983fc55fffc60fac9d4` | |
| `src/core/sprite/cels/orderedMap.ts` | `src/core/cels/orderedMap.ts` | verbatim | `ea5c91d` | `5ef2a6aa640827dab9656019e50d824cf8c16de525e076573b86cb8414e159f2` | |
| `src/core/sprite/composite/blend.ts` | `src/core/composite/blend.ts` | verbatim | `ea5c91d` | `215f5c92bce80814d690f44614b67337c50f53dc09a74d733a2def73f4a8868e` | |
| `src/core/sprite/composite/compositeFrame.ts` | `src/core/composite/compositeFrame.ts` | verbatim | `ea5c91d` | `f0b9c66cf3fbaaadc1c82ae767dc764165e88a45d08e965ff443e7414829740e` | |
| `src/core/sprite/export/atlasFormat.ts` | `src/core/export/atlasFormat.ts` | verbatim | `ea5c91d` | `3804715597a48fa57d5eb5b3948ad0a321ca8f99edc33eb3644e4461a086106a` | |
| `src/core/sprite/export/errors.ts` | `src/core/export/errors.ts` | verbatim | `ea5c91d` | `2fec68b1cb0e8fc0506ce835a93d05e48549dd5dd85556b84c41d87d0adc864b` | |
| `src/core/sprite/export/names.ts` | `src/core/export/names.ts` | verbatim | `ea5c91d` | `72444f549ec41c31853bf1de84540e03be8343be8afa21940a4a65e17ace6db4` | |
| `src/core/sprite/export/pack.ts` | `src/core/export/pack.ts` | verbatim | `ea5c91d` | `507e618ebddc3bb9363ff5599779c478ae6d9ecdd660986ef82629f03b30fcdc` | |
| `src/core/sprite/export/packErrors.ts` | `src/core/export/packErrors.ts` | verbatim | `ea5c91d` | `73a3f90b75e22dab99784872b7422381f870162391e5639001a46658e19ce471` | |
| `src/core/sprite/export/sprite-runtime.ts` | `src/core/export/sprite-runtime.ts` | verbatim | `ea5c91d` | `fbfd33992aa6896ac8ab6444893175e32e2e42a24ab905ad36c2b8f0c7ad1fa3` | |
| `src/core/sprite/export/validateAtlas.ts` | `src/core/export/validateAtlas.ts` | verbatim | `ea5c91d` | `563a9afac931a269e6cd979f0cd5758259411a7a62b26666a351a1d151ec944f` | |
| `src/core/sprite/frames/commands.ts` | `src/core/frames/commands.ts` | verbatim | `ea5c91d` | `60ccb5066a61eaac2c2ced1bb04db68c77093b645ac0fbc25cd5d5f021bd6f99` | |
| `src/core/sprite/frames/errors.ts` | `src/core/frames/errors.ts` | verbatim | `ea5c91d` | `e48e004b7d9b18ad6d248d9f73d5031743cac9131e2ac999e308438b767ea9b6` | |
| `src/core/sprite/frames/index.ts` | `src/core/frames/index.ts` | verbatim | `ea5c91d` | `54421fcc59da187033e3a900a0162812c2d13f12388a392ea0a48c50c4ea0278` | |
| `src/core/sprite/history/allocate.ts` | `src/core/history/allocate.ts` | verbatim | `ea5c91d` | `7184ba4197f39d9b1cad8b26875b505d04a68a913b4b69676178e60366add57e` | |
| `src/core/sprite/history/chained.ts` | `src/core/history/chained.ts` | verbatim | `ea5c91d` | `dbf232c472a81b500ac50a53667daec1425f6e499023be0b507c6c33670b9418` | |
| `src/core/sprite/history/command.ts` | `src/core/history/command.ts` | verbatim | `ea5c91d` | `be3def30f56f5b67c8afc3bed0bcbbafac15bd6ef191534eec4c4f2c5d590288` | |
| `src/core/sprite/history/errors.ts` | `src/core/history/errors.ts` | verbatim | `ea5c91d` | `8d4592872de46e1c413dc540d797a24ef1281f4164340970c308996a41e85130` | |
| `src/core/sprite/history/history.ts` | `src/core/history/history.ts` | verbatim | `ea5c91d` | `80edff1e6ff56b92bf40e6712d884c75f6c73e28ba42bbe791f1cf731083bacb` | |
| `src/core/sprite/history/index.ts` | `src/core/history/index.ts` | verbatim | `ea5c91d` | `cff5290416419ee7277ea96d9f0fdc81326f251290b9d0fa176e090002a7ca4a` | |
| `src/core/sprite/history/pixelPatch.ts` | `src/core/history/pixelPatch.ts` | verbatim | `ea5c91d` | `f827538a45c03bb8382986604d847f882ce8c48289fbbda78f18a07afbb0e580` | |
| `src/core/sprite/history/transaction.ts` | `src/core/history/transaction.ts` | verbatim | `ea5c91d` | `eee05e1c45bdf7d297e87fb29f443908292109c8d3e326ebb3725e97bba15ff2` | |
| `src/core/sprite/model/createDocument.ts` | `src/core/model/createDocument.ts` | verbatim | `ea5c91d` | `8c3355ca03c6d791093440ffd2d83e3f94542f8d355cd939dacd029742222293` | |
| `src/core/sprite/model/defaultPalette.ts` | `src/core/model/defaultPalette.ts` | verbatim | `ea5c91d` | `c0b9e2d8c49af709d876455c9fd242925021c0d3aa61e5b68e1aa0a033cf693c` | |
| `src/core/sprite/model/defaults.ts` | `src/core/model/defaults.ts` | verbatim | `ea5c91d` | `4533c66242fab7e4312344752a421b8e3b27f967ed96693c2bc30e0cbb89975e` | |
| `src/core/sprite/model/ids.ts` | `src/core/model/ids.ts` | verbatim | `ea5c91d` | `d2048173b54881c59783b9d5c68ee2f3beeffe64db318a4d11feb893895e5f0b` | |
| `src/core/sprite/model/index.ts` | `src/core/model/index.ts` | verbatim | `ea5c91d` | `8f7cfb56bec8728df06e1cb2085d40fe16c017c91a6c7ef31312aaad6982017b` | |
| `src/core/sprite/model/invariants.ts` | `src/core/model/invariants.ts` | verbatim | `ea5c91d` | `685aa5db2462177f37bf38570186a6b1fb3d9da320a98532ad596dd00b0f3ca4` | |
| `src/core/sprite/model/limits.ts` | `src/core/model/limits.ts` | verbatim | `ea5c91d` | `c9b830952556d052cac41fb9f17d6221f2c2c89e83dc213ab065c9725039b4c5` | |
| `src/core/sprite/model/queries.ts` | `src/core/model/queries.ts` | verbatim | `ea5c91d` | `7d448563bfed8d318e4240385f5d64b991e410f0a600b21f37efb72e90efb872` | |
| `src/core/sprite/model/types.ts` | `src/core/model/types.ts` | verbatim | `ea5c91d` | `e33b8b6714ff342562c23b6b963add4207c91093455a40caa9130c46b31f96a8` | |
| `src/core/sprite/pixels/buffer.ts` | `src/core/pixels/buffer.ts` | verbatim | `ea5c91d` | `5ead4f2e13ad8249972242340bbbe8bfd3b71a4bcb5e075ca46cc0276807486d` | |
| `src/core/sprite/pixels/index.ts` | `src/core/pixels/index.ts` | verbatim | `ea5c91d` | `338af67efca2a31a448d4d14188df8ffcbdf4f57580d3ffb55b806d497b2c91f` | |
| `src/core/sprite/pixels/transform.ts` | `src/core/pixels/transform.ts` | verbatim | `ea5c91d` | `7ea0c96485aeccecf1f2a98d55adb84bc2d401d9d7d98e2519b214e700ebe9fd` | |
| `src/core/sprite/png/decode.ts` | `src/core/png/decode.ts` | verbatim | `ea5c91d` | `923b8353b8386415b72751d968f0c3c85030e14a6ff69bdfdf34f1f1af52d612` | |
| `src/core/sprite/png/encode.ts` | `src/core/png/encode.ts` | verbatim | `ea5c91d` | `d50020dd5c13da77885b651e66ce4af26e1f88c7e6fc60998cc1ac344dc1fb62` | |
| `src/core/sprite/png/errors.ts` | `src/core/png/errors.ts` | verbatim | `ea5c91d` | `ca62993364a90980ff960025b2c1e44f70acee4d178d6a329aecc6bcadddcdde` | |
| `src/core/sprite/png/index.ts` | `src/core/png/index.ts` | verbatim | `ea5c91d` | `4b4b9eaae82b94e5ebb1cf20b3d503737d9dd560793f9fec68ecd7d3e4a63a4d` | |
| `src/core/sprite/project/deserialize.ts` | `src/core/project/deserialize.ts` | verbatim | `ea5c91d` | `1470409d9327a147e83fd0fa18dbc105a1f970cb5dc9fef7cf0925ad82ca57cf` | |
| `src/core/sprite/project/docFromJson.ts` | `src/core/project/docFromJson.ts` | verbatim | `ea5c91d` | `1995c6b98feb8184a41518007e5e02c9f5c4a7d0805d94a94858453b471e6831` | |
| `src/core/sprite/project/errors.ts` | `src/core/project/errors.ts` | verbatim | `ea5c91d` | `0c38e297d087bf13acb2355cc1d5eca200e712fdd037e71d23c3de8a816558ba` | |
| `src/core/sprite/project/format.ts` | `src/core/project/format.ts` | verbatim | `ea5c91d` | `537f452144cdd86bc9af2f870ec08bbd6b13a7d9ad9ad9f4d5140ca60eecf9b2` | |
| `src/core/sprite/project/json.ts` | `src/core/project/json.ts` | verbatim | `ea5c91d` | `ffb6dfa988fa5062d550a72fa888287e0d090eed73691326228ad845e1b7ed95` | |
| `src/core/sprite/project/manifest.ts` | `src/core/project/manifest.ts` | verbatim | `ea5c91d` | `a086f3c5ea8852cc822fd3c449193977b7cdbdab2e4f9ebd2cc0744dc9e58771` | |
| `src/core/sprite/project/migrations.ts` | `src/core/project/migrations.ts` | verbatim | `ea5c91d` | `7d37d8e4b1a2ef789d878fd3cfe247eae42b4b7513a6543b9dbb2b05a402698c` | |
| `src/core/sprite/project/png.ts` | `src/core/project/png.ts` | verbatim | `ea5c91d` | `7458385e6136b6acd0ea7c0870b56ae825c3d1902f15840af2f5f973b9f3db21` | |
| `src/core/sprite/project/schema.ts` | `src/core/project/schema.ts` | verbatim | `ea5c91d` | `c4b697256a4d319d08e2bc4b644a65d0f4e9585633c6c8bf8c6ed445f23bf3bd` | |
| `src/core/sprite/project/zip.ts` | `src/core/project/zip.ts` | verbatim | `ea5c91d` | `c77aee663b3964e6e2012257dfb9f3fbacf3c685b30ea2c1e58c9fd090b1a7ad` | |
| `src/core/sprite/tags/commands.ts` | `src/core/tags/commands.ts` | verbatim | `ea5c91d` | `39432e0ea2f52efe72d10d9b37e0dc4709d1c1ce34aeff8d6991631c3a538b6f` | |
| `src/core/sprite/tags/errors.ts` | `src/core/tags/errors.ts` | verbatim | `ea5c91d` | `c170d18fa238b0a336594996415b8769df3506216b6b89bc553f1384c372bc62` | |
| `src/core/sprite/tags/follow.ts` | `src/core/tags/follow.ts` | verbatim | `ea5c91d` | `47cf22e4671f43122f3616efbc40720fd4318d7a8f13d41538be09e9dc32504a` | |
| `src/core/sprite/tags/index.ts` | `src/core/tags/index.ts` | verbatim | `ea5c91d` | `53cd62d1e8e1e5e8c601723b38f0bb7f67f20e70ee718c2e51c31d15fe779210` | |
| `src/core/sprite/tags/tagList.ts` | `src/core/tags/tagList.ts` | verbatim | `ea5c91d` | `2645ecaec4b30ada632365a047357c797a1ede9145dee5ebc18d7c1e91ddcdf6` | |
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
| `tests/unit/te-002-fixtures/golden-v1.ngsprite` | `tests/unit/se-040-fixtures/golden-v1.ngsprite` | verbatim | `ea5c91d` | `9e1e15076393d05f99322dfdd866133d191fe6e0cca3cdefd0b710b55ee05044` | |
| `tsconfig.json` | `tsconfig.json` | verbatim | `ea5c91d` | `4dd0bfb34ca25b40ad4fc39e95876e50fad6ebdced165919618156742e15081e` | |
| `tsconfig.node.json` | `tsconfig.node.json` | adapt | `ea5c91d` | | `src/gifenc.d.ts` dropped |
| `vite.config.ts` | `vite.config.ts` | adapt | `ea5c91d` | | Ports 5183/4183 (strict); PWA plugin, manifest, file handler and theme colour are TE-066's; base path from the deploy build |
| `vitest.config.ts` | `vitest.config.ts` | verbatim | `ea5c91d` | `4a41581bc1a038dec83a21477c0a1288d693602ee3001af4327f3d08bad5fea4` | |
| `vitest.perf.config.ts` | `vitest.perf.config.ts` | verbatim | `ea5c91d` | `09675eb8bb88964f2e553c15966b99ced61c8910e3363731e977aa05d1955c9c` | |
