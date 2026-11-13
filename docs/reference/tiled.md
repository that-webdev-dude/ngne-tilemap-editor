# Tiled — reference for the NGNE Tilemap Editor

Tiled 1.12.2 (latest stable, 2026-05-27), its behaviour studied from its source and manual on
2026-10-30. Behaviour reference the spec and tickets cite; what v1 includes is decided in
[BRIEF.md](../BRIEF.md) §4, not here.

This file describes what Tiled does; it holds no Tiled code. Tiled's editor (`src/tiled`) is
GPL-2.0-or-later. Most of libtiled (`src/libtiled`) is BSD 2-clause, but some of its files are
GPL-2.0-or-later (the JSON converters `varianttomapconverter.cpp` and
`maptovariantconverter.cpp`, `tiled.cpp`, `templatemanager.cpp`): check each file's header. The
editor's code derived from libtiled, and the test fixtures' JSON writer (after Tiled's bundled
qjsonparser), are listed with their notices in
[public/THIRD-PARTY-NOTICES.txt](../../public/THIRD-PARTY-NOTICES.txt); apart from them, the
editor's code is not translated from Tiled's code. The line, terrain filler, terrain brush and
its pick, and the shape fill's rectangle were rewritten from the spec, the tests and Tiled's
user manual; no code in them was translated from Tiled's source or from their earlier versions,
whose public interfaces they keep. Earlier versions of
some files followed Tiled's editor source; the [README](../../README.md#licence) lists them and
their licence.

Read against `mapeditor/tiled` `master` (raw.githubusercontent.com), not the `v1.12.2` tag,
and https://doc.mapeditor.org/en/stable/ (docs reflect 1.12). Recheck any detail a ticket
depends on against the `v1.12.2` tag. Paths are relative to the Tiled repo root.
"Docs" = stated in the manual only, not checked in source. **Unverified** = not confirmed.

---

## 1. Latest stable release

| Item | Value | Evidence |
|---|---|---|
| Latest stable | **Tiled 1.12.2** (tag `v1.12.2`) | GitHub API `releases/latest` |
| Published | **2026-05-27** (15:17 UTC) | same |
| Previous | 1.12.1 (2026-03-25), 1.12.0 (2026-03-13), 1.11.2 (2025-01-28) | GitHub releases list |
| 1.12.2 content | Bug-fix release (properties view, list-property copy/paste, tile animation editor refresh, etc.) | release body |
| `master` state | `NEWS.md` top section is "Unreleased" (world grid snapping, scripting `tiled.cell`, dock-toggle shortcuts...) | `NEWS.md` |
| File format version written | `"1.11"` for current/latest compat (`"1.8"`,`"1.9"`,`"1.10"` for compat modes) | `src/libtiled/fileformat.cpp` `versionString()` |

1.12.0 headline features (relevant here): rewritten Properties view, **list** custom properties,
capsule object shape, **Oblique** orientation (skewx/skewy), per-object opacity, per-layer
**blend modes** (JSON `mode`), terrain brush "full tile mode" toggle button, square/centre
rect-select, "Go to Tile" (Ctrl+Shift+G), Delete bound to Remove Tiles.

Note: master `src/libtiled` may contain post-1.12.2 changes; everything below was read from
master, cross-checked against 1.12 docs where possible.

---

## 2. Core data model (`src/libtiled`)

All editable things derive from `Object` (`src/libtiled/object.h`): `className()`,
`properties()` (`Properties = QVariantMap`), `TypeId` = Layer, MapObject, Map, Tileset, Tile,
WangSet, WangColor, Project, World. So **every** entity has a class + custom properties.

### Map (`src/libtiled/map.h`)

| Field | Values / default |
|---|---|
| `orientation` | Orthogonal (default), Isometric, Staggered, Hexagonal, Oblique (1.12) |
| `renderOrder` | RightDown (default), RightUp, LeftDown, LeftUp (orthogonal only, per docs) |
| `width`,`height` | in tiles (ignored for rendering bounds when infinite) |
| `tileWidth`,`tileHeight` | grid cell size in px |
| `infinite` | bool; tile layers stored as chunks |
| `hexSideLength`, `staggerAxis` (X/Y), `staggerIndex` (Odd/Even) | hex/staggered only |
| `skewX`,`skewY` | oblique only (1.12) |
| `parallaxOrigin` | QPointF, default (0,0) |
| `backgroundColor` | optional |
| `mNextLayerId`, `mNextObjectId` | monotonically increasing ID counters (`takeNextLayerId()`, `takeNextObjectId()`) |
| `EditorSettings` | `compressionLevel=-1`, `chunkSize=(CHUNK_SIZE,CHUNK_SIZE)`, `layerDataFormat=Base64Zlib` |
| `LayerDataFormat` | XML, Base64, Base64Gzip, Base64Zlib, Base64Zstandard, CSV |

