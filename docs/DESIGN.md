# NGNE Tilemap Editor — Interface design

The interface of the tilemap editor as **deltas from the sprite editor**. Behaviour is
[SPEC.md](SPEC.md); identity, stack and layout frame are [SUITE.md](SUITE.md). `se/` is the
sprite editor at the commit SUITE §1 names; `se-design` is its `docs/DESIGN.md`.

## 1. Inherited unchanged

These parts of `se-design` apply to this editor as written; this file does not repeat them.

| `se-design` | Content |
| ----------- | ------- |
| §1 Principles | All five, with principle 4 read as "Tiled's map, the sprite editor's manners": Tiled's regions, tools and modifiers; the sprite editor's look, menus, command palette and keyboard rules |
| §3 Tokens | Colour (both themes), type, space, shape, motion, icons, checkerboard, reduced motion |
| §4 Components | Every component and the message channels (toast, status bar, dialog), error boundary per region |
| §2 Overflow rules | Tool rail one/two columns, dock scroll, context bar overflow menu, tab strip, window-too-small notice. The tab strip holds map tabs (§2) |
| §6 Viewport | Workspace colour, 1 px document outline, grid alphas (12% / 25%), marching ants painter, handle style, zoom and Fit in the status bar only, plain-text empty state |
| §7 Shared surfaces | Preferences, Shortcut sheet, Recovery, WebGPU required, overwrite confirm, the "confirm only what undo cannot reverse" rule |
| §8 Accessibility | All rules; this editor's exceptions to the 24 px target are in §10 |

Where this file and `se-design` disagree, this file governs for the tilemap editor.

## 2. Layout

SUITE §3 is the frame; sizes are `se/src/ui/shell/layout.ts`.

```text
+------------------------------------------------------------------------+
| File Edit Map Layer Tileset Select View   [Overworld*][Cave]    Ctrl K | 36 menu bar
+----+------------------------------------------------------+------------+
| B  | Stamp  Fill:Tile|Terrain  Rot ⟲ ⟳  Flip H  Flip V     | Maps       | 36 context bar
| E  +------------------------------------------------------+------------+
| G  |                                                      | Layers     |
| U  |          viewport (NGNE canvas + overlay)            |            |
| M  |                                                      +------------+
| W  |                                                      | Properties |
| S  |                                                      +------------+
| T  |                                                      | Preview    | 264 right dock
| H  |                                                      | Minimap    |
|[▦] +------------------------------------------------------+------------+
| 44 | Tilesets | Terrains     [grass][cave][+]   filter [    ]  zoom 2× | bottom panel
|    | ▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦▦     |
+----+-------------------------------------------------------------------+
| 12, 7  grass#14 solid  2×  Fit  64 × 40 cells  sel 6 × 3  Shift: line   | 24 status bar
+------------------------------------------------------------------------+
```

