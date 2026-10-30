# [TE-047] Project file workflows

Milestone: M6 Persistence · Size: L · Depends on: TE-010, TE-032, TE-046

## Context

Save, open, revert, recent files and the empty state work as the sprite editor's documents,
applied to one project per window (SPEC §10.1). Save and open run in the worker within the
main-thread budget.

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §10.1 (differences from the sprite editor), §14 (save and open budgets).
- `se/docs/SPEC.md` §10 (file workflows, permissions, gesture lapse, download fallback, file
  names, messages).
- [DESIGN.md](../DESIGN.md) §3.2 row `ui/file/DiscardChangesDialog.tsx`; §3.3 rows
  `ui/file/FileWorkflows.tsx`, `app/file/*`, `app/platform/projectFiles.ts`,
  `app/file/fileName.ts`, `ui/sprite/EmptyState.tsx`; §5 (File menu); §9 (New Project);
  §10.3 (Ctrl+S, Ctrl+Shift+S, Ctrl+O, Ctrl+Alt+N).
- [SUITE.md](../SUITE.md) §7 (pickers, storage names).

## Required work

- Adapt the `se/` file workflow files: New Project (project name, then the New Map fields), Save,
  Save As, Open (picker, drop of a `.ngtilemap` anywhere, recent files), Revert, Close Project;
  File System Access when present, download fallback; default file name from the project name
  with `.ngtilemap`.
- One project per window: opening while dirty asks Save / Discard / Cancel.
- Recent files: 10, IndexedDB `ngne-tilemap-editor-recent`.
- Empty state (adapted `EmptyState`): New Project, Open, Import Tiled Map (enabled by TE-061),
  recent projects. It replaces the default project the app started with since TE-007.
- Save and open through the worker; the editor clipboard is cleared when another project opens.

## Acceptance criteria

- [ ] `tests/e2e/te-047-save-open.spec.ts`: new project → edit → save → reload → open gives the
      same project; Save As, Revert, Close Project; dirty marker follows the history.
- [ ] Open while dirty asks Save / Discard / Cancel and each choice behaves as specified.
- [ ] Download fallback without File System Access (E2E with the API removed).
- [ ] Recent files list up to 10 and reopen; a dropped `.ngtilemap` opens.
- [ ] Opening another project clears the clipboard (E2E).
- [ ] Measured on reference hardware: save of the reference project, main-thread task max
      ≤ 16 ms and total ≤ 3 s; open to first frame ≤ 3 s.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-047-*`; perf page `tests/perf/te-047-*`.

## Dependencies and scope

- Depends on TE-010, TE-032, TE-046.
- Out of scope: autosave and recovery (TE-048), OS file handling (TE-066), Export on Save
  (TE-054).

## Documentation

Adds rows to `docs/PROVENANCE.md`; fills the save and open cells of SPEC §14.

## Completion handoff

Report per [RULES 13](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