`CHUNK_SIZE` value: used in `map.h`/`tilelayer.h` but definition not located; commonly 16
(**unverified**; JSON default chunk size in docs/editorsettings not confirmed).

### Layer base (`src/libtiled/layer.h`, `class Layer : public Object`)

| Member | Notes |
|---|---|
| `TypeFlag` | TileLayerType 0x01, ObjectGroupType 0x02, ImageLayerType 0x04, GroupLayerType 0x08 |
| `mId`, `mName` | id unique across all layers in map |
| `mOpacity` | `effectiveOpacity()` multiplies through parent groups |
| `mVisible`, `mLocked` | `isUnlocked()` checks ancestors |
| `mOffset` (QPointF px) | `totalOffset()` sums parents |
| `mParallaxFactor` (QPointF, default 1,1) | `effectiveParallaxFactor()` multiplies parents |
| `mTintColor` | `effectiveTintColor()` combines parents |
| `mBlendMode` (1.12) | Normal, Add, Multiply, Screen, Overlay, Darken, Lighten, ColorDodge, ColorBurn, HardLight, SoftLight, Difference, Exclusion (`src/libtiled/tiled.h`) |
| class, properties | inherited from `Object` |

Key design point: visual attributes compose down the group tree ("effective*" getters).

### TileLayer (`src/libtiled/tilelayer.h`, `.cpp`)

- Storage: `QHash<QPoint, Chunk> mChunks`; each `Chunk` = `QVector<Cell> mGrid(CHUNK_SIZE*CHUNK_SIZE)`,
  index `x + y*CHUNK_SIZE`; chunk key = `(x >> CHUNK_BITS, y >> CHUNK_BITS)`. Same storage for
  fixed and infinite maps (fixed just clamps to `rect()`).
- `Cell`: `_tileset` (Tileset*), `_tileId` (int, -1 = empty), `_flags` (int).
- Cell flags: `FlippedHorizontally=0x01`, `FlippedVertically=0x02`, `FlippedAntiDiagonally=0x04`,
  `RotatedHexagonal120=0x08`, `Checked=0x10` (editor scratch bit, excluded from `VisualFlags`).
- Methods: `cellAt`, `setCell`, `setCells`, `erase(region)`, `merge`, `resize`, `offsetTiles`,
  `flip(dir)`, `rotate(dir)`, `flipHexagonal`, `rotateHexagonal`, `region()`, `modifiedRegion()`,
  `usedTilesets()`, `copy(region)`.
- `flip()` XORs H or V flag and mirrors position; leaves anti-diagonal flag alone.
- `rotate()` packs flags as `(H<<2)|(V<<1)|(D<<0)`, maps through an 8-entry permutation table
  `rotateRightMask = {5, 4, 1, 0, 7, 6, 3, 2}`, `rotateLeftMask = {3, 2, 7, 6, 1, 0, 5, 4}`
  (checked at tag `v1.12.2`), swaps width/height.
- `Cell::operator==` compares tileset, tile ID and visual flags (H, V, D, hex 120); the
  `Checked` scratch bit is excluded (checked at `v1.12.2`).
- Rendering (`maprenderer.cpp` `CellRenderer::render`, `v1.12.2`): ortho tiles are drawn
  bottom-left anchored at their tile size; with D set the fragment is rotated 90° with
  `H' = V`, `V' = !H`, and shifted by half the size difference so the swapped box keeps its
  bottom-left corner.
  Reproduce this table exactly to get Tiled-compatible rotations.

### ObjectGroup (`src/libtiled/objectgroup.h`)

- `QList<MapObject*> mObjects`, `QColor mColor` (display colour), `DrawOrder`: `TopDownOrder`
  (sort by y; default), `IndexOrder` (manual), `UnknownOrder=-1`.
