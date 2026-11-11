# TMJ import fixtures

Fixtures of TMJ import (BRIEF §7, SPEC §13), authored for this repository, so their licence
is the repository's. Every file here except `build.ts` is written by
`node tests/fixtures/tmj/build.ts` as Tiled 1.12.2 writes it (JSON maps, tilesets and
templates; one XML tileset) with generated PNGs; `tests/unit/te-058-build.test.ts` checks
that the script reproduces them byte for byte, and `tests/unit/te-058-coverage.test.ts` that
every BRIEF §7 row and SPEC §13 coverage item is named below by a file that exists.

## Conventions

- Cells are 16 px unless an entry says otherwise; cell (x,y) counts from the top-left, as
  Tiled's status bar shows it.
- `tiles.png` is 8 × 4 tiles: 0–23 flat colours (0 grass, 1 dirt, 2 stone, 3 water, 4 sand,
  5 wall, 6 floor, 7 lava, 8 wood, 9 forest, 10 snow, 11 brick, 12–13 torch frames, 14 cloud,
  15 road, 16 deep water, 17 mountain, 18 door, 19 chest, 20 pillar, 21 slope, 22 bush,
  23 coin), each with a darker bottom row and right column; 24–31 arrow tiles, each a colour
  with a white 5 × 5 mark in the top-left corner and a white bar along the top edge, so every
  flip and rotation shows.
- `tmj.tiled-project` defines the custom types of `properties.tmj`.

## Owner check in Tiled 1.12.2

Open `tmj.tiled-project` (Project → Open Project…), then open each `.tmj` below (File →
Open). Each must open without an error dialog and look as its entry says. Reply `tmj pass`,
or `tmj fail: <file> <what differs>`.

## Files

### `encoding-csv.tmj`

- SPEC §13: csv data
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 10 × 8 cells of 16 px. A grey stone border round a green meadow; a blue 3 × 2 pond ringed with sand left of centre; a dark green forest tile at the bottom right; at cell (1,1) the red arrow tile, its white mark in the top-right corner and its bar along the top (flipped horizontally). All five encoding maps look the same.

### `encoding-base64.tmj`

- SPEC §13: base64 uncompressed data
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 10 × 8 cells of 16 px. A grey stone border round a green meadow; a blue 3 × 2 pond ringed with sand left of centre; a dark green forest tile at the bottom right; at cell (1,1) the red arrow tile, its white mark in the top-right corner and its bar along the top (flipped horizontally). All five encoding maps look the same.

### `encoding-zlib.tmj`

- SPEC §13: zlib data
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 10 × 8 cells of 16 px. A grey stone border round a green meadow; a blue 3 × 2 pond ringed with sand left of centre; a dark green forest tile at the bottom right; at cell (1,1) the red arrow tile, its white mark in the top-right corner and its bar along the top (flipped horizontally). All five encoding maps look the same.

### `encoding-gzip.tmj`

- SPEC §13: gzip data
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 10 × 8 cells of 16 px. A grey stone border round a green meadow; a blue 3 × 2 pond ringed with sand left of centre; a dark green forest tile at the bottom right; at cell (1,1) the red arrow tile, its white mark in the top-right corner and its bar along the top (flipped horizontally). All five encoding maps look the same.

### `encoding-zstd.tmj`

- BRIEF §7: `zstd` compression
- SPEC §13: zstd data
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 10 × 8 cells of 16 px. A grey stone border round a green meadow; a blue 3 × 2 pond ringed with sand left of centre; a dark green forest tile at the bottom right; at cell (1,1) the red arrow tile, its white mark in the top-right corner and its bar along the top (flipped horizontally). All five encoding maps look the same. The editor refuses this map; Tiled opens it.

### `flips.tmj`

- BRIEF §7: GID flip bits
- SPEC §13: all 8 flip combinations; bit 28 set
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 8 × 2 cells, every one the red arrow tile: a white 5 × 5 mark in a corner and a white bar from it along one edge. Columns 1–8 show: mark top-left, bar along the top (unflipped); top-right, top (H); bottom-left, bottom (V); bottom-right, bottom (H+V); top-left, left edge (anti-diagonal); top-right, right edge (anti-diagonal+H, 90° clockwise); bottom-left, left edge (anti-diagonal+V, 90° anticlockwise); bottom-right, right edge (all three). Row 2 has bit 28 set as well and looks exactly like row 1: Tiled ignores the bit on orthogonal maps.

