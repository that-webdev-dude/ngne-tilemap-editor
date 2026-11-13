# NGNE Tilemap Editor — Brief

Agreed 2026-10-30. What the product is, what v1 contains, and every decision the spec builds
on. `SPEC.md`, `DESIGN.md` and `FORMAT.md` refine this file; they do not contradict it
without a new owner decision.

## 1. Summary

A browser-based **tile map builder** in the Tiled mould. Users build tilesets, paint tile
layers (with terrain brushes), mark per-tile collision and properties, place simple marker
shapes (spawns, zones), and export a tilemap that an NGNE game loads without hand-editing —
as ngne-sprite-editor does for sprites.

- The viewport and the game preview are rendered by NGNE (`@ngne/core` 0.3.0): see
  [ENGINE.md](ENGINE.md).
- It is the second tool of the NGNE editor suite: same design system, stack and packaging as
  ngne-sprite-editor: see [SUITE.md](SUITE.md).
- Tiled behaviour it reproduces is documented in [reference/tiled.md](reference/tiled.md).

It is **not a gameplay level editor**: no entity classes, no object references, no
scripting, no in-editor playtest.

## 2. Goals (v1)

- Tiled's core tile-map loop for orthogonal maps: tilesets, tile layers, terrain painting,
  per-tile properties and collision, marker layers, export.
- Works with the sprite editor directly: its project files (`.ngsprite`) and atlases
  (`ngne-sprite-atlas` v1), and grid PNGs, become tilesets; a tileset drawn in the sprite
  editor stays bound to its frames, so edits there come back through "Update tileset from
  source".
- Export consumed by NGNE unmodified: a game scene draws a tilemap with no editor code.
- TMJ (Tiled JSON) import, so existing Tiled maps and community tilesets come in.
- Indistinguishable from the sprite editor in look, interaction and installation.

## 3. Non-goals (v1)

- Gameplay level editing: entity classes, custom property types (classes, enums), object
  references, cross-map links, tile objects, templates, in-editor playtest.
- Server, accounts, collaboration. It is a static, local-first PWA.
- A fallback renderer (WebGPU only, with a blocking notice without it).
- Changes to the NGNE repository.
- Tiled's scripting API, extensions, custom commands, CLI and third-party engine exporters.
- Non-orthogonal orientations, worlds, infinite maps, automapping.
- Touch/pen workflows, mobile layouts.

## 4. Feature scope

**v1** = specified and ticketed · **Later** = recorded backlog · **Out** = not planned.

| Area | Feature | Tier |
| --- | --- | --- |
| Map | Orthogonal orientation; fixed size; tile size; map properties; background colour | v1 |
| Map | Resize / offset map | v1 |
| Map | Isometric, staggered, hexagonal, oblique orientations | Later |
| Map | Infinite maps | Later |
| Layers | Tile, marker, image and group layers; visible, lock, opacity, offset | v1 |
| Layers | Parallax factor and map parallax origin | v1 |
| Layers | Tint colour | Later |
| Layers | Blend modes | Out |
| Tile tools | Stamp brush, eraser, bucket fill, shape fill (rectangle, ellipse) | v1 |
| Tile tools | Rectangle select, magic wand, select same tile; cut, copy, paste, delete | v1 |
| Tile tools | Flip H/V and rotate 90° of stamps and tiles | v1 |
| Tile tools | Capture a stamp from the map (right-drag); stamp from a tileset selection | v1 |
| Tile tools | Random mode, stamp library, stamp variations | Later |
| Terrain | Terrain sets: corner, edge, mixed; terrain brush; terrain fill mode | v1 |
| Terrain | Tile and terrain probability; tile transformations in terrain sets | Later |
| Automapping | Rule maps, rules files | Later |
| Tilesets | Image tileset (grid PNG: margin, spacing, tile offset) | v1 |
| Tilesets | Tileset from a sprite-editor project `.ngsprite` v1: frames composited as the sprite editor exports them, sliced by a grid; tags become tile animations | v1 |
| Tilesets | Tileset from an `ngne-sprite-atlas` v1 (frame = tile), uniform frame size | v1 |
| Tilesets | Collection of images; mixed tile sizes | Later |
| Tilesets | Tile properties; tile class as a plain string | v1 |
| Tilesets | Tile animation editor; atlas animations become tile animations | v1 |
| Tilesets | Tile collision editor (rectangle, ellipse, polygon per tile) | v1 |
| Tilesets | Tilesets shared by every map of a project | v1 |
| Tilesets | Update a tileset from its source file, remapping tiles | v1 |
| Markers | Rectangle, point, ellipse, polygon, polyline; name, class string, properties | v1 |
| Markers | Select, move, resize, edit polygon points, snap to grid | v1 |
| Markers | Marker rotation | Later |
| Objects | Tile objects, text, capsule, templates, object references | Later |
| Properties | Types bool, int, float, string, colour, file | v1 |
| Properties | `object` and `list` types; custom classes and enums | Later |
| Project | One project file holding several maps and their tilesets; maps open as tabs | v1 |
| Worlds | World file, multi-map world view | Later |
| File | Save, open, autosave, recovery | v1 |
| File | NGNE tilemap export | v1 |
| File | Game preview of the current map through the exported runtime | v1 |
| File | TMJ/TSJ import, TSX tileset import, with an import report | v1 |
| File | TMX import; TMJ/TMX export; map PNG export | Later |
| Edit | Unlimited undo within a memory budget; command palette; shortcut sheet; preferences | v1 |
| Automation | Scripting API, extensions, custom commands, CLI | Out |