- Also used as the per-tile collision container (`Tile::objectGroup()`).

### ImageLayer (`src/libtiled/imagelayer.h`)

- `mImageSource` (QUrl), `mTransparentColor`, `mImage`, `mRepetition` flags `RepeatX`/`RepeatY`
  (`repeatX()`/`repeatY()`, JSON `repeatx`/`repeaty`, 1.8+).

### GroupLayer

- Container of child layers; contributes offset/opacity/tint/parallax/visibility/lock to
  children via the effective* getters (`src/libtiled/grouplayer.h`, not read in detail).

### Tileset (`src/libtiled/tileset.h`)

| Member | Notes |
|---|---|
| Image vs collection | `isCollection()` = no image source and null image. Image tileset: one atlas cut into a grid. Collection: each `Tile` has its own `imageSource` (and since 1.9 optional sub-rect `imageRect`) |
| `margin`, `tileSpacing` | px around atlas edge / between tiles |
| `tileWidth/Height` | for collections = max tile size |
| `columnCount` | derived for image tilesets (`expectedColumnCount()`), editable for collections |
| `tileOffset` (QPoint) | render offset px, +y down |
| `objectAlignment` | Unspecified, TopLeft, Top, TopRight, Left, Center, Right, BottomLeft, Bottom, BottomRight (`tiled.h`); Unspecified ⇒ BottomLeft (ortho) / Bottom (iso) per docs |
| `TileRenderSize` | `TileSize` (default) or `GridSize` (scale tile to map grid) |
| `FillMode` | `Stretch` or `PreserveAspectFit` (used with GridSize) |
| `Orientation` + `gridSize` | Orthogonal/Isometric; affects terrain overlay and collision editor |
| `TransformationFlag` | `AllowFlipHorizontally`, `AllowFlipVertically`, `AllowRotate`, `PreferUntransformed` (used by terrain to generate variants) |
| `backgroundColor`, `transparentColor` | display / colour-key |
| `mTilesById` (QMap<int,Tile*>), `mTiles` (QList, display order) | |
| `nextTileId` | `takeNextTileId()`; GID span reserved = `nextTileId` |
| `wangSets()` | QList<WangSet*> |

### Tile (`src/libtiled/tile.h`)

- `id`, `className()` (JSON writes it as `type` again since 1.10), `probability` (default 1;
  used by random mode and terrain), `imageSource`/`imageRect` (collections),
  `mObjectGroup` = collision shapes (unique_ptr<ObjectGroup>), `mFrames` = `QVector<Frame{tileId,
  duration}>` (one looping animation per tile; frames reference tiles in same tileset),
  `advanceAnimation(ms)`, `currentFrameIndex()`.

### WangSet / WangColor / WangId (`src/libtiled/wangset.h`, `.cpp`)

- `WangId`: one `quint64`, 8 indexes × 8 bits (`BITS_PER_INDEX=8`, `INDEX_MASK=0xFF`).
  Index order clockwise from top: `Top=0, TopRight=1, Right=2, BottomRight=3, Bottom=4,
  BottomLeft=5, Left=6, TopLeft=7`. Even = edges, odd = corners. 0 = "no colour"/wildcard.
  `MAX_COLOR_COUNT = 254`. Helpers: `rotate`, `flipHorizontally`, `flipVertically`,
  `oppositeIndex` (+4 mod 8), `indexByGrid`.
- `WangSet::Type`: `Corner` (mask `MaskCorners`), `Edge` (`MaskEdges`), `Mixed` (`FULL_MASK`).
  `wangIdOfCell()` = stored id, transformed by the cell's flip/rotate flags, `& typeMask()`.
- `WangSet` members: `name`, `type`, `imageTileId`, `colors` (1-based `colorAt(i)`),
  `mTileIdToWangId` (QHash<int,WangId>), `maximumColorDistance()`, `isComplete()`.
- `WangColor`: `colorIndex`, `name`, `color`, `imageId` (-1), `probability` (1),
  `mDistanceToColor` (QVector<int>), plus class/properties.
- `completeSetSize()` = C^4 (Corner/Edge) or C^8 (Mixed), C = colour count.
- `recalculateCells()`: builds `(WangId, Cell)` list = base tiles + generated variants:
  AllowRotate → ×4, AllowFlipH → ×2, AllowFlipV → ×2 only if count ≤ 4.
  `PreferUntransformed`: skip a variant whose WangId already exists.
