# [TE-066] Installable PWA and offline use

Milestone: M9 Hardening and release · Size: M · Depends on: TE-063

## Context

The editor installs and works offline like the sprite editor, opens `.ngtilemap` files from the
OS, and announces updates (SUITE §1, §7).

## Relevant code and documentation

- [SUITE.md](../SUITE.md) §1 (manifest, icons, icon mark, favicon), §7 (PWA, service worker,
  updates, file handling, storage names).
- [DESIGN.md](../DESIGN.md) §3.2 rows `ui/pwa/updateToast.ts`, `app/pwa/updates.ts`; §3.3 rows
  `app/pwa/precache.ts`, `app/pwa/sw.ts`, `app/pwa/launchQueue.ts`.
- `se/vite.config.ts:25-73`, `se/scripts/icons.ts`, `se/tests/unit/se-072-pwa.test.ts`.

## Required work

- `vite-plugin-pwa` `injectManifest` with `src/app/pwa/sw.ts`, `injectRegister: false`; one cache
  per deployment (hash of the manifest), cache-first, deleting only caches with the
  `ngne-tilemap-editor-` prefix; message `ngne-tilemap-editor:skip-waiting`.
- Manifest: name, short name, description, `theme_color` / `background_color` from tokens at
  build, icons, `file_handlers` for `.ngtilemap` (`application/x-ngtilemap`), `launch_handler`
  `focus-existing`.
- Icons: `scripts/icons.ts` generates `public/icons/icon-{192,512}.png` and
  `maskable-{192,512}.png` (7 × 7 grid, `--accent`, a 2 × 2 tile-grid glyph); favicon link.
- Update toast "A new version of the editor is ready." with Reload; checks on visibility change
  and hourly.
- Launch queue opens a launched `.ngtilemap` as the project (one project per window rules).

## Acceptance criteria

- [ ] `tests/unit/te-066-pwa.test.ts`: manifest fields and colours; icons equal a fresh
      `scripts/icons.ts` run (drift test); cache names prefixed.
- [ ] `tests/e2e/te-066-offline.spec.ts`: after one load the production build reloads and works
      offline; a new deployment shows the update toast and Reload activates it; old caches of
      this app are removed and the sprite editor's are not.
- [ ] Launch-queue handling opens a file as the project (E2E with a mocked `launchQueue`).
- [ ] Owner check card below passes.

**Owner check — install and file handling**

1. `npm run build && npm run preview`; open `http://localhost:4183/` in Chrome; click the install
   icon in the address bar → Install.
2. Close the app; in Explorer, right-click a saved `.ngtilemap` → Open with → NGNE Tilemap
   Editor.
3. Expected: the installed app opens that project; with the network off it still starts.
4. Reply `pwa pass`, or `pwa fail: <step>`.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-066-*`; the owner check above.

## Dependencies and scope

- Depends on TE-063.
- Out of scope: deployment (TE-067; the owner deploys).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
