# [TE-031] Map commands and map tabs

Milestone: M4 Maps, layers and markers · Size: M · Depends on: TE-015

## Context

A project holds several maps that open as tabs in the menu bar (BRIEF §4, SPEC §7.1). With one
history per project, undoing another map's change must first show that map (SPEC §3).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §3 (one history, undo switches tab, per-map session), §7.1 (maps).
- [DESIGN.md](../DESIGN.md) §3.3 row `ui/tabs/DocumentTabs.tsx` → `ui/tabs/MapTabs.tsx`;
  §2 (menu bar tabs, project name and unsaved marker); §5 (Map menu); §10.3 (Alt+W).
- [ENGINE.md](../ENGINE.md) §3 (texture lifetime), §6 (tab-switch budget).

## Required work

- Commands: New Map (name, size, tile size; defaults from the last new map, first 64 × 64 of
  16 × 16; one tile layer; opens it), Duplicate, Rename, Delete (refused for the last map, no
  confirmation), Move up/down in the map list.
- Map tabs (adapted `DocumentTabs`): open maps of the project, same metrics, keys, drag and
  overflow menu ("All maps"); project name and unsaved marker before the first tab; closing a tab
  hides the map; Close Map (Alt+W); Previous Map, Next Map.
- Undo or redo of an entry for another map switches to that map's tab first.
- Per-map session (view, active layer, selections) kept across tab switches; textures released
  when no open map uses them.

## Acceptance criteria

- [ ] `tests/unit/te-031-map-commands.test.ts`: each command passes the TE-006 symmetry
      harness; deleting the last map is refused.
- [ ] `tests/e2e/te-031-tabs.spec.ts`: new, duplicate, rename, delete and undo restore; closing
      a tab keeps the map; undo of a change on a closed or inactive map opens its tab first;
      view and active layer survive a tab switch.
- [ ] Measured on reference hardware: tab switch to an open map, first frame submitted ≤ 100 ms
      on the reference map.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-031-*`; perf page `tests/perf/te-031-*`.

## Dependencies and scope

- Depends on TE-015.
- Out of scope: Maps panel and dialogs (TE-032), Resize / Offset Map (TE-033).

## Documentation

Adds rows to `docs/PROVENANCE.md`; fills the tab-switch cell of ENGINE §6.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