- `recalculateColorDistances()`: colours sharing a tile = distance 1; then fixed-point relaxation
  (`d(i,j) = min d(i,t)+d(t,j)`) until stable; slot 0 = distance to "empty". -1 = unreachable.
- `transitionPenalty(a,b)` = that distance. `wangIdProbability(id)` = product of colour
  probabilities over non-zero indexes.

### MapObject (`src/libtiled/mapobject.h`)

- `Shape`: Rectangle (default), Polygon, Polyline, Ellipse, Capsule (1.12), Text, Point.
- Members: `id`, `name`, `className`, `position` (px), `size`, `rotation` (deg, clockwise),
  `visible`, `opacity` (1.12), `cell()` (tile object if cell set ⇒ JSON `gid` with flip bits),
  `polygon()` (points relative to position), `textData()`, `objectTemplate()`.
- Template instances store only overridden props; `MapObject::Property` enum (Name, Visible,
  Text*, Position, Size, Rotation, Opacity, Cell, Shape, Template, CustomProperties) tracks
  which are changed (**partly inferred**; enum is used for get/set by id).

### Properties (`src/libtiled/properties.h/.cpp`, `propertytype.h`)

- Built-in type names: `string`, `int`, `float`, `bool`, `color`, `file` (`FilePath{url}`,
  saved relative), `object` (`ObjectRef{int id}` — map-object id), `class` (QVariantMap),
  `list` (QVariantList, 1.12; each element exported as `{type, propertytype?, value}`).
- Custom types (project file, `propertytype.h`): `PT_Class`, `PT_Enum`.
  - Enum: `storageType` StringValue|IntValue, `values`, `valuesAsFlags` (multi-select; strings
    comma-joined, ints bitflags, max 31 flags per docs).
  - Class: `members` (with defaults, can nest classes), `color`, `drawFill`, `usageFlags`:
    PropertyValueType, LayerClass, MapObjectClass, MapClass, TilesetClass, TileClass,
    WangSetClass, WangColorClass, ProjectClass.
- Inheritance chain (docs + `Object::inheritedProperties()`): class defaults → tile props →
  tile-object instance (and template → instance). Inherited values shown grey.

---

## 3. Editor tools, docks, UX

### Tile tools (`src/tiled/`)

| Tool | Key | File | Behaviour |
|---|---|---|---|
| Stamp Brush | B | `stampbrush.cpp` | Paint current stamp (1+ tiles, possibly multi-layer). Shift+click = line, Ctrl+Shift+click = circle/ellipse centred on first point. States `Free/StartSet/Paint/Capture`. Drag fills gaps with `pointsOnLine`. |
| Terrain Brush | T | `wangbrush.cpp` | Paint a terrain colour onto a corner or edge (picked from cursor pos within tile via 3×3 grid, `WangId::indexByGrid`). Shift = line; Ctrl = toggle full-tile mode (also toolbar "Fill Full Tiles", 1.12); Alt = rotational symmetry: each painted cell is also painted at `(w − x − 1, h − y − 1)` with its WangId rotated by 180° (checked at `v1.12.2`). `indexByGrid` centre cell returns `NumIndexes` and paints nothing. Right-click = sample colour under cursor. Unresolvable cells drawn red. |
| Bucket Fill | F | `bucketfilltool.cpp`, `abstracttilefilltool.cpp` | Flood region of matching cells (cells collected while dragging, 1.12) then fill. Shift = fill selection (or whole layer). Right-click/Esc cancels drag. |
| Shape Fill | P | `shapefilltool.cpp` | Rect or Circle (`ellipseRegion`). Shift = square/circle; Alt = centred on start. Right-click/Esc cancels. |
| Eraser | E | `eraser.cpp` | LMB erase under cursor (line-interpolated); RMB drag = rectangle erase; Shift = all layers. |
| Rectangular Select | R | `tileselectiontool.cpp` | Rect selection. Shift add, Ctrl subtract, Ctrl+Shift intersect (toolbar can lock mode). While dragging (1.12): Shift = square, Ctrl = from centre (docs). |
| Magic Wand | W | `magicwandtool.cpp` | Selects connected region of same tile(s) via `TilePainter::computeFillRegion`. |
| Select Same Tile | S | `selectsametiletool.cpp` | Selects all cells of the current layer equal (`Cell::operator==`, flags included) to the hovered cell; dragging accumulates every cell value hovered; an empty match adds all empty cells. Modes from `abstracttileselectiontool.cpp`: Shift add, Ctrl subtract, Ctrl+Shift intersect; right click clears (checked at `v1.12.2`). |
| Layer offset / world tools | — | `layeroffsettool.cpp`, `worldmovemaptool.cpp` | Out of scope. |

