# Implementation tickets

The v1 work of [BRIEF.md](../BRIEF.md) §4 as 67 tickets in 10 milestones. Each ticket is one
file `TE-0xx-<slug>.md` with one concrete outcome, sized so one session finishes it
([RULES](../../RULES.md) 10). Working rules: [RULES.md](../../RULES.md) and
[AGENTS.md](../../AGENTS.md).

## Conventions

| Field | Meaning |
| ----- | ------- |
| ID | `TE-0xx`, sequential in execution order: every ticket depends only on lower IDs, so ID order is a valid order for one developer |
| Title | The line after `[TE-0xx]` in the file's heading; with the prefix it is the commit message, unchanged: `[TE-001] Scaffold, toolchain and CI` on branch `te-001` (RULES 11, 12) |
| Milestone | A group of related tickets; milestones overlap in time, dependencies alone order the work |
| Size | S ≤ 1 day · M 2–3 days · L 4–6 days for one developer |
| Depends on | Tickets that must be Done before this one starts; dependencies implied through another listed ticket are not repeated |
| Status | To do → In progress → Done, kept in the index below only |

**Done** = every acceptance item met and backed by a named test or a recorded measurement,
`npm run check` and the ticket's E2E files pass, no dependency beyond SUITE §5, docs unchanged
unless the ticket's Documentation section names the change, clean-up of RULES 9
([SPEC.md](../SPEC.md) §15, RULES 7).

Tests are named after their ticket: `tests/unit/te-0xx-*.test.ts`, `tests/e2e/te-0xx-*.spec.ts`,
`tests/perf/te-0xx-*`.

## Milestones

| Milestone | Tickets | Outcome |
| --------- | ------- | ------- |
| M0 Foundation | 001–008 | Toolchain, CI, copied sprite core and shell, model, history, commands |
| M1 Viewport | 009–015 | Packing, worker, shared emitter, compositor, both viewport tiers, navigation |
| M2 Tile tools | 016–021 | Pointer pipeline, stamp brush, eraser, fills, selection, clipboard |
| M3 Tilesets | 022–030 | Import of grid PNG, `.ngsprite`, atlas; Tilesets panel; update from source; tile editors |
| M4 Maps, layers and markers | 031–040 | Map tabs and dialogs, resize, layers and panel, image layers, markers, properties |
| M5 Terrain | 041–045 | Wang filler port, fixtures checked in Tiled, Terrains panel, brush, fill mode |
| M6 Persistence | 046–048 | `.ngtilemap` codec, save/open, autosave and recovery |
| M7 Export, runtime and preview | 049–057 | Tilemap format, generated runtime, compile matrix, export, conformance, preview, minimap |
| M8 TMJ import | 058–062 | Fixtures checked in Tiled, map and tileset conversion, import dialog |
| M9 Hardening and release | 063–067 | Golden path, reference-hardware record, audit, PWA, release candidate |

Milestone dependencies (some ticket of the later one depends on some ticket of the earlier one;
transitive links omitted):

```text
M0 Foundation -> M1 Viewport -> M2 Tile tools -> M3 Tilesets
                                                      |
                                                      v
                                          M4 Maps, layers, markers
                                            |                  |
                                            v                  v
                                       M5 Terrain       M6 Persistence
                                            |             |          |
                                            |             v          v
                                            |       M7 Export,    M8 TMJ
                                            |       runtime,      import
                                            |       preview         |
                                            |             |         |
                                            v             v         v
                                           M9 Hardening and release
```

M7's core tickets (049–052) need only M0–M1 and can run early; see Parallel work.

## Ticket index

Dependencies are listed without the `TE-` prefix.

