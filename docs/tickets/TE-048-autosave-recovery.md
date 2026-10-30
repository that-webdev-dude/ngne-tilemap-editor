# [TE-048] Autosave, recovery and session restore

Milestone: M6 Persistence · Size: M · Depends on: TE-047

## Context

A dirty project is written to IndexedDB 2 s after the last change and offered for recovery on
launch; open tabs and per-map views are restored best effort (SPEC §10.1).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §10.1 (autosave, Web Lock, session state).
- [DESIGN.md](../DESIGN.md) §3.3 rows `ui/autosave/RecoveryDialog.tsx`, `app/autosave/*`;
  §9 (Recovery).
- [SUITE.md](../SUITE.md) §7 (IndexedDB and Web Locks names).

## Required work

- Autosave 2 s after the last change: `project.json`, changed maps' JSON and changed tileset
  and image pixels as raw buffers, keyed by ID, in `ngne-tilemap-editor-autosave`; written
  through the worker; the autosave preference (TE-008) can turn it off.
- Each page holds the Web Lock `ngne-tilemap-editor-page:<id>`; launch offers recovery of
  snapshots whose page lock is free, with map thumbnails (adapted `RecoveryDialog`); discarding a
  snapshot confirms.
- Session state per project ID, best effort: open map tabs and the active one, per-map view and
  active layer.

## Acceptance criteria

- [ ] `tests/e2e/te-048-autosave.spec.ts`: edits, then a closed page without saving; the next
      launch offers recovery; recovering gives the edited project, dirty.
- [ ] A second open window does not offer the first window's live snapshot.
- [ ] Only changed maps and pixels are rewritten after a single-map edit (store spy).
- [ ] Reopening a project restores its tabs, active map, views and active layers.
- [ ] Autosave keeps every main-thread task ≤ 16 ms on the reference project (long-task observer;
      measured on reference hardware).

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-048-*`.

## Dependencies and scope

- Depends on TE-047.
- Out of scope: PWA install and offline (TE-066).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