Shared fill behaviour (`abstracttilefilltool.cpp`):
- `FillMethod`: `TileFill` (default), `RandomFill`, `WangFill` (toolbar toggles; mutually exclusive).
- TileFill tiles the stamp over the region's bounding rect from `bounds.topLeft()` row by row
  (step = variation width / tallest in row), picks a variation per step, then erases outside
  the region mask. Not modulo-anchored to world coords.
- RandomFill: `mRandomCellPicker` holds every non-empty cell of every stamp variation weighted by
  `tile->probability()`; one pick per cell.
- WangFill: `WangFiller(wangSet, currentLayer, renderer)`, `setRegion()`, `apply()`; only the
  border has to match neighbours, interior randomised (docs).
- Flood fill (`src/tiled/tilepainter.cpp`): queue-based **scanline** fill, 4-connected on
  rectangular grids (widened on staggered/hex). Bounds: fixed map = layer rect; infinite = current
  selection if any, else layer's occupied `bounds()`.

### Stamp transforms, random, stamps library

- `src/tiled/stampactions.cpp`: X = flip H, Y = flip V, **Z = rotate right (CW)**, **Shift+Z =
  rotate left** (docs page `editing-tile-layers` states the reverse; source and the shortcuts page
  agree on Z = CW). D = random mode. Terrain-fill mode has no shortcut.
- Random mode: picks tiles from the stamp weighted by tile probability (`updateRandomList()`).
- Stamp variations: a `TileStamp` (`tilestamp.cpp`) holds N variations, each with a probability;
  `randomVariations.pick()` per placement.
- Tile Stamps library (`tilestampmanager.cpp`, `tilestampsdock.cpp`, `tilestampmodel.cpp`):
  named stamps with variations, saved as files; Ctrl+1..9 store current stamp (or capture
  selection if no tile tool active), 1..9 recall.
- Right-click capture (`capturestamphelper.cpp`): RMB (no Ctrl) drag on map captures the
  rectangle from the current layer as the new stamp; Shift while releasing = cut. Works in stamp
  brush and fill tools. Ctrl+RMB = select layer of topmost tile under cursor.

### Object tools (tilemap editor: rectangle, point, ellipse, polygon, polyline only, as markers)

S Select Objects (PgUp/PgDn/Home/End reorder in manual order), O Edit Polygons, R Rectangle,
I Point, C Ellipse, P Polygon (Enter finish, Esc cancel, Backspace remove last point), T Tile
object, V Template, E Text. Files: `objectselectiontool.cpp`, `editpolygontool.cpp`,
`create*objecttool.cpp`, `createtemplatetool.cpp`, `objectreferencetool.cpp`.
Ctrl during move = toggle snap; Ctrl during resize = keep aspect; Alt during resize = toggle snap.

### Docks (`src/tiled/`)

| Dock | File | Role |
|---|---|---|
| Layers | `layerdock.cpp` | Tree of layers/groups; visibility, lock, opacity, reorder |
| Tilesets | `tilesetdock.cpp` | Tabs per tileset; select tiles → stamp; filter by name (1.12); `[`/`]` switch |
| Properties | `propertiesdock.cpp` | Built-in + custom props of current selection (rewritten 1.12) |
| Terrain Sets | `wangdock.cpp` (+ `wangsetview`, `wangcolorview`, `wangtemplateview`) | Pick terrain set/colour for terrain brush; in tileset editor, mark tiles; "Patterns" tab shows missing combos |
| Minimap | `minimapdock.cpp`, `minimap.cpp` | Overview + viewport drag |
| Objects | `objectsdock.cpp` | Object list per object layer |
| Tile Stamps | `tilestampsdock.cpp` | Stamps library |
| Templates, Project, Issues, Undo History, Console | `templatesdock.cpp`, `projectdock.cpp`, `issuesdock.cpp`, `undodock.cpp`, `consoledock.cpp` | Secondary |
| Tile Animation Editor | `tileanimationeditor.cpp` | Drag tiles into frame list; default 100 ms; edit/apply durations; preview |
| Tile Collision Editor | `tilecollisiondock.cpp` | Full object-tool editing of shapes in the tile's ObjectGroup; per-shape props |