| ID | Title | Size | Depends on | Status |
| -- | ----- | ---- | ---------- | ------ |
| **M0** | **Foundation** | | | |
| [TE-001](TE-001-scaffold-toolchain-ci.md) | Scaffold, toolchain and CI | L | — | Done |
| [TE-002](TE-002-sprite-core-subtree-drift.md) | Sprite core subtree, provenance and drift report | M | 001 | Done |
| [TE-003](TE-003-design-system-shell.md) | Design system, primitives and app shell | L | 002 | Done |
| [TE-004](TE-004-cell-store-orientation.md) | Cell store and orientation algebra | M | 001 | Done |
| [TE-005](TE-005-project-model.md) | Project model and invariants | M | 004 | Done |
| [TE-006](TE-006-commands-history.md) | Commands, transactions and project history | L | 005 | Done |
| [TE-007](TE-007-session-commands-keymap-menus.md) | Session store, command registry, keymap and menus | L | 003, 006 | Done |
| [TE-008](TE-008-palette-sheet-preferences.md) | Command palette, shortcut sheet and preferences | M | 007 | Done |
| **M1** | **Viewport** | | | |
| [TE-009](TE-009-tileset-packing.md) | Tileset packing and packability check | M | 002, 005 | Done |
| [TE-010](TE-010-background-worker.md) | Background worker | M | 009 | Done |
| [TE-011](TE-011-quad-emitter.md) | Shared quad emitter and tile placement | M | 005 | Done |
| [TE-012](TE-012-cpu-compositor.md) | CPU compositor and map thumbnails | M | 005 | Done |
| [TE-013](TE-013-viewport-live-tier.md) | Viewport renderer and live tier | L | 007, 009, 011, 012 | Done |
| [TE-014](TE-014-navigation-overlay-status.md) | View navigation, overlay and status bar | M | 013 | To do |
| [TE-015](TE-015-chunk-tier.md) | Chunk tier and tier switching | L | 014 | To do |
| **M2** | **Tile tools** | | | |
| [TE-016](TE-016-tool-framework.md) | Tool framework and cell pointer pipeline | M | 014 | To do |
| [TE-017](TE-017-stamp-brush-eraser.md) | Current stamp, stamp brush and eraser | L | 016 | To do |
| [TE-018](TE-018-stamp-transforms-capture.md) | Stamp transforms and capture | M | 017 | To do |
| [TE-019](TE-019-flood-bucket-shape-fill.md) | Flood fill, bucket fill and shape fill | M | 018 | To do |
| [TE-020](TE-020-tile-selection-tools.md) | Tile selection tools | M | 019 | To do |
| [TE-021](TE-021-cell-clipboard.md) | Cell clipboard | S | 020 | To do |
| **M3** | **Tilesets** | | | |
| [TE-022](TE-022-import-grid-png-atlas.md) | Tileset import core: grid PNG and atlas | M | 006, 009 | To do |
| [TE-023](TE-023-import-ngsprite.md) | Tileset import core: sprite projects | M | 022 | To do |
| [TE-024](TE-024-import-tileset-dialog.md) | Import Tileset dialog and file drop | L | 007, 010, 023 | To do |
| [TE-025](TE-025-tilesets-panel.md) | Tilesets panel | L | 017, 024 | To do |
| [TE-026](TE-026-tileset-commands-properties.md) | Tileset commands and Tileset Properties | M | 025 | To do |
| [TE-027](TE-027-update-from-source-core.md) | Update tileset from source: matching and apply | M | 023 | To do |
| [TE-028](TE-028-update-from-source-dialog.md) | Update Tileset from Source dialog | M | 026, 027 | To do |
| [TE-029](TE-029-collision-editor.md) | Tile collision editor and Show Collision | L | 025 | To do |
| [TE-030](TE-030-animation-editor.md) | Tile animation editor | M | 025 | To do |
| **M4** | **Maps, layers and markers** | | | |
| [TE-031](TE-031-map-commands-tabs.md) | Map commands and map tabs | M | 015 | To do |
| [TE-032](TE-032-maps-panel-dialogs.md) | Maps panel, New Map and Map Properties dialogs | M | 031 | To do |
| [TE-033](TE-033-resize-offset-map.md) | Resize / Offset Map | M | 032 | To do |
| [TE-034](TE-034-layer-commands.md) | Layer commands | M | 015 | To do |
| [TE-035](TE-035-layers-panel.md) | Layers panel | L | 034 | To do |
| [TE-036](TE-036-image-layers.md) | Image layers | M | 035 | To do |
| [TE-037](TE-037-marker-commands-drawing.md) | Marker commands and overlay drawing | M | 032, 035 | To do |
| [TE-038](TE-038-marker-select-create-tools.md) | Marker select and create tools | L | 016, 037 | To do |
| [TE-039](TE-039-marker-points-nudge-clipboard.md) | Marker edit points, nudge and clipboard | M | 038 | To do |
| [TE-040](TE-040-properties-panel.md) | Properties panel | L | 025, 037 | To do |
| **M5** | **Terrain** | | | |
| [TE-041](TE-041-terrain-filler.md) | Terrain set analysis and filler | L | 005 | To do |
| [TE-042](TE-042-terrain-fixtures-goldens.md) | Terrain fixtures, goldens and Tiled check | M | 041 | To do |
| [TE-043](TE-043-terrains-panel.md) | Terrains panel | L | 025, 032, 041 | To do |
| [TE-044](TE-044-terrain-brush.md) | Terrain brush | L | 042, 043 | To do |
| [TE-045](TE-045-terrain-fill-mode.md) | Terrain fill mode | S | 019, 044 | To do |
| **M6** | **Persistence** | | | |
| [TE-046](TE-046-ngtilemap-codec.md) | `.ngtilemap` reader and writer | L | 002, 012 | To do |
| [TE-047](TE-047-project-file-workflows.md) | Project file workflows | L | 010, 032, 046 | To do |
| [TE-048](TE-048-autosave-recovery.md) | Autosave, recovery and session restore | M | 047 | To do |
| **M7** | **Export, runtime and preview** | | | |
| [TE-049](TE-049-tilemap-writer-reader.md) | Tilemap writer and reader | M | 009 | To do |
| [TE-050](TE-050-runtime-generator-data.md) | Runtime generator and data functions | L | 011, 049 | To do |
| [TE-051](TE-051-runtime-draw.md) | Runtime `drawTilemap` | M | 050 | To do |
| [TE-052](TE-052-runtime-compile-matrix.md) | Runtime compile matrix and engine-contract check | M | 051 | To do |
| [TE-053](TE-053-export-pipeline.md) | Export pipeline | L | 010, 051 | To do |
| [TE-054](TE-054-export-dialog.md) | Export dialog, Export Again and Export on Save | M | 047, 053 | To do |
| [TE-055](TE-055-export-conformance.md) | Export conformance | L | 052, 053 | To do |
| [TE-056](TE-056-game-preview.md) | Game preview | L | 015, 051 | To do |
| [TE-057](TE-057-minimap.md) | Minimap | M | 015 | To do |
| **M8** | **TMJ import** | | | |
| [TE-058](TE-058-tmj-fixtures.md) | TMJ fixtures and Tiled check | M | 002 | To do |
| [TE-059](TE-059-tmj-map-conversion.md) | TMJ map conversion | L | 005, 058 | To do |
| [TE-060](TE-060-tmj-tileset-conversion.md) | TMJ tileset conversion | L | 022, 059 | To do |
| [TE-061](TE-061-import-tiled-map-dialog.md) | Import Tiled Map dialog and report | L | 047, 060 | To do |
| [TE-062](TE-062-update-collection-tileset.md) | Update a collection tileset from source | S | 028, 061 | To do |
| **M9** | **Hardening and release** | | | |
| [TE-063](TE-063-golden-path-regression.md) | Golden path and E2E regression suite | M | 008, 021, 029, 030, 033, 036, 039, 040, 045, 048, 054, 055, 056, 057, 062 | To do |
| [TE-064](TE-064-performance-record.md) | Performance record on reference hardware | M | 063 | To do |
| [TE-065](TE-065-accessibility-interface-audit.md) | Accessibility and interface audit | M | 063 | To do |
| [TE-066](TE-066-installable-pwa.md) | Installable PWA and offline use | M | 063 | To do |
| [TE-067](TE-067-release-docs-candidate.md) | Release documentation and candidate | M | 064, 065, 066 | To do |

