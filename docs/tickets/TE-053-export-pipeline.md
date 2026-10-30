# [TE-053] Export pipeline

Milestone: M7 Export, runtime and preview · Size: L · Depends on: TE-010, TE-051

## Context

Export writes one folder per project: marker, atlases, image PNGs, tilemap JSON and the runtime,
in an order that lets a game's dev server reload only what changed (BRIEF §5, SPEC §10.2,
FORMAT §5).

## Relevant code and documentation

- [SPEC.md](../SPEC.md) §10.2 (folder, marker check, packing, write, failure), §14 (export
  budget).
- [FORMAT.md](../FORMAT.md) §4 (atlas), §5 (export folder, marker file).
- [BRIEF.md](../BRIEF.md) §5 (write order, unchanged files, stable slugs).
- [DESIGN.md](../DESIGN.md) §3.3 rows `app/export/exportFolders.ts`,
  `app/platform/exportFiles.ts`, `ui/export/ExportOverwriteDialog.tsx`.
- `core/pack` (TE-009), `tilemapFor` (TE-049), generator (TE-050), worker (TE-010).

## Required work

- Export plan from the project as of the moment export starts: per tileset `<name>.png` and
  `<name>.atlas.json` (packed in the worker), per image `<name>.png`, per map
  `<map>.tilemap.json`, `ngne-tilemap.ts`, and the marker `ngne-tilemap.export.json`.
- Folder per project ID (directory handle in IndexedDB `ngne-tilemap-editor-export`). Before the
  first write: a marker of another project, or export-named files without a marker, asks
  Replace / Cancel naming that project (adapted `ExportOverwriteDialog`).
- Write order marker → PNGs → atlases → tilemap JSON → runtime; a file whose bytes equal the
  folder's is not rewritten; nothing is removed; a failed write stops with one toast naming the
  file and those written before it.
- Without File System Access the folder downloads as `<exportName>.zip`.
- A stroke in progress stops the export.

## Acceptance criteria

- [ ] `tests/unit/te-053-plan.test.ts`: file names and contents for a project with two maps, two
      tilesets and an image; a 8192 px overflow fails naming the tileset.
- [ ] `tests/e2e/te-053-export.spec.ts`: first export writes every file in order; a second export
      after one cell edit rewrites only that map's JSON; another project's marker asks Replace /
      Cancel; a failing write reports as specified; the zip fallback holds the same files.
- [ ] Measured on reference hardware: export of the reference project ≤ 3 s with no main-thread
      task over 16 ms.

## Validation

- `npm run check`; `npx playwright test tests/e2e/te-053-*`; perf page `tests/perf/te-053-*`.

## Dependencies and scope

- Depends on TE-010, TE-051.
- Out of scope: the Export dialog, Export Again, Export on Save (TE-054); conformance (TE-055).

## Documentation

Adds rows to `docs/PROVENANCE.md`; fills the export cell of SPEC §14.

## Completion handoff

Report per [RULES 12](../../RULES.md): files added and changed; each acceptance item with the
test or measurement that backs it, or why it is not met; anything done differently from the docs
and why; decisions taken under RULES 1; measurements left for reference hardware.