### `isometric.tmj`

- BRIEF §7: Non-orthogonal map
- SPEC §13: isometric map
- Uses: `iso.png`
- In Tiled: An 8 × 8 isometric diamond of 32 × 16 cells: a grey stone rim, a green and brown checkerboard inside and a 2 × 2 blue pond in the middle. The editor refuses this map; Tiled opens it.

### `hexagonal.tmj`

- BRIEF §7: Non-orthogonal map
- SPEC §13: hexagonal map
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: An 8 × 6 hexagonal map (stagger axis y, odd rows shifted right by half a cell, side length 8): square green, sand and blue tiles in diagonal stripes, rows overlapping by 4 px. The editor refuses this map; Tiled opens it.

### `infinite.tmj`

- BRIEF §7: Infinite map
- SPEC §13: infinite map
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: An infinite map. Layer Ground: a 4 × 4 green block at cells (-4,-4)–(-1,-1) and an 8 × 8 green block at (0,0)–(7,7), touching corner to corner. Layer Overlay: one stone tile at (36,20). Layer Markers: a point Far corner at pixel (-200,-120) and a 32 × 16 rectangle Beyond at (520,300).

### `tileset-embedded.tmj`

- SPEC §13: image tileset; embedded tileset
- Uses: `tiles.png`
- In Tiled: 6 × 4 cells: a green meadow with a 2 × 1 pond edged with sand, a forest tile at the bottom right and the unflipped red arrow at (1,1). Its tileset tiles-embedded is stored in the map.

### `tileset-tsj.tmj`

- SPEC §13: image tileset; `.tsj` tileset
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: As tileset-embedded.tmj, with its tileset read from tiles.tsj.

### `tileset-tsx.tmj`

- SPEC §13: image tileset; `.tsx` tileset
- Uses: `tiles-xml.tsx`, `tiles.png`
- In Tiled: As tileset-embedded.tmj, with its tileset read from tiles-xml.tsx; in the tileset, tile 5 (dark wall) has class Wall and a bool property solid = true.

### `collection-uniform.tmj`

- BRIEF §7: Image-collection tileset, uniform tile size
- SPEC §13: image-collection tileset, uniform
- Uses: `props.tsj`, `images/crate.png`, `images/barrel.png`, `images/bush.png`, `tiles.tsj`, `tiles.png`
- In Tiled: 7 × 4 cells of grass with six 16 × 16 props from the collection props.tsj: row 1 has a crate, a barrel and a bush; row 3 a bush, a crate and a barrel.

### `collection-mixed.tmj`

- BRIEF §7: Image-collection tileset, mixed sizes
- SPEC §13: image-collection tileset, mixed
- Uses: `images/tree-small.png`, `images/tree-tall.png`, `images/tree-wide.png`, `tiles.tsj`, `tiles.png`
- In Tiled: 8 × 4 cells of grass with trees from the embedded collection trees: 16 × 16 at (2,1) and (6,3), 16 × 32 at (5,2) and 32 × 32 at (1,3), each drawn from its cell's bottom-left corner, so taller trees reach into the row above. The editor refuses this map; Tiled opens it.

### `objects-shapes.tmj`

- BRIEF §7: Object layer: rectangle, point, ellipse, polygon, polyline
- SPEC §13: every object shape
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 12 × 8 grass cells; object layer Markers (orange): rectangle Spawn area (class Zone, property team), point Start, ellipse Pond, triangle polygon Rock, four-point polyline Path, and rectangle Secret, hidden (its eye is off in the Objects view).

### `objects-rotated.tmj`

- BRIEF §7: Object rotation
- SPEC §13: rotated object
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 12 × 8 grass cells; a rectangle turned 30°, an ellipse turned 45° and a right-angle wedge turned 90° clockwise, each about its top-left point.

### `objects-dropped.tmj`

- BRIEF §7: Tile objects, text, capsule
- SPEC §13: tile object; text object; capsule object
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 12 × 8 grass cells; a chest tile object, the red arrow as a tile object flipped horizontally, a text object reading Hello, Tiled (wrapped in a 96 × 32 box) and a 64 × 24 capsule.

### `templates.tmj`

