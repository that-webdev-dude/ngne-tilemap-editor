# [TE-067] Release documentation and candidate

Milestone: M9 Hardening and release · Size: M · Depends on: TE-064, TE-065, TE-066

## Context

Release 1.0.0 freezes the file formats (FORMAT stability), ships the user guide and changelog,
and prepares the deployment the owner triggers (SUITE §7). The engine-gap table goes to the NGNE
owner with measured costs (ENGINE §7).

## Relevant code and documentation

- [SUITE.md](../SUITE.md) §7 (hosting, deploy workflow, CI README and link checks,
  CHANGELOG format, formats frozen).
- [ENGINE.md](../ENGINE.md) §7 (gaps; costs filled from measurements).
- [SPEC.md](../SPEC.md) §11.4 (`latest` check before every release).
- [docs/README.md](../README.md) (`GUIDE.md` to be written).
- `se/README.md`, `se/docs/GUIDE.md`, `se/CHANGELOG.md`, `se/.github/workflows/deploy.yml`,
  `se/scripts/check-links.mjs`.

## Required work

- `README.md` (what it is, install, commands); `docs/GUIDE.md` (user guide: projects, tilesets,
  painting, terrain, layers, markers, properties, export, using `ngne-tilemap.ts` in a game, TMJ
  import); `CHANGELOG.md` `## 1.0.0 – <date>` with sections per milestone and Known limitations.
- `package.json` version 1.0.0; generator strings follow it.
- CI jobs: README commands run verbatim; link check over the docs.
- `.github/workflows/deploy.yml`: GitHub Pages, `vite build --base=/ngne-tilemap-editor/`, on a
  `v*` tag or manual dispatch; written, not triggered.
- ENGINE §7 cost column filled from recorded measurements.
- Run the `latest` compatibility check and record its result in the report.
- Clean-up of RULES 9 across the repo; `docs/README.md` index updated (GUIDE written).

## Acceptance criteria

- [ ] README commands job and link check pass in CI.
- [ ] `npm run build` with the release base path serves the app from a sub-path locally (E2E
      smoke against `vite preview --base`).
- [ ] Generator strings in project files, tilemaps and the runtime header read
      `ngne-tilemap-editor 1.0.0` (unit test).
- [ ] `latest` compatibility run recorded; ENGINE §7 costs filled.
- [ ] Owner decision recorded in the report: tag `v1.0.0` and deploy (the owner pushes the tag).

## Validation

- `npm run check`; full `npx playwright test`; CI after the owner pushes.

## Dependencies and scope

- Depends on TE-064, TE-065, TE-066.
- Out of scope: tagging and deploying (owner actions).

## Documentation

Writes `README.md`, `docs/GUIDE.md`, `CHANGELOG.md`; updates `docs/README.md` and ENGINE §7.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