### General UX conventions (docs, `manual/keyboard-shortcuts`)

- Pan: middle-drag or hold Space. Zoom: Ctrl+wheel, Ctrl+Plus/Minus, Ctrl+0 reset, Ctrl+/ fit.
- Ctrl+G toggle grid; H highlight current layer; Ctrl+Shift+G go to tile; Alt+C copy coords.
- Ctrl+X/C/V tiles; Del remove tiles; Ctrl+J new layer from copied selection; Ctrl+Shift+J
  from moved selection; Ctrl+Shift+A clear selection.
- Ctrl+PgUp/PgDn prev/next layer; Ctrl+Shift+Up/Down move layer; Ctrl+H / Ctrl+L show/lock
  selected; Ctrl+Shift+H / Ctrl+Shift+L show/lock all others; Ctrl+Shift+D duplicate layer.
- Esc clears tile selection when a tile tool is active (1.12). Pressing current tool's key
  again switches to previous tool (1.12; master makes this optional, off by default).
- Tab hides docks. F2 rename.

---

## 4. Terrain (Wang) fill algorithm (`src/tiled/wangfiller.cpp`, `src/libtiled/wangset.cpp`)

Inputs: a WangSet, the current layer as background (`mBack`), the renderer (for hex neighbours).

1. **Painting constraints.** Per touched cell keep `CellInfo{ desired: WangId, mask: WangId }`
   in a `Grid<CellInfo>`. On first touch, `desired` = WangId of the existing cell.
   `setCorner(pos, color)` writes that corner into the 4 cells sharing it;
   `setEdge(pos, index, color)` writes the edge into the cell and its opposite neighbour.
   Painted indexes get `mask = 0xFF` (hard constraint). Region = set of touched cells.
2. **Border seeding** (fill tools, corrections off): border cells of the region derive desired
   colours from untouched outside neighbours (`wangIdFromSurroundings()`), never overriding
   painted indexes.
3. **Bounds** = region bbox expanded by `maximumColorDistance()` (+1 for hex), clipped on fixed maps.
4. **Resolve** each region cell row by row (`resolve(x,y)`):
   - `findBestMatch(info)`:
     - candidates = all `(WangId, Cell)` incl. generated flip/rotate variants, filtered so
       `candidate & mask == desired & mask`;
     - score = Σ over unconstrained-but-desired indexes of `transitionPenalty(desired, cand)`
       (unreachable ⇒ reject if corrections on, else `maxDistance+1`);
     - keep only lowest-score candidates in a `RandomPicker` weighted by
       `wangIdProbability × tile.probability`; if erasing enabled, an empty cell is also a candidate;
     - only with corrections off and the set not complete (`!mCorrectionsEnabled &&
       !isComplete()`), look-ahead: tentatively apply and reject a pick if any neighbour would be
       left with no possible tile; try next pick.
   - On success write cell, mark `Checked`, and `updateAdjacent()` pushes its colours into the
     `desired`+`mask` of all 8 neighbours (shared corners/edges).
   - On failure add to `mInvalidRegion` (brush shows red overlay).
5. **Corrections** (terrain brush, `setCorrectionsEnabled(true)`): edge neighbours outside the
   region but inside bounds whose current tile no longer matches the new masked constraints are
   queued and re-resolved in batches until none remain. This is how painting a corner ripples out
   and how A→C transitions route through an intermediate B (distances > 1).

Brush specifics (`wangbrush.cpp`): modes `PaintCorner` / `PaintEdge` / `PaintEdgeAndCorner`
(by set type), `Idle` when no set. Cursor → index by 3×3 sub-tile grid; corners chosen by
rounding at 0.5, edges by diagonals. Full-tile mode sets all indexes of the centre tile and its
neighbours' shared indexes.

Reproduction notes:
- Precompute per WangSet: variant list, colour-distance matrix (Bellman-Ford style), max distance.
- The greedy row-major resolve + 1-step look-ahead is not a full constraint solver; failures are
  expected on incomplete sets and are surfaced, not hidden.
