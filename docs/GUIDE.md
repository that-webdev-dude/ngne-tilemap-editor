# User guide

[README](../README.md) · [File formats](FORMAT.md) · [Specification](SPEC.md) ·
[Interface and keys](DESIGN.md)

The NGNE Tilemap Editor builds orthogonal tile maps for NGNE games. A project holds maps and the
tilesets they share; an export writes a folder that a game loads with the generated
`ngne-tilemap.ts`. Menus, tools and keys follow the NGNE Sprite Editor, and Tiled where the sprite
editor has no equivalent. Ctrl+K opens the command palette and `?` the shortcut sheet;
[DESIGN §10.3](DESIGN.md#103-table) lists every key.

## Projects

1. Choose **File → New Project…** (Ctrl+Alt+N). Give the project a name, then its first map: a
   name, a size in cells (presets from 32 × 32 to 256 × 256, and 1000 × 40 for a side-scroller)
   and a tile size in pixels. The map opens fitted to the window.
2. **File → Save** (Ctrl+S) writes one `.ngtilemap` file holding every map, every tileset with
   its pixels, each map's thumbnail and the export settings. **Save As…** (Ctrl+Shift+S) chooses
   another file. With File System Access the editor keeps the file and asks for write permission
   when needed; otherwise it downloads the file. A star on the project name marks unsaved work.
3. **File → Open…** (Ctrl+O), Open Recent, a dropped `.ngtilemap` or, in the installed app,
   double-clicking a `.ngtilemap` file opens a project. One project is open per window; leaving
   one with unsaved changes asks Save / Discard / Cancel.
4. Autosave stores the project in this browser two seconds after the last change. At the next
   launch the editor offers recovery of unsaved snapshots. Autosave is not a replacement for
   saving the project file.

**Maps.** **File → New Map…** (Ctrl+Alt+M) adds a map. The dock's Maps list shows every map of
the project: a click opens it as a tab, a double click renames it, dragging reorders the list,
and the row menu has Map Properties…, Duplicate and Delete. **Map → Map Properties…** sets the
name, export name, class, tile size, background colour and parallax origin; **Map → Resize /
Offset Map…** changes the size and shifts the content, with a preview of the old bounds. Closing
a tab (Alt+W) only hides a map; Delete Map removes it, and undo brings it back.

**Navigation.** Hold Space or drag with the middle button to pan; the wheel zooms about the
pointer and Shift+wheel pans sideways; 1–6 zoom to 1×–32× and 0 fits the map. The Minimap in the
dock shows the whole map; drag its rectangle to move the view. The status bar shows the cell and
tile under the pointer, the zoom, the map size and the selection.

## Tilesets

**File → Import Tileset…**, or a file dropped on the Tilesets panel, copies the source's pixels
into the project. Each tile gets a stable ID owned by the project, so maps never change because
a source file did.

- **Grid PNG.** Set the tile width and height, margin and spacing; the preview shows the grid
  and the number of tiles. Every whole cell becomes a tile, row by row.
- **Sprite-editor project (`.ngsprite`).** Each frame is composited as the sprite editor exports
  it and sliced by the grid (the sprite's own grid by default). A cell that repeats an earlier
  frame's cell is not a new tile. Animation tags become tile animations.
- **`ngne-sprite-atlas`** (`.atlas.json` with its PNG). Every frame becomes a tile; frames must
  share one size. Atlas animations become tile animations on their first frame; a `once`
  animation loops, with a warning.

Tile sizes are 1–256 px. An import that the export atlas could not hold (8192 px a side) is
refused with the limit in the message.

The **Tilesets** panel (bottom) has a tab per tileset. Click a tile or drag over several to make
the current stamp; filter tiles by class; zoom 1×–8×. Marks on a tile show properties or class,
an animation (`▶`) and collision. The tile menu has **Edit Collision…** (also a double click),
**Edit Animation…** and Properties.

- **Collision editor:** rectangles, ellipses and polygons per tile, with select, edit points and
  snap to whole pixels. Every edit applies at once and undoes from the project history.
- **Animation editor:** frames are tiles of the same tileset, 100 ms by default. Add them from
  the dialog's tile grid, reorder by dragging, edit durations, and watch the looping preview.

**Tileset → Update Tileset from Source…** reads the source file again and matches tiles by their
pixels. Unique matches remap silently and changed pixels at the same frame update in place; the
dialog lists ambiguous and missing tiles with their usage in each map, and you choose a
candidate, keep the tile, delete it or replace it. This command is the only way source changes
reach a project. **Tileset Properties…** sets the name, export name, class and tile offset.

## Painting

Tools act on the **active layer** and show in the tool rail by its kind. Tile layers take these:

| Tool | Key | Use |
| ---- | --- | --- |
| Stamp brush | B | Paint the stamp. Shift+click: a line of stamps from the last one; Ctrl+Shift+click: an ellipse |
| Eraser | E | Erase cells. Right drag: a rectangle. Shift: every visible, unlocked tile layer |
| Bucket fill | G | Fill the connected region of equal cells with the stamp. Shift: the whole selection or layer |
| Shape fill | U, Shift+U | Fill a rectangle or an ellipse. Shift: square or circle; Alt: from the centre |
| Rectangle select | M | Select cells. Shift adds, Ctrl subtracts, Ctrl+Shift intersects |
| Magic wand | W | Select the connected region of equal cells |
| Select same tile | S | Select every cell of the layer equal to the clicked one |
| Terrain brush | T | Paint terrain ([Terrain](#terrain)) |

- **The stamp** comes from a tileset selection, from the map (right-drag with the stamp brush or
  a fill tool; Shift at release also cuts) or from the clipboard. R and Shift+R rotate it, F and
  Shift+F flip it; the transforms change the stamp, not the map.
- **Selection.** A tile selection clips the stamp brush, eraser and fills. Ctrl+X, Ctrl+C and
  Ctrl+V cut, copy and paste cells; Paste makes the clipboard the stamp. Ctrl+A, Ctrl+D and Ctrl+I
  select all, none or the inverse; Escape clears the selection.
- A hidden or locked layer refuses painting; the status bar says why.

## Terrain

A terrain set belongs to one tileset and is a corner, edge or mixed set of up to 254 terrains.
In the **Terrains** panel (bottom), add a set, name its terrains and give each a colour and an
optional icon tile. Select a terrain and click a corner or edge of a tile to assign it; right
click clears it and Shift+click assigns the whole tile. "Missing combinations" counts the
combinations the set still lacks; a complete set always resolves.

The **Terrain brush** (T) paints the selected terrain at the corner or edge nearest the pointer
and picks matching tiles around it, as Tiled's terrain brush does. **Full tile** (context bar,
Ctrl inverts) paints whole cells; Shift draws a line from the last point; Alt adds the
point-symmetric stroke; right click samples the terrain under the pointer. Cells it cannot
resolve show red and stay unchanged. Bucket fill and shape fill in **Terrain** mode fill their
region with tiles of the set that match the cells around it.

## Layers

The **Layers** tree (dock) holds tile, marker, image and group layers, top of the stack first.
The `+` button adds a tile layer (Shift+N), and its menu the other kinds. Each row has
visibility and lock toggles; its opacity opens the layer properties: name, class, opacity, offset
and parallax, a colour for marker layers, and the image and repeat for image layers. Drag rows to
reorder or to move them into a group. ↑ and ↓ in the viewport select the layer above or below;
Ctrl+Shift+↑ and Ctrl+Shift+↓ move it. The Layer menu also groups, ungroups, duplicates
(Ctrl+Shift+D), shows or locks only this layer, and Highlight Current Layer (Shift+H) fades the
others.

An **image layer** shows one PNG of the project, optionally repeated across the view; **New
Image Layer…** picks one or imports a PNG. Parallax factors move a layer slower or faster than
the camera, around the map's parallax origin. The Preview in the dock draws the map as a game
does.

## Markers

Marker layers hold rectangles, points, ellipses, polygons and polylines for spawns, zones and
paths. Tools: Select (V), Edit points (O), Rectangle and Ellipse (U, Shift+U), Point (P), Polygon
(Shift+D) and Polyline (L). Click points for a polygon or polyline; Enter finishes, Backspace
removes the last point and Escape cancels. Snap to grid is on by default; Ctrl inverts it while
moving. Arrows nudge selected markers by a pixel and Shift+arrows by a cell. Each marker has a
name, a class and properties. Markers draw above the tile layers in their layer's colour.

## Properties

The **Properties** section (dock) edits what is selected: the selected markers, else the selected
tiles while the Tilesets panel has the focus, else the active layer, else the map. Its menu shows
the project or the tileset instead. Built-in fields come first, then custom properties: Add sets a
name and one of six types (bool, int, float, string, colour, file); the row menu renames, changes
the type or removes. With several items selected, a value set applies to all, and differing
values show as "—". A class is a plain string; games read it with `classAt` and `markers`.

## Export

**File → Export…** (Ctrl+E) picks a folder, sets the project's export name and lists the files
with their sizes; **Export on Save** writes the folder after each save. **Export Again**
(Ctrl+Shift+X) writes without the dialog. Without File System Access the folder downloads as a
zip. The folder holds:

- `<map>.tilemap.json` for each map, in the `ngne-tilemap` v1 format;
- `<tileset>.png` and `<tileset>.atlas.json` for each tileset, repacked as an `ngne-sprite-atlas`
  v1;
- the PNG of each image of an image layer;
- `ngne-tilemap.ts`, the generated runtime;
- `ngne-tilemap.export.json`, which names the project: exporting another project into the
  folder asks first.

File names are the export names, slugs kept in the project, so renaming a map's title does not
rename its files. A file whose bytes did not change is not rewritten, so a game's development
server reloads only what changed. Export never deletes files.

## Use `ngne-tilemap.ts` in a game

Export into a folder of the game's source, for example `src/maps/`, and commit the folder. Never
edit `ngne-tilemap.ts`: each export overwrites it. Its header puts it under MIT-0
(`SPDX-License-Identifier: MIT-0`), so a game that ships it needs no licence notice for it. It
imports nothing and compiles against `ngne` 0.1.0 and `@ngne/core` 0.2.x and 0.3.0. It gives the
game:

- `loadTilemap(name)`: loads a map by export name; `readTilemap(json, atlases)` reads one the
  game holds. An invalid tilemap or atlas throws a `TilemapError`, with a `code` and a `path`;
  `readTilemap` throws nothing else. `loadTilemap` also rejects with an `Error` for an unknown
  name or an HTTP status that is not ok, and with what `fetch` rejects with when a request fails
  or is aborted.
- `assetsFor(tilemap, imageAsset)`: the scene's assets for the map's tilesets and images.
- `drawTilemap(frame, tilemap, camera, options)`: draws the visible layers in `scene.render`,
  culled to the view, with parallax, opacity and tile animations at `options.elapsedMs`. Map layer
  `i` is drawn at depth `i`, so a sprite at depth `i + 0.5` goes between layers `i` and `i + 1`.
- Data: `findLayer`, `tileAt`, `classAt`, `propertyAt`, `grid` (a byte per cell where a property
  is set), `collisionShapes`, `collisionRects` (merged rectangles), `markers`, and `setCell` /
  `invalidate` for a map the game changes.

A scene that loads the map exported as `overworld`, walks a player from the marker named `player`
and stops at the collision of the layer `ground`:

<!-- guide-example:start -->

```ts
import { BrowserGame, imageAsset, type SceneDefinition } from "@ngne/core";
import {
    assetsFor,
    collisionRects,
    drawTilemap,
    findLayer,
    loadTilemap,
    markers,
    type Rect,
} from "./maps/ngne-tilemap";

const WIDTH = 480;
const HEIGHT = 270;

function inside(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/** The overworld: the map, with the player drawn between its layers 1 and 2. */
async function overworld(): Promise<SceneDefinition<Record<string, never>, never>> {
    const tilemap = await loadTilemap("overworld");
    const ground = findLayer(tilemap, "ground");
    const walls = ground?.type === "tile" ? collisionRects(tilemap, ground) : [];
    const spawn = markers(tilemap, { name: "player" })[0];
    const player = { x: spawn?.x ?? 0, y: spawn?.y ?? 0 };
    return {
        id: "overworld",
        assets: assetsFor(tilemap, imageAsset),
        setup(scene) {
            let elapsedMs = 0;
            scene.camera.pixelSnap = true;
            scene.system(({ dt }) => {
                elapsedMs += dt * 1000;
                const x = player.x + 32 * dt;
                if (!walls.some((wall) => inside(wall, x, player.y))) player.x = x;
                scene.camera.x = player.x - WIDTH / 2;
                scene.camera.y = player.y - HEIGHT / 2;
            });
            scene.render((frame) => {
                drawTilemap(frame, tilemap, scene.camera, {
                    elapsedMs,
                    viewWidth: WIDTH,
                    viewHeight: HEIGHT,
                    assets: scene.assets,
                });
                frame.sprite({ x: player.x, y: player.y, width: 16, height: 16, depth: 1.5 });
            });
        },
    };
}

const canvas = document.querySelector("canvas");
if (!canvas) throw new Error("The page has no canvas.");
const app = new BrowserGame<Record<string, never>, never>({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    clear: 0x202020,
    seed: "overworld",
    state: {},
    transition: (state) => state,
    diagnostic: (error) => console.error(error),
});
await app.start(await app.game.prepare(await overworld(), { key: "overworld" }));
```

<!-- guide-example:end -->

`npm test` compiles this example against `@ngne/core` 0.3.0 and a generated runtime. Pass
`options.scale` for a render scale (world units are then map pixels × scale; tiles meet without
seams at whole-number scales), `options.layers` to choose layers, and `options.report` to receive
the warning for a tileset missing from the scene's assets; `drawTilemap` itself never throws.

## Import a Tiled map

**File → Import Tiled Map…** reads a Tiled map (`.tmj`, or `.json` of type map) with its
tilesets (embedded, `.tsj` or `.tsx`), images and templates. Pick the folder holding the map, so
relative paths resolve; without File System Access pick or drop the map and its files together,
and add any file listed as missing. The map is added to the open project as a new map, or becomes
a new project from the empty state. Tilesets already imported from the same file with the same
tiles are reused.

Before anything changes, the report lists the converted map (size, layers, tilesets, markers)
and every item dropped or changed, with counts and locations. Orthogonal maps only; an infinite
map becomes a fixed map over its used area; `zstd` data is refused (re-save in Tiled with zlib or
gzip); object rotation, tile, text and capsule objects, `object` and `list` properties, layer
tint and blend modes, and terrain probabilities are dropped and reported. Import adds the map as
one undo step; Cancel adds nothing.

## Limits

Maps are tested up to 65,536 cells per layer (each side ≤ 4096), 16 layers and 2,000 markers;
larger maps open, with a warning, but are not held to the performance budgets. Tile sizes are
1–256 px and a project's tileset pixels at most 32 megapixels. The file formats are frozen at
1.0.0 ([FORMAT.md](FORMAT.md)): a later format change brings a new version and a migration, and
the runtime reads every older `ngne-tilemap` version.
