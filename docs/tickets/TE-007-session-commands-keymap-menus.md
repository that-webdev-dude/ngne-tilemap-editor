# [TE-007] Session store, command registry, keymap and menus

Milestone: M0 Foundation · Size: L · Depends on: TE-003, TE-006

## Context

One command registry drives menus, palette, shortcuts and the shortcut sheet (SUITE §4), and
the UI changes documents only through registered commands (RULES 4, 6). This ticket adapts the
sprite editor's registry and keymap to this editor's session, menus and key contexts.

## Relevant code and documentation

- [SUITE.md](../SUITE.md) §4 (interaction rules).
- [DESIGN.md](../DESIGN.md) §3.2 and §3.3 rows for `app/commands/*`, `app/keymap/*`,
  `ui/commands/*`, `ui/menubar/*`, `app/surfaces/surfaces.ts`; §5 (menus); §10 (keyboard).
- [SPEC.md](../SPEC.md) §3 (one history per project).
- `se/src/app/commands/`, `se/src/app/keymap/`, `se/src/ui/commands/`,
  `se/src/ui/menubar/`; `se/tests/e2e/harness/se-007-keymap.*` (chord harness pattern).

## Required work

- App session store over `ProjectSession`. Until TE-047 adds the empty state, the app starts with
  `createProject()`.
- Copy and adapt per DESIGN §3.2–§3.3: chord, menu model, registry, `types.ts` (`MENU_BAR` =
  DESIGN §5 menus), `invoke.ts` (no playback state), `appCommands.ts`, `runCommand`,
  `useCommands`, `useEditorKeymap`, `contextMenu`, key classes, resolution, regions, contexts
  `text`, `gesture`, `markers`, `panel`, `canvas`, `global` (DESIGN §10.1), `install.ts`,
  `Chord.tsx`, `MenubarItems`, `surfaces.ts`.
- Register Undo and Redo (Edit), Next/Previous Region (F6, Shift+F6), Hide Bottom Panel (View;
  Tab with the viewport focused).
- E2E chord harness that binds every chord of DESIGN §10.3 to a probe and records which reach the
  page.

## Acceptance criteria

- [ ] `tests/unit/te-007-resolve.test.ts`: for each context of DESIGN §10.1, the first context
      that applies and binds the key wins; † chords act while a text field has focus.
- [ ] Menu bar shows `File Edit Map Layer Tileset Select View` in that order (E2E).
- [ ] Undo and Redo via menu, Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z on a test command (E2E).
- [ ] F6 / Shift+F6 cycle the regions; Tab hides and shows the bottom panel (E2E).
- [ ] `tests/e2e/te-007-chords.spec.ts`: every chord of DESIGN §10.3 reaches the page in
      Chrome.
- [ ] Owner check card below passes.

**Owner check — chords in Chrome**

1. `npm run dev`, open `http://localhost:5183/` in Chrome stable, open the chord harness page the
   ticket names.
2. Press each † chord of DESIGN §10.3 and F6, Shift+F6, Ctrl+G, Ctrl+Shift+↑, Ctrl+Shift+↓.
3. Expected: the harness lists each as received; the browser takes no action of its own.
4. Reply `chords pass`, or `chords fail: <chord>`.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-007-*`; the owner check above.

## Dependencies and scope

- Depends on TE-003, TE-006.
- Out of scope: command palette, shortcut sheet, preferences (TE-008); feature commands (their
  tickets register them).

## Documentation

Adds rows to `docs/PROVENANCE.md`. A chord that does not reach the page gets an alternate key in
DESIGN §10.3 (RULES 1).

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