## Estimates

| | Count | Developer-days |
| - | ----- | -------------- |
| S | 3 | 1.5–3 |
| M | 39 | 78–117 |
| L | 25 | 100–150 |
| **Total** | **67** | **180–270** |

111 dependency edges. For agent sessions, the sprite editor's measured cost per ticket (with
review and fixes) was about 18% of a 5-hour window for M and 25–35% for L; applied here that is
about 14–16 five-hour windows of work, so the weekly limit, not the 5-hour one, sets the pace.
These are estimates from the sizes, not measurements of this project.

## Owner checks

Manual checks the owner runs; each ticket holds the check card (steps, expected result, reply).

| Ticket | Check | Needs |
| ------ | ----- | ----- |
| TE-001 | CI green on GitHub after the push | — |
| TE-007 | Every chord of DESIGN §10.3 reaches the page in Chrome | Chrome stable |
| TE-042 | Terrain goldens match Tiled cell for cell (SPEC §5.2) | Tiled 1.12.2 |
| TE-058 | TMJ fixtures open in Tiled as described (SPEC §13) | Tiled 1.12.2 |
| TE-065 | Interface against DESIGN.md at 1280 × 720 and 125% zoom | Chrome stable |
| TE-066 | Install, open a `.ngtilemap` from Explorer, start offline | Chrome stable |
| TE-067 | Decide tag `v1.0.0` and deployment; push the tag | — |

Tiled 1.12.2 is needed only at TE-042 and TE-058.

## Measurements

- Benchmarks live under `tests/perf/` (`te-0xx-*`): Node benchmarks run with
  `npx vitest run --config vitest.perf.config.ts`, browser perf pages with Playwright. Neither is
  part of `npm run check`; CI runs them report-only (SwiftShader).
