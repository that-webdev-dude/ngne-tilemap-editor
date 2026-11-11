# NGNE Tilemap Editor — Engine integration

How the editor uses `@ngne/core` 0.3.0, the viewport architecture, performance budgets, the
spikes that gate the spec, and the engine gaps the editor works around.

Authoritative engine behaviour: the versioned contracts at
[ngne v0.3.0 `docs/contracts/browser-and-presentation.md`](https://github.com/that-webdev-dude/ngne/blob/v0.3.0/docs/contracts/browser-and-presentation.md)
([renderer](https://github.com/that-webdev-dude/ngne/blob/v0.3.0/docs/contracts/browser-and-presentation.md#renderer),
[editable manual textures](https://github.com/that-webdev-dude/ngne/blob/v0.3.0/docs/contracts/browser-and-presentation.md#editable-manual-textures))
and the [usage guide](https://github.com/that-webdev-dude/ngne/blob/v0.3.0/docs/guide.md).
Local checkout: `..\ngne` at tag `v0.3.0`.

## 1. Rules

- `@ngne/core` **0.3.0**, exact pin. No engine changes, no internal imports, no patched engine.
- Only `src/engine/` imports `@ngne/core` (lint-enforced, as in the sprite editor).
- `src/core/` (document model, compositor, packer, codecs, terrain solver) has no DOM, React
  or NGNE imports and is the source of truth; the GPU only displays it.
- One NGNE renderer per canvas. Only two canvases use NGNE: the main viewport (direct
  `WebGPURenderer`) and the game preview (`BrowserGame`). Every other view — tileset panel,
  minimap, terrain editor, collision editor, animation editor — is Canvas2D.

## 2. Renderer lifecycle (main viewport)

| Need | API | Rule |
| --- | --- | --- |
| Create | `WebGPURenderer.create(canvas, width, height, onError?, signal?)` | Abort obsolete creation (tab/document switch, teardown); handle its rejection; dispose a completed renderer when no longer needed. A failed renderer still owns its canvas until disposed |
| Resize | `renderer.resize(width, height)` | Keeps device, pipelines and textures. Positive safe integers within the device limit. Rejects during recovery: await `ready()` and retry. The host owns CSS size, DPR and pointer-to-world mapping |
| Recovery | `renderer.onLifecycle(observer)` (`recovering`, `ready`, `failed`), `renderer.status`, `renderer.ready(signal?)` | Observers get future transitions only: read `status` for the current one. Callbacks stay small: set flags, request a redraw. On `ready`, redraw from the CPU document. On `failed`, show the failure notice and offer reload |
| Teardown | unsubscribe, then `renderer.dispose()` | Disposal emits no lifecycle event |

`ready()` means retained images are drawable; it does not await a pending texture update or
prove a frame reached the display. Await the specific texture operation before treating an
edit as on screen.

No polling of status or sprite counters, no renderer re-creation on resize.

## 3. Textures

| Content | ID | API | Lifetime |
| --- | --- | --- | --- |
| Tileset atlas: the export's packed atlas from `core/pack` (even rectangles, 1 px extrusion; SPEC §10.2), never the stored grid, so viewport, preview and runtime share one emitter and UV table and no fractional zoom or DPR samples a neighbour tile | `ed:ts:<tilesetId>` | `renderer.texture(id, source)` (transactional whole-image replace) | Uploaded when a map using it opens; replaced on "Update tileset from source"; `releaseTexture` when no open map uses it |
| Overview chunk | `ed:chunk:<layerId>:<cx>:<cy>` | `createTexture(id, w, h)` once, then `updateTexture(id, canvas, region)` per dirty rectangle | Created when the chunk tier first needs it; released on eviction (a change leaves it showing nothing, or a new plan drops it or changes T), map close or layer delete |
| Checkerboard, image layers | `ed:checker`, `ed:img:<layerId>` | `texture()` | As the map |

Editable texture rules (`createTexture` / `updateTexture`):

- `createTexture` needs an absent ID; to change size, release, create, repopulate.
- `updateTexture` takes an `ImageBitmap` or canvas and a region
  `{sourceX, sourceY, width, height, destinationX, destinationY}` that fits both images.
  No clipping, scaling or blending; transparent source pixels erase.
- Per ID, updates run FIFO with at most 32 pending including the active one; overflow
  rejects. The editor coalesces dirty rectangles per chunk and keeps at most one update in
  flight per chunk, so it never approaches the limit.
- Keep the source canvas unchanged until the update's promise settles (pixels are captured
  when the queued operation runs). Each chunk has its own source canvas.
- A copy or validation failure can drop the registration: re-create and repopulate from the
  CPU document. A loss after submission rejects that update: re-composite the region from
  the document and retry; never replay a write blindly.
- `releaseTexture(id)`: absent IDs are no-ops; releasing during recovery is allowed; stop
  submitting sprites that reference a released ID.

## 4. Viewport

```text
 core/ document ──(visible cells)──> live tier: one quad per tile ─┐
      │                                                            ├─> NGNE Frame ─> canvas
      └──(dirty regions)──> core/ compositor ──> chunk canvases ───┘
                                       └──(updateTexture)──> ed:chunk:* textures

 Canvas2D overlay (same size, takes all pointer input):
 grid, selection, stamp preview, markers, collision outlines, terrain hints, handles
```

- **Camera:** NGNE has no camera zoom. The editor scales quad positions and sizes into device
  pixels, `pixelSnap = false`, as the sprite editor does. Overlay and hit-testing use the
  same transform.
- **Live tier** (≤ 65,536 non-empty visible cells across visible layers, from S1): each
  visible cell becomes one sprite, with flips as negative size and quarter turns as
  rotation. Emission is layer by layer, grouped by tileset inside a layer, one depth per
  layer, so NGNE batches consecutive same-texture quads (14 draw calls for the reference
  map) and the frame arrives already ordered. Cost is CPU-bound and equal on both GPUs;
  about 70% is quad emission, 30% `renderer.render`.
- **Tier choice:** the visible count is the sum, over visible tile layers, of the non-empty
  counts of the cell-store chunks the view touches, each weighted by the share of the chunk the
  view covers (an estimate, O(chunks), no cell scan; SPEC §2.2). Whole chunk counts would be an
  upper bound, but a pan that touches one more row or column of chunks moves them by more than
  the 10% band below, and the tier would flip; the estimate falls short of the true count only
  where an edge chunk's cells crowd into the part in view. The viewport enters the chunk tier
  when the count exceeds 65,536 and the chunk tier is built; it returns to the live tier when the
  count falls to 58,982 (90%) or below, so a pan at the threshold does not flip tiers every
  frame. While the chunk tier is still building, the live tier draws, beyond its budget.
- **Chunk tier** (above the threshold): chunks of 32×32 cells composited on the CPU by the
  `core/` compositor and uploaded with `createTexture` + `updateTexture`.
  - **Flattened sets:** all visible layers that share parallax factor and offset are
    composited into one chunk set (layer opacity baked in); a layer with its own parallax
    or offset gets its own set. One set per layer costs 4× the memory (S2: 128 MB) and is
    not used.
  - **Resolution:** T texels per cell, the largest power of two ≤ the device pixels per
    cell at the switch zoom, reduced until chunk GPU memory ≤ 64 MB. The reference map gets
    T = 8 (32 MB).
  - **Build:** started in the background when a map opens, in slices of one chunk (≤ 16 ms
    each), so the chunk tier is ready before the user zooms out. Rebuilt the same way after
    a layer visibility, opacity, parallax or offset change.
  - **Painting at overview:** painted cells draw as live quads over their chunk on the next
    frame; the chunk's dirty rectangle is patched with one `updateTexture` in flight per
    chunk (later edits coalesce), and the live quads are dropped when it settles. A chunk that
    shows something after a change gets a texture, and one that shows nothing is released. A new
    chunk that would take chunk memory past 64 MB is not created: the tier is planned again
    (Resolution) and rebuilt, and the live tier draws meanwhile.
- **Redraw on demand:** frames are submitted only when the document, view or lifecycle
  changes; an idle editor submits nothing.
- **Layer opacity** maps to sprite alpha. Tint and blend modes are not drawn (Later / Out).
- **Image layers:** one texture each, ≤ 8192 px per side; repeat is drawn as a quad grid. The
  texture of a repeated axis holds copies of the image side by side, enough to span 512 px
  where 8192 px allow, so a small image covers the view with few quads.

## 5. Game preview

A dock panel that runs the current map through the **same generated runtime the export
writes**, so what the user sees is what the game draws.

- `BrowserGame` on its own canvas, one scene drawing the map with `drawTilemap`,
  `pixelSnap` on, tile animations playing, at a chosen game resolution and integer scale.
- Tilesets reach it as packed atlases through `SceneDefinition.assets` (a custom
  `ImageAsset` loader over in-memory bitmaps); the scene restarts when a tileset changes.
- Its camera follows the viewport centre; it stops when the dock section is collapsed or
  the window is hidden.

## 6. Budgets and spikes

Reference hardware: Windows 11, Chrome stable, Intel UHD (gen-12) and an RTX 4060 laptop
GPU. Every measurement records CPU, power plan and display refresh rate. Budgets run
report-only in CI (SwiftShader) and are enforced on reference hardware.

Reference map (D1 worst case): 256×256 cells, 16 px tiles, 8 layers with every cell
filled, two tilesets, 12.5% of cells flipped or rotated, one parallax layer.

### Editor budgets

"Measured" values are from the spikes (Intel UHD / RTX 4060); the others are checked by the
tickets that build the feature.

| Metric | Budget | Measured |
| --- | --- | --- |
| Pan at the live-tier threshold, 1920×1080 at DPR 1 and 1.25: animation-frame callback start → submit, p95 | ≤ 10 ms | 7.7–7.8 / 7.0–7.2 ms |
| Dropped frames (interval > 25 ms) over a 5 s scripted pan | ≤ 1% | 0% / 0% |
| Paint: pointer event → frame containing it submitted, p95 | ≤ 33 ms | TE-017: 31.3 / 27.8 ms (median 19.6 / 16.6 ms, max 42.3 / 42.6 ms) |
| Paint at overview: painted cells visible | next frame | by design (live quads); frame submit p95 1.6 / 0.9 ms |
| Overview chunk patch settled after a paint, p95 | ≤ 100 ms | TE-015: 19.9 / 21.0 ms (16×16 stamp: 34.1 / 25.5 ms) |
| Chunk-tier memory, GPU (NGNE retains the same again on the CPU) | ≤ 64 MB | TE-015: 32 / 32 MB (T = 8, 128 chunks) |
| Overview rebuild after a layer visibility/opacity change | ≤ 500 ms, no task > 16 ms | TE-015: 456 / 356 ms, longest build slice 4.0 / 3.9 ms; the live-tier frame drawn meanwhile 126 / 116 ms (§4) |
| Initial overview build after a map opens (background) | no task > 16 ms | TE-015: 0.67 / 0.57 s total, longest task 33.9 / 53.2 ms, **over budget** (NGNE's first `updateTexture` readback; build slices ≤ 9.9 / 10.4 ms) |
| Tab switch to an open map: first frame submitted, p95 | ≤ 100 ms | TE-031: fitted view 99.3 / 98.4 ms (max 106.3 / 107.8 ms); 100% view 25.8 / 25.7 ms |
| Idle editor: frames submitted per second | 0 | — |
| Cold load to interactive (production build, local) | ≤ 2 s | — |

TE-015 rows: 2026-10-31, Chrome 156.0.8078.80, i7-12650H, Balanced power plan with the Best
performance power mode, 144 Hz panel, 1920×1080 window at DPR 1 (canvas 1612×784). Raw data: `te-015-*-intel-uhd.json` and
`te-015-*-rtx-4060.json` in [evidence/](evidence/).
TE-017 row: 2026-11-02, the same machine, Chrome, power plan, panel and window. Raw data:
`te-017-paint-intel-uhd.json` and `te-017-paint-rtx-4060.json` in [evidence/](evidence/).
TE-031 row: 2026-11-06, the same machine, Chrome, power plan, panel and window. Two open tabs
each hold the reference map; a switch is timed from the call that shows the other map to the
return of the first frame submitted after it, 40 switches 1 s apart. At the fitted view the first
frame is a live-tier frame of all 524,289 cells (median draw 76 ms): the previous map's chunk tier
is released on the switch and the new one is built in the background (§4). Raw data:
`te-031-tab-switch-{fit,100}-{intel-uhd,rtx-4060}.json` in [evidence/](evidence/).

### Game runtime budget

| Config (stacked HUD scene, `pixelSnap` on, tile animations on, panning) | Budget: p95 `game.stats.renderMs` | Measured |
| --- | --- | --- |
| 480×270 logical ×3 (typical pixel-art game; 4,664 sprites) | ≤ 8 ms on Intel UHD | TE-055: 1.1 / 1.1 ms (median 0.9 / 0.8 ms, max 1.8 / 1.6 ms) |
| 1920×1080 logical ×1, all 8 layers full (67k sprites, worst case) | recorded, not gated | TE-055: 10.3 / 10.4 ms (median 9.5 / 9.4 ms, max 16.3 / 14.3 ms) |

TE-055 rows: 2026-11-10, the machine, power plan and window of §6, Chrome 157.0.8103.50, 144 Hz
panel. The fixture game (`tests/fixtures/game`, `@ngne/core` 0.3.0) imports the exported
`ngne-tilemap.ts` of the reference project with 32 animated tiles per tileset and draws the
reference map under a stacked HUD scene of 200 sprites, `pixelSnap` on, the camera panning
48 × 27 px/s; 10 s after 2 s, on `requestAnimationFrame`. Sprites per frame 4,664 and 66,992,
17 draw calls. Raw data: `te-055-runtime-{480x270,1920x1080}-{intel-uhd,rtx-4060}.json` in
[evidence/](evidence/).

The worst case leaves ~6 ms of a 60 Hz frame for game updates. A runtime option that
pre-composites static layers into chunk textures (as the editor's chunk tier does) is the
answer if a game needs more; it is Later.

### Spike results (2026-10-30)

Raw data: [evidence/spikes-2026-10-30/](evidence/spikes-2026-10-30/) (one JSON per GPU).
Windows 11, Chrome 156, i7-12650H,
Balanced power plan on AC, 144 Hz panel.

| Spike | Result |
| --- | --- |
| S1 live tier | Go at **65,536** visible cells: p95 submit 7.7 ms worst (Intel, DPR 1.25). 98,304 is marginal (9.8–10.1 ms); 131,072 fails (12.3–12.7 ms). Cost scales linearly with quads and is CPU-bound |
| S2 chunk tier | Go with flattened sets at T = 8: 32 MB, no task over 6.1 ms. Per-layer sets need 128 MB. Patch settle on Intel UHD (72 ms p95) is slow but hidden by live quads |
| S4 runtime | Go: 3.2 ms p95 on Intel UHD for a 480×270 ×3 game. Worst case 1920×1080 with 8 full layers: 8.4 ms |

## 7. Engine gaps

Open gaps in 0.3.0 that the editor or the generated runtime works around. The NGNE owner
reads this table; costs are filled in from spike and ticket measurements.

| Gap | Workaround | Where |
| --- | --- | --- |
| CPU cost per quad; sort fast path only for 32,768–262,144 quads | Two-tier viewport (§4) | editor |
| Batching joins only consecutive quads with the same texture | Emit layer by layer, grouped by tileset | editor, runtime |
| No camera zoom | Scale quad positions and sizes; runtime takes a render-scale option | editor, runtime |
| Nearest/clamp sampler only (no linear, no repeat) | Chunk tier for overview; image-layer repeat as a quad grid; runtime seam-free only at integer scales | editor, runtime |
| Source-over blending only; multiplicative tint | Opacity via alpha; tint Later; blend modes Out | editor, runtime |
| No texture readback | CPU compositor in `core/` for chunks, thumbnails and test references | editor |
| The first `updateTexture` blocks the main thread while Chrome reads its source canvas back from the GPU: 33.9 / 53.2 ms (TE-015, §6) | None yet: the initial overview build misses its 16 ms task budget; later updates stay within it | editor |
| Centre pixel snapping misplaces odd sizes | Editor: `pixelSnap = false`. Runtime: placement table for the 8 orientations with integer centre corrections; atlases padded to even rectangles, exported images to even sides | editor, runtime |
| No line, ellipse or polygon primitives | Markers and collision shapes on the Canvas2D overlay (they ignore tile-layer order and opacity) | editor |
| No animation repeat count or direction | Tile animations loop; `once` atlas animations imported as looping | editor |
| Assets checked by object identity; no reference following; unlisted texture throws in render | Runtime caches one definition per ID, namespaces IDs, exposes `assetsFor(tilemap)`, skips unlisted tilesets | runtime |
| No tilemap or atlas schema; no tileset discovery | Editor-owned `ngne-tilemap` and `ngne-sprite-atlas` formats | editor, runtime |
| One GPU device per renderer; no multi-viewport | Secondary views in Canvas2D | editor |
| BrowserGame: no in-scene uploads, fixed logical size | Preview restarts its scene on tileset change; fixed preview resolution | preview |