## 5. Projects, tilesets and export

### Project file

- A project is one `.ngtilemap` file: a zip with the same container rules as the sprite
  editor's `.ngsprite`. It holds every map of the project, every tileset (pixels included),
  each map's thumbnail and the project's export settings.
- Save, open, autosave to IndexedDB, crash recovery, recent files and OS file handling
  work as in the sprite editor. File System Access is used when present; download is the
  fallback.
- Maps inside a project are referenced by stable map ID. Tilesets are project-level and
  shared by every map of the project.

### Tilesets and stable tile IDs

- Importing a grid PNG, a sprite-editor project (`.ngsprite`) or an `ngne-sprite-atlas`
  **copies its pixels into the project**. Each tile gets a stable integer tile ID owned by the
  project; maps store tile IDs, never source frame IDs.
- Each tileset records its source binding: source file name, and per tile the source frame
  ID (atlas), sprite frame ID and grid cell (`.ngsprite`) or grid cell (PNG) and a pixel
  fingerprint (hash of the tile's RGBA pixels).
- A `.ngsprite` is read with the sprite editor's own reader and compositor, copied unchanged
  (D14), so a tile looks exactly as the sprite editor exports that frame.
- **Update tileset from source** (explicit command) re-reads the source and remaps by
  fingerprint: unique matches remap silently, changed pixels at the same frame ID update in
  place, ambiguous and missing tiles are listed in a dialog for the user to resolve. Maps
  never change without this command.
- Atlases whose frames differ in size are refused with a message (mixed sizes are Later).
- Atlas pivots are ignored for tiles; atlas animations become tile animations whose host
  tile is the animation's first frame. A `once` animation is imported as looping, with a
  warning.

### Export

- Export writes one folder per project. The folder holds a marker file naming the project;
  exporting a different project into it asks first.
- Per tileset: a repacked `ngne-sprite-atlas` v1 (`.png` + `.atlas.json`): each tile's
  rectangle padded to even size, with a 1 px extrusion ring and no further gap. Repacking that
  would exceed 8192 px fails with an error naming the tileset.
- Per map: `<map>.tilemap.json` in the `ngne-tilemap` v1 format ([FORMAT.md](FORMAT.md) §3).
- Per image of an image layer: its PNG.
- Once per folder: the generated runtime `ngne-tilemap.ts` (§6).
- Write order PNG → atlas → tilemap JSON → runtime; files whose bytes are unchanged are not
  rewritten, so a game's dev server reloads only what changed. "Export on save" and
  "Export again" work as in the sprite editor.
- Map and tileset export names are stable slugs stored in the project (`[a-z0-9][a-z0-9_-]*`,
  ≤ 64 chars, unique case-insensitively); renaming a map's title does not rename its files.

## 6. Generated runtime (`ngne-tilemap.ts`)

One generated TypeScript module per export folder. Games commit it and never edit it; each
export overwrites it.

- **No imports.** It declares the structural types it needs (sprite sink, image asset
  shape) and takes an `imageAsset` factory from the game. It compiles against `ngne` 0.1.0,
  `@ngne/core` 0.2.x and 0.3.0, under the union of the strictest game settings
  (`verbatimModuleSyntax`, no `allowImportingTsExtensions`, no `DOM.Iterable`, ES2022, no JSON
  imports). A compile test runs against each. It is engine-version agnostic by construction:
  it depends only on a small structural contract (sprite fields, `frame.sprite`, the scene's
  asset map, the game's `imageAsset`; [SPEC.md](SPEC.md) §11.4), which is checked against every
  new NGNE release.
- Header comment names the generator version and the newest format version it reads; it
  reads every older `ngne-tilemap` version.
- **Assets:** one definition object per asset ID, cached at module level; IDs namespaced
  `ngne-tilemap:<export>/<tileset>`; `assetsFor(tilemap)` returns the flat list a scene puts in
  `SceneDefinition.assets`.
- **Draw:** `drawTilemap(frame, tilemap, camera, options)` for `scene.render`: view culling,
  parallax, layer opacity, tile animation from an explicit elapsed-time argument, the 8
  flip/rotate orientations with integer placement corrections for odd tile sizes, render
  scale, tint/alpha, layer filtering. Quads are emitted layer by layer, grouped by tileset,
  with a common depth per layer. It never throws: tilesets missing from the scene's assets
  are skipped and reported once.
- **Data:** a typed tile array per layer that the game can copy and mutate (the draw helper
  can read the game's copy); `tileAt`, `classAt`, `propertyAt(x, y, name)`,
  `grid(property)` returning a `Uint8Array`; per-layer collision as tile shapes and as
  merged rectangles; markers by layer, name and class.

## 7. TMJ import

Imports `.tmj` maps with embedded tilesets, external `.tsj` and `.tsx` (XML) tilesets.
Everything not converted is listed in an import report shown after import.

| Input | Handling |
| --- | --- |
| Non-orthogonal map | Refused |
| Infinite map | Converted to a fixed map over the used bounds |
| `zstd` compression | Refused, with "re-save in Tiled with zlib or gzip" |
| GID flip bits | Decoded with `>>> 0`; bits 31/30/29 kept (flips and 90° rotations); bit 28 cleared |
| Image-collection tileset, uniform tile size | Converted to an image tileset |
| Image-collection tileset, mixed sizes | Refused |
| Object layer: rectangle, point, ellipse, polygon, polyline | Imported as markers |
| Object rotation | Dropped (reported) |
| Tile objects, text, capsule | Dropped (reported) |
| Template instances | Inlined, then treated as above |
| `object`, `list` and class-typed properties | Dropped (reported) |
| Enum properties | Imported as their string or int value |
| Class names | Kept as class strings |
| Layer tint, blend mode | Dropped (reported) |
| Terrain probability, terrain-set transformations, tile probability | Dropped (reported) |

Acceptance fixtures: TMJ, TSJ, TSX and template files authored for this repo by a committed
script, covering every row ([SPEC.md](SPEC.md) §13), each confirmed once to open the same in
Tiled 1.12.2.

## 8. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Performance envelope: ≤ 65,536 tiles per layer in any shape, each side ≤ 4096; ≤ 16 layers; tile size 1–256 px; ≤ 2,000 markers per map; tileset pixels ≤ 32 MP per project. Larger maps open but are not budgeted. Budgets measured at 256×256, 16 px, 8 layers | Covers long side-scrollers (~1000×40) and 256×256 overworlds. The tileset cap bounds memory: each tileset lives in the editor's CPU buffer, NGNE's retained copy and the GPU |
| D2 | Orthogonal only. The model carries `orientation` from day 0 | Every current NGNE game is orthogonal; other orientations add depth sorting, picking and terrain rules; the field keeps them additive |
| D3 | Terrain sets (corner, edge, mixed) with terrain brush and fill mode in v1, reproducing Tiled's algorithm. Automapping and probabilities Later | Terrain painting is what makes tile authoring fast |
| D4 | Tile map builder, not a gameplay level editor: markers only (§4); no custom types, object references or tile objects in v1 | Games keep entity logic in code; markers cover spawn points and zones without a type system; each Later item is additive to the format |
| D5 | One `.ngtilemap` project file holds all maps and tilesets (§5) | Same save/open/autosave/file-handling model as the sprite editor; no directory permissions; tilesets shared within a project |
| D6 | Tileset pixels are snapshotted into the project; tiles have stable project-owned IDs; source changes come in only through "Update tileset from source" with fingerprint remapping (§5) | Atlas frame IDs renumber on edit and a browser cannot watch files; maps must never change silently |
| D7 | Games load the editor's own format `ngne-tilemap` v1: strict JSON, specified in `FORMAT.md`, frozen at 1.0.0, versioned with migrations. TMJ is import only | A small, validated, stable input for games; TMJ is loose and would push a large defensive reader into every game |
| D8 | Export repacks every tileset into its own `ngne-sprite-atlas` v1: rectangles padded to even size, 1 px extrude, no gap between rectangles | One tileset path in games; even padding meets the atlas's even-rectangle rule for odd tile sizes; extrude stops neighbour bleeding, and NGNE's nearest/clamp sampler needs no further gap |
| D9 | Each export writes the generated, import-free runtime `ngne-tilemap.ts` (§6) | NGNE has no tilemap support by design; one tested helper replaces a loader per game; works across the engine versions games use |
| D10 | `@ngne/core` pinned exactly at 0.3.0; no changes to NGNE; gaps worked around in the editor ([ENGINE.md](ENGINE.md)) | One repo, one release train; 0.3.0's lifecycle, resize, release and editable-texture APIs are what the viewport needs |
| D11 | Two-tier viewport: live quads up to 65,536 visible cells; above that, flattened CPU-composited chunk textures patched by `updateTexture` ([ENGINE.md](ENGINE.md) §4) | Spikes S1 and S2: per-tile quads cost ~0.12 µs CPU each, so 65,536 is the most that pans within 10 ms p95 on both reference GPUs; a zoomed-out D1 map is ~524k |
| D12 | Budgets and spike results in [ENGINE.md](ENGINE.md) §6 are the performance baseline for the spec and tickets | Spikes S1, S2 and S4 passed on reference hardware on 2026-10-30 |
| D13 | Same suite as the sprite editor: identity, design system, stack (exact versions), packaging, hosting ([SUITE.md](SUITE.md)) | Both tools must read as one product |
| D14 | Design system and non-engine shared code are copied from the sprite editor with a provenance list and a drift-report script; engine-facing code is written new on 0.3.0 | The sprite editor is released and frozen; a shared package would reopen it. Its engine layer works around 0.2.1 gaps that 0.3.0 removes |