- Use seeded RNG if deterministic output/tests are needed (Tiled uses random picks).
- `isComplete()` counts only WangIds without a 0 at any of the 8 indexes after the type mask
  (`recalculateCells`, `hasWildCards`), so a corner or edge set is never complete to the filler
  and its look-ahead always runs with corrections off. The editor reproduces this; the
  completeness of SPEC §5.1 and §5.2 counts the type's own indexes.
- Fill tools call only `setRegion`: their cells start with no wish (`desired` all `INDEX_MASK`,
  no mask) apart from border seeding. Region rectangles are resolved in `QRegion` order (bands
  top to bottom, rectangles left to right, each row by row).
- The brush's painting mode comes from `effectiveTypeForColor(color)` (`wangbrush.cpp`
  `setColor`): in a mixed set a terrain used only at corners paints corners, one used only at
  edges paints edges; full-tile mode follows that mode.
- A correction cell found invalid can be resolved by a later batch; Tiled keeps it in
  `mInvalidRegion`. The editor reports only the cells left unchanged (SPEC §5.2).

---

## 5. JSON format (TMJ/TSJ) essentials (`manual: reference/json-map-format`, `src/libtiled/maptovariantconverter.cpp`)

Extensions `.tmj` (map), `.tsj` (tileset), `.tj` (template) accepted since **1.8.0** (`NEWS.md`).

### Map
`type:"map"`, `version` (string, e.g. "1.11"), `tiledversion`, `class`, `orientation`
(orthogonal|isometric|staggered|hexagonal|oblique), `renderorder` (right-down default),
`width`, `height`, `tilewidth`, `tileheight`, `infinite`, `hexsidelength`, `staggeraxis`,
`staggerindex`, `skewx`/`skewy`, `parallaxoriginx/y`, `backgroundcolor`, `compressionlevel`
(-1), `nextlayerid`, `nextobjectid`, `layers[]`, `tilesets[]`, `properties[]`,
`editorsettings` (`chunksize{width,height}`, `export{target,format}`; written only if non-default).

### Layer (common)
`id`, `name`, `type` (tilelayer|objectgroup|imagelayer|group), `class`, `visible`, `locked`,
`opacity`, `mode` (blend, 1.12, omitted when normal; exact strings **unverified**),
`offsetx/y`, `parallaxx/y` (default 1), `tintcolor`, `x`/`y` (always 0), `properties`.
- **tilelayer**: `width`, `height`, `data`, `encoding` (`csv` default ⇒ JSON array of uint GIDs,
  or `base64`), `compression` (`zlib`|`gzip`|`zstd`|""; base64 only). Infinite: `startx`,
  `starty`, `chunks[]` of `{x, y, width, height, data}` (tile coords) instead of `data`.
  Base64 payload = little-endian uint32 GIDs, row-major; pack bytes → compress → base64
  (`gidmapper.cpp encodeLayerData`, verified).
- **objectgroup**: `objects[]`, `draworder` (`topdown` default | `index`).
- **imagelayer**: `image`, `imagewidth/height` (1.11.1), `repeatx`, `repeaty`, `transparentcolor`.
- **group**: `layers[]`.

### Tileset
In a map: either embedded full definition with `firstgid`, or `{firstgid, source:"x.tsj"}`
(external; writer returns early after `source`). Fields: `type:"tileset"`, `name`, `class`,
`tilewidth`, `tileheight`, `tilecount`, `columns`, `image`, `imagewidth`, `imageheight`,
`margin`, `spacing`, `transparentcolor`, `backgroundcolor`, `tileoffset{x,y}`,
`objectalignment`, `tilerendersize` (tile|grid), `fillmode` (stretch|preserve-aspect-fit),
`grid{orientation,width,height}`, `transformations{hflip,vflip,rotate,preferuntransformed}`,
`tiles[]`, `wangsets[]`, `properties`.
- **Tile**: `id` (local), `type` (class; written as `type` since 1.10), `probability`,
  `image`/`imagewidth`/`imageheight` (collections), `x,y,width,height` (sub-rect, 1.9),
  `animation[]` of `{tileid, duration}`, `objectgroup` (collision), `properties`.
  Tiles only listed if they have extra data.
