# Changelog

## 1.0.0 – 2026-11-13

First release. The file formats `.ngtilemap` v1, `ngne-tilemap` v1 and the export folder are
frozen ([FORMAT.md](docs/FORMAT.md)). Tagging `v1.0.0` and deploying to GitHub Pages are the
owner's actions.

### M0 — Foundation

- Scaffold on the sprite editor's stack, design system and app shell, with the sprite editor's
  core copied under provenance and a drift report.
- Cell store with the 8 flip and rotation orientations; project model with invariants.
- Commands, transactions and one undo history per project within a memory budget.
- Menus, keymap, command palette, shortcut sheet and preferences.

### M1 — Viewport

- NGNE WebGPU viewport in two tiers: live quads up to 65,536 visible cells, composited chunk
  textures for overview.
- Pan, zoom, fit, grid, overlay and status bar; background worker; CPU compositor and map
  thumbnails; tileset packing shared with the export.

### M2 — Tile tools

- Current stamp from a tileset, the map or the clipboard; stamp brush, eraser, bucket fill and
  rectangle and ellipse fill.
- Stamp flip and rotation, capture from the map; rectangle select, magic wand, select same tile;
  cut, copy, paste and delete of cells.

### M3 — Tilesets

- Tileset import from grid PNGs, sprite-editor projects (`.ngsprite`) and `ngne-sprite-atlas`
  files, with stable project-owned tile IDs and animations from tags and atlases.
- Tilesets panel, tileset commands and properties.
- Update Tileset from Source with fingerprint remapping and a dialog for ambiguous and missing
  tiles.
- Tile collision editor (rectangle, ellipse, polygon) with Show Collision; tile animation editor.

### M4 — Maps, layers and markers

- Several maps per project as tabs; Maps panel, New Map, Map Properties, Resize / Offset Map.
- Tile, marker, image and group layers with visibility, lock, opacity, offset and parallax;
  Layers panel.
- Rectangle, point, ellipse, polygon and polyline markers with select, create, edit points,
  nudge and clipboard.
- Properties panel for the project, maps, layers, tilesets, tiles and markers: six property
  types, classes, mixed values.

### M5 — Terrain

- Corner, edge and mixed terrain sets reproducing Tiled's terrain filler, checked against Tiled
  1.12.2 goldens.
- Terrains panel, terrain brush with full-tile mode, lines and symmetry, and terrain fill mode for
  the bucket and shape fill.

### M6 — Persistence

- `.ngtilemap` reader and writer with migrations.
- Save, Save As, Open, Open Recent, Revert, file drop and download fallback; autosave to
  IndexedDB, crash recovery and session restore.

### M7 — Export, runtime and preview

- Export folder: repacked atlases, `ngne-tilemap` v1 tilemaps, images and the generated
  import-free runtime `ngne-tilemap.ts` (MIT-0); Export dialog, Export Again and Export on Save;
  unchanged files are not rewritten.
- Runtime data functions and `drawTilemap`, compiled against `ngne` 0.1.0 and `@ngne/core` 0.2.2
  and 0.3.0, with an engine-contract check and a weekly check of the newest engine.
- Export conformance: a fixture game draws every orientation as the editor's compositor does.
- Game preview in the dock through the same runtime; minimap.

### M8 — TMJ import

- Import of Tiled maps (`.tmj`) with embedded, `.tsj` and `.tsx` tilesets and templates, with an
  import report; update of a converted image-collection tileset from source.

### M9 — Hardening and release

- Golden path and E2E regression suite; performance record on reference hardware; GPU frames in
  flight measured.
- Accessibility and interface audit; installable PWA with offline use, `.ngtilemap` file handling
  and update toast.
- README, user guide, changelog, documentation link check, README commands job and the GitHub
  Pages workflow.

### Known limitations

- Desktop Chrome or Edge with WebGPU only; other browsers are unverified. The viewport is not
  operable by screen reader.
- Performance rows over budget on reference hardware, accepted by the owner for 1.0.0
  ([ENGINE.md §6](docs/ENGINE.md#6-budgets-and-spikes), [SPEC.md §14](docs/SPEC.md#14-performance)):
    - the initial overview build after a map opens has one task of 29.0 / 35.3 ms (Intel UHD /
      RTX 4060) against 16 ms, the first texture upload of NGNE 0.3.0;
    - a pan at the live-tier threshold keeps up to 4 GPU frames in flight against 2; NGNE 0.3.0
      gives the editor no way to wait for submitted work;
    - with 2,000 markers, a pan at the live-tier threshold takes 10.6 ms p95 on Intel UHD against
      10 ms.
- Paste of a full 256 × 256 layer runs as one main-thread task of 18–24 ms; no budget covers it.
- Markers and collision shapes are drawn above all tile layers, ignoring layer order and opacity
  (NGNE 0.3.0 has no line or polygon primitives).
- Maps beyond 65,536 cells per layer, 16 layers or 2,000 markers open with a warning and are not
  held to the budgets. Orthogonal maps only.
- Not in 1.0.0: layer tint and blend modes, terrain and tile probabilities, automapping, tile
  objects, TMX import and TMJ export, map PNG export, marker rotation.
- The engine gaps the editor works around are listed with their measured costs in
  [ENGINE.md §7](docs/ENGINE.md#7-engine-gaps).
