# NGNE Tilemap Editor — Interface design

Targets **`@ngne/editor-ui` 0.1.0**. The suite's design canon — principles, layout, tokens,
components, messages, viewport chrome, shared surfaces, interaction and accessibility rules —
is that package's
[DESIGN.md](https://github.com/that-webdev-dude/ngne-editor-ui/blob/v0.1.0/docs/DESIGN.md)
("the canon" below), and the package draws it. This file describes only the tilemap editor's
own interface and its exceptions to the canon; it never restates or changes a rule of the
canon. Behaviour is [SPEC.md](SPEC.md); identity, stack and layout frame are
[SUITE.md](SUITE.md). `se/` is the sprite editor at the commit SUITE §1 names; `se-design` is
its `docs/DESIGN.md` there, cited for the panels and tools this editor rebuilds from it.

## 1. The canon here

| Canon | Here |
| ----- | ---- |
| §1 Principles | All five, with principle 4 read as "Tiled's map, the sprite editor's manners": Tiled's regions, tools and modifiers; the suite's look, menus, command palette and keyboard rules |
| §2 Layout | Regions, sizes and overflow rules; the tab strip holds map tabs, the bottom region the Bottom Panel (§2) |
| §3 Tokens, §4 Components, §5 Messages | As written |
| §6 Viewport chrome | Workspace colour, grid alphas, marching ants, handle style, zoom and Fit in the status bar only, plain-text empty state |
| §7 Shared surfaces | Preferences, Shortcut sheet, Open Source Licences, About, Recovery, overwrite and discard questions, WebGPU required, window too small (§9) |
| §8 Interaction rules, §9 Accessibility | All rules; this editor's exceptions to the 24 px target are in §10.4 |

## 2. Layout

SUITE §3 is the frame; regions and sizes are the canon's §2.

```text
+------------------------------------------------------------------------+
| File Edit Map Layer Tileset Select View Help [Overworld*][Cave] Ctrl K | 36 menu bar
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

| Region | Content |
| ------ | ------- |
| Menu bar | Menus of §5; **map tabs** in the centre (the canon's tab strip, holding the open maps of the project); the project name and unsaved marker sit before the first tab in `--text-muted` |
| Tool rail | Tools of the active layer's kind (§6); its footer (28 px) holds the **stamp preview**: the current stamp at up to 28 × 28 px, a click selects the stamp brush |
| Context bar | Options of §7, from the `*.contextbar.tsx` registry |
| Right dock | Sections, top to bottom: Maps, Layers, Properties, Preview, Minimap; each collapsible. At window heights under 800 px Preview and Minimap start collapsed |
| Bottom region | The **Bottom Panel**, labelled "Bottom Panel", with the canon's splitter, sizes and Tab toggle: tabs **Tilesets** and **Terrains** (§8.5, §8.6) |
| Status bar | Fields of §8.7 |

## 3. Reused components

What this editor takes from `@ngne/editor-ui` 0.1.0 and from `se/`. The package is a
dependency (SUITE §5): its code is imported from its subpaths, never copied or edited (§3.2).
Files taken from `se/` are of three kinds, recorded per file in `docs/PROVENANCE.md` with the
`se/` commit; `scripts/drift.ts` reports later changes to the verbatim rows.

- **Verbatim**: byte-identical to its `se/` source, drift-checked. Every module it imports
  exists here with the same exports (verbatim, or adapted without changing its exports); a row
  that cannot hold moves to Adapt.
- **Adapt**: copied, then changed only as the row states; its exports stay those of `se/`
  unless the row says otherwise.
- **Pattern**: rebuilt for this editor following the `se/` file's structure and the canon's
  rules; no code copied.

Paths are under `se/src/`; the tilemap editor keeps the same path unless the row names another.

### 3.1 Sprite core — verbatim subtree

`src/core/sprite/` holds the `se/src/core/` files in the import closure of
`project/deserialize.ts`, `composite/compositeFrame.ts`, `animation/index.ts`,
`export/pack.ts` and `export/validateAtlas.ts`, each at its `se/src/core/` path below
`src/core/sprite/` and byte-identical: 59 files at the recorded commit (model, pixels, png,
project, composite, animation, export, history, cels, frames, tags). Their only external imports
are `fflate` and `fast-png`. Only the tilemap editor's `core/` modules import from it
(`.ngsprite` reading, frame compositing, tag expansion, packing, atlas validation, PNG and zip),
and it imports nothing outside itself (lint-enforced). The scaffold ticket recomputes the
closure with a script and records every file in `docs/PROVENANCE.md`. When the sprite editor
changes these files (its move to a newer NGNE does not touch `core/`), `scripts/drift.ts`
reports it and a ticket takes the new versions deliberately.

### 3.2 `@ngne/editor-ui` 0.1.0

`src/app/editorUi.ts` creates the editor's one instance (`createEditorUi`): id
`ngne-tilemap-editor` (the storage names of SUITE §7), product name, the menus of §5 ending with
Help, the key contexts of §10.1 with the panel selector, the Bottom Panel (`bottom-panel`,
"Bottom Panel"), a 28 px rail footer, the module maps of the registries (RULES 6), the refresh
stores and the "no project open" gate. `src/ui/shell/EditorShell.tsx` fills the shell's slots.

| Subpath | Use here |
| ------- | -------- |
| `@ngne/editor-ui` | The instance, `UiRoot`; theme, layout and recent-command stores |
| `@ngne/editor-ui/styles.css` | All styling: tokens and component styles |
| `@ngne/editor-ui/primitives` | Every control, popovers that apply on close (layer properties, colour edits) |
| `@ngne/editor-ui/focus` | Focus rules |
| `@ngne/editor-ui/messages` | Toasts, dialog host and `*.dialog.tsx` registry, notices, the Discard / Cancel question, the error boundary per region, the WebGPU-required and window-too-small notices |
| `@ngne/editor-ui/shell` | The shell and its regions; the map tabs on its tab strip (`ui/tabs/MapTabStrip.tsx`); the tool registry (`app/tools/toolRegistry.ts`), context bar, dock and status-field registries |
| `@ngne/editor-ui/commands` | Command registry, keymap and key contexts (`app/keymap/contextState.ts`), menus from the registry, command palette, shortcut sheet, surfaces, key chord display |
| `@ngne/editor-ui/overlay` | `*.overlay.ts` registry with draw orders; wheel travel → zoom steps and pan |
| `@ngne/editor-ui/platform` | Window size, WebGPU check, storage access |
| `@ngne/editor-ui/pwa`, `pwa/worker` | PWA update flow; the service worker (`app/pwa/sw.ts`) |
| `@ngne/editor-ui/about`, `licences` and their `build` subpaths | About and Open Source Licences dialogs and commands; the build facts and `licences.txt` (`vite.config.ts`) |
| `@ngne/editor-ui/colour` | Colour maths for pickers and properties |
| `@ngne/editor-ui/gallery`, `gallery.css` | The development gallery route (`ui/galleryRoute.tsx`) |

Kept verbatim from `se/`: `engine/testing/readCanvas.ts` (canvas readback in E2E) and
`ui/colour/cancelContextMenu.ts`, `colourPicker.css` (the colour panel). PNG codec, zip
container and strict JSON reader come from `core/sprite` (§3.1).

### 3.3 Adapt

| `se/src/` | Change |
| --------- | ------ |
| `app/pwa/sw.ts` | The package's service worker, run with the editor's id (cache and message names `ngne-tilemap-editor-*`, SUITE §7) |
| `app/keymap/contextState.ts` | This editor's state contexts (§10.1), `gesture` and `markers` instead of `floating`, in the package's key-context store |
| `app/tools/toolRegistry.ts` | The editor's one tool registry, on the package's factory |
| `app/tabs/*` | Tabs are maps of the open project, shown on the package's tab strip; overflow menu "All maps" |
| `ui/colour/ColourPicker.tsx` (+ `pickerEdits`, `pickerMath`) | Edits a value given by its caller instead of FG/BG: background colour, layer colours, terrain colours, colour properties; `Hsv` from the package's colour subpath |
| `ui/preferences/PreferencesDialog.tsx` | This editor's preferences (theme, checkerboard, grid colour and opacity, highlight-layer opacity, autosave) |
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
| `core/raster/line.ts` | `lineCells` for cell strokes, checked against Tiled's endpoints |
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
  2 px bar (edge), in full tile mode the cell by a 1 px `--accent` outline (the stamp preview's),
  at the symmetric place too with Alt; cells that cannot be resolved get a 35% `--danger` fill.
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
| Edit | Undo, Redo · Cut, Copy, Paste, Delete · Command Palette…, Preferences… |
| Map | Map Properties…, Resize / Offset Map…, Duplicate Map, Delete Map · Previous Map, Next Map |
| Layer | New Tile Layer, New Marker Layer, New Image Layer…, New Group · Group Layers, Ungroup · Duplicate Layer, Delete Layer, Rename Layer · Layer Properties… · Move Layer Up, Move Layer Down, Select Layer Above, Select Layer Below · Show/Hide Other Layers, Lock/Unlock Other Layers |
| Tileset | Tileset Properties…, Update Tileset from Source…, Delete Tileset · Edit Collision…, Edit Animation… (selected tile) · Previous Tileset, Next Tileset · Flip Stamp Horizontally, Flip Stamp Vertically, Rotate Stamp Right, Rotate Stamp Left |
| Select | Select All, Select None, Invert Selection |
| View | Zoom In, Zoom Out, Fit, 100% · Hide Grid, Show Collision, Highlight Current Layer · Snap to Grid · Hide Bottom Panel · Focus Next Region, Focus Previous Region · Open Source Licences… |
| Help | Keyboard Shortcuts… · About NGNE Tilemap Editor… |

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
Header: New Map (+). The row menu acts on its row's map, which opening it shows, as a tileset
tab's menu shows that tileset (§8.5). A drag moves the map when the row is dropped: one undo
step, Move Map Up or Move Map Down by its direction; it opens no map and leaves the tab strip's
order unchanged. The list is one tab stop; ↑ ↓, Home and End move between rows, Enter or Space
opens the row's map, F2 renames it.

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

As in Tiled: a layer dropped on a group
goes to the bottom of its children; dropped below an expanded group's row, to the top of its
children (the row shown below it); dropped below the last row, to the bottom of the map. ← on
a row that is no expanded group goes to its group's row, → on an expanded group to its top
child; Home and End go to the first and last row. A rename may leave the name blank (Tiled's
layer names may be empty).

As the sprite editor's timeline: Escape keeps the old name; the popover applies on Enter, Escape
or a press outside, and Escape in a number field first drops what the field has not taken; a
press on a row's toggle or opacity focuses the row. Leaving the tree keeps no row: the tab stop
is the active layer's row again. F2 renames the focused row's layer; Rename Layer and Layer
Properties… of the Layer menu act on the active layer and are enabled while the section is
expanded, where the field and the popover show.

### 8.3 Properties (dock)

Two parts: built-in fields of the selection (name, class, and the kind's own fields), then
**Custom properties**: a list of rows `name · type chip · value control`, sorted by name; Add
(+) opens a popover with Name, Type (select) and Add; row menu Rename, Change Type, Remove.
Mixed values show "—" (`se-design` timeline duration rule). The header names what is shown
("Marker · exit", "3 tiles", "Layer · Ground", "Map · Overworld") and holds the panel's menu
(overflow button): Show Selection Properties, Show Project Properties, Show Tileset Properties.
Built-in fields per kind: project name and export name; tileset name, export name, class, tile
size (read-only) and tile offset; tile ID (one tile, read-only) and class; map name, export
name, class, size and tile size (read-only); layer name, class, type (read-only), opacity,
offset and parallax; marker name and class, and for one marker its shape (read-only), X, Y,
and width and height of a rectangle or ellipse. Value controls: bool a checkbox, int a number
field, float a number field of 9 decimals, string a text field, colour a swatch whose picker popover applies on close,
file a text field with Pick. Text fields apply on Enter or leaving, Escape keeps the old value;
Rename edits the name in place; Change Type is a submenu of the six types.

### 8.4 Preview (dock)

The `se-design` §5.5 stage and row, with: resolution select, scale select, play/pause, layer
filter select. Header "Preview · NGNE". Diagnostics in `--warn` under the row.

Recorded by TE-056, as the sprite editor's preview does: the stage is 132 px high and centres
the canvas. The scale is in device pixels per game pixel: Fit (the default) takes the largest
whole scale that fits the stage, and 1/n, the largest that fits, when even 1 does not; 1× to 4×
are used as chosen, and a canvas larger than the stage scrolls in it. The game clears to the
map's background colour over #202020 (#202020 alone without one). The default resolution is
480 × 270. "This layer and below" draws the visible layers up to the active layer, or up to the
top layer inside an active group.

### 8.5 Tilesets (bottom panel)

Tabs per tileset along the top (the sprite editor's tab metrics at 24 px), New Tileset (+) at the
end with Import Tileset…; right side: tile class filter (text field), zoom select (1×–8×,
whole numbers). The grid draws tiles on the checkerboard with 1 px `--border` gaps; selected
tiles have a 2 px `--accent` outline round the selection's rectangle. Tile menu (Menu key,
overflow): Edit Collision…, Edit Animation…, Properties. Tab menu (right click or Menu key on a
tab, which shows that tab): Tileset Properties…, Move Tileset Left, Move Tileset Right, Delete
Tileset; Tiled reorders by dragging tabs, which this panel does not. F2 renames the shown tileset
in its tab. Double click opens the collision editor. Keyboard: the grid is one tab stop; arrows move the selection, Shift extends it, Enter
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

Recorded by TE-057, as Tiled's minimap does: the map keeps its aspect with its longer side at the
section's width, so a tall map is no taller than the section is wide; it is sampled as a
thumbnail (FORMAT §2.7), over the map's background colour, without parallax. A press inside the
rectangle grabs it; a press outside centres the view there first; dragging then moves the view
within the pan limits. A history step of the shown map, a tileset or the project counts as a
change; another map, another project or another section width redraws at once. Redraws start at
least 500 ms apart, so a change after a quiet 500 ms shows within 500 ms, and one made just after
a redraw starts shows with the next: at most 500 ms plus that redraw's time.

## 9. Dialogs and surfaces

| Surface | Kind | Content |
| ------- | ---- | ------- |
| New Project | Dialog | Project name, then the New Map fields for its first map |
| New Map | Dialog | Name, width, height (cells), tile width, height; size presets (32 × 32, 64 × 64, 128 × 128, 256 × 256, 1000 × 40) |
| Map Properties | Dialog | Name, export name, class, tile size, background colour (picker popover, "None"), parallax origin X/Y |
| Resize / Offset Map | Dialog | Width, height, offset X/Y (cells), anchor grid, preview of old bounds inside new |
| New Image Layer | Dialog | Image: the project's images (name and size, the first chosen) and Import PNG… (a PNG equal to a project image chooses it); a refused PNG's reason below; Cancel / Create. Tiled adds an image layer without an image and picks it in the layer's properties; here a layer always names an image (FORMAT §2.5), so the dialog asks first |
| Import Tileset | Large dialog | Accepts `.png`, `.ngsprite` and `.atlas.json` + PNG. Grid PNG: left the image with the grid overlay (adapted `SourcePane`), right the form (tile size, margin, spacing, name, export name) and "n tiles". `.ngsprite`: as grid PNG, the left pane showing the composited frame chosen under it (frame select), the form adding "n frames, m tiles, k animations" and warnings. Atlas: frame list with sizes, animations, warnings. Cancel / Import |
| Update Tileset from Source | Large dialog | Summary line (unchanged, moved, changed, new, ambiguous, missing); a list of ambiguous and missing tiles with old picture, usage ("Overworld: 120 cells"), and a choice per row (candidates, Keep as is, Delete, Replace with… picker); Cancel / Apply |
| Collision Editor | Large dialog | Tool strip (select, edit points, rectangle, ellipse, polygon, snap), tile canvas (`PixelCanvas`, zoom 1–32), shape list with X/Y/W/H fields; Close (edits are live commands) |
| Animation Editor | Dialog | Frame list (thumbnail, duration field, drag handle), frame duration with Apply, Delete; the tileset's tile grid (the panel's zoom) with Add from selection, preview at 1×–4×; Close |
| Tileset Properties | Dialog | Name, export name, class, tile offset X/Y, source (read-only: kind, file, tile size, margin, spacing) |
| Import Tiled Map | Large dialog | Files: folder or files picked, the map (a select when they hold several), required files with status (found, missing) and Add files…; then the report: summary, groups per BRIEF §7 row with counts and locations; Cancel / Import |
| Export | Large dialog | Left: destination folder, project export name, Export on save; right: file list with sizes grouped (tilemaps, tilesets, images, runtime), tileset atlas thumbnails, errors in `--danger`; Close / Export |
| Open Source Licences | Large dialog | View → Open Source Licences…, the last item of the View menu. The text of `licences.txt` ([SUITE.md](SUITE.md) §7) in a monospaced block that keeps its line breaks and scrolls; Close. When the file cannot be read, a line saying so with a link to its address. A dialog, not a tab: a tab the page opens holds the editor's heap (as in the sprite editor) |
| Preferences, Shortcut sheet, About, Recovery, WebGPU required | As the canon's §7 | Preferences fields per §3.3. Shortcut sheet: Help → Keyboard Shortcuts… and `?`. About: Help → About NGNE Tilemap Editor…, enabled with no project open. WebGPU required also shows when the adapter request does not settle: each request has 5 s, a pending one is retried once (an earlier request that answers late still counts), and after the retry the notice shows reason "no adapter" with the detail "WebGPU adapter request timed out". Until then the window stays blank, as in the sprite editor |

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
| `panel` | Focus is in the Tilesets or Terrains panel, the Maps list or the Layers tree (they take arrows, Enter, Home, End) |
| `canvas` | As the sprite editor; fallback for keys a panel does not bind, so tool keys keep working |
| `global` | As the sprite editor |

### 10.2 Rule

A command both editors have uses the sprite editor's key. A command only this editor has uses
Tiled's key ([keyboard shortcuts](https://doc.mapeditor.org/en/stable/manual/keyboard-shortcuts/)) unless the sprite editor binds that key
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
