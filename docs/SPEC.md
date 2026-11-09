# NGNE Tilemap Editor — Specification

What the editor does and how it is built. Scope and decisions: [BRIEF.md](BRIEF.md). Files:
[FORMAT.md](FORMAT.md). Engine use, viewport tiers and budgets: [ENGINE.md](ENGINE.md). Look,
layout and keys: `DESIGN.md` and [SUITE.md](SUITE.md). Tiled behaviour cited as "Tiled":
[reference/tiled.md](reference/tiled.md). If this file and BRIEF disagree, BRIEF wins; on the
content of a file, FORMAT wins.

## 1. Architecture

```text
 ui/  panels, dialogs, menus ──dispatch──> app/  stores, tools, commands, files
                                              │ execute commands
                                              v
 core/  project model, history, cell store, terrain solver, flood fill,
        compositor, packer, codecs, tilemap writer, runtime source
        │ visible cells, chunk pixels        │ packed atlases, tilemap JSON
        v                                    v
 engine/viewport (WebGPURenderer)      engine/preview (BrowserGame + runtime)
```

| Module | Content |
| ------ | ------- |
| `core/model` | Types of §2, invariants, ID and slug helpers |
| `core/history` | Commands, transactions, the project history (§3) |
| `core/cells` | Chunked cell store, cell value helpers, orientation algebra (§2.3) |
| `core/fill` | Scanline flood fill, shape regions, line points (§4) |
| `core/terrain` | Terrain set analysis and the terrain filler (§5) |
| `core/compositor` | CPU compositing of tile and image layers: chunk tier, thumbnails, minimap (DESIGN §8.8), test references (§10.3) |
| `core/project` | `.ngtilemap` codec (FORMAT §2) |
| `core/tilemap` | `ngne-tilemap` writer and `validateTilemap` (FORMAT §3) |
| `core/pack` | Tileset → `ngne-sprite-atlas` with the sprite editor's packer (§10.2); also the viewport's tileset textures (ENGINE §3) |
| `core/sprite` | The sprite editor's `core/` files that read `.ngsprite`, composite frames, expand tags, pack and validate atlases, and code PNG and zip, byte-identical (DESIGN §3.1); imports nothing outside itself |
| `core/runtime` | Source of the generated runtime (§11), imported as code by the editor and as raw text by the generator |
| `core/tmj` | TMJ/TSJ/TSX parsing and conversion (§13) |
| `app/*` | Session store, tools, pointer pipeline, commands, file workflows, export, import |
| `engine/viewport`, `engine/preview` | The two NGNE canvases (ENGINE §2–§5) |
| `ui/*` | Shell, docks, panels and dialogs (DESIGN.md) |

Layer rules are RULES 4 and 6. Heavy work that would hold the main thread past 16 ms (zip,
deflate, PNG encode and decode, TMJ decompression, packing) runs in a worker
(`app/worker`) that imports only `core/`.

## 2. Project model

### 2.1 Types

The in-memory model. Its file form is FORMAT §2; every member below is persisted unless marked.

```ts
interface Project {
    id: string;                     // FORMAT ID
    name: string;
    exportName: string;             // slug
    maps: ProjectMap[];               // list order = project map list
    tilesets: Tileset[];            // list order = Tilesets panel, assigns firstGid on write
    images: ProjectImage[];
    exportSettings: { exportOnSave: boolean };
    properties: Property[];
}
interface Tileset {
    id: string; name: string; exportName: string; class: string;
    slot: number;                   // 1..255, session-only (§2.2)
    tileWidth: number; tileHeight: number;      // 1..256
    offsetX: number; offsetY: number;           // tile offset
    columns: number;                // grid of the stored image
    pixels: PixelBuffer;            // straight RGBA8, tiles in list order
    nextTileId: number;
    source: TilesetSource;
    tiles: Tile[];                  // display order; tile k at grid position k
    terrainSets: TerrainSet[];
    properties: Property[];
}
interface Tile {
    id: number;                     // 0..1 048 575, stable, never reused
    sourceKey: [number, number] | string | null;
    fingerprint: string;            // FORMAT §2.4
    class: string;
    collision: Shape[];             // tile pixels, untransformed
    animation: { tile: number; ms: number }[];
    properties: Property[];
}
interface ProjectMap {
    id: string; name: string; exportName: string; class: string;
    orientation: "orthogonal";
    width: number; height: number; tileWidth: number; tileHeight: number;
    backgroundColor: number | null; // 0xRRGGBBAA
    parallaxOriginX: number; parallaxOriginY: number;
    nextLayerId: number; nextMarkerId: number;
    layers: Layer[];                // bottom to top; groups hold children
    properties: Property[];
}
type Layer = TileLayer | MarkerLayer | ImageLayer | GroupLayer;
interface LayerBase {
    id: number; name: string; class: string;
    visible: boolean; locked: boolean; opacity: number;      // 0..255
    offsetX: number; offsetY: number; parallaxX: number; parallaxY: number;
    properties: Property[];
}
interface TileLayer extends LayerBase { type: "tile"; cells: CellStore }
interface MarkerLayer extends LayerBase { type: "marker"; color: number; markers: Marker[] }
interface ImageLayer extends LayerBase { type: "image"; imageId: string; repeatX: boolean; repeatY: boolean }
interface GroupLayer extends LayerBase { type: "group"; layers: Layer[] }
type Marker = Shape & { id: number; name: string; class: string; properties: Property[] };
interface ProjectImage { id: string; name: string; exportName: string; pixels: PixelBuffer }
interface PixelBuffer { width: number; height: number; data: Uint8ClampedArray } // straight RGBA8
```

`Shape`, `Property` and cell values are FORMAT §1. `class` is free text, empty for none.

Invariants (asserted after every command in development builds and in tests): FORMAT §2 rules
and limits; at least one map; every cell names an existing tile; every animation frame and
terrain tile names a tile of its tileset; export names distinct (FORMAT §2.4); IDs never reused
(`nextTileId`, `nextLayerId`, `nextMarkerId` only grow).

### 2.2 Cells in memory

- A tile layer's cells live in a `CellStore`: chunks of 32 × 32 cells (`Uint32Array`, absent
  chunk = all empty), keyed by chunk coordinates, each with a count of non-empty cells. The
  chunk size equals the viewport's chunk tier (ENGINE §4), so a dirty chunk maps to one chunk
  texture, and the store is ready for infinite maps (Later).
- In-memory cell value: the flag bits of FORMAT §1.2 unchanged; bits 20..27 the tileset's
  `slot`; bits 0..19 the tile ID; 0 is empty. Slots are assigned when a project opens or a
  tileset is added (lowest free) and never written. Saving and export convert to GIDs with the
  per-map `firstGid` table of FORMAT §1.2; opening converts back. Conversion is O(cells) per map.
- Memory: 4 bytes per allocated cell. The app warns when a project's tileset and cell memory
  exceeds 512 MB and refuses an operation that would exceed 1 GB (typed error, project
  unchanged).

### 2.3 Orientation algebra

`core/cells` holds the 8 orientations of FORMAT §1.2 as 2 × 2 integer matrices and composes
them. Flip horizontal toggles `H`, flip vertical toggles `V` (Tiled's `flip()`, which leaves `D`
alone); rotate right and left map the 3-bit index `H<<2 | V<<1 | D` through Tiled's tables
`rotateRightMask = [5, 4, 1, 0, 7, 6, 3, 2]` and `rotateLeftMask = [3, 2, 7, 6, 1, 0, 5, 4]`
(`src/libtiled/tilelayer.cpp`, tag `v1.12.2`). A unit test checks that each table entry equals
the matrix product, and that the FORMAT §1.2 table equals Tiled's composition (anti-diagonal,
then H, then V). Transforming a stamp also moves its cells: flip mirrors positions, a quarter
turn rotates the stamp's rectangle and swaps its width and height.

## 3. Sessions, commands and undo

```ts
interface ProjectSession {          // core; one per window
    project: Project;
    activeMapId: string;
    perMap: Map<string, MapSession>; // not persisted
}
interface MapSession {
    activeLayerId: number;
    tileSelection: Region | null;   // cell mask + bounds
    markerSelection: number[];      // marker IDs
    view: { centreX: number; centreY: number; zoom: number };
}
interface Command {
    label: string;
    do(s: ProjectSession): void;
    undo(s: ProjectSession): void;
    bytes: number;
    touched: Touched;               // maps, layers, dirty cell rects, tilesets, structure
}
```

- One window holds one project, as Tiled holds one project. Maps of the project open as tabs.
- **One history per project.** Every change to `Project` is a command. An entry records the map
  it changed (or none, for project and tileset edits). Undo or redo of an entry for another map
  first switches to that map's tab, so a change is never undone out of sight.
- Tile selection, marker selection, active layer and view are session state, restored by the
  commands that change them as in the sprite editor.
- A tool stroke is one transaction: `begin` snapshots nothing; the stroke writes cells and
  records `(layer, index, before, after)` for each cell it first changes (12 bytes a cell);
  `commit` makes one command; `abort` (Escape, pointer cancel, right click during a drag)
  restores the before values. A stroke that changes nothing makes no entry.
- After every do, undo and redo the history checks the memory limit (§2.2) and the cells of
  all tile layers of each map against FORMAT §2.8 (4 194 304). A stroke or command that would
  pass either is refused whole: its cells go back, no entry is made, and a toast names the
  limit, as for a command that cannot allocate.