- **WangSet**: `name`, `class`, `type` (corner|edge|mixed), `tile`, `colors[]`
  (`{name, color, class, tile, probability, properties}`), `wangtiles[]` of
  `{tileid, wangid:[8 ints]}` (index order Top, TR, R, BR, B, BL, L, TL), `properties`.

### Object
`id`, `name`, `type` (class), `x`, `y`, `width`, `height`, `rotation`, `visible`, `opacity`,
`gid` (tile object, flip bits allowed), `template`, shape markers `ellipse`/`point`/`capsule`,
`polygon`/`polyline` `[{x,y}]`, `text{...}`, `properties`. Template file (`.tj`):
`{type:"template", tileset?, object}`.

### Property
`{name, type, propertytype?, value}`; types: string, int, float, bool, color (`#AARRGGBB`),
file, object (int id), class (value = object of members), list (1.12; value = array of
`{type, propertytype?, value}`).

### GID encoding (`src/libtiled/gidmapper.cpp`, `reference/global-tile-ids`)

| Bit (0-based) | Mask | Ortho/iso meaning | Hex meaning |
|---|---|---|---|
| 31 | `0x80000000` | flip horizontally | flip horizontally |
| 30 | `0x40000000` | flip vertically | flip vertically |
| 29 | `0x20000000` | flip anti-diagonally (swap x/y) | rotate 60° CW |
| 28 | `0x10000000` | ignored (must clear) | rotate 120° CW |

- Decode: read flags, clear all 4 bits, 0 ⇒ empty; owning tileset = largest `firstgid ≤ gid`;
  local id = gid − firstgid.
- Render order of transforms (ortho): anti-diagonal first, then H, then V.
- `firstgid` assignment on save: starts at 1, `firstgid += tileset.nextTileId()` (not tilecount).
- Always clear bit 28 even on non-hex maps (Tiled keeps it if orientation changed).

---

## 6. Use in the tilemap editor

| Tiled feature | Tilemap editor |
| --- | --- |
| Rotate permutation table (§2 TileLayer) | The same tables: rotations must match Tiled's |
| `WangFiller` (§4) | Same behaviour: colour distances, greedy row-major resolve, 1-step look-ahead, corrections pass; seeded RNG in tests |
| Chunked cell storage (§2 TileLayer) | Use for tile layers: keeps infinite maps additive and maps onto the viewport's chunk tier |
| Scanline flood fill (§3) | One implementation for bucket fill, magic wand and select same tile |
| Bucket Fill (§3) | Fills at the press, not at the release; dragging collects no further cells (1.12's drag is not reproduced) |
| Shape Fill `ellipseRegion` (§3) | Same cells: the ellipse fill's cells must match Tiled's (Zingl's `plotEllipseRect`) |
| Tile collision editor (§3 docks) | A small rectangle/ellipse/polygon editor, reused for marker layers. A click of its rectangle or ellipse tool without a drag makes nothing; Tiled's `CreateObjectTool` (v1.12.2) commits a shape of size 0, which has no area to collide with |
| Object tools (§3) | Only the rectangle, point, ellipse, polygon and polyline tools, as marker tools |
| TMJ/TSJ (§5) | Import only; handling per feature in [BRIEF.md](../BRIEF.md) §7 |
| GID bits (§5) | Bit 29 (anti-diagonal) is valid on orthogonal maps: with H/V it encodes the 90° rotations. Bit 28 is hex-only and is cleared on import |
| Shortcuts (§3) | B stamp, T terrain, F bucket, P shape fill, E eraser, R rect select, W magic wand, S select same tile, X/Y flip, Z / Shift+Z rotate, Space or middle-drag pan, Ctrl+G grid. The tilemap editor's keys after the suite rule ([SUITE.md](../SUITE.md) §4): [DESIGN.md](../DESIGN.md) §10 |

## Unverified / open

None of these is a dependency of the tilemap editor:

- `CHUNK_SIZE` / `CHUNK_BITS` literal values (likely 16 / 4) — not in `tilelayer.h`, `map.h`,
  `tiled.h` or `tiled_global.h`. The editor uses its own 32-cell chunks.
- Exact JSON strings for blend `mode` values. Import drops any `mode` present, whatever its value.
- GroupLayer header not read; behaviour inferred from `Layer::effective*` getters.