- BRIEF §7: Template instances
- SPEC §13: templates
- Uses: `templates/door.tj`, `templates/coin.tj`, `templates/zone.tj`, `tiles.tsj`, `tiles.png`
- In Tiled: 12 × 8 grass cells; object layer Instances: a 16 × 32 Door (locked false), a second door renamed Vault door with locked true, a coin tile object and a four-point Zone polygon, all from templates (Template section of the Properties view filled).

### `properties.tmj`

- BRIEF §7: `object`, `list` and class-typed properties; Enum properties; Class names
- SPEC §13: every property type; class property; enum property; `object` property; `list` property
- Uses: `tiles.png`, `tmj.tiled-project`
- In Tiled: 8 × 6 grass cells. The map has class Level and one property of each type: bool, color, file, float, int, string, object (target → Hero), class Stats, string enum Facing, int flag enum Layers and a list of three values. Layer Ground has class Terrain, layer Actors class Actors; Hero and Sidekick are class Npc, Hero has an object property friend → Sidekick; the embedded tileset typed has class Palette and its grass tile class Grass. Open tmj.tiled-project first (Project → Open Project) so Tiled knows Stats, Facing and Layers; without it the map still opens and the Issues view lists the unknown types.

### `tint-blend.tmj`

- BRIEF §7: Layer tint, blend mode
- SPEC §13: tint; blend mode
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 10 × 8 grass cells; a stone ring tinted red (layer Tinted); a 4 × 4 pond in Multiply mode (darker blue over the grass) and the same pond shifted by (32,16) px at 50% opacity in Screen mode (lighter).

### `terrain.tmj`

- BRIEF §7: Terrain probability, terrain-set transformations, tile probability
- SPEC §13: terrain probabilities; terrain transformations
- Uses: `terrain.tsj`, `tiles.png`
- In Tiled: 8 × 8 cells: a brown dirt ring on grass with grass in the middle. Tileset terrain.tsj has the corner terrain set Ground (Grass probability 1, Dirt 0.5), grass tile probability 0.25, and all four transformation boxes ticked.

### `transparent-color.tmj`

- SPEC §13: `transparentcolor`
- Uses: `keyed.png`, `images/backdrop.png`
- In Tiled: 6 × 5 cells on a dark blue background: image layer Backdrop (blue to orange gradient) with a rectangular and a round hole where its magenta was keyed out; four discs (green, blue, orange, gold) with no magenta round them.

### `tilerendersize.tmj`

- SPEC §13: `tilerendersize`
- Uses: `big.png`
- In Tiled: 8 × 6 cells of 16 px in a checkerboard of two 32 × 32 tiles (green and blue checks, white border), each drawn shrunk to one 16 px cell (tile render size Grid).

### `side-scroller.tmj`

- SPEC §13: 1000 × 40 side-scroller
- Uses: `images/sky.png`, `tiles.tsj`, `tiles.png`
- In Tiled: 1000 × 40 cells. Image layer Sky (blue gradient, repeated across, parallax 0.2); layer Ground: rolling grass over dirt over stone, a three-column pit with water at the bottom every 97 columns; layer Decor: bushes, wooden platforms with coins; object layer Spawns: point Player at the left, an Enemy point every 80 columns, rectangle Goal at the right end. Ground and Decor are zlib.

### `overworld.tmj`

- SPEC §13: 256 × 256 overworld with groups and parallax
- Uses: `tiles.tsj`, `tiles.png`
- In Tiled: 256 × 256 cells. Group World: layer Ground (deep water, water, sand, grass, forest, mountain and snow by height), layer Roads (a cross of road tiles through the centre, not over water), object layer Towns (four points). Group Sky at 70% opacity, parallax 0.5: layer Clouds, white translucent patches offset by 8 px. All tile layers are gzip.

### `dungeon.tmj`

- BRIEF §7: Object layer: rectangle, point, ellipse, polygon, polyline
- SPEC §13: small dungeon with markers and collision
- Uses: `dungeon.tsj`, `tiles.png`
- In Tiled: 24 × 16 cells of rooms: layers Floor, Walls (walls, pillars, torches, slopes) and Items (doors, chests); object layer Markers (light orange): four Room rectangles, two Spawn points, a Trap polygon, a Path polyline and a Light ellipse. Tileset dungeon.tsj: wall tile with a full-cell collision rectangle, pillar an ellipse, slope a triangle polygon plus a point and a polyline, torch an 8 × 16 rectangle and a two-frame animation (yellow, orange, 200 ms each), seen in the Tile Collision and Tile Animation editors.