- A number that decides anything comes from reference hardware (ENGINE §6: Windows 11, Chrome
  stable, Intel UHD and RTX 4060), both GPUs, taken with nothing else running, recording CPU,
  power plan and refresh rate (RULES 8).
- The result fills the row's "Measured" cell in ENGINE §6 or SPEC §14 (the first ticket that
  records a SPEC §14 value adds that column) and cites a raw JSON under `docs/evidence/`. Older
  raw files for the same row are deleted (RULES 9).
- A missed budget is reported with its numbers; the ticket does not change the budget.

| Ticket | Measurement |
| ------ | ----------- |
| TE-013 | Pan at the live-tier threshold p95 ≤ 10 ms; dropped frames ≤ 1% |
| TE-015 | Chunk patch settled p95 ≤ 100 ms; chunk memory ≤ 64 MB; rebuild ≤ 500 ms; no task over 16 ms |
| TE-017 | Paint, pointer → frame submitted p95 ≤ 33 ms |
| TE-019 | Bucket fill of 65,536 cells p95 ≤ 100 ms |
| TE-020 | Magic wand of 65,536 cells p95 ≤ 100 ms |
| TE-028 | Update from source, 1,024 tiles ≤ 1 s |
| TE-031 | Tab switch, first frame ≤ 100 ms |
| TE-037 | 2,000 markers within the pan budget |
| TE-044 | Terrain brush step p95 ≤ 33 ms |
| TE-047 | Save: task max ≤ 16 ms, total ≤ 3 s; open to first frame ≤ 3 s |
| TE-048 | Autosave: no main-thread task over 16 ms |
| TE-053 | Export ≤ 3 s, task max ≤ 16 ms |
| TE-055 | Game runtime 480 × 270 ×3 p95 ≤ 8 ms on Intel UHD; 1920 × 1080 recorded |
| TE-064 | Cold load ≤ 2 s; idle 0 frames/s; every row re-measured on the finished build |

## Parallel work

Waves computed from the index: a ticket's wave is one more than the latest wave among its
dependencies. Tickets in one wave do not depend on each other. Letters are sizes.

| Wave | Tickets | Count |
| ---- | ------- | ----- |
| W0 | 001L | 1 |
| W1 | 002M · 004M | 2 |
| W2 | 003L · 005M · 058M | 3 |
| W3 | 006L · 009M · 011M · 012M · 041L · 059L | 6 |
| W4 | 007L · 010M · 022M · 042M · 046L · 049M | 6 |
| W5 | 008M · 013L · 023M · 050L · 060L | 5 |
| W6 | 014M · 024L · 027M · 051M | 4 |
| W7 | 015L · 016M · 052M · 053L | 4 |
| W8 | 017L · 031M · 034M · 055L · 056L · 057M | 6 |
| W9 | 018M · 025L · 032M · 035L | 4 |
| W10 | 019M · 026M · 029L · 030M · 033M · 036M · 037M · 043L · 047L | 9 |
| W11 | 020M · 028M · 038L · 040L · 044L · 048M · 054M · 061L | 8 |
| W12 | 021S · 039M · 045S · 062S | 4 |
| W13 | 063M | 1 |
| W14 | 064M · 065M · 066M | 3 |
| W15 | 067M | 1 |

Longest chain (16 tickets), to release:
`001 → 004 → 005 → 006 → 007 → 013 → 014 → 016 → 017 → 018 → 019 → 020 → 021 → 063 → 064 → 067`.

Chain to a paintable map: `001 → 004 → 005 → 006 → 007 → 013 → 014 → 016 → 017`.
Chain to export conformance, with no UI ticket: `001 → 004 → 005 → 009 → 049 → 050 → 051 → 052 → 055`.

Rules for parallel agents (one ticket each, own worktree and branch `te-0xx`):

- A feature registers through its registry (RULES 6). Registries that later tickets extend
  without editing shared files: commands, keymap and menus (TE-007), dock sections (TE-003),
  overlay layers (TE-014), status fields (TE-014), tools and context bars (TE-016), worker tasks
  (TE-010), the tile menu (TE-025), layer popover fields (TE-035).
- Tickets of one wave that edit the same module run one after the other: in W8, TE-031 then
  TE-034 (both change `src/engine/viewport`).
- `docs/PROVENANCE.md` rows stay sorted by path, so concurrent additions merge cleanly.
- Measurements are taken after the ticket is merged, alone (Measurements above); an implementing
  agent in a parallel run writes the benchmark and leaves the number out.
- Agents do not change Status and do not merge; whoever orchestrates does both.