| Region | Delta from the sprite editor |
| ------ | ---------------------------- |
| Menu bar | Menus of §5; **map tabs** in the centre (the sprite editor's document tabs, holding the open maps of the project); the project name and unsaved marker sit before the first tab in `--text-muted` |
| Tool rail | Tools of the active layer's kind (§6); at the bottom, in place of the colour chips, the **stamp preview**: the current stamp at up to 28 × 28 px, a click selects the stamp brush |
| Context bar | Options of §7, from the `*.contextbar.tsx` registry |
| Right dock | Sections, top to bottom: Maps, Layers, Properties, Preview, Minimap; each collapsible. At window heights under 800 px Preview and Minimap start collapsed |
| Bottom panel | In the timeline's slot with its splitter, sizes and Tab toggle: tabs **Tilesets** and **Terrains** (§8.5, §8.6) |
| Status bar | Fields of §8.7 |

## 3. Reused components

What this editor takes from `se/`. Three kinds, recorded per file in `docs/PROVENANCE.md` at
scaffold with the `se/` commit; `scripts/drift.ts` reports later changes to the verbatim rows.

- **Verbatim**: byte-identical to its `se/` source, drift-checked. Every module it imports
  exists here with the same exports (verbatim, or adapted without changing its exports); the
  scaffold ticket checks this per row and moves a row that cannot hold to Adapt.
- **Adapt**: copied, then changed only as the row states; its exports stay those of `se/`
  unless the row says otherwise.
- **Pattern**: rebuilt for this editor following the `se/` file's structure and `se-design`'s
  rules; no code copied.

Paths are under `se/src/`; the tilemap editor keeps the same path unless the row names another.

### 3.1 Sprite core — verbatim subtree

`src/core/sprite/` holds the `se/src/core/` files in the import closure of
`project/deserialize.ts`, `composite/compositeFrame.ts`, `animation/index.ts`,
`export/pack.ts` and `export/validateAtlas.ts`, each at its `se/src/core/` path below
`src/core/sprite/` and byte-identical: 60 files at the recorded commit (model, pixels, png,
project, composite, animation, export, history, cels, frames, tags). Their only external imports
are `fflate` and `fast-png`. Only the tilemap editor's `core/` modules import from it
(`.ngsprite` reading, frame compositing, tag expansion, packing, atlas validation, PNG and zip),
and it imports nothing outside itself (lint-enforced). The scaffold ticket recomputes the
closure with a script and records every file in `docs/PROVENANCE.md`. When the sprite editor
changes these files (its move to a newer NGNE does not touch `core/`), `scripts/drift.ts`
reports it and a ticket takes the new versions deliberately.

### 3.2 Design system and primitives — verbatim

| `se/src/` | Use here |
| --------- | -------- |
| `ui/styles/tokens.css`, `ui/styles/base.css` (+ token test) | All styling |
| `ui/primitives/*` — `Button`, `IconButton`, `ToolButton`, `Toggle`, `SegmentedControl`, `NumberField` (+ `numberMath`), `Slider`, `Select`, `Popover`, `Dialog`, `ContextMenu`, `Tooltip`, `Splitter` (+ `splitterMath`), `Icon`, `cx`, their CSS | Every control |
| `ui/focus/*` — `inertOutside`, `menuOpener`, `modality`, `returnFocus` | Focus rules |
| `ui/toast/*` | Toasts |
| `ui/dialogs/DialogHost.tsx`, `ui/dialogs/registry.ts`, `app/dialogs/dialogRequests.ts` | Dialog host and `*.dialog.tsx` registry |
| `ui/platform/useWindowSize.ts`, `ui/platform/webgpu.ts` | Window size, WebGPU check |
| `ui/shell/RegionBoundary.tsx`, `ui/shell/layout.ts`, `ui/shell/notices/WindowTooSmall.tsx`, `ui/shell/notices/notice.css` | Error boundary, region sizes, window-too-small notice |
| `ui/gallery/Gallery.tsx` | Dev gallery of primitives; this editor's new components are added to it |
| `ui/timeline/useClosingPopover.ts` | Popovers that apply on close (layer properties, colour edits) |
| `ui/file/DiscardChangesDialog.tsx` | Discard / Cancel question |
| `ui/pwa/updateToast.ts`, `app/pwa/updates.ts` | PWA update flow |
| `app/notices/notices.ts`, `app/platform/storage.ts` | Notices, storage access |
| `app/commands/chord.ts`, `menuModel.ts`, `registry.ts` | Command registry |
| `app/keymap/keyClasses.ts`, `regions.ts`, `regions.commands.ts` | Key classes, F6 regions |
| `app/commandPalette/fuzzy.ts`, `paletteModel.ts` | Command palette model |
| `ui/commands/Chord.tsx` | Key chord display |
| `ui/menubar/MenubarItems.tsx` + CSS | Menus from the registry |
| `app/shortcuts/shortcutSheet.ts`, `ui/shortcuts/ShortcutSheet.tsx` | Shortcut sheet |
| `app/surfaces/surfaces.ts` | Open-surface tracking for key contexts |
| `ui/dock/DockSection.tsx`, `ui/dock/registry.ts` | Collapsible dock sections, `*.dock.tsx` registry |
| `ui/tools/contextBarRegistry.ts`, `app/tools/registry.ts`, `app/tools/toolRegistry.ts` | Context bar and tool registries |
| `app/overlay/overlayLayers.ts` | `*.overlay.ts` registry with draw orders |
| `app/view/wheel.ts` | Wheel travel → zoom steps and pan |
| `core/color/*` (`hex`, `hsv`, `rgba`, `oklab`, `contrast`) | Colour maths for pickers and properties |
| `engine/testing/readCanvas.ts` | Canvas readback in E2E |

PNG codec, zip container and strict JSON reader come from `core/sprite` (§3.1).

### 3.3 Adapt

| `se/src/` | Change |
| --------- | ------ |
| `ui/theme/theme.ts`, `app/commandPalette/recentCommands.ts` | Storage keys `ngne-tilemap-editor.*` (SUITE §7) |
| `app/pwa/precache.ts`, `app/pwa/sw.ts` | Cache and message names `ngne-tilemap-editor-*` (SUITE §7) |
| `ui/shell/notices/WebGpuRequired.tsx` | Product name |
| `app/commands/types.ts` | `MENU_BAR` = this editor's menus (§5) |
| `app/keymap/contextState.ts`, `app/keymap/environment.ts`, `app/keymap/resolve.ts` | This editor's contexts (§10.1): `markers` and `panel` instead of `floating` and `timeline` |
| `app/commands/invoke.ts` | Drop the playback-state dependency |
| `app/commands/appCommands.ts` | Bind to this editor's session store |
| `ui/commands/runCommand.ts`, `useCommands.ts`, `useEditorKeymap.ts`, `contextMenu.ts` | Follow the adapted `appCommands` |
| `app/keymap/install.ts` | This editor's contexts (§10.1) |
| `ui/commandPalette/CommandPalette.tsx`, `CommandPaletteTrigger.tsx`, `app/commandPalette/commandPalette.commands.ts` | Follow the adapted commands |
| `ui/shell/AppShell.tsx`, `ui/shell/layoutStore.ts`, `ui/shell/RailFrame.tsx` | Bottom panel in the timeline's slot; rail fed by the active layer's tool set |
| `ui/shell/regions/MenuBar.tsx`, `ContextBar.tsx`, `Dock.tsx`, `StatusBar.tsx`, `ToolRail.tsx`, `Viewport.tsx` | Map tabs; stamp preview instead of colour chips; this editor's status fields and empty state |
| `ui/tabs/DocumentTabs.tsx`, `ui/tabs/tabs.css`, `app/tabs/*` → `ui/tabs/MapTabs.tsx` | Tabs are maps of the open project; same metrics, keys, drag, overflow menu ("All maps") |
| `ui/tools/VariantToolButton.tsx`, `ui/tools/useToolState.ts`, `toolRail.css`, `contextBar.css` | Bound to this editor's active-tool store |
| `ui/colour/ColourPicker.tsx` (+ `pickerMath`, `pickerEdits`) | Edits a value given by its caller instead of FG/BG: background colour, layer colours, terrain colours, colour properties |
| `ui/preferences/hexColour.ts`, `ui/preferences/PreferencesDialog.tsx` | This editor's preferences (theme, checkerboard, grid colour and opacity, highlight-layer opacity, autosave) |
| `ui/sprite/EmptyState.tsx` | Actions New Project, Open, Import Tiled Map; recent projects |
| `ui/sprite/PivotGrid.tsx` (+ `pivotGridKeys`) | Anchor grid of the Resize / Offset Map dialog |
| `ui/autosave/RecoveryDialog.tsx`, `app/autosave/*` | Project snapshots with map thumbnails |
| `ui/file/FileWorkflows.tsx`, `app/file/*`, `app/platform/projectFiles.ts` | `.ngtilemap`, one project per window (SPEC §10.1) |
| `app/file/fileName.ts` | `.ngtilemap` extension |
| `app/pwa/launchQueue.ts` | Opens a launched `.ngtilemap` as the project |
| `app/export/exportFolders.ts`, `app/platform/exportFiles.ts` | Folder per project ID; database `ngne-tilemap-editor-export` |
| `ui/export/ExportOverwriteDialog.tsx` | Names the other project from the folder marker |
| `ui/export/AtlasThumbnail.tsx` | Shows a packed tileset in the Export dialog |
| `ui/import/SourcePane.tsx` | Grid overlay of the grid-PNG tileset import (tile size, margin, spacing) |
| `app/view/zoom.ts` | Zoom steps 1/32 and 1/16 added below the sprite editor's (SPEC §4.1) |
| `app/view/coordinates.ts`, `navigate.ts`, `pointerNavigation.ts`, `viewNavigation.ts`, `viewPolicy.ts`, `viewportSize.ts` | Map pixels and cells instead of sprite pixels; the new viewport (ENGINE §4) |
| `app/overlay/overlayController.ts`, `draw.ts`, `gridLines.ts`, `types.ts`, `mountOverlay.ts` | Cell grid; this editor's session store and viewport geometry |
| `app/selection/antsGeometry.ts`, `boundaryCache.ts`, `ringPainter.ts` | Ring around a cell mask instead of a pixel mask |
| `app/selection/transform/handles.ts` | Handles of marker and collision-shape boxes |
| `core/selection/mask.ts`, `operations.ts`, `boundary.ts` | Cell masks (replace, add, subtract, intersect, invert) |
| `core/raster/line.ts` | `pointsOnLine` for cell strokes, checked against Tiled's endpoints |
| `core/history/command.ts`, `transaction.ts`, `history.ts`, `allocate.ts`, `errors.ts` | Cell patches instead of pixel patches; one history per project (SPEC §3) |
| `ui/import/PixelCanvas.tsx` | Zoomable checkerboard canvas for the tileset import preview and tile editors; its `core/pixels` import points into `core/sprite` |
| `engine/viewport/checker.ts` | Checkerboard texture for the new viewport |

### 3.4 Pattern only

| `se/src/` | Rebuilt as |
| --------- | ---------- |
| `ui/timeline/LayerRow.tsx`, `LayerProperties.tsx` | Layers panel tree rows and layer properties popover (§8.2) |
| `ui/export/ExportDialog.tsx` | Export dialog (§9) |
| `ui/import/ImportDialog.tsx` | Tileset import dialog (§9) |
| `ui/sprite/NewSpriteDialog.tsx`, `CanvasSizeDialog.tsx` | New Map, Resize / Offset Map (§9) |
| `app/state/status.ts`, `ui/status/statusFields.ts` | Status fields (§8.7) |
| `app/tools/pipeline.ts`, `attachToolPointer.ts`, `activeTool.ts`, `options.ts` | Cell pointer pipeline and tool options (SPEC §4.1) |
| `ui/viewport/OverlayCanvas.tsx`, `ViewportArea.tsx`, `ViewportProbe.tsx` | Viewport host for the new engine layer |
| `ui/preview/PreviewPanel.tsx` | Game preview section (§8.4) |

### 3.5 Not reused

`se/src/engine/*` except the rows above (built on 0.2.1 workarounds, SUITE §6); the sprite
document model as an editing model (it is only read, through `core/sprite`), raster tools, palette, timeline, onion skin, symmetry, reference layers, PNG
quantizing import, GIF and sprite exports.

## 4. Look of the new elements

Every new element uses tokens and primitives only. Specifics:

- **Tile grid** on the viewport: 1 device px lines at the sprite editor's tile-grid alpha (25%),
  white in the dark theme, black in the light one; on from a cell size of 4 device px; toggled by
  Show Grid.
- **Cell selection**: the marching ants of `se-design` §6 around the selected cells.
- **Stamp preview** on the viewport: the stamp's tiles at 60% opacity over the cells it would
  paint, with a 1 px `--accent` outline of its rectangle. Fill tools preview their region the
  same way. Erase previews show a 1 px `--danger` outline of the cells.
- **Terrain brush**: the painted corner or edge marked by a 6 px `--accent` square (corner) or a
  2 px bar (edge); cells that cannot be resolved get a 35% `--danger` fill.
- **Markers**: outlines 1.5 CSS px in their layer's colour on a 1 px black halo; rectangles,
  ellipses and polygons filled with the colour at 15%; points as a 9 px pin (`MapPin`, 16 px)
  anchored at its tip; names in 11 px `--text` on a `--bg-panel` chip at 80% beside the shape.
  Selected markers: 7 px white handles with black border (`se-design` §5.2 handles), vertices as
  5 px squares in Edit points.
- **Collision outlines** (View → Show Collision, off by default): 1 px `--accent` outlines of
  every visible tile's collision shapes, transformed with the tile.
- **Highlight current layer**: other layers drawn at the preference's opacity (default 25%).
- **Tile marks** in the Tilesets panel: a 4 px corner triangle in `--text-muted` for a tile with
  properties or class, a small `▶` glyph for animated, an outline square glyph for collision.
- **Layer type icons** (16 px, lucide): `Grid2x2` tile, `MapPin` marker, `Image` image, `Folder`
  group.

## 5. Menus

Order and items. Keys are §10. Every item is a registered command; disabled items stay visible.

| Menu | Items |
| ---- | ----- |
| File | New Project…, New Map…, Open…, Open Recent ▸, Save, Save As…, Revert · Import Tileset…, Import Tiled Map… · Export…, Export Again · Close Map, Close Project |
| Edit | Undo, Redo · Cut, Copy, Paste, Delete · Command Palette…, Keyboard Shortcuts…, Preferences… |
| Map | Map Properties…, Resize / Offset Map…, Duplicate Map, Delete Map · Previous Map, Next Map |
| Layer | New Tile Layer, New Marker Layer, New Image Layer…, New Group · Group Layers, Ungroup · Duplicate Layer, Delete Layer, Rename Layer · Layer Properties… · Move Layer Up, Move Layer Down, Select Layer Above, Select Layer Below · Show/Hide Other Layers, Lock/Unlock Other Layers |
| Tileset | Tileset Properties…, Update Tileset from Source…, Delete Tileset · Edit Collision…, Edit Animation… (selected tile) · Previous Tileset, Next Tileset · Flip Stamp Horizontally, Flip Stamp Vertically, Rotate Stamp Right, Rotate Stamp Left |
| Select | Select All, Select None, Invert Selection |
| View | Zoom In, Zoom Out, Fit, 100% · Hide Grid, Show Collision, Highlight Current Layer · Snap to Grid · Hide Bottom Panel · Focus Next Region, Focus Previous Region |

## 6. Tool rail

The rail shows the tool set of the **active layer's kind**, as Tiled enables tools per layer
type; the navigate group is always there. Groups top to bottom, separators between groups;
corner mark and press-and-hold variant menu as `se-design` §5.1.

| Layer kind | Groups and tools (icon) |
| ---------- | ----------------------- |
| Tile | paint: Stamp brush (`Stamp`), Eraser (`Eraser`), Bucket fill (`PaintBucket`), Shape fill — variants Rectangle (`Square`) / Ellipse (`Circle`) · terrain: Terrain brush (`Mountain`) · select: Rectangle select (`SquareDashed`), Magic wand (`WandSparkles`), Select same tile (`ScanSearch`) |
| Marker | select: Select (`MousePointer2`), Edit points (`Spline`) · create: Rectangle (`Square`), Ellipse (`Circle`), Point (`MapPin`), Polygon (`Pentagon`), Polyline (`Waypoints`) |
| Image, group, none | No editing tools |
| Always | navigate: Hand (`Hand`), Zoom (`ZoomIn`) |

Switching the active layer between kinds keeps each kind's last tool. The stamp preview sits at
the bottom (§2); one column stacks it, two columns put it full width under the tools.

## 7. Context bars

Left-aligned in this order; fields are `NumberField`, choices `SegmentedControl`, on/off text
toggles (`se-design` §4).

| Tool | Options |
| ---- | ------- |
| Stamp brush | Rotate left / right (icon buttons `RotateCcwSquare`, `RotateCwSquare`), Flip H, Flip V (text buttons; lucide 1.55 has no flip icons), stamp size readout `w × h` |
| Eraser | All layers (toggle, same as Shift) |
| Bucket fill | Fill: Tile / Terrain · Whole selection (toggle, same as Shift) · stamp transforms as the stamp brush |
| Shape fill | Fill: Tile / Terrain · Rectangle / Ellipse · stamp transforms |
| Terrain brush | Terrain set (select), terrain swatches (16 px chips with names, Erase first), Full tile (toggle; Ctrl inverts while held) |
| Rectangle select, Magic wand, Select same tile | Mode: Replace / Add / Subtract / Intersect (`se-design` §5.2 Mode control); the modifiers stand in for one gesture |
| Marker select | X, Y, W, H of the selection's box (px), Snap (toggle) |
| Marker create tools | Snap (toggle) |
| Hand, Zoom | None |

## 8. Panels

### 8.1 Maps (dock)

One row per map of the project in list order: name, open-tab dot, `w × h` in `--text-muted`.
Click opens (or selects) its tab; double click renames in place (rules of `se-design` §5.6
rename); drag reorders; row menu (Menu key, overflow button) Map Properties…, Duplicate, Delete.
Header: New Map (+).

### 8.2 Layers (dock)

A tree of the active map's layers, top of the stack first, 28 px rows: indentation 12 px per
group level, disclosure triangle for groups, type icon, name, then visibility and lock toggles
(eye and lock icons as the sprite editor's timeline, no pressed background). Opacity shows in
the row on hover, focus and whenever below 255, and opens the **layer properties popover**
(name, class, opacity slider, offset X/Y, parallax X/Y; marker layers add colour; image layers
add image and repeat X/Y), applied on close (`useClosingPopover`). The active layer row is
`--bg-active` with a 2 px `--accent` bar on its left; locked or hidden ancestry shows the row
text in `--text-muted`. Drag reorders and moves into groups (drop on a group row's middle
third). Header: New Tile Layer (+) with a variant menu for the other kinds, Delete. The tree is
one tab stop; ↑ ↓ move, ← → collapse/expand, Enter makes active, F2 renames.

### 8.3 Properties (dock)

Two parts: built-in fields of the selection (name, class, and the kind's own fields), then
**Custom properties**: a list of rows `name · type chip · value control`, sorted by name; Add
(+) opens a popover with Name, Type (select) and Add; row menu Rename, Change Type, Remove.
Mixed values show "—" (`se-design` timeline duration rule). The header names what is shown
("Marker · exit", "3 tiles", "Layer · Ground", "Map · Overworld").

### 8.4 Preview (dock)

The `se-design` §5.5 stage and row, with: resolution select, scale select, play/pause, layer
filter select. Header "Preview · NGNE". Diagnostics in `--warn` under the row.

### 8.5 Tilesets (bottom panel)

Tabs per tileset along the top (the sprite editor's tab metrics at 24 px), New Tileset (+) at the
end with Import Tileset…; right side: tile class filter (text field), zoom select (1×–8×,
whole numbers). The grid draws tiles on the checkerboard with 1 px `--border` gaps; selected
tiles have a 2 px `--accent` outline round the selection's rectangle. Tile menu (Menu key,
overflow): Edit Collision…, Edit Animation…, Properties. Double click opens the collision
editor. Keyboard: the grid is one tab stop; arrows move the selection, Shift extends it, Enter
makes the stamp.

### 8.6 Terrains (bottom panel)

Left column (200 px): terrain sets of the active tileset, each expandable to its terrains
(colour chip, name, icon tile); add, rename, delete, reorder; type select per set. Right: the
tileset grid with the selected set's terrain marks drawn over each tile (corner dots and edge
bars in terrain colours); clicking assigns per SPEC §5.1. Under it, "Missing combinations: n"
with a disclosure listing them as small diagrams.

### 8.7 Status bar

Left to right: cell `x, y` (blank off the map) · tile under the cursor `tileset#id` and its
class · zoom with Fit · map size `w × h cells` · selection size `w × h` or marker count. Right:
the active tool's modifier hint, or transient feedback in `--warn` ("Layer is locked").

### 8.8 Minimap (dock)

The whole map from `core/compositor` at the dock width, with the viewport's rectangle as a 1 px
`--accent` outline; drag pans; redrawn after a change settles (≤ 1 per 500 ms).

## 9. Dialogs and surfaces

| Surface | Kind | Content |
| ------- | ---- | ------- |
| New Project | Dialog | Project name, then the New Map fields for its first map |
| New Map | Dialog | Name, width, height (cells), tile width, height; size presets (32 × 32, 64 × 64, 128 × 128, 256 × 256, 1000 × 40) |
| Map Properties | Dialog | Name, export name, class, tile size, background colour (picker popover, "None"), parallax origin X/Y |
| Resize / Offset Map | Dialog | Width, height, offset X/Y (cells), anchor grid, preview of old bounds inside new |
| Import Tileset | Large dialog | Accepts `.png`, `.ngsprite` and `.atlas.json` + PNG. Grid PNG: left the image with the grid overlay (adapted `SourcePane`), right the form (tile size, margin, spacing, name, export name) and "n tiles". `.ngsprite`: as grid PNG, the left pane showing the composited frame chosen under it (frame select), the form adding "n frames, m tiles, k animations" and warnings. Atlas: frame list with sizes, animations, warnings. Cancel / Import |
| Update Tileset from Source | Large dialog | Summary line (unchanged, moved, changed, new, ambiguous, missing); a list of ambiguous and missing tiles with old picture, usage ("Overworld: 120 cells"), and a choice per row (candidates, Keep as is, Delete, Replace with… picker); Cancel / Apply |
| Collision Editor | Large dialog | Tool strip (select, edit points, rectangle, ellipse, polygon, snap), tile canvas (`PixelCanvas`, zoom 1–32), shape list with X/Y/W/H fields; Close (edits are live commands) |
| Animation Editor | Dialog | Frame list (thumbnail, duration field, drag handle), Add from selection, Delete, preview at 1×–4×; Close |
| Tileset Properties | Dialog | Name, export name, class, tile offset X/Y, source (read-only: kind, file, tile size, margin, spacing) |
| Import Tiled Map | Large dialog | Files: folder or files picked, required files with status (found, missing) and Add files…; then the report: summary, groups per BRIEF §7 row with counts and locations; Cancel / Import |
| Export | Large dialog | Left: destination folder, project export name, Export on save; right: file list with sizes grouped (tilemaps, tilesets, images, runtime), tileset atlas thumbnails, errors in `--danger`; Close / Export |
| Preferences, Shortcut sheet, Recovery, WebGPU required | As `se-design` §7 | Preferences fields per §3.3 |

Only actions undo cannot reverse confirm: discarding an unsaved project, discarding a recovery
snapshot, replacing files in an export folder. Delete Map, Delete Layer and Update Tileset rely
on undo.

## 10. Keyboard

### 10.1 Contexts

The sprite editor's resolution model (its SPEC §7.8): first context that applies and binds the
key wins.

| Context | Applies when |
| ------- | ------------ |
| `text` | A text or number field has focus (as the sprite editor) |
| `gesture` | A multi-click gesture is open: polygon or polyline marker, collision polygon, shape fill or terrain line in progress |
| `markers` | The active layer is a marker layer and markers are selected |
| `panel` | Focus is in the Tilesets or Terrains panel or the Layers tree (they take arrows, Enter, Home, End) |
| `canvas` | As the sprite editor; fallback for keys a panel does not bind, so tool keys keep working |
| `global` | As the sprite editor |

### 10.2 Rule

A command both editors have uses the sprite editor's key. A command only this editor has uses
Tiled's key ([reference/tiled.md](reference/tiled.md) §3) unless the sprite editor binds that key
to anything, in which case it gets another key listed here. A command the sprite editor has
without a key may take Tiled's key when that key is free in both editors. Tool keys follow
Tiled in being resolved by the active layer's kind (§6): one letter may name a tile tool and a
marker tool.

### 10.3 Table

| Key | Context | Action | Source |
| --- | ------- | ------ | ------ |
| B | canvas, tile layer | Stamp brush | sprite editor (pencil) = Tiled |
| E | canvas, tile layer | Eraser | both |
| G | canvas, tile layer | Bucket fill | sprite editor (Tiled F) |
| U, Shift+U | canvas, tile layer | Shape fill rectangle, ellipse | sprite editor (rectangle, ellipse) |
| M | canvas, tile layer | Rectangle select | sprite editor (marquee; Tiled R) |
| W | canvas, tile layer | Magic wand | both |
| S | canvas, tile layer | Select same tile | Tiled |
| T | canvas, tile layer | Terrain brush | Tiled |
| V | canvas, marker layer | Marker select | sprite editor (move; Tiled S) |
| O | canvas, marker layer | Edit points | Tiled |
| U, Shift+U | canvas, marker layer | Rectangle, ellipse marker | sprite editor (Tiled R, C) |
| P | canvas, marker layer | Point marker | new (Tiled I is the sprite editor's eyedropper) |
| Shift+D | canvas, marker layer | Polygon marker | sprite editor (polygon; Tiled P) |
| L | canvas, marker layer | Polyline marker | sprite editor (line) |
| H, Z | canvas | Hand, zoom tool | sprite editor |
| Space (hold), middle drag | canvas / pointer | Temporary hand, pan | sprite editor |
| Wheel, Shift+wheel | pointer over viewport | Zoom about cursor, pan horizontally | sprite editor |
| 1–6, 0 | canvas | Zoom 1×, 2×, 4×, 8×, 16×, 32×; Fit | sprite editor |
| R, Shift+R | canvas, tile layer | Rotate stamp right, left | new (Tiled Z is the sprite editor's zoom tool) |
| F, Shift+F | canvas, tile layer | Flip stamp horizontally, vertically | new (Tiled X is the sprite editor's swap colours; F keeps the pair on one key) |
| [ , ] | canvas, panel | Previous, next tileset | Tiled |
| ↑, ↓ | canvas (viewport focused), no marker selection | Select layer above, below | new (the sprite editor binds them in its timeline only; Tiled's Ctrl+PgUp/PgDn are browser-reserved) |
| Ctrl+Shift+↑, Ctrl+Shift+↓ | global | Move layer up, down | Tiled |
| Arrows, Shift+arrows | markers | Nudge 1 px, one cell | sprite editor (nudge) |
| Delete | global | Delete selected cells or markers | sprite editor |
| Enter | gesture | Finish the polygon or polyline | sprite editor |
| Backspace | gesture | Remove the last point | Tiled |
| Escape | canvas, gesture | Cancel the gesture or stroke; else clear the tile selection | sprite editor; Tiled 1.12 |
| Tab | canvas (viewport focused) | Hide / show the bottom panel | sprite editor (timeline) |
| Shift+N | global | New tile layer | sprite editor (new layer) |
| Ctrl+Shift+D | global | Duplicate layer | Tiled (sprite editor's has no key) |
| Ctrl+G | global | Show / hide grid | Tiled (sprite editor's has no key) |
| Shift+H | canvas | Highlight current layer | new (Tiled H is the sprite editor's hand) |
| F2 | panel | Rename the focused layer, map or tileset | Tiled |
| Ctrl+Z; Ctrl+Y, Ctrl+Shift+Z | global | Undo; redo | sprite editor |
| Ctrl+X, Ctrl+C, Ctrl+V | global | Cut, copy, paste (cells or markers) | sprite editor |
| Ctrl+A, Ctrl+D, Ctrl+I | global | Select all, select none, invert | sprite editor (Tiled Ctrl+Shift+A) |
| Ctrl+S †, Ctrl+Shift+S †, Ctrl+O † | global | Save, save as, open | sprite editor |
| Ctrl+Alt+N †, Ctrl+Alt+M † | global | New project, new map | sprite editor (new sprite); new (Ctrl+N is browser-reserved) |
| Alt+W † | global | Close map tab | sprite editor (close document) |
| Ctrl+E †, Ctrl+Shift+X † | global | Export, export again | sprite editor; new (Ctrl+Shift+E is taken by the Redux DevTools extension in Chrome and by Tiled's Export As; Ctrl+Alt+E is AltGr+E, "€" on UK and most European layouts) |
| Ctrl+K † | global | Command palette | sprite editor |
| ? | canvas | Shortcut sheet | sprite editor |
| F6, Shift+F6 † | global | Next, previous region | sprite editor |

† also acts while a text field has focus. A tool's key pressed again while that tool is active
selects the next variant of its slot with the same letter (`se-design` §5.1), so U toggles
rectangle and ellipse fill. Tiled's Ctrl+H, Ctrl+L and Ctrl+PgUp/PgDn are browser-reserved and
have no binding here. The ticket that builds the keymap verifies in Chrome that every chord
reaches the page, as the sprite editor did.

### 10.4 Pointer targets below 24 px

Each also operable from the keyboard: tiles in the Tilesets panel at 1× (arrow keys), terrain
swatches in the context bar (select), marker vertices (Edit points with arrow nudge on the
selected vertex), splitters (as the sprite editor).
