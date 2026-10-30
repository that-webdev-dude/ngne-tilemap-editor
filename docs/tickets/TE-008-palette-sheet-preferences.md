# [TE-008] Command palette, shortcut sheet and preferences

Milestone: M0 Foundation · Size: M · Depends on: TE-007

## Context

The command palette, shortcut sheet and preferences are shared surfaces of the suite
(DESIGN §1, `se-design` §7). The view preferences of SPEC §3 are app-wide and stored in one
localStorage key.

## Relevant code and documentation

- [DESIGN.md](../DESIGN.md) §3.2 rows `app/commandPalette/*`, `app/shortcuts/*`,
  `ui/shortcuts/*`; §3.3 rows `recentCommands.ts`, `CommandPalette.tsx`,
  `CommandPaletteTrigger.tsx`, `commandPalette.commands.ts`, `hexColour.ts`,
  `PreferencesDialog.tsx`; §9 (Preferences row).
- [SPEC.md](../SPEC.md) §3 (view preferences, `ngne-tilemap-editor.view`).
- [SUITE.md](../SUITE.md) §7 (storage names).

## Required work

- Copy and adapt the rows above. Recent commands under `ngne-tilemap-editor.*`.
- Preferences dialog: theme, checkerboard, grid colour and opacity, highlight-layer opacity
  (default 25%), autosave.
- View preferences store (Show Grid, Show Collision, Highlight Current Layer, Snap to Grid) in
  `ngne-tilemap-editor.view`; the commands that toggle them come with their features.
- Edit menu items Command Palette… (Ctrl+K), Keyboard Shortcuts… (?), Preferences….

## Acceptance criteria

- [ ] `tests/e2e/te-008-palette.spec.ts`: Ctrl+K opens the palette; a fuzzy query finds a
      registered command; Enter runs it; recent commands persist across reload.
- [ ] `tests/e2e/te-008-sheet.spec.ts`: `?` opens the sheet; its list is derived from the
      registry with each command's key.
- [ ] `tests/e2e/te-008-preferences.spec.ts`: each preference persists across reload.
- [ ] `tests/unit/te-008-storage-keys.test.ts`: every localStorage key the app writes starts
      with `ngne-tilemap-editor.`.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-008-*`.

## Dependencies and scope

- Depends on TE-007.
- Out of scope: the features the preferences affect (grid TE-014, highlight TE-034, autosave
  TE-048).

## Documentation

Adds rows to `docs/PROVENANCE.md`. Other docs unchanged.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