- History budget 256 MB per project; oldest entries dropped first; the newest is kept even when
  it alone exceeds the budget; a new command clears redo. A command that cannot allocate aborts
  cleanly with a toast.
- `touched` drives the viewport (live quads, chunk patches), the thumbnail and the preview.
- View settings (grid, highlight current layer, zoom) and export settings are plain setters with
  no history entry. Export settings make the project dirty; view settings do not.
- Show Grid, Show Collision, Highlight Current Layer and Snap to Grid are app preferences, as in
  Tiled: kept in localStorage (`ngne-tilemap-editor.view`), the same for every project and map.
  Zoom and centre are per-map session state (§10.1).
- The project is **dirty** when its history position differs from the saved one or its export
  settings changed since the save.

## 4. Tile tools

### 4.1 Pointer pipeline

- The overlay canvas takes all pointer input (ENGINE §4). Positions map to map pixels through
  the inverse of the view transform, then to cells with `floor`. Coalesced events are used; a
  drag joins consecutive cells with `pointsOnLine` (Bresenham, Tiled's), so no cell is skipped.
- Tools paint on the **active layer** only. A hidden or locked layer (or one under a hidden or
  locked group) refuses painting with a status-bar message and no change. A tile tool on a
  non-tile layer does nothing and says so.
- Painting is clipped to the map. A tile selection, when present, clips painting by stamp,
  eraser, bucket and shape fill to the selected cells (Tiled).
- Navigation is the sprite editor's (its `app/view`): wheel zooms about the cursor, Shift+wheel
  pans sideways, middle drag or Space-drag pans, keys 1–6 and 0 (DESIGN §10). Zoom is device
  pixels per map pixel on the sprite editor's steps (1/8 to 64) with 1/32 and 1/16 added below
  for overview. The grid shows when a cell is at least 4 device pixels.

### 4.2 Stamp

The **current stamp** is a rectangle of cell values (empty cells allowed), with an anchor at its
centre cell (`floor(w/2), floor(h/2)`). It comes from: a tileset selection (a rectangle of tiles
in the Tilesets panel, laid out as in the panel); a capture from the map; the clipboard. It is
shown at the cursor as a translucent preview on the overlay and in the tool rail.

- **Preview cost** follows what is shown, not the stamp's pixels (Tiled's `BrushItem` draws only
  the exposed part of its preview layer, at the view's scale). The rail composites the stamp at
  its own size. The overlay's stamp and fill previews composite only the part of the stamp in
  view, at the view's scale and at most one texel per map pixel, in chunks of at most 256 × 256
  texels made when first in view; a redraw makes chunks for at most 8 ms after its first and
  leaves the rest to the next frames. A new stamp costs its cells, not the tilesets' pixels: the
  tilesets are read once, and again only when one of them or the cell size changes.

- **Transforms** (keys in DESIGN §10): flip horizontal, flip vertical, rotate right, rotate
  left of the whole stamp (§2.3). They change the stamp only, not the map.
- **Capture** (Tiled): with the stamp brush, bucket or shape fill active, a right drag on the
  map selects a rectangle of the active layer; on release it becomes the current stamp and the
  active tool stays (Tiled switches to the stamp brush only from a tool that does not use the
  stamp, `MapEditor::setStamp`). Shift held at release also erases the captured cells (cut), one
  history entry. A right click without drag captures one cell. As Tiled's
  `capturestamphelper.cpp` (v1.12.2): the stamp is the rectangle's part inside the map, cut to
  the bounding box of its non-empty cells (empty cells inside stay empty); a rectangle with none
  leaves no stamp. A capture only reads: a locked layer is captured but not cut (§4.1); a
  hidden layer, or one under a hidden group, refuses the press (Tiled hides its brush there);
  Ctrl+right does not capture (Tiled keeps it for picking a layer).
- **Removed tiles**: the stamp and the clipboard (§4.4) hold slots and tile IDs (§2.2), so a
  change that removes a tileset or a tile empties their cells on it, as Delete in an update
  erases a deleted tile's cells in the maps (§6.3); a stamp left with no non-empty cell is no
  stamp. Such changes: undoing an import, Delete Tileset (§6.2), Delete and Replace in an update
  from source (§6.3), and the undo or redo of any change that removes one. Tiled does not settle
  this: its stamp holds the tileset itself, not a slot.

### 4.3 Tools

| Tool | Behaviour (Tiled's, `stampbrush.cpp` and siblings) |
| ---- | -------------------------------------------------- |
| Stamp brush | Press and drag paint the stamp at each cell crossed. Empty stamp cells leave the map as it is. Shift+click: a line of stamps from the last painted point. Ctrl+Shift+click: an ellipse of stamps centred on the last painted point through the cursor. Along a line or an ellipse a stamp that would overlap one placed before it is left out (Tiled's `drawPreviewLayer`); with no painted point on the map yet, a Shift+click only sets the start (Tiled sets it at every Shift+click that does not continue a line) |
| Eraser | Press and drag erase the cell under the cursor (line-interpolated). Right drag: erase a rectangle. Shift: erase on all unlocked visible tile layers |
| Bucket fill | Fills the 4-connected region of cells equal to the clicked cell (same tile and flags; Tiled's `Cell` equality) in the map, then only its cells in the selection, if any (Tiled's `computePaintableFillRegion` on a fixed-size map). Shift: fill the whole selection when the clicked cell is in it, or the whole layer without one. The stamp tiles the region from the region's bounding box top-left (Tiled `TileFill`); its empty cells leave the map as it is (Tiled paints the fill's non-empty cells, `modifiedRegion`). A 1 × 1 stamp equal to the clicked cell fills nothing (Tiled). The fill is made at the press (Tiled fills at the release and, since 1.12, also fills the regions of the cells dragged over; neither is done here). Hover previews the region |
| Shape fill | Drag a rectangle or ellipse (context bar toggle); Shift: square / circle; Alt: centred on the press. Filled with the stamp as bucket fill does. Right click or Escape cancels |
| Rectangle select | Drag a rectangle of cells. Mode by modifiers (Tiled): none = replace (or the context bar's locked mode), Shift = add, Ctrl = subtract, Ctrl+Shift = intersect. Right click clears the selection |
| Magic wand | Selects the 4-connected region of cells equal to the clicked one; modes as rectangle select |
| Select same tile | Selects every cell of the active layer equal to the clicked one (empty included when the clicked cell is empty); dragging adds each further cell value hovered; modes as rectangle select |
| Terrain brush | §5.3 |
| Marker tools | §8 |
| Hand, Zoom | The sprite editor's: drag pans; click zooms in, Alt+click out |

Tools are offered by the active layer's kind (DESIGN §6). Bucket fill, shape fill and the terrain fill mode (§5.4) share one fill-mode toggle in the
context bar: **Tile** (stamp) or **Terrain**.

Flood fill (`core/fill`) is one queue-based scanline fill, 4-connected, used by bucket fill and
the magic wand; it returns a region (row spans). An ellipse region is Tiled's `ellipseRegion` of
the drag rectangle: Zingl's Bresenham ellipse with each row filled between its edge cells; it
touches all four sides of the rectangle.

### 4.4 Selection and clipboard

- The tile selection is per map, applies to whichever tile layer is active, and is not saved.
  Marching ants on the overlay.
- Select All, Select None, Invert (Select menu); Escape with a tile tool active clears it
  (Tiled 1.12).
- **Copy** copies the selected cells of the active layer into the clipboard as a stamp (its bounding
  box, cells outside the selection empty). **Cut** copies, erases and clears the selection, one
  entry. **Delete** erases the selected cells and keeps the selection. Cut and Delete are refused on
  a locked layer or one under a locked group, not on a hidden one (Tiled's `isTileSelectionLocked`);
  Copy only reads. **Paste** makes the clipboard the current stamp, cut to the bounding box of its
  non-empty cells, clears the selection (an entry of its own) and selects the stamp brush (Tiled's
  `MapEditor::paste`, v1.12.2). Copy, Cut and Delete act on the selected cells inside the map
  only; a selection moved by Resize / Offset Map (§7.1) can reach past it (Tiled's
  `eraseTileLayers` cuts the region to the layer's bounds). The clipboard is the editor's own,
  shared by all maps of the project; it holds slots and tile IDs, so it is cleared when another
  project opens and loses its cells on removed tiles (§4.2).
- **Crop to Selection** and **New Layer from Selection** are Later.

## 5. Terrain

### 5.1 Terrain sets

A terrain set belongs to one tileset: type corner, edge or mixed; 1 to 254 terrains, each with
a name, a colour and an optional icon tile; and a terrain ID per index (FORMAT §2.4) for each
tile that takes part. Tile probability, terrain probability and terrain-set transformations are
Later: every candidate weighs 1.

Editing (Terrains tab of the bottom panel): add, rename, delete and reorder sets and terrains;
change a set's type (indexes the new type does not use are cleared, in the same entry); select
a terrain and click a tile's corner or edge in the tileset view to assign it (the index is
picked from the cursor as the terrain brush picks it, §5.3); right click clears that index;
Shift+click assigns the whole tile. A count of missing combinations for corner and edge sets
(Tiled's "Patterns" view as a number with a list) shows how complete the set is.

### 5.2 Terrain filler

`core/terrain` ports Tiled's `WangFiller` and `WangSet` analysis
([reference/tiled.md](reference/tiled.md) §4):

- Per set, computed when it changes: the candidate list (base tiles only; no generated
  variants, since transformations are Later), the colour-distance matrix by fixed-point
  relaxation, the maximum distance, completeness (C⁴ or C⁸ combinations present).
- Fill: painting constraints per touched cell (`desired`, `mask`), border seeding for fill
  tools, bounds = region grown by the maximum distance and clipped to the map, row-major
  resolve with lowest transition penalty, one-step look-ahead unless the set is complete,
  updating neighbours' constraints, and the corrections pass for the brush.
- Random choice among equal candidates uses a seeded generator (`xorshift32`); the session
  seeds it from the clock, tests seed it with a constant. With a fixed seed the result is
  deterministic.
- Cells that cannot be resolved are returned as an invalid region; the brush shows them red on
  the overlay and leaves them unchanged.
- Fixtures (`tests/fixtures/terrain/`): corner, edge and mixed sets, complete and incomplete,
  each with exactly one tile per terrain combination; each with scripted strokes (brush,
  full-tile, fill mode) that constrain every index of every cell the filler resolves. Only then
  does one candidate have the lowest penalty, so Tiled's random choice never applies and its
  result is deterministic; an index with no wish (inside a fill region wider than the seeded
  border) leaves equal candidates.
  - Automated: fast-check properties (every resolved cell matches its constraints; a complete
    set leaves no invalid cell; nothing outside the bounds of §5.2 changes) and golden results,
    each traced by hand against `wangfiller.cpp` when written and committed as TMJ.
  - Once, at the terrain ticket: the owner paints the scripted strokes in Tiled 1.12.2 on the
    fixture maps and confirms the goldens cell for cell (manual check card); a mismatch is a
    port bug.

### 5.3 Terrain brush

The context bar picks a terrain set and terrain (or "erase terrain" = 0). Behaviour is Tiled's
`wangbrush.cpp`, tag `v1.12.2`:

- The set and terrain are the Terrains panel's selection for the active tileset (§5.1), as
  Tiled's brush follows its terrain sets view; the context bar and right-click sampling change
  that selection. "Erase terrain" is the brush's own choice, dropped when a terrain is selected
  again. The painting mode is the terrain's effective type in its set (Tiled's
  `effectiveTypeForColor`: in a mixed set a terrain used only at corners paints corners).
- The painted index is picked from the cursor within the cell: corner sets round to the nearest
  corner; edge sets pick the edge by the cell's diagonals; mixed sets use a 3 × 3 grid of the
  cell (`WangId::indexByGrid`: sides = edges, corners = corners, the centre paints nothing).
- Drag paints continuously: each new target is joined to the one before by a line without
  diagonal steps (corner and edge modes; in full tile mode with them), and in edge mode the
  edge follows the direction of the drag (moving right paints the left edge of the cell
  entered). Shift: a line from the last painted point; the first Shift+click after the tool is
  selected only sets the start (Tiled's `mLineStartSet`); Shift pressed during a drag ends its
  painting, as Tiled's brush then turns to its line behaviour. Lines of corner and edge modes
  take no diagonal steps; a line in full tile mode may, and a line of a mixed set is painted in
  full tile mode, as Tiled does. **Full tile mode** (context bar
  toggle, Ctrl inverts it while held) sets every index of the cell and the shared indexes of its
  neighbours. Alt adds rotational symmetry: each painted index is also painted at the cell
  `(width − x − 1, height − y − 1)` with the terrain index turned by 180°.
- Right click without modifiers samples the terrain under the cursor into the context bar (an
  empty cell or a tile outside the set samples "erase terrain").
- One stroke is one entry; the filler runs with corrections on at each step. The tile selection
  does not clip the brush (Tiled's brush paints through `PaintTileLayer`, not `TilePainter`;
  §4.1 lists the tools it clips). Between strokes the overlay shows what a press at the cursor
  would leave invalid (Tiled's brush preview).

### 5.4 Terrain fill mode

Bucket fill and shape fill in Terrain mode fill their region with tiles of the terrain set
selected for the terrain brush, as Tiled's `wangFill` (`abstracttilefilltool.cpp`, tag
`v1.12.2`): `WangFiller` given the region only (`setRegion`, no index painted, so the selected
terrain is not used), border seeding from outside neighbours, corrections off. Only the border
has to match the cells around the region; inside it the filler chooses freely among equal
candidates (§5.2).

## 6. Tilesets

One tileset file operation (Import Tileset, Update Tileset from Source) runs at a time: while it
runs, file drops, those two commands and the tileset dialogs (Edit Collision, Edit Animation,
Tileset Properties) are unavailable, and an operation given up after it started is reported by a
toast.

### 6.1 Import

File → Import Tileset… or a file dropped on the Tilesets panel; a `.ngsprite` dropped anywhere
else in the window is imported as a tileset too (a `.ngtilemap` dropped there opens).

- **Grid PNG**: dialog with tile
  width and height, margin, spacing, a live grid preview, name and export name (slug of the
  file name, made unique). Every grid cell becomes a tile, IDs 0.. in row-major order (Tiled);
  partial cells at the right and bottom are not tiles. As Tiled's `initializeTilesetTiles`
  (v1.12.2), the grid starts at the margin and steps by the tile size plus the spacing, and a
  cell is a tile when it lies whole inside the image: the margin counts at the left and top
  only. The tiles' pixels are copied into the tileset's stored grid. As Tiled's New Tileset
  dialog (v1.12.2), the form starts with the active map's tile size and the margin and spacing
  of the last grid PNG imported in the window (0 at first). The export name follows the name
  until it is typed.
- **Sprite project `.ngsprite`** (picked or dropped like a PNG): the sprite editor's own file,
  so a tileset drawn there comes in without an export step. It is read by the sprite editor's
  reader (`core/sprite`, its `FORMAT.md` §1; a newer version is refused naming both versions)
  and each frame is composited as the sprite editor exports it (`compositeFrame`: visible pixel
  layers with layer and cel opacity and blend modes; reference layers left out). The dialog
  slices every frame by a grid (tile width and height, margin, spacing). Defaults: the sprite's
  grid (its cell size; its offset as margin when the x and y offsets are equal and not
  negative, else margin 0) when the cell is at most 256 px a side, else the whole canvas (one
  tile per frame) when it is at most 256 px a side, else none: Import stays disabled until a
  tile size of at most 256 is entered.
  - Tiles: each grid cell of each frame, frames in order, cells row by row, IDs 0..; a cell
    whose pixels equal the same cell of an earlier frame is not a new tile. Source key
    `[frameId, column, row]` of the cell's first occurrence (FORMAT §2.4). Sprite frame IDs are
    stable in the sprite editor, so inserting, deleting or reordering frames there does not
    break the binding.
  - Animations: each tag, expanded as the sprite editor's atlas export expands it
    (`expandTag`: reverse and ping-pong written out; a repeat count other than 0 imported as
    looping, with a warning); a sprite with several frames and no tag counts as one tag over
    all frames. For each tag and each grid cell whose pixels change within the tag, the
    cell's tile at the tag's first expanded frame (the first it plays: the last of its range
    when reversed, as the atlas's first entry) is animated through that cell's tiles at the
    expanded frames, each for its frame's duration. A tile that would host a second animation
    keeps the first; the others are warned about.
  - With one tile per frame, the tileset shows the same pixels and animations as the one
    imported from the atlas the sprite editor exports from the same sprite (frames all, no
    trim); only the source keys differ, and a frame identical to an earlier one is that
    frame's tile. One exception: a tag under which no cell changes (one frame, or identical
    frames) animates nothing here, where the atlas gives its first frame an animation that
    shows one picture. A test checks this on a fixture sprite and the atlas the sprite editor
    exports from it.
- **`ngne-sprite-atlas`** (the `.atlas.json` and its PNG, picked or dropped together; the atlas
  is checked with the sprite editor's `validateAtlas` rules; its PNG is the file its `image`
  names, else the only PNG among the files, and without one the import is refused naming it):
  every frame becomes a tile, IDs 0..
  in the order of `frames`, source key = frame ID. A frame is rebuilt at its source size
  (`sourceW × sourceH`, its rectangle's content placed at `offsetX, offsetY`). Frames of
  different source sizes, or a source size above 256, refuse the import with a message naming
  the frames. Pivots are
  ignored. Each animation becomes the animation of the tile of its first entry's frame, `ms`
  kept; a `once` animation is imported as looping, and a second animation on the same first
  frame is dropped; both are warned about in the import result.
- Pixel limits (FORMAT §2.8) refuse an import that would exceed them, before decoding.
- **Packability:** every tileset can always be exported. An import or an update from source
  that would give a tileset more distinct tiles than its export atlas holds
  (§10.2: `⌈√r⌉ × (w + 2) ≤ 8192` and `⌈r / ⌈√r⌉⌉ × (h + 2) ≤ 8192` for `r` distinct tiles of even
  size `w × h`, e.g. at most 961 tiles of 256 × 256) is refused with that limit in the message.
  The check runs the packer's layout only, without pixels, before decoding: each grid cell
  counts as a distinct tile, and atlas frames count once per distinct rectangle and offset.
- New tilesets go to the end of the list. One command; undo removes the tileset.

### 6.2 Tilesets panel

Tabs per tileset (Tiled's `tilesetdock`), a zoomable grid of tiles in display order drawn with
Canvas2D, a filter by tile class; click or drag a rectangle to make the current stamp. The tile
under the cursor and the selected tile show
their ID and class in the status bar. Tiles with collision, animation or properties carry small
markers (DESIGN). As Tiled's `TilesetDock` (v1.12.2): the grid lays tiles out on the tileset's
own columns; a pointer selection is the current stamp at every change (a keyboard selection on
Enter, DESIGN §8.5); Previous and Next Tileset stop at the first and last tab; adding a tileset
leaves the tab shown, and removing the shown one shows the tab after it, else the last. As
Tiled's `MapEditor::setStamp`, a stamp from the panel selects the stamp brush unless the stamp
brush, the bucket or the shape fill is active, and a selection without a tile leaves the stamp
as it is. The class filter (Tiled has none) shows the tiles whose class contains its text,
ignoring case, and hides the others in place: the layout is kept, and a hidden tile is an empty
cell of a stamp across it. Tileset commands: rename, edit tile offset, move left/right in the list,
delete (refused while any map uses one of its tiles: the message names the maps; Later: delete
with replacement).

### 6.3 Update tileset from source

An explicit command (Tileset menu). It asks for the source file (the file picker opens with the
recorded file name; drop works too; a `"collection"` tileset asks for its TSJ, TSX or TMJ and
the tile images as TMJ import picks files, §13), reads it with the recorded parameters (tile
size, margin, spacing; a `"sprite"` source is composited and sliced as at import, §6.1), and
matches old tiles to new source entries in this order:

1. **Unique fingerprint**: a fingerprint held by exactly one old tile and exactly one new entry
   → the tile takes that entry (its key may change; pixels are the same).
2. **Same key**: an old tile still unmatched whose source key exists among unmatched entries →
   the tile takes that entry and its new pixels (changed in place).
3. **Ambiguous**: an old tile whose fingerprint appears several times among unmatched entries,
   or that shares its fingerprint with other unmatched old tiles.
4. **Missing**: every other old tile.
5. Unmatched new entries become **new tiles** with new IDs at the end.

Matched tiles keep their class, properties, collision and animation; new tiles get the
animations the import rules of §6.1 give them.

When nothing is ambiguous or missing, the update applies at once. Otherwise a dialog lists
ambiguous and missing tiles with their old picture, the maps and cell counts using them, and a
choice per tile: one of the candidates (ambiguous), **Keep as is** (pixels kept, key set to
`null`), **Delete** (its cells are erased in every map; animation frames on it removed) or
**Replace with…** a tile of the new source (cells rewritten to it, flags kept). Apply makes one
history entry for the whole update; Cancel changes nothing. The entry holds the before and after
pixels of changed, new and deleted tiles only, plus the rewritten cells, and counts against the
history budget (§3) like any entry: an update larger than the budget stays undoable as the
newest entry and drops older ones. A different tile
size in the source refuses the update ("tile size changed from 16 × 16 to 32 × 32"). Tile IDs of
matched tiles never change, so maps change only through Delete and Replace. Undo does not give
tile IDs back, as in Tiled: undo and redo leave `nextTileId` at the highest value it has had, so
a tile added by a later update never takes an ID that a saved file or an export may already hold.

The command acts on the tileset the Tilesets panel shows. A browser's open picker cannot be
given a file name (Tiled's file dialog preselects the file; the sprite editor names files only
in its save pickers), so the picker takes only files of the source's kind and an information
toast names the recorded file as it opens; a file of another name is accepted. Files dropped
on a tileset's tab in the Tilesets panel update that tileset; files dropped elsewhere on the
panel are imported (§6.1). The reading and matching run in the background worker. An update
applied at once reports its summary in a toast. In the dialog, each row starts on a choice that
loses nothing: an ambiguous tile on the first of its candidates no row above took, else Keep
as is; a missing tile on Keep as is. Replace with… picks the tile from a grid of the source's
tiles, and Apply waits until it is picked; a candidate another row took cannot be chosen.
Delete and Replace both remove the old tile: its animation frames and terrain entries go
with it (a replaced tile's are not moved to the replacement). The summary counts unchanged,
moved and changed tiles of steps 1 and 2, ambiguous and missing tiles, and as new every entry
steps 1 and 2 leave unmatched, before any choice of the dialog.

### 6.4 Tile editors

Opened from the tileset panel for the selected tile; each is a dialog with a Canvas2D view of
the tile (zoom 1–32) and its own undoable commands in the project history.

- **Collision editor**: tools rectangle, ellipse, polygon (click points; Enter or a click on the
  first point closes; Backspace removes the last point; Escape cancels), select/move/resize,
  edit points (drag a vertex; double click on an edge adds one; Delete removes one, never below
  three). Snap to whole pixels by default (context toggle); Ctrl inverts snapping while held.
  Shapes may extend outside the tile (FORMAT range). Applying to several selected tiles at once
  copies the shape list to each (one entry). The editor shows the tile the panel's selection
  ends on (Tiled's current tile); each edit copies that tile's edited list to every selected tile
  the filter shows. A rectangle or ellipse is made only when its drag spans an area: a click,
  or a drag along one axis, makes nothing (unlike Tiled, [reference/tiled.md](reference/tiled.md)
  §6), as a shape without area blocks nothing. A new shape is selected; a polygon is stored at
  its first point. Escape cancels a polygon or a drag first, then closes the dialog; while it is
  open, Ctrl+Z and Ctrl+Y undo and redo the project history.
- **Animation editor**: the frame list of the tile; add tiles by dragging from the tileset grid
  or a button for the tileset selection; default 100 ms; edit durations (one or many); reorder by
  drag; delete; a looping preview at the tile's size. A tile is animated when its list is not
  empty. Animation frames are tiles of the same tileset (Tiled). As Tiled's
  `TileAnimationEditor` (v1.12.2): the editor edits the tile the panel's selection ends on, that
  tile only, and holds its own grid of the tileset's tiles (the dialog is modal, so the panel
  cannot be reached), starting with the panel's selection. A tile dragged from that grid is
  inserted where it is dropped, a double click appends it, and the button appends the grid's
  selection. New frames take the frame duration, 100 ms until changed and kept while the page is
  open (Tiled keeps it in its session); Apply gives it to the selected frames, and each frame's
  own field edits that frame. Dragging a selected frame's handle moves the selection; Alt+Up and
  Alt+Down move each selected frame one place; Delete or Backspace deletes them. Each edit is
  one entry, and an undo or redo leaves no frame selected (Tiled resets its list); the
  preview restarts from the first frame at every change, frame `k` showing from the sum of the
  durations before it.
- **Tile properties and class** are edited in the Properties panel (§9) for the selected tiles.

## 7. Maps and layers

### 7.1 Maps

- **New Map** (name, width, height, tile size; defaults from the last new map, first default
  64 × 64 of 16 × 16) adds a map with one tile layer and opens it. **Duplicate**, **Rename**,
  **Delete** (refused for the last map; no confirmation, undo restores it: SUITE §4),
  **Move up/down** in the map list.
- **Map Properties**: name, export name, class, tile size, background colour, parallax origin,
  properties. Changing the tile size keeps cells; markers and offsets stay in pixels. As
  Tileset Properties, the dialog changes nothing until OK, and OK applies every changed field
  as one undo step (none when nothing changed).
- **Resize / Offset Map** (Tiled's dialog): new width and height and an offset in cells; a
  preview shows the old map inside the new bounds. Cells outside the new bounds are removed;
  markers are moved by the offset and kept even outside the bounds (Tiled). The tile selection
  moves by the offset and is not cut to the new bounds (Tiled's `MapDocument::resizeMap`). One
  entry. The offset is limited on each axis as Tiled's `ResizeHelper` limits it: 0 to the growth
  when the map grows, the shrink to 0 when it shrinks, so the old map holds the new bounds or
  lies inside them; with an anchor checked, a new size keeps the old map at the anchor
  (offset truncated towards zero, as the sprite editor's canvas size); with none, the offset is
  moved into its range. An image layer's offset moves by the offset in pixels, as markers do
  (Tiled's `SetLayerOffset` by the change of the map's bounds); other layer offsets stay. An
  offset that would move a marker or an image layer past its coordinate range is refused.
- Maps are tabs in the menu bar (SUITE §3). Closing a tab hides the map; it stays in the
  project. The project's map list (DESIGN) opens them.
- New Map adds the map at the end of the map list, named "Map N" with N one above the highest
  number among maps named "Map <number>" (1 with none), as the sprite editor names a new layer;
  its size and tile size default to the last new map's for the session. Duplicate places the
  copy after its map, named "<name> Copy" as the sprite editor names a duplicated layer, with
  an export name of its own. Both show the map they add.
- The tab strip has its own order, changed by dragging a tab, as the sprite editor's document
  tabs; Move up/down changes the map list and names no map in its history entry. A map that
  becomes active by any route gets a tab; the last tab may be closed, and then no map is shown
  (Tiled, the sprite editor). Deleting the active map shows the tab that takes its place; its
  undo restores the map, its tab where it was, and shows it. Undo or redo of another map's
  entry switches to that map and performs the step in one press.

### 7.2 Layers

Tiled's layer model: tile, marker, image and group layers in a tree; the Layers panel shows it.

- New Tile / Marker / Image Layer, New Group. **Image layers** pick an image of the project or
  import a PNG (≤ 8192 px a side, FORMAT §2.8 pixel limits checked before decoding): the PNG is
  decoded to straight RGBA8 and added to the project's images (name from the file, export name
  its slug made unique); a PNG whose pixels equal an existing image's reuses that image. An image
  that no layer of any map uses any more is removed in the same command that removed its last
  use (undo restores both).
- Layer commands: Group Layers (wraps the selected layers), Ungroup; Duplicate (new IDs for
  the layer and its markers); Delete; Rename; drag to reorder or move into and out of groups;
  Move Up / Move Down; select previous / next layer.
- Visible, locked, opacity, offset, parallax, class and properties per layer; group values
  compose (FORMAT §2.5). Show/lock all other layers (Tiled). Highlight Current Layer (view
  setting) draws other layers at 25% opacity in the viewport.
- Layer opacity draws as sprite alpha; parallax and offset are drawn in the viewport relative to
  the view centre as FORMAT §3.4 defines. Tint and blend modes are not drawn.
- Limits: FORMAT §2.8; the D1 envelope warns once per map when exceeded ("This map is beyond the
  editor's tested envelope"), naming what the map exceeds: more than 65,536 cells per layer
  (width × height), more than 16 layers (groups included) or more than 2,000 markers. The other
  D1 bounds are hard limits already, or the project's (tileset pixels).
- As Tiled (`MapDocument`, `MoveLayer`, `LayerModel`, `LayerIterator` at `v1.12.2`):
  - A new layer goes right above the active layer, in its group, and becomes active; it is
    named "Tile Layer N", "Marker Layer N", "Image Layer N" or "Group Layer N", N one above the
    count of layers of that kind, raised past names taken. Group Layers puts a group named "Group N" (N one above
    the count of groups) right above the first chosen layer and moves the chosen layers into it
    in tree order; the active layer stays.
  - Ungroup moves a group's children into its parent where it was and removes it; a layer
    inside a group moves out right above the group, and a group left empty is removed.
    Duplicate puts each copy right above its original with the same name (Tiled's "duplicate
    adds Copy" preference is off by default) and makes the copy active.
  - Move Up / Down passes a sibling, enters a sibling group (at its bottom going up, at its top
    going down) or leaves the group at either end, above or below it. Select Layer Above /
    Below step through the layers bottom to top with a group right after its children.
  - Show/Hide Other Layers shows them all when none is visible, else hides them all; Lock/Unlock
    likewise locks them all unless all are locked. The other layers are the siblings of the
    layer and of each of its groups, not the layer, its groups or the children of a sibling
    group.
  - When Delete or Ungroup removes the active layer, the row that takes its place in the Layers
    panel becomes active (Qt's current row after a removal): the next layer below it in its
    group, else the one above, else the group; Ungroup of the active group, its top child.
- Delete is refused when the map would have no layer. Undo does not give layer or marker IDs
  back, as in Tiled: undo and redo leave `nextLayerId` and `nextMarkerId` at the highest value
  they have had, so a layer or marker added after an undo never takes an ID that a saved file or
  an export may already hold.
- Highlight Current Layer keeps the active layer, and a group's children when the active layer
  is that group, at their own opacity; every other layer is drawn at the preference's opacity
  (25% by default) times its own. Tiled darkens the layers below and fades only those above;
  the editor fades all others.

## 8. Markers

- Marker layers hold rectangle, point, ellipse, polygon and polyline markers (FORMAT §1.5).
  Each has a name, class and properties.
- Tools (Tiled's object tools for these shapes): **Select** (click, Shift-click to add, drag a
  rubber band; drag to move; 8 handles to resize rectangles and ellipses; arrows nudge one
  pixel, Shift+arrow one cell; Delete removes), **Edit points** (vertex drag, insert on edge
  double click, delete vertex), **Rectangle**, **Point**, **Ellipse**, **Polygon** and
  **Polyline** (click points; Enter finishes; Escape cancels; Backspace removes the last point).
- Snap to grid is on by default (context toggle); Ctrl inverts it while moving; Ctrl while
  resizing keeps aspect; Alt while resizing inverts snapping (Tiled).
- Tool details, from Tiled's object tools (v1.12.2):
  - Snapping puts a position on the map's tile grid; with snapping off it goes to the nearest
    whole map pixel, as the sprite editor places pixels (Tiled keeps fractions unless its Snap
    to Pixels is on). A move snaps the least `x` and `y` of the moved markers' positions; a
    resize snaps the dragged handle, which keeps its offset from the pointer, and puts the box's
    sides on whole pixels; Ctrl also inverts snapping while creating.
  - Select takes markers of every visible, unlocked marker layer, the topmost first; with
    Highlight Current Layer on, a marker of the active layer first. Shift- or Ctrl-click adds a
    marker or takes it out of the selection; a click where no marker is clears it (kept with
    Shift); a drag from where no marker is, or with Shift, is a rubber band that takes what it
    touches (with Alt, what it encloses), added with Shift or Ctrl. Dragging a marker that is
    not selected selects it alone. A drag starts after 5 CSS px. Selecting makes no history
    entry; a move or a resize is one.
  - The handles and the context bar's W and H act on a lone selected rectangle or ellipse; X
    and Y move the whole selection.
  - A created marker becomes the selection. Shift makes a rectangle or ellipse square (the
    longer side); a click without a drag makes one of size 0. A polygon or polyline also
    finishes on a double or right click, a polygon of 3 points or more on a click on its first
    point; Backspace with one point left cancels; a click on the last point adds none; finished
    with too few points, nothing is made.
  - Edit points (`EditPolygonTool`) shows the points of the selected polygons and polylines and
    works on one chosen point at a time (Tiled selects several, with a rubber band). A press on a
    point chooses it and a drag moves it, placed as a move is; a double click on an edge, away
    from the points, inserts a point at the nearest position on the edge, on the nearest whole
    pixel and not snapped (Tiled's `nearestPointOnLine`), and chooses it. Any other click selects
    as Select's click does; where no marker is, a chosen point alone is let go first. Arrows nudge
    the chosen point 1 px and Shift+arrows one cell, as they nudge markers (Tiled's arrows move
    objects only). Delete removes the chosen point, refused below 3 points of a polygon or 2 of a
    polyline (Tiled removes the object instead). Every edit of the points is one entry.
  - A selection outlives a lock made after it. While a selected marker's layer, or a group above
    it, is locked, nudge, Cut and Delete of the markers or of the chosen point, and edits of
    the context bar's X, Y, W and H, are refused with the status-bar message, as Cut and Delete
    of cells are (§4.4); Copy only reads.
- New markers take `nextMarkerId`. Copy/paste of markers within and between maps keeps
  geometry and positions and gives new IDs. Paste goes into the active layer when it is an
  unlocked, visible marker layer, and selects the pasted markers; otherwise Paste of markers is
  refused with a status-bar message (Tiled pastes objects only into an object layer). The
  clipboard holds either cells or markers: the last copy wins.
- Markers are drawn on the overlay with their layer's colour, above all tile layers, ignoring
  layer order and opacity (ENGINE §7); a hidden marker layer is not drawn. Names show beside
  markers above a zoom of 1.
- Budget: 2,000 markers per map redraw within the pan budget (ENGINE §6).

## 9. Properties

The Properties panel shows the built-in fields and the custom properties of the selection:
the selected markers, else the selected tiles (from the tileset panel focus), else the active
layer, else the map; the project and the active tileset are reachable from their menus.

- Add (name, type of FORMAT §1.4), rename, change type (value converted where it can be, else
  the type's default: `false`, `0`, `""`, `#000000ff`), remove, edit value with a control per
  type (checkbox, integer and number fields, text, colour picker, file name field with a Pick
  button that takes the chosen file's name).
- With several items selected, a property shown is common to all; editing it sets it on all;
  properties of some items show as mixed (Tiled).
- Every edit is an undoable command.

As Tiled's Properties view follows its document's current object (v1.12.2): the selected tiles
are the selection while the Tilesets panel has the focus, which it takes when the panel takes
the keyboard focus, when its selection changes, or from the tile menu's Properties; it loses it
when the active map, the active layer or the marker selection changes, or the focus enters the
Maps or Layers section. Change Type converts as Qt's `QVariant::convert` does in Tiled: bool,
int and float convert among themselves (non-zero is true, a float rounds half away from zero,
and one outside the int range gives the default) and to text; text converts to bool (false for
"", "0" and "false" in any case), to an int or float when it is one, to a colour when it is
`#rrggbbaa` or `#rrggbb`, and to a file name of at most 1024 code units; colour and file convert
to text only. Any other conversion gives the default.

The project and the shown tileset are shown from the panel's menu until the selection first
changes. A property is common to several items when each has one of that name and type; Add
refuses a name any of them has.

## 10. Persistence and export

### 10.1 Project file

The file workflows (save, open, revert, permissions, gesture lapse, download fallback, file
names, messages), recent files, autosave and recovery are those of the sprite editor's
documents (`..\ngne-sprite-editor\docs\SPEC.md` §10), applied to the project, with these
differences:

- The unit is the project: Save, Save As, Open, Revert, Close Project. Opening a project while
  one is dirty asks Save / Discard / Cancel (one project per window). Maps are tabs inside it.
- New Project creates a project with one empty map from the New Map dialog.
- Open accepts `.ngtilemap` by picker, drop, OS file handling (SUITE §7) and recent files (10,
  IndexedDB `ngne-tilemap-editor-recent`).
- The default file name is the project name sanitised as the sprite editor does, with
  `.ngtilemap`; `Untitled.ngtilemap` when nothing is left of the name.
- The app starts on the empty state (no project open), and Close Project returns to it. While
  no project is open only New Project, Open, Open Recent, Import Tiled Map and the window's own
  commands (command palette, shortcut sheet, preferences, regions, bottom panel) act.
- New Project, Open (picker, drop, recent file) and Close Project ask Save / Discard / Cancel
  before an unsaved project goes, as Tiled asks before a document with changes is closed; Save
  saves it first and goes on only when that save succeeds. New Project asks once its dialog is
  answered, Open once the file has been read (a file that cannot be opened asks nothing).
  Revert asks Discard / Cancel, as the sprite editor's. Opening the project's own file again
  changes nothing ("… is open already"). Revert keeps the active map and the view of each map
  still in the file.
- A drop that holds a `.ngtilemap` opens it, whatever else it holds; a `.ngsprite` without one
  goes to Import Tileset while a project is open; any other drop is reported as not a project.
- The current stamp and the clipboard are emptied whenever another project takes the window
  (New Project, Open, Revert, Close Project). A new project's map is shown fitted, as New Map's.
- Autosave: 2 s after the last change, the dirty project is written to IndexedDB
  (`ngne-tilemap-editor-autosave`): `project.json`, changed maps' JSON and changed tileset and image
  pixels as raw buffers, keyed by ID. Launch offers recovery of unsaved snapshots. Each page
  holds a Web Lock `ngne-tilemap-editor-page:<id>` so two windows never offer each other's live
  snapshot.
  - A map's JSON is written again when a step names that map, and every map's when a step of no
    map changes cells, layers, tilesets or the structure (a map's JSON holds its tilesets' first
    GIDs, FORMAT §1.2); `project.json` with every snapshot. The worker makes the JSON and writes
    it; the page hands over the project without pixels, the cells of the changed maps and copies
    of the changed pixels, and makes the thumbnails of the first 4 maps one per task.
  - The recovery dialog lists each snapshot with its project's name, time, map count and the
    thumbnails of its first 4 maps. A recovered project takes the window with an empty history
    and no file, dirty until saved, as the sprite editor's recovered documents; the dialog then
    closes and the other snapshots stay for the next launch (one project per window). Recover is
    refused while the window's project has unsaved changes.
- Session state kept per project ID in IndexedDB (`ngne-tilemap-editor-session`, the newest 100
  projects), best effort: open map tabs and the active one, per-map view and active layer, as
  Tiled keeps them per file in its session. It is written 0.5 s after it changes and when the
  project leaves the window, and restored when a project takes the window by Open, a recent
  file, a drop or recovery; Revert restores nothing (it keeps the views itself) and a restore
  that arrives after the user switched maps is dropped.

### 10.2 Export

Export writes the export folder of FORMAT §5.

- **Export…** (dialog): folder (directory picker, kept per project ID in IndexedDB
  `ngne-tilemap-editor-export`), the project's export name, the list of files with their sizes,
  Export on Save. **Export Again** writes without a dialog when a folder is known and writable.
  Without File System Access the folder downloads as `<exportName>.zip`.
- Before the first write into a folder: a marker of another project ID (or files of the export's
  names without a marker) asks Replace / Cancel, naming that project.
- **Packing** (`core/pack`, per tileset): the sprite editor's packer, `pack` of `core/sprite`
  unchanged, given the tiles in ID order and the options `layout: "grid"`, `padding: 0`,
  `extrude: 1`, `trim: false`, `mergeDuplicates: true`. So: rectangles of even size (FORMAT §4),
  tiles with identical pixels sharing one, `⌈√r⌉` columns for `r` rectangles, each rectangle with
  a 1 px extrusion ring and the rings of neighbours touching (contents 2 px apart);
  deterministic. `core/pack` turns the result into the atlas JSON of FORMAT §4. Packability is
  guaranteed at import (§6.1); an image above 8192 px still fails the export naming the tileset.
- **Why no gap is needed:** a pixel is drawn only when its centre lies inside the quad, so its
  texture coordinate lies inside the rectangle, edges included, at any scale, flip or rotation;
  nearest sampling then reads at most one texel past an edge, which is the extrusion ring. The
  even-size column or row of an odd tile is transparent and so is its ring. NGNE samples
  nearest with clamp only (ENGINE §7), so no filter reaches further. The conformance test
  (§10.3) draws every orientation of odd and even tiles at scales 1 and 3 and at DPR 1.25.
- **Write**: marker, then PNGs, atlases, tilemap JSON, runtime (BRIEF §5). A file whose bytes equal
  the file in the folder is not rewritten. Export removes nothing: files of deleted maps stay.
  A failed write stops the export with one toast naming the file and those written before it.
- **Export on Save** runs after a successful save, inside the same file operation, never with a
  dialog; any problem is one error toast and the save stands.
- Export reads the project as of the moment it starts; a stroke in progress stops it.

### 10.3 Conformance

Export is accepted when, for the reference project and the FORMAT fixtures:

1. Every atlas passes the sprite editor's `validateAtlas` rules and FORMAT §4; every tilemap passes
   `validateTilemap` against them.
2. Round trip: export → `readTilemap` → cells, flags, properties, collision and markers equal the
   project's.
3. A fixture NGNE game (`tests/fixtures/game`, `@ngne/core` 0.3.0) imports the exported
   `ngne-tilemap.ts`, draws every map at scale 1 and 3 with `pixelSnap` on, and its canvas readback
   equals the `core/compositor` reference pixel for pixel, for all 8 orientations of odd and even
   tile sizes, a tile larger than the grid, a tile offset, a parallax layer and an opacity layer
   (opacity within 1 per channel). At scale 1.25 (not seam-free, FORMAT §1.3) every drawn
   pixel's colour belongs to the tile drawn there: no texel of a neighbouring rectangle shows.

## 11. Generated runtime (`ngne-tilemap.ts`)

The export writes one runtime per folder (BRIEF §6). Its source is `core/runtime/runtime.ts`;
the generator prepends a header and appends the folder's tables; the editor's preview and tests
import the same source as code. It has no imports.

### 11.1 Header and tables

```ts
// Generated by ngne-tilemap-editor 1.0.0. Reads ngne-tilemap versions 1..1. Do not edit.
```

Generated tables, as static code so bundlers see every asset, each URL written as
`new URL("./<file>", import.meta.url).href`: `TILEMAP_URLS` (map export name → its
`.tilemap.json`), `ATLAS_URLS` (tileset export name → `{ json, png }`), `IMAGE_URLS` (image export
name → its `.png`), and the types `TilemapName`, `TilesetName` (string-literal unions of the export
names).

### 11.2 API

```ts
export class TilemapError extends Error { readonly code: TilemapErrorCode; readonly path: string }
export function readTilemap(json: unknown, atlases: Readonly<Record<string, unknown>>): Tilemap;
export function loadTilemap(name: TilemapName, signal?: AbortSignal): Promise<Tilemap>;
export function assetsFor<A>(tilemap: Tilemap, imageAsset: (id: string, url: string) => A): readonly A[];
export function drawTilemap(frame: SpriteSink, tilemap: Tilemap, camera: { x: number; y: number },
                          options: DrawOptions): void;
export function findLayer(tilemap: Tilemap, name: string): TilemapLayer | undefined;
export function tileAt(tilemap: Tilemap, layer: TileLayerData, x: number, y: number): TileRef | null;
export function classAt(tilemap: Tilemap, layer: TileLayerData, x: number, y: number): string;
export function propertyAt(tilemap: Tilemap, layer: TileLayerData, x: number, y: number,
                           name: string): PropertyValue | undefined;
export function grid(tilemap: Tilemap, layer: TileLayerData,
                     select: string | ((tile: TileInfo) => boolean)): Uint8Array;
export function collisionShapes(tilemap: Tilemap, layer: TileLayerData): readonly CollisionShape[];
export function collisionRects(tilemap: Tilemap, layer: TileLayerData): readonly Rect[];
export function markers(tilemap: Tilemap, filter?: { layer?: string; name?: string; class?: string }):
    readonly TilemapMarker[];
export function setCell(tilemap: Tilemap, layer: TileLayerData, x: number, y: number, value: number): void;
export function invalidate(tilemap: Tilemap, layer: TileLayerData): void;
```

- `readTilemap` is `validateTilemap` (FORMAT §3.8) plus the atlas checks; it migrates older versions
  and throws only `TilemapError`. Each call returns new objects; each tile layer's `data` is a new
  `Uint32Array` that the game may mutate (cell values of FORMAT §1.2). `drawTilemap` and the data
  functions read the tilemap's current arrays, so a game's edits show and collide at once. A game
  that wants the original keeps a copy (`data.slice()`).
- `loadTilemap` fetches the tilemap JSON and the atlases it names through the URL tables.
- `assetsFor` returns one image asset per tileset and image of the tilemap, IDs
  `ngne-tilemap:<project>/<exportName>`. Definitions are cached at module level by ID, so every
  call returns the same objects (NGNE checks assets by identity). The game passes its engine's
  `imageAsset`.
- `drawTilemap` (for `scene.render`):
  - Draws the visible tile and image layers, or those `options.layers` accepts, bottom to top.
    Map layer `i` (index in `tilemap.layers`) is drawn at engine `layer` `options.layer ?? 0` and
    `depth` `(options.depth ?? 0) + i`, so a game sprite at depth `i + 0.5` goes between map
    layers `i` and `i + 1`.
  - World units are map pixels × `options.scale` (default 1). The view is `camera` plus
    `options.viewWidth × options.viewHeight`; its centre gives the parallax shift (FORMAT §3.4).
  - Culls to the view: a tile is skipped only when none of its pixels can be in view (tiles larger
    than the grid and tile offsets widen the scanned cell range).
  - Orientation and placement: FORMAT §1.2 and §1.3, odd-size corrections included.
  - Animated tiles show the frame at `options.elapsedMs` (required, the scene's own clock, so
    pause and freeze follow the game); all tiles share one clock from 0 (Tiled).
  - Alpha = layer opacity × `options.alpha` (default 1); `options.color` passes to every sprite.
  - Image layers draw their image at the layer's shift; repeat draws a grid of quads covering
    the view.
  - Within a layer, quads are emitted grouped by tileset, in row-major order inside a tileset,
    so NGNE batches them (ENGINE §4).
  - Never throws: a texture missing from `options.assets` (anything with `has(id)`, normally the
    `assets` map the scene's `setup` receives, a `ReadonlyMap<string, unknown>` keyed by asset ID
    in every supported engine version) is skipped and reported once per tilemap and tileset through
    `options.report` (default `console.warn`).
- Data functions use map pixels at parallax 1: positions include the layer's offset and no
  parallax shift. Cells outside the map are empty.
  - `tileAt` returns `{ tileset, id, flipH, flipV, flipD }`; `classAt` `""` for none;
    `propertyAt` the tile's property value.
  - `grid` returns `width × height` bytes, 1 where the cell's tile has the named property with a
    value that is `true`, a non-zero number or a non-empty string (or where the predicate holds).
  - `collisionShapes` returns each non-empty cell's collision shapes transformed by its
    orientation about the tile's content centre and placed by FORMAT §1.3, in map pixels, with
    the cell and tile they came from.
  - `collisionRects` merges cells whose tile's collision is exactly one rectangle covering the
    whole tile: maximal runs per row, then runs with the same x range in consecutive rows merge
    into one rectangle. Deterministic; other shapes are only in `collisionShapes`.
  - `markers` returns the markers of marker layers, optionally filtered by layer name, marker
    name and class, with positions in map pixels.
- Results of `collisionShapes`, `collisionRects` and `grid` are cached per layer. `setCell`
  writes a cell value and drops that layer's cache; a game that writes `data` directly calls
  `invalidate(tilemap, layer)` afterwards.

### 11.3 Performance

The inner loop allocates nothing: one reused sprite object, per-tileset UV tables and an
8-entry orientation table (sign, rotation, centre correction) precomputed by `readTilemap`, a
per-layer bucket of visible cell indexes per tileset filled in one row scan. Quad emission is
~70% of the live tier's frame cost (ENGINE §4); the runtime and the editor's live tier share this
emitter (`core/runtime/emit.ts`), and its budget is ENGINE §6.

### 11.4 Compatibility

The runtime declares structural types for what it uses (`SpriteSink` with
`sprite(s: SpriteLike): void`, `SpriteLike` with NGNE's sprite fields). `Sprite`, `Frame.sprite`,
`imageAsset(id, url)` and the setup `assets` map have the same shape in all three versions.
`loadTilemap` uses `fetch`, `URL` and `import.meta.url`, which every NGNE game's settings allow
(`module` `ESNext`, the `DOM` library). A compile test builds a fixture game against `ngne`
0.1.0, `@ngne/core` 0.2.2 and 0.3.0 (the versions games use), each installed in its own fixture
folder (`tests/runtime-compat/<version>/`, own lockfile; not dependencies of the app),
under the settings of BRIEF §6 plus `strict`, `exactOptionalPropertyTypes`, `noUnusedLocals` and
`noUnusedParameters`.

**Engine contract.** The runtime is engine-version agnostic: it imports nothing and relies only
on this, which is all a new NGNE release has to keep:

- a sink with `sprite(s)`, where `s` has `x`, `y`, `width`, `height` (negative mirrors),
  `rotation` (radians, clockwise), `texture`, `u`, `v`, `uw`, `vh`, `alpha`, `color`, `layer`,
  `depth`, drawn in scene → layer → depth → insertion order;
- a texture named by the ID of the image asset that loaded it;
- an asset map with `has(id)`, and an `imageAsset(id, url)` factory, both handed in by the game;
- nearest sampling and centre pixel snapping as in 0.3.0 (FORMAT §1.3 placement).

`tests/runtime-compat/latest/` installs the newest published `@ngne/core` when it runs (no
lockfile) and runs the compile test and the conformance draw of §10.3 against it. It runs before
every editor release and in a weekly CI job, report-only (network, not pinned). A failure there
means a new NGNE release broke the contract: the runtime adapts in the next editor release, or
the NGNE owner is told through ENGINE §7.

## 12. Game preview

ENGINE §5 is the architecture. Behaviour:

- Dock section "Preview": game resolution (320 × 180, 480 × 270, 640 × 360, 1280 × 720),
  integer scale (largest that fits, or chosen), play/pause, layer filter (all visible / this
  layer and below).
- The scene draws the current map through `drawTilemap` from the same runtime source, with
  atlases packed in memory by `core/pack` (no files), `pixelSnap` on and animations playing. Its
  camera follows the viewport's centre.
- The preview holds one `Tilemap` built from the project by `tilemapFor` and `readTilemap`, as a game
  would load it. A command's `touched` (§3) updates it before the next preview frame: changed
  cells are written into the layer's `data` and the layer is `invalidate`d; any other change to
  the map (layers, groups, markers, properties, map size) rebuilds the `Tilemap`; a tileset change
  restarts the scene (new assets). The preview stops while its section is collapsed or the
  window is hidden.

## 13. TMJ import

File → Import Tiled Map… (BRIEF §7). Conversion is `core/tmj`; it never mutates the project
until the user accepts the report.

- **Files.** The user picks the folder holding the map (directory picker; relative paths of
  tilesets, images and templates resolve exactly), or, without File System Access, the map and
  its files in one multi-select or drop, matched by base name; files still missing are listed
  and can be added. A `.tmj` or `.json` with `"type": "map"` is a map; `.tsj` and `.tsx` are
  tilesets; `.tj` templates.
- **Into the current project** as one new map (name from the file, export name made unique).
  External tilesets already imported into this project from a file of the same name with the
  same tile fingerprints are reused; every other tileset becomes a new one.
- **Conversion** beyond the table of BRIEF §7:
  - IDs: layer IDs, object IDs (→ marker IDs), `nextlayerid` and `nextobjectid` kept; tile IDs
    are Tiled's local IDs; `nextTileId` = Tiled's tile count (image tilesets) or its next tile
    ID (collections).
  - Tile layers: `csv`, `base64` with no compression, `zlib` or `gzip` (fflate) decoded; GIDs
    decoded with `>>> 0`, bits 31/30/29 kept, bit 28 cleared; local ID via `firstgid`.
  - Infinite maps: the union of used chunks becomes the map; every layer and marker moves by the
    same offset, which the report states in cells.
  - Colours `#AARRGGBB` or `#RRGGBB` → FORMAT colours; opacity `round(255 × o)`; fractional layer
    offsets rounded (reported).
  - Tilesets: `margin`, `spacing`, `tileoffset`, tile `type` → class, animations, collision
    (`objectgroup`: rectangles, ellipses, polygons kept; points, polylines, rotation, names and
    properties of shapes dropped, reported), wang sets → terrain sets (colours, tiles; class,
    properties, probabilities dropped, reported). `transparentcolor` of tilesets and image layers
    is applied as a colour key (alpha 0) when the pixels are copied. `tilerendersize: "grid"`
    is dropped (tiles draw at tile size; reported). Tile sizes above 256 refuse the map.
  - Object layers → marker layers (layer `color` kept); a template instance is merged with its
    template first; then BRIEF §7 rows apply. `visible: false` objects import visible (reported).
  - Classes of maps, layers, tilesets, tiles and objects are kept as class strings.
  - `renderorder` other than `right-down` is reported (drawn right-down).
- **Report** dialog: the converted map's size, layers, tilesets and markers, and every dropped or
  changed item grouped by BRIEF §7 row with counts and where it was (layer, object, tile).
  Import adds the map in one history entry; Cancel adds nothing.
- **Fixtures** (`tests/fixtures/tmj/`): authored for this repo, so their licence is the repo's.
  `tests/fixtures/tmj/build.ts` writes them, with generated tile and image PNGs, following
  [reference/tiled.md](reference/tiled.md) §5 (Tiled's JSON and TSX as Tiled 1.12.2 writes
  them). At least one file per BRIEF §7 row (isometric and hexagonal maps; infinite; csv, base64
  uncompressed, zlib, gzip and zstd data; all 8 flip combinations and bit 28 set; image and
  image-collection tilesets, uniform and mixed; embedded, `.tsj` and `.tsx` tilesets; every
  object shape, rotated, tile, text and capsule objects; templates; every property type
  including class, enum, `object` and `list`; tint and blend mode; terrain probabilities and
  transformations; `transparentcolor`; `tilerendersize`), plus three composite maps of
  realistic size (a 1000 × 40 side-scroller, a 256 × 256 overworld with groups and parallax, a
  small dungeon with markers and collision). The folder's README lists which file covers which
  row. Each fixture's import report is a committed golden file. Once, at the import ticket, the
  owner opens every fixture in Tiled 1.12.2 and confirms it loads without error and looks as the
  README describes (manual check card).

## 14. Performance

The budgets are ENGINE §6, unchanged; the ticket that builds a feature measures its row on
reference hardware (RULES 8). Feature budgets ENGINE does not list, measured the same way on the
reference map:

| Metric | Budget | Measured (Intel UHD / RTX 4060) |
| ------ | ------ | ------------------------------- |
| Bucket fill / magic wand of a 65,536-cell region, press → frame submitted, the region found after the press, p95 | ≤ 100 ms | Bucket, TE-019: 41.3 / 43.1 ms (median 25.7 / 29.8 ms; flood alone 4.5 / 4.2 ms). Magic wand, TE-020: 20.0 / 18.9 ms (median 6.4 / 6.8 ms; flood alone 6.1 / 5.1 ms) |
| Stamp preview of a 256 × 256 stamp (a layer copied and pasted), Rotate Stamp Right and 40 one-cell pointer moves, with 16 and 32 px cells, main-thread task max | ≤ 16 ms | 10.6 / 13.0 ms (overlay redraws ≤ 9.8 / 9.7 ms) |
| Terrain brush step on a complete 4-terrain corner set, pointer event → frame submitted, p95 | ≤ 33 ms | TE-044: 15.7 / 14.4 ms (median 14.5 / 10.5 ms, max 17.1 / 17.4 ms) |
| Save of the reference project (worker), main-thread task max | ≤ 16 ms; total ≤ 3 s | TE-047: 7.9 / 5.6 ms (median 5.0 / 5.4 ms); total 311.2 / 331.6 ms (median 308.2 / 305.5 ms) |
| Open of the reference project to first frame | ≤ 3 s | TE-047: 258.9 / 274.8 ms (median 247.2 / 264.4 ms) |
| Autosave of the reference project after a cell edit (worker, IndexedDB), main-thread task max | ≤ 16 ms | TE-048: 8.3 / 13.5 ms (median 7.2 / 7.0 ms) |
| Export of the reference project (2 tilesets, 1 map) | ≤ 3 s; main-thread task max ≤ 16 ms | — |
| Update tileset from source, 1,024 tiles | ≤ 1 s | TE-028: 205.9 / 175.0 ms (median 151.1 / 129.9 ms; to the history entry, median 85.4 / 84.0 ms) |
| 2,000 markers on the reference map (SPEC §8): pan at the live-tier threshold, animation-frame callback start → overlay redrawn after the submit, p95; frames more than 25 ms apart | ≤ 10 ms; ≤ 1% | TE-037: 9.8 / 10.0 ms (overlay 0.2 / 0.2 ms), 0 / 0 frames; names shown at zoom 1.25: 4.1 / 4.3 ms, 0 / 0 frames |

TE-019 row: 2026-11-02, the machine, Chrome, power plan and window of ENGINE §6. Raw data:
`te-019-bucket-fill-intel-uhd.json` and `te-019-bucket-fill-rtx-4060.json` in
[evidence/](evidence/); with the region already found by the hover preview the p95 is
39.7 / 40.3 ms.

TE-020 row: 2026-11-02, the machine, Chrome, power plan and window of ENGINE §6. The wand changes
no cells, so its frame is the overlay's redraw showing the selection's ants. Raw data:
`te-020-magic-wand-intel-uhd.json` and `te-020-magic-wand-rtx-4060.json` in [evidence/](evidence/).

Terrain brush row: 2026-11-09, the machine, Chrome, power plan and window of ENGINE §6. The
reference map's first tileset given the 256 corner combinations of 4 terrains as one terrain set,
the tile layer under the parallax layer filled with terrain 1; one stroke of terrain 2 at 100%,
200 drag moves to a new cell each (each paints a new vertex and runs the filler with
corrections), timed from the event to the first frame submitted after it; live tier. Raw data:
`te-044-terrain-brush-intel-uhd.json` and `te-044-terrain-brush-rtx-4060.json` in
[evidence/](evidence/).

Save and open rows: 2026-11-09, the machine, Chrome, power plan and window of ENGINE §6. The
reference project (ENGINE §6's reference map with its two tilesets, a file of 1,419,753 bytes)
saved and opened through the file workflows with the worker's writer and reader, to and from a
file in memory. Save: the task max is the longest gap of a message loop from the call to the
bytes written, as TE-015's; handing the project to the worker takes about 4 ms of it. Open: from
the empty state, as at launch, from the call to the frame that draws the map with both tileset
textures uploaded; its longest task is 102.8 / 104.7 ms (no budget). Raw data:
`te-047-{save,open}-{intel-uhd,rtx-4060}.json` in [evidence/](evidence/).

Autosave row: 2026-11-09, the machine, Chrome, power plan and window of ENGINE §6. The reference
project opened afresh in the app, one cell edited and the first snapshot (every map entry and
both tilesets' pixels) stored, then another cell edited and the next snapshot (that map's entry)
stored; 5 runs of both. The task max is the longest gap of a message loop, as TE-015's, from
300 ms before the 2 s delay ends to the snapshot stored. Taking the project is at most
7.6 / 12.4 ms and a map thumbnail 7.0 / 12.3 ms, each a task of its own; the snapshot is stored
95.7 / 106.9 ms after the delay ends at most. Raw data: `te-048-autosave-intel-uhd.json` and
`te-048-autosave-rtx-4060.json` in [evidence/](evidence/).

Update from source row: 2026-11-03, the machine, Chrome, power plan and window of ENGINE §6. A
tileset of 1,024 tiles of 16 px used by the reference map, updated at once from a grid PNG with
64 tiles changed and 2 moved; timed from the call with the picked file (read and match in the
worker, apply) to the first frame after the new texture is uploaded, the maximum of 10 updates.
Raw data: `te-028-update-intel-uhd.json` and `te-028-update-rtx-4060.json` in
[evidence/](evidence/).

Markers row: 2026-11-07, the machine, Chrome, power plan, panel and window of ENGINE §6. TE-013's
pan of the reference map with a marker layer of 2,000 markers (rectangles, ellipses, points,
polygons of 6 points, polylines of 4, all named) that stays in view through the pan; the overlay is
redrawn in the same callback after the viewport's submit. The overlay copies each marker layer from
a picture painted once per history step, zoom and colour, so its redraw takes 0.2 ms; the rest is
the live tier's own frame (submit p95 9.6 / 9.9 ms). Raw data:
`te-037-markers-pan-{threshold,names}-{intel-uhd,rtx-4060}.json` in [evidence/](evidence/).

Stamp preview row: 2026-11-03, the machine, Chrome, power plan and window of ENGINE §6, the map's
overview built first. The task max is the longest gap of a message loop, as TE-015's, so one
gap can hold a task and the frame drawn after it. The paste is not in the row: its task holds
the Paste command itself (17–19 ms alone; 26.1–29.7 ms with the preview). The row is measured
again at later stages of the implementation, and with every row in TE-064. Raw data:
`te-017-stamp-preview-intel-uhd.json` and `te-017-stamp-preview-rtx-4060.json` in
[evidence/](evidence/).

## 15. Quality

| Layer | What is tested |
| ----- | -------------- |
| Unit (Node, Vitest) | Model invariants; do/undo symmetry of every command; cell store and orientation algebra (all 64 compositions against Tiled's tables); flood fill and shape regions against golden regions; terrain filler against Tiled fixtures; codecs: `.ngtilemap` round trip and byte stability, every reader rejection of FORMAT §2.9 and §3.8, fast-check properties for cell values and GID conversion; packer options and packability limit; `.ngsprite` import against the sprite editor's atlas export of the same fixtures; runtime `readTilemap`, placement and collision functions; TMJ conversion against golden reports |
| E2E (Playwright, installed Chrome) | Paint-undo-redo per tool; selection and clipboard; terrain brush; tileset import and update-from-source dialog; collision and animation editors; markers; layers and groups; save/open/recover; export with conformance (§10.3); TMJ import of every fixture; preview; viewport readback against the compositor at DPR 1 and 1.25 in both tiers |
| Compile | Runtime against `ngne` 0.1.0, `@ngne/core` 0.2.2 and 0.3.0 (§11.4) |
| Performance | ENGINE §6 and §14 on reference hardware; report-only in CI |
| Manual | Interface against DESIGN.md on reference hardware at 1280 × 720 and 125% zoom |

Frame-time assertions inside E2E tests are performance assertions: enforced on reference
hardware, reported only under CI (SwiftShader).

**Definition of done** for every ticket: RULES 7 (every acceptance item backed by a named test or
a recorded measurement; `npm run check` and the ticket's E2E files pass), no dependency beyond
SUITE §5, docs unchanged unless the ticket's scope says so, and the clean-up of RULES 9.
