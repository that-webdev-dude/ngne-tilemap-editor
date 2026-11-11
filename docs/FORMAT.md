# NGNE Tilemap Editor — File formats

The formats the editor reads and writes, each specified precisely enough for another program to
do the same. `SPEC.md` says what the editor does with them; where the two differ on the content
of a file, this document governs.

The editor also reads formats it does not define:

| Input | Defined by | Use |
| ----- | ---------- | --- |
| Sprite project `.ngsprite`, version 1 | `..\ngne-sprite-editor\docs\FORMAT.md` §1 | Tileset import and update (SPEC §6.1) |
| `ngne-sprite-atlas`, version 1 | `..\ngne-sprite-editor\docs\FORMAT.md` §2 | Tileset import and update (SPEC §6.1) |
| TMJ, TSJ, TSX | Tiled ([reference/tiled.md](reference/tiled.md) §5) | Map import ([BRIEF.md](BRIEF.md) §7) |

| Format                | File                                     | Version | Section |
| --------------------- | ---------------------------------------- | ------- | ------- |
| NGNE tilemap project  | `<name>.ngtilemap`                         | 1       | [2](#2-tilemap-project-ngtilemap-version-1) |
| NGNE tilemap          | `<map>.tilemap.json`                       | 1       | [3](#3-tilemap-ngne-tilemap-version-1) |
| Tileset atlas         | `<tileset>.png` + `<tileset>.atlas.json` | `ngne-sprite-atlas` 1 | [4](#4-tileset-atlas) |
| Export folder marker  | `ngne-tilemap.export.json`                 | 1       | [5](#5-export-folder) |

Stability: every format here is frozen from release 1.0.0 of the editor. Any change needs a new
version number and a migration from the version before it.

## Conventions

How the sections are written, and nothing more:

- **JSON** is text as in RFC 8259, encoded as UTF-8.
- In a table, **integer** means a JSON number with an integral value (`3`, `3.0` and `3e0` are
  the same integer), **number** a JSON number that an IEEE 754 double holds as a finite value,
  and **string** a JSON string. A range includes both of its ends.
- §1 defines values that §2 and §3 both use; each of those sections says that it uses them.
  Every other rule (whether a member may be left out, what a reader does with an unknown
  member, how a writer lays out the text, which limits apply) stands in its own section and
  holds for that format only.

## 1. Common values

### 1.1 Text, colour, ID, slug

- **Text.** A string of free text (a name, a class, `generator`) holds any characters and may be
  empty unless its row says otherwise. It is at most 255 UTF-16 code units long: a character
  outside the Basic Multilingual Plane counts as two. A text that must be **non-blank** has at
  least one character that ECMAScript's `String.prototype.trim` does not remove.
- **Colour.** A string `#rrggbbaa`: `#` and eight hexadecimal digits for red, green, blue and
  alpha, 8 bits each, alpha not premultiplied. The editor writes lowercase digits and reads
  both cases.
- **ID.** A string of 1 to 64 characters from `A`–`Z`, `a`–`z`, `0`–`9`, `_` and `-`,
  case-sensitive. The editor writes UUIDs. IDs name the project, its maps, tilesets and images.
- **Slug.** A string of 1 to 64 characters matching `[a-z0-9][a-z0-9_-]*`. Slugs are export
  names: they name files in the export folder (§5) and asset IDs in the generated runtime.
  `ngne-tilemap` is reserved and is no slug.

### 1.2 Cell value

A tile layer stores one cell value per cell: an integer 0..4 294 967 295 (an unsigned 32-bit
integer), laid out as Tiled lays out a global tile ID ([reference/tiled.md](reference/tiled.md)
§5).

| Bits  | Mask         | Meaning |
| ----- | ------------ | ------- |
| 31    | `0x80000000` | `H`: flip horizontally |
| 30    | `0x40000000` | `V`: flip vertically |
| 29    | `0x20000000` | `D`: flip anti-diagonally (swap x and y) |
| 28    | `0x10000000` | Reserved, always 0 |
| 0..27 | `0x0FFFFFFF` | GID: 0 is an empty cell, otherwise a tile (below) |

- An empty cell has value 0: a cell with GID 0 has no flag set.
- A map lists the tilesets its cells use, each with a `firstGid`. The tileset of a GID is the
  one with the largest `firstGid` not above it; the tile is the tile whose ID is
  `GID − firstGid`. A reader in JavaScript takes flags and GID apart with `>>> 0` and `&`, never
  with signed shifts: `value >>> 31` is `H`, `value & 0x0FFFFFFF` the GID.
- **Spans.** Each listed tileset owns the GIDs `firstGid .. firstGid + nextTileId − 1`
  (`nextTileId` of §2.4). Spans do not overlap, every GID a cell uses falls in a span, and the
  tile it names exists. A writer lists exactly the tilesets the map's cells use, in the order
  of the project's `tilesets`, from `firstGid` 1, each span starting where the previous ends.
  Both formats use this one rule, so a map's cell values are the same in the project and in its
  export.

The flags name the 8 orientations of a tile; Tiled's rotate commands move between them
(rotate right maps `HVD` = `000` to `101`; [reference/tiled.md](reference/tiled.md) §2).

| `H V D` | Orientation | `fx` | `fy` | `θ` | Texel at tile offset `(a, b)` from the centre lands at |
| ------- | ----------- | ---- | ---- | --- | ------------------------------------------------------ |
| `0 0 0` | As drawn | 1 | 1 | 0 | `( a,  b)` |
| `1 0 0` | Flipped horizontally | −1 | 1 | 0 | `(−a,  b)` |
| `0 1 0` | Flipped vertically | 1 | −1 | 0 | `( a, −b)` |
| `1 1 0` | Rotated 180° | −1 | −1 | 0 | `(−a, −b)` |
| `1 0 1` | Rotated 90° clockwise | 1 | 1 | π/2 | `(−b,  a)` |
| `0 1 1` | Rotated 90° counter-clockwise | −1 | −1 | π/2 | `( b, −a)` |
| `0 0 1` | Flipped over the main diagonal | 1 | −1 | π/2 | `( b,  a)` |
| `1 1 1` | Flipped over the anti-diagonal | −1 | 1 | π/2 | `(−b, −a)` |

Screen axes point right and down. `fx`, `fy` and `θ` are the values of an NGNE sprite (signed
width and height, rotation in radians, clockwise on screen): NGNE maps the texel at `(a, b)` to
`R(θ)·(fx·a, fy·b)` with `R(θ)·(p, q) = (p·cos θ − q·sin θ, p·sin θ + q·cos θ)`. This is
Tiled's rendering: anti-diagonal first, then horizontal, then vertical; with `D` set Tiled
draws at 90° with `H' = V` and `V' = not H` (`src/libtiled/maprenderer.cpp`, `CellRenderer`,
tag `v1.12.2`). Each row has a test fixture with a 3 × 2 asymmetric tile.

### 1.3 Placing a tile

A tile of `tw × th` pixels (its tileset's tile size) with tile offset `offX, offY` (its
tileset's), in cell `(cx, cy)` of a map with grid `gw × gh`:

```text
B      = (cx·gw, (cy + 1)·gh)                       bottom-left corner of the cell
box    = D ? (th, tw) : (tw, th)                    size of the tile as drawn
centre = (B.x + offX + box.w/2, B.y + offY − box.h/2)
```

The tile as drawn has its bottom-left corner on the cell's bottom-left corner, moved by the tile
offset; a tile larger than the grid grows up and to the right. This is Tiled's `BottomLeft`
origin, including its correction for a swapped box under `D`.

**Odd sizes.** The atlas rectangle of a tile is `w × h` = `tw × th` rounded up to even (§4),
with the extra column on the right and the extra row at the bottom, transparent. A renderer
that rounds sprite centres, as NGNE does with `pixelSnap`, draws the whole rectangle so the
quad's edges fall on pixels, and moves the quad so the tile's content stays on `centre`. With
`pw = w − tw` and `ph = h − th` (each 0 or 1):

```text
quad centre = centre + (θ = 0 ? (fx·pw/2, fy·ph/2) : (−fy·ph/2, fx·pw/2))
quad size   = (fx·w, fy·h), rotation θ
```

Example: a 15 × 15 tile in a 15 px grid, cell `(0, 0)`, rectangle 16 × 16. As drawn, its
content centre is `(7.5, 7.5)` and the quad centre `(8, 8)`: the quad covers `0..16` and its
transparent column `15..16`. Flipped horizontally the quad centre is `(7, 8)`: the quad covers
`−1..15`, the transparent column lands on `−1..0`, and the content again covers `0..15`.
Rotated 90° clockwise the quad centre is `(7, 8)` as well.

A render scale `s` multiplies every position and size above. The result is seam-free only for
whole-number `s` ([ENGINE.md](ENGINE.md) §7).

### 1.4 Property

A **property list** is an array of Property, at most 256, with no two of the same `name`. A
writer sorts it by `name` in UTF-16 code-unit order; a reader accepts any order.

| Member  | Type   | Constraint | Meaning |
| ------- | ------ | ---------- | ------- |
| `name`  | text   | Non-blank  | Case-sensitive |
| `type`  | string | `"bool"`, `"int"`, `"float"`, `"string"`, `"color"` or `"file"` | |
| `value` | by `type` | below | |

| `type`     | `value` |
| ---------- | ------- |
| `"bool"`   | boolean |
| `"int"`    | integer −9 007 199 254 740 991..9 007 199 254 740 991 |
| `"float"`  | number |
| `"string"` | string of at most 65 535 UTF-16 code units |
| `"color"`  | colour |
| `"file"`   | string of at most 1024 UTF-16 code units: a file name or path as the user chose or typed it; its meaning is the game's |

`type` is stored because JSON writes the float `2.0` and the int `2` alike.

### 1.5 Shape

The geometry of a marker (§2.5, §3.5) and of a tile's collision shape (§2.4, §3.3). Coordinates
are pixels, x right, y down, as numbers.

| `shape`       | Members besides `shape`, `x`, `y` | Meaning |
| ------------- | --------------------------------- | ------- |
| `"rectangle"` | `width`, `height`: number ≥ 0 | `x, y` is the top-left corner |
| `"ellipse"`   | `width`, `height`: number ≥ 0 | The ellipse inscribed in that rectangle |
| `"point"`     | none | The point `x, y` |
| `"polygon"`   | `points`: array of 3 to 1024 points | Closed outline; each point `[px, py]` is relative to `x, y` |
| `"polyline"`  | `points`: array of 2 to 1024 points | Open line; points as above |

A point is an array of two numbers. Collision shapes are rectangles, ellipses and polygons only.

## 2. Tilemap project (`.ngtilemap`), version 1

One file holds one project of `SPEC.md` with everything needed to open it again: its maps, its
tilesets with their pixels, the images of its image layers, a thumbnail per map and the export
settings. It holds no session state (open tabs, selection, active layer, view) and no undo
history.

- File extension `.ngtilemap`, media type `application/x-ngtilemap`.
- Implementation: `src/core/project` (`serialize`, `deserialize`).
- A file of this version, kept as a test fixture: `tests/fixtures/format/golden-v1.ngtilemap`.
- Uses §1.1 to §1.5.

### 2.1 Container

The file is a zip archive (PKWARE APPNOTE) under the container rules of the sprite editor's
`.ngsprite` v1 (`..\ngne-sprite-editor\docs\FORMAT.md` §1.1), restated here. A reader refuses an
archive that breaks one of them.

- One disk; no zip64 records; at most 65 534 entries.
- The central directory ends exactly where the end-of-central-directory record starts, and that
  record with its comment ends the file.
- An entry that is read is not encrypted and uses method 0 (stored) or 8 (deflate).
- No two entries have the same name, compared byte for byte as UTF-8; `/` separates a folder
  from a name.
- The central directory is authoritative for name, sizes, CRC-32 and method; the local header
  must carry the same name; nothing else of it is interpreted.
- Every entry that is read has a matching CRC-32 and exactly its stated uncompressed size.

Entries may appear in any order; a reader finds them by name and ignores entries this section
does not name.

What the editor writes, beyond the rules: the entries in the order of §2.2 (maps, tilesets and
images in the order of their lists in `project.json`); JSON entries deflated, PNG entries
stored; time stamp 1980-01-01 00:00:00 on every entry, no extra fields, comments, flags or
attributes. The same project always gives the same bytes; that is a property of one version of
the editor, not of the format.

### 2.2 Entries

| Entry                     | Content                                         | Section |
| ------------------------- | ----------------------------------------------- | ------- |
| `manifest.json`           | Format name and version                         | §2.3    |
| `project.json`            | The project, its tilesets and images, without pixels or maps | §2.4 |
| `maps/<mapId>.json`       | One map; one entry per map                      | §2.5    |
| `tilesets/<tilesetId>.png`| The pixels of one tileset                       | §2.6    |
| `images/<imageId>.png`    | The pixels of one image                         | §2.6    |
| `thumbs/<mapId>.png`      | A picture of one map, at most 128 px a side     | §2.7    |

All entries are required except the thumbnails.

**The JSON entries** follow these rules:

- Every member a table lists is **required**, and an object has **no other member**. Nothing
  has a default; a member that may be absent in the model is written as `null` where its row
  says so. A reader refuses an entry with a missing or unknown member.
- Member names are unique within an object; a reader refuses an object with a repeated name.
- No byte order mark (a reader skips one). Member order and white space carry no meaning. The
  editor writes members in the order of the tables, indented by four spaces, each `data` array
  of a tile layer with one map row per line, and a line feed at the end.

### 2.3 `manifest.json`

```json
{
    "format": "ngne-tilemap-project",
    "version": 1,
    "generator": "ngne-tilemap-editor 1.0.0"
}
```

| Member      | Type    | Value |
| ----------- | ------- | ----- |
| `format`    | string  | `"ngne-tilemap-project"` |
| `version`   | integer | At least 1. This section specifies 1 |
| `generator` | text    | Name and version of the writer. Informative only |

A reader checks them before anything else: another `format` is not a tilemap project; a
`version` above the newest it knows is refused, naming both versions, without reading further;
an older one is migrated (§2.10).

### 2.4 `project.json`

**Project**

| Member           | Type             | Constraint | Meaning |
| ---------------- | ---------------- | ---------- | ------- |
| `id`             | ID               | | Identity of the project; the export folder marker names it (§5) |
| `name`           | text             | Non-blank | |
| `exportName`     | slug             | | Namespace of the runtime's asset IDs (`ngne-tilemap:<exportName>/<tileset>`) |
| `maps`           | array of MapRef  | 1 to 256 | The maps, in the order of the project's map list |
| `tilesets`       | array of Tileset | At most 255 | In the order of the Tilesets panel; this order assigns `firstGid` (§1.2) |
| `images`         | array of Image   | At most 256 | Images of image layers |
| `exportSettings` | object           | `exportOnSave`: boolean | Export again on every save |
| `properties`     | property list    | | Project properties (not exported) |

The IDs of the project, its maps, tilesets and images are distinct from one another, and no two
of them differ only in letter case (they name zip entries). The `exportName` values of all
maps, tilesets and images are distinct from one another (they name files in one folder, §5).

**MapRef**

| Member | Type | Meaning |
| ------ | ---- | ------- |
| `id`   | ID   | Names `maps/<id>.json` |

**Tileset.** An image cut into tiles of one size, stored as a grid without margin or spacing.

| Member        | Type          | Constraint | Meaning |
| ------------- | ------------- | ---------- | ------- |
| `id`          | ID            | | Names `tilesets/<id>.png` |
| `name`        | text          | Non-blank | Shown in the editor |
| `exportName`  | slug          | | Base name of its atlas files |
| `class`       | text          | | Empty for none |
| `tileWidth`   | integer       | 1..256 | |
| `tileHeight`  | integer       | 1..256 | |
| `columns`     | integer       | 1..8192, `columns × tileWidth ≤ 8192` | Tiles per row of the stored image |
| `offsetX`     | integer       | −4096..4096 | Tile offset when drawn, +x right (§1.3) |
| `offsetY`     | integer       | −4096..4096 | +y down |
| `nextTileId`  | integer       | 1..1 048 576, above every tile `id` | ID of the next tile created; IDs are never reused |
| `source`      | Source        | | Where the pixels came from |
| `tiles`       | array of Tile | 1 to 65 536; `ceil(tiles / columns) × tileHeight ≤ 8192` | In display order; tile `k` of the list is at column `k mod columns`, row `floor(k / columns)` of the stored image |
| `terrainSets` | array of TerrainSet | At most 256 | |
| `properties`  | property list | | |

**Source.** The binding that "Update tileset from source" re-reads (BRIEF §5).

| Member     | Type    | Constraint | Meaning |
| ---------- | ------- | ---------- | ------- |
| `kind`     | string  | `"image"`, `"sprite"`, `"atlas"` or `"collection"` | Grid PNG, sprite-editor project `.ngsprite` sliced by a grid, `ngne-sprite-atlas`, or one image per tile (TMJ collection of uniform size) |
| `fileName` | text    | Non-blank | Name of the source file (for `"collection"`: of the TSJ/TSX or TMJ it came from) |
| `margin`   | integer | 0..4096; 0 unless `"image"` or `"sprite"` | Pixels around the source image's (each frame's) edge |
| `spacing`  | integer | 0..4096; 0 unless `"image"` or `"sprite"` | Pixels between source tiles |

**Tile**

| Member        | Type          | Constraint | Meaning |
| ------------- | ------------- | ---------- | ------- |
| `id`          | integer       | 0..1 048 575, unique in the tileset | The stable tile ID that maps store |
| `source`      | Source key or `null` | By the tileset's `source.kind`, below | Where the tile is in the source; `null` for a tile kept after it went missing from the source |
| `fingerprint` | string        | 64 lowercase hexadecimal digits | SHA-256 of the tile's pixels (below) |
| `class`       | text          | | Tile class; empty for none |
| `collision`   | array of Shape | At most 64; `"rectangle"`, `"ellipse"`, `"polygon"`; coordinates −4096..4096 | In tile pixels from the tile's top-left corner, as drawn untransformed |
| `animation`   | array of AnimationFrame | Empty, or 1 to 1024 | Empty: not animated. Otherwise the tile shows these frames in a loop |
| `properties`  | property list | | |

| `source.kind`  | Source key |
| -------------- | ---------- |
| `"image"`      | `[column, row]`: integers 0..65 535, the tile's cell in the source grid |
| `"sprite"`     | `[frameId, column, row]`: the sprite frame's `id` (an ID of the sprite editor's format) and integers 0..65 535, the cell in that frame's grid |
| `"atlas"`      | string: the atlas frame ID |
| `"collection"` | text: the tile's image file name |

No two tiles of a tileset have the same source key.

**Fingerprint.** SHA-256 over the tile's `tileWidth × tileHeight × 4` bytes: rows top to bottom,
pixels left to right, red, green, blue, alpha, not premultiplied, every pixel with alpha 0
written as `0, 0, 0, 0`. The writer computes it; a reader does not check it (it is matching
data for "Update tileset from source", not an integrity check: the zip's CRC-32 is).

**AnimationFrame**

| Member | Type    | Constraint | Meaning |
| ------ | ------- | ---------- | ------- |
| `tile` | integer | The `id` of a tile of the same tileset | |
| `ms`   | integer | 1..65 535 | How long it shows |

The entries of all animations of a tileset together are at most 65 536 (§4).

**TerrainSet** (Tiled's Wang set, [reference/tiled.md](reference/tiled.md) §2)

| Member   | Type   | Constraint | Meaning |
| -------- | ------ | ---------- | ------- |
| `name`   | text   | Non-blank | |
| `type`   | string | `"corner"`, `"edge"` or `"mixed"` | |
| `colors` | array of TerrainColor | 1 to 254 | Terrain `n` is `colors[n − 1]`; 0 means no terrain |
| `tiles`  | array of TerrainTile | At most 65 536 | |

| TerrainColor member | Type | Constraint | Meaning |
| ------------------- | ---- | ---------- | ------- |
| `name`  | text | Non-blank | |
| `color` | colour | | Shown in the editor |
| `tile`  | integer or `null` | The `id` of a tile of the tileset | Icon of the terrain |

| TerrainTile member | Type | Constraint | Meaning |
| ------------------ | ---- | ---------- | ------- |
| `tile`   | integer | The `id` of a tile of the tileset; unique within the set | |
| `wangId` | array of 8 integers | Each 0..`colors.length`; `"corner"`: indexes 0, 2, 4, 6 are 0; `"edge"`: indexes 1, 3, 5, 7 are 0 | Terrain per index, clockwise from the top: top, top-right, right, bottom-right, bottom, bottom-left, left, top-left |

**Image**

| Member       | Type    | Constraint | Meaning |
| ------------ | ------- | ---------- | ------- |
| `id`         | ID      | | Names `images/<id>.png` |
| `name`       | text    | Non-blank | |
| `exportName` | slug    | | Base name of its exported PNG |
| `width`      | integer | 1..8192 | |
| `height`     | integer | 1..8192 | |

### 2.5 `maps/<mapId>.json`

**Map**

| Member            | Type    | Constraint | Meaning |
| ----------------- | ------- | ---------- | ------- |
| `id`              | ID      | The `id` of its MapRef | |
| `name`            | text    | Non-blank | Map title, shown on its tab |
| `exportName`      | slug    | | Base name of `<exportName>.tilemap.json`; renaming the title does not change it |
| `class`           | text    | | Empty for none |
| `orientation`     | string  | `"orthogonal"` | The only orientation of version 1 (BRIEF D2) |
| `width`           | integer | 1..4096 | In cells |
| `height`          | integer | 1..4096; `width × height ≤ 1 048 576` | In cells |
| `tileWidth`       | integer | 1..256 | Grid cell width in pixels |
| `tileHeight`      | integer | 1..256 | |
| `backgroundColor` | colour or `null` | | `null`: none |
| `parallaxOriginX` | number  | −1 048 576..1 048 576 | Map pixel where parallax has no effect (§3.4) |
| `parallaxOriginY` | number  | −1 048 576..1 048 576 | |
| `nextLayerId`     | integer | 1..2 147 483 647, above every layer `id` | IDs are never reused |
| `nextMarkerId`    | integer | 1..2 147 483 647, above every marker `id` | |
| `tilesets`        | array of TilesetRef | §1.2 | The tilesets the cells use |
| `layers`          | array of Layer | 1 to 256 layers in the whole tree | Bottom to top |
| `properties`      | property list | | |

All tile layers of a map together hold at most 4 194 304 cells.

| TilesetRef member | Type    | Constraint | Meaning |
| ----------------- | ------- | ---------- | ------- |
| `tileset`         | ID      | The `id` of a tileset of the project | |
| `firstGid`        | integer | 1..268 435 455 | §1.2 |

**Layer.** `type` decides the members after the common ones.

| Member       | Type    | Constraint | Meaning |
| ------------ | ------- | ---------- | ------- |
| `id`         | integer | 1..2 147 483 647, unique in the map | Stable; exported as is |
| `type`       | string  | `"tile"`, `"marker"`, `"image"` or `"group"` | |
| `name`       | text    | | Games find layers by name; names need not be unique |
| `class`      | text    | | Empty for none |
| `visible`    | boolean | | |
| `locked`     | boolean | | |
| `opacity`    | integer | 0..255 | 255 is opaque |
| `offsetX`    | integer | −1 048 576..1 048 576 | Pixels, +x right |
| `offsetY`    | integer | −1 048 576..1 048 576 | Pixels, +y down |
| `parallaxX`  | number  | −100..100 | Parallax factor (§3.4); 1 moves with the map |
| `parallaxY`  | number  | −100..100 | |
| `properties` | property list | | |

| `type`     | Further members |
| ---------- | --------------- |
| `"tile"`   | `data`: array of `width × height` cell values (§1.2), row by row from the top-left |
| `"marker"` | `color`: colour, how the editor draws its markers; `markers`: array of Marker, in the order the editor lists them |
| `"image"`  | `image`: the `id` of an image of the project; `repeatX`, `repeatY`: boolean |
| `"group"`  | `layers`: array of Layer, bottom to top; nesting at most 16 groups deep |

A group's visibility, lock, opacity, offset and parallax apply to its children as in Tiled:
visible and unlocked only if every ancestor is; opacity and parallax multiply; offsets add.
The effective offset and parallax of every layer stay inside the ranges of the table above.

**Marker.** A Shape (§1.5) with:

| Member       | Type          | Constraint | Meaning |
| ------------ | ------------- | ---------- | ------- |
| `id`         | integer       | 1..2 147 483 647, unique in the map | Stable; exported as is |
| `name`       | text          | | |
| `class`      | text          | | Empty for none |
| `x`, `y`     | number        | −1 048 576..1 048 576 | Map pixels |
| `properties` | property list | | |

A map has at most 16 384 markers with at most 262 144 points in all.

### 2.6 Images

`tilesets/<id>.png` is `columns × tileWidth` wide and `ceil(tiles / columns) × tileHeight`
high; `images/<id>.png` has its image's `width` and `height`. Both are PNG with colour type 6
(RGB with alpha), bit depth 8, no interlacing. Samples are red, green, blue, alpha, not
premultiplied, without colour conversion; a reader ignores ancillary chunks. Pixels of a
tileset image that no tile covers have alpha 0. The editor writes no chunk besides IHDR, IDAT
and IEND.

### 2.7 Thumbnails

`thumbs/<mapId>.png` shows the map for programs that list project files: the background colour,
then its visible tile and image layers composited with opacity and offsets, without parallax,
markers or animation (each animated tile shows itself), as an 8-bit RGBA PNG. With the map
`W × H` pixels (`width × tileWidth` by `height × tileHeight`): when neither side exceeds 128 it
has that size; otherwise it is scaled by nearest neighbour so the longer side is 128 and the
other `max(1, round(side × 128 / longer side))`, pixel `(x, y)` showing map pixel
`(floor((x + 0.5) × W / w), floor((y + 0.5) × H / h))`. A writer includes it; a reader does
not need or check it.

### 2.8 Limits

A writer does not exceed them; a reader checks each one before it inflates, decodes or
allocates what the limit is about, and refuses the file. The implementation exports each as a
constant (`src/core/project`). These are hard limits of the file; the performance envelope is
narrower (BRIEF D1).

| What | Limit |
| ---- | ----- |
| Maps | 256 |
| Tilesets; images | 255; 256 |
| Tiles per tileset; tile ID | 65 536; 1 048 575 |
| Tiles in all tilesets | 262 144 |
| Pixels of all tileset images together | 64 MP (67 108 864) |
| Pixels of all images together | 64 MP |
| Map side; cells per tile layer; cells of all tile layers of a map | 4096; 1 048 576; 4 194 304 |
| Layers per map (groups included); group depth | 256; 16 |
| Markers per map; marker points per map | 16 384; 262 144 |
| Collision shapes per tile; points per shape | 64; 1024 |
| Animation frames per tile; per tileset | 1024; 65 536 |
| Terrain sets per tileset; terrains per set | 256; 254 |
| Properties per list | 256 |
| Length of an ID; slug; text | 64; 64; 255 UTF-16 code units |

| Entry | Limit, uncompressed |
| ----- | ------------------- |
| `manifest.json` | 64 KiB |
| `project.json` | 64 MiB |
| One `maps/<mapId>.json` | 64 MiB |
| One PNG | `height × (4 × width + 1) + 65 536` bytes |
| All entries together | 2 GiB |

The count limits do not guarantee the size limits when many are reached at once (for example
262 144 tiles each with 64 collision polygons). The writer checks the sizes and refuses to save,
naming the entry, rather than write a file it could not read.

### 2.9 Reading

A file is untrusted. A reader checks everything before it uses it, in this order, stops at the
first problem, and returns a whole project or none.

1. The container (§2.1).
2. `manifest.json`: present, within its limit, intact, valid JSON without repeated names; §2.3.
3. `project.json`: as `manifest.json`; migrated when older; every member against §2.4: none
   missing or unknown, each of its type and range, IDs and slugs well-formed and distinct as
   required, tile IDs unique and below `nextTileId`, every tile reference inside its tileset,
   terrain `wangId` values within the set, counts within §2.8.
4. Every map in `maps`: as `project.json`, against §2.5: layer and marker IDs unique and below
   their counters, `data` of the right length, `tilesets` and cell values against §1.2.
5. The pixel limits of §2.8 from the stated sizes.
6. Every tileset and image PNG: present, within its limit; header (colour type, bit depth,
   interlacing, size) against §2.6 before decoding; then the pixels.

Steps 1 to 5 decode no pixels. The reader reports each problem as a `ProjectError` with a code
for its kind and the entry at fault (`src/core/project/errors.ts`). The writer makes the checks
of steps 3 to 6 on the project it saves and refuses one that fails.

### 2.10 Versions and migrations

A change after the freeze gets the next version. A reader of version N reads 1 to N: it
migrates the parsed JSON entries step by step, one migration per version, then checks the
result as version N (`src/core/project/migrations.ts`). A file is always written in the newest
version.

## 3. Tilemap (`ngne-tilemap`), version 1

One JSON file describes one map for a game: its cells, layers, markers, and of each tileset it
uses the data a game needs besides the pixels (tile classes, properties, collision). The pixels
and tile rectangles are in the tileset atlases (§4). Terrain sets, locks, display colours, the
source binding and fingerprints are editor data and are not here.

- File `<map>.tilemap.json` in the export folder (§5); `<map>` is the map's `exportName`.
- Implementation: `src/core/tilemap` (`tilemapFor` writes, `validateTilemap` reads); the generated
  runtime carries the same reader.
- A file of this version, kept as a test fixture with its atlas:
  `tests/fixtures/format/meadow.tilemap.json`.
- Uses §1.1 to §1.5.

A **rule** holds for every file of this format, whoever wrote it; what **the editor writes**
(§3.7) is a property of this writer only.

### 3.1 The JSON text

The rules of `ngne-sprite-atlas` v1 (`..\ngne-sprite-editor\docs\FORMAT.md` §2.1), restated:

- Every member a table lists is **required**. Nothing has a default.
- An object may hold **other members**; a reader ignores them. A member that changes what a
  reader must do is a change of the format (§3.9).
- Member names are unique within an object; a writer never repeats one, and a reader need not
  detect a repeat.
- Member order and white space carry no meaning; no byte order mark.

### 3.2 The tilemap

| Member            | Type    | Constraint | Meaning |
| ----------------- | ------- | ---------- | ------- |
| `format`          | string  | `"ngne-tilemap"` | |
| `version`         | integer | At least 1. This section specifies 1 | |
| `generator`       | text    | | Informative only |
| `project`         | slug    | | The project's `exportName`: namespace of asset IDs |
| `name`            | slug    | | The map's `exportName` |
| `title`           | text    | | The map's title |
| `class`           | text    | | The map's class; empty for none |
| `orientation`     | string  | `"orthogonal"` | |
| `width`, `height` | integer | 1..4096; `width × height ≤ 1 048 576` | In cells |
| `tileWidth`, `tileHeight` | integer | 1..256 | Grid cell size in pixels |
| `backgroundColor` | colour or `null` | | |
| `parallaxOriginX`, `parallaxOriginY` | number | −1 048 576..1 048 576 | §3.4 |
| `tilesets`        | array of Tileset | §1.2 spans | The tilesets the cells use |
| `groups`          | array of Group | | The group layers of the map |
| `layers`          | array of Layer | 1 to 256 | Tile, marker and image layers, flattened, bottom to top |
| `properties`      | property list | | Map properties |

`format` and `version` are checked first: another `format` is not a tilemap; a `version` above
the newest the reader knows is refused, naming both versions, without reading further.

### 3.3 Tileset

| Member        | Type    | Constraint | Meaning |
| ------------- | ------- | ---------- | ------- |
| `name`        | slug    | | The tileset's `exportName` |
| `atlas`       | string  | `<name>.atlas.json` | The atlas JSON in the same folder (§4) |
| `class`       | text    | | Empty for none |
| `firstGid`    | integer | 1..268 435 455 | §1.2 |
| `nextTileId`  | integer | 1..1 048 576 | Length of the span |
| `tileWidth`, `tileHeight` | integer | 1..256 | |
| `offsetX`, `offsetY` | integer | −4096..4096 | Tile offset (§1.3) |
| `tiles`       | array of TileData | | The tiles with a class, properties or collision, in ID order; every other tile has none |
| `properties`  | property list | | |

**TileData**

| Member       | Type   | Constraint | Meaning |
| ------------ | ------ | ---------- | ------- |
| `id`         | integer | 0..`nextTileId − 1`, unique in the list | |
| `class`      | text   | | Empty for none |
| `collision`  | array of Shape | §2.4 Tile `collision` | In tile pixels, untransformed; a reader transforms them by the cell's orientation (§1.2) about the tile's centre |
| `properties` | property list | | |

The tiles of a tileset are the frames of its atlas (§4): a cell value or TileData naming a
tile its atlas lacks is an error.

### 3.4 Group and layer

**Group**

| Member       | Type    | Constraint | Meaning |
| ------------ | ------- | ---------- | ------- |
| `id`         | integer | 1..2 147 483 647, unique among groups and layers | |
| `name`       | text    | | |
| `class`      | text    | | Empty for none |
| `parentId`   | integer or `null` | The `id` of another group; no cycles | `null` at the top |
| `properties` | property list | | |

**Layer.** The values are **effective**: a group's visibility, opacity, offset and parallax are
already applied (§2.5), so a reader draws a layer from its own members alone.

| Member       | Type    | Constraint | Meaning |
| ------------ | ------- | ---------- | ------- |
| `id`         | integer | 1..2 147 483 647, unique among groups and layers | The project's layer ID |
| `type`       | string  | `"tile"`, `"marker"` or `"image"` | |
| `name`       | text    | | |
| `class`      | text    | | Empty for none |
| `groupId`    | integer or `null` | The `id` of a group | The innermost group holding it |
| `visible`    | boolean | | Hidden layers are exported; a game may show them |
| `opacity`    | integer | 0..255 | `round(255 × Π(oᵢ / 255))` over the layer and its groups |
| `offsetX`, `offsetY` | integer | −1 048 576..1 048 576 | Sum over the layer and its groups |
| `parallaxX`, `parallaxY` | number | −100..100 | Product over the layer and its groups |
| `properties` | property list | | |

| `type`     | Further members |
| ---------- | --------------- |
| `"tile"`   | `data`: array of `width × height` cell values (§1.2), row by row from the top-left |
| `"marker"` | `markers`: array of Marker (§3.5) |
| `"image"`  | `image`: `<image>.png` in the folder, a plain file name as an atlas's `image` (sprite editor `FORMAT.md` §2.2); `imageWidth`, `imageHeight`: integer 1..8192, the image's size (its PNG has these sides rounded up to even, §5); `repeatX`, `repeatY`: boolean |

**Position.** A layer is drawn moved by

```text
shift = (offsetX + (Vx − parallaxOriginX) × (1 − parallaxX),
         offsetY + (Vy − parallaxOriginY) × (1 − parallaxY))
```

where `V` is the centre of the view in map pixels (Tiled: the distance between parallax origin
and view centre). With factor 1 a layer moves with the map; with 0 it stays fixed on screen. An
image layer's image has its top-left corner at `shift`; `repeatX`/`repeatY` tile it without end
along that axis, one copy every `imageWidth` (`imageHeight`) pixels. A renderer that rounds sprite
centres, as NGNE does with `pixelSnap`, draws the whole PNG, whose sides are even (§5), with its
top-left corner at the image's: the quad's edges then fall on pixels, and its transparent extra
column and row draw nothing.

### 3.5 Marker

A Shape (§1.5) with `id` (integer 1..2 147 483 647, unique in the tilemap), `name` (text),
`class` (text, empty for none), `x`, `y` (number, map pixels, before the layer's shift) and
`properties` (property list). Markers stand in the order the editor lists them.

### 3.6 Limits

A writer does not exceed them; a reader refuses a file that does (`src/core/tilemap` exports each
as a constant).

| What | Limit |
| ---- | ----- |
| Map side; cells per tile layer; cells of all tile layers | 4096; 1 048 576; 4 194 304 |
| Groups and layers together | 256 |
| Tilesets | 255 |
| Markers; marker points | 16 384; 262 144 |
| Collision shapes per tile; points per shape | 64; 1024 |
| Properties per list | 256 |
| File size | 64 MiB |

### 3.7 What the editor writes

Beyond the rules, not for a reader to rely on:

- Members in the order of the tables and no others; indented by four spaces, each `data` array
  with one map row per line, ASCII, a line feed at the end. The same project gives the same
  bytes.
- `tilesets` in project order with `firstGid` assigned by §1.2, so `data` equals the project's.
- `groups` in tree order (parents first); `layers` in draw order.
- Properties sorted by name.

### 3.8 Reading

`validateTilemap(json, atlases)` takes the parsed JSON and the validated atlases of its tilesets
by tileset name. It checks, in order, and returns a whole tilemap or none:

1. The value is an object; `format` and `version` (§3.2).
2. Every member of §3.2 to §3.5: present, of its type and in its range; counts checked from
   array lengths before elements are read.
3. Cross-references: group parents exist and form no cycle; `groupId`s exist; IDs unique; spans
   of §1.2 do not overlap.
4. Every tileset against its atlas (§4); every non-zero cell value has bit 28 clear and names a
   tile its atlas has; every TileData `id` names one.

A member is read only as a member of its own object (`__proto__` is a name like any other). The
result holds the members of the tables and nothing else; each `data` becomes a `Uint32Array`.

A problem is a `TilemapError` with the path of the member at fault and one of these codes
(`src/core/tilemap/errors.ts`); the reader throws nothing else.

| Code            | The problem |
| --------------- | ----------- |
| `format`        | Not an object, `format` is not `"ngne-tilemap"`, or not readable |
| `newer-version` | `version` above 1 |
| `field`         | A member missing, of the wrong type or outside its range |
| `reference`     | A group, tileset or tile that does not exist; a cell outside every span; a cycle of groups |
| `atlas`         | A tileset's atlas missing or not matching §4 |
| `limit`         | A count above §3.6 |

### 3.9 Versions

A change after the freeze gets the next version: a member a reader must understand, a new
value of `type` or `shape`, a wider range, a changed meaning. A reader of version N reads 1 to
N; the generated runtime of every editor release reads every version up to its own. A file is
always written in the newest version.

### 3.10 Example

A 4 × 3 map of 16 px cells with one tileset of four tiles (tile 2 animated, tile 3 solid), a
tile layer with a flipped and a rotated cell inside a group, and a marker layer.

```json
{
    "format": "ngne-tilemap",
    "version": 1,
    "generator": "ngne-tilemap-editor 1.0.0",
    "project": "meadow-game",
    "name": "meadow",
    "title": "Meadow",
    "class": "",
    "orientation": "orthogonal",
    "width": 4,
    "height": 3,
    "tileWidth": 16,
    "tileHeight": 16,
    "backgroundColor": "#6db3e8ff",
    "parallaxOriginX": 0,
    "parallaxOriginY": 0,
    "tilesets": [
        {
            "name": "grass",
            "atlas": "grass.atlas.json",
            "class": "",
            "firstGid": 1,
            "nextTileId": 4,
            "tileWidth": 16,
            "tileHeight": 16,
            "offsetX": 0,
            "offsetY": 0,
            "tiles": [
                {
                    "id": 3,
                    "class": "solid",
                    "collision": [{ "shape": "rectangle", "x": 0, "y": 0, "width": 16, "height": 16 }],
                    "properties": [{ "name": "friction", "type": "float", "value": 0.8 }]
                }
            ],
            "properties": []
        }
    ],
    "groups": [{ "id": 4, "name": "World", "class": "", "parentId": null, "properties": [] }],
    "layers": [
        {
            "id": 1,
            "type": "tile",
            "name": "Ground",
            "class": "",
            "groupId": 4,
            "visible": true,
            "opacity": 255,
            "offsetX": 0,
            "offsetY": 0,
            "parallaxX": 1,
            "parallaxY": 1,
            "properties": [],
            "data": [
                0, 0, 3, 0,
                0, 2147483649, 0, 2684354562,
                4, 4, 4, 4
            ]
        },
        {
            "id": 2,
            "type": "marker",
            "name": "Spawns",
            "class": "",
            "groupId": null,
            "visible": true,
            "opacity": 255,
            "offsetX": 0,
            "offsetY": 0,
            "parallaxX": 1,
            "parallaxY": 1,
            "properties": [],
            "markers": [
                { "shape": "point", "id": 1, "name": "player", "class": "spawn", "x": 8, "y": 24, "properties": [] },
                {
                    "shape": "rectangle", "id": 2, "name": "exit", "class": "zone",
                    "x": 48, "y": 16, "width": 16, "height": 16,
                    "properties": [{ "name": "target", "type": "string", "value": "cave" }]
                }
            ]
        }
    ],
    "properties": [{ "name": "music", "type": "file", "value": "meadow.ogg" }]
}
```

- `3` is GID 3 → tile 2 (animated, §4) as drawn.
- `2147483649` is `0x80000001`: `H` set, GID 1 → tile 0 flipped horizontally.
- `2684354562` is `0xA0000002`: `H` and `D` set, GID 2 → tile 1 rotated 90° clockwise. At cell
  `(3, 1)`: `B = (48, 32)`, centre `(56, 24)`, sprite 16 × 16 with `fx = fy = 1`, `θ = π/2`.
- `4` is tile 3, class `solid`, along the bottom row.

## 4. Tileset atlas

Each tileset is exported as an `ngne-sprite-atlas` version 1 (`..\ngne-sprite-editor\docs\FORMAT.md`
§2, whose rules apply unchanged) with these further rules, which `validateTilemap` checks:

- Files `<name>.png` and `<name>.atlas.json`, `<name>` the tileset's `exportName`; `image` is
  `<name>.png`.
- One frame per tile, with ID `<name>-<tileId>` (tile ID in decimal, no leading zeros), and no
  other frame.
- Every frame: `sourceW = tileWidth`, `sourceH = tileHeight`, `offsetX = offsetY = 0`, `w` and
  `h` the tile size rounded up to even, `pivot` `[0, 1]` (bottom-left, the corner §1.3 places).
- One animation per animated tile, with the ID of the tile's frame, `playback` `"loop"`, and the
  tile's animation frames as entries. No other animation.

What the editor writes: even rectangles, each with a 1 px extrusion ring and no further gap
(BRIEF D8); tiles with identical pixels share a rectangle; the image at most 8192 px a side, or the
export fails naming the tileset.

## 5. Export folder

One folder per project (BRIEF §5):

| File | Content | Section |
| ---- | ------- | ------- |
| `ngne-tilemap.export.json` | Marker naming the project that owns the folder | below |
| `<tileset>.png`, `<tileset>.atlas.json` | Per tileset of the project | §4 |
| `<image>.png` | Per image of the project, colour type 6, bit depth 8, its sides rounded up to even: the image in the top-left corner, the extra column on the right and the extra row at the bottom transparent | §2.6, §3.4 |
| `<map>.tilemap.json` | Per map | §3 |
| `ngne-tilemap.ts` | The generated runtime | `SPEC.md` |

Export names are distinct slugs (§2.4), and `ngne-tilemap` is reserved, so no two files collide on
a file system that ignores case.

**`ngne-tilemap.export.json`**

```json
{
    "format": "ngne-tilemap-export",
    "version": 1,
    "generator": "ngne-tilemap-editor 1.0.0",
    "projectId": "3f0c9d1e-6c1a-4b7e-9c55-0d2f1a7b8e21",
    "projectName": "Meadow game"
}
```

| Member        | Type    | Meaning |
| ------------- | ------- | ------- |
| `format`      | string  | `"ngne-tilemap-export"` |
| `version`     | integer | 1 |
| `generator`   | text    | Informative only |
| `projectId`   | ID      | The `id` of the project that exported here |
| `projectName` | text    | Its name, for the dialog that asks before another project exports here |

JSON rules as §3.1. A folder whose marker is missing, unreadable or of another `projectId` is
not this project's folder.
