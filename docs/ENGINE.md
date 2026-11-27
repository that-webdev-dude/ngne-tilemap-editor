# NGNE Tilemap Editor — Engine integration

How the editor uses `@ngne/core` 0.4.0, the viewport architecture, performance budgets, the
spikes that gate the spec, and the engine gaps the editor works around.

Authoritative engine behaviour: the versioned contracts at
[ngne v0.4.0 `docs/contracts/browser-and-presentation.md`](https://github.com/that-webdev-dude/ngne/blob/v0.4.0/docs/contracts/browser-and-presentation.md)
([renderer](https://github.com/that-webdev-dude/ngne/blob/v0.4.0/docs/contracts/browser-and-presentation.md#renderer),
[editable manual textures](https://github.com/that-webdev-dude/ngne/blob/v0.4.0/docs/contracts/browser-and-presentation.md#editable-manual-textures))
and the [usage guide](https://github.com/that-webdev-dude/ngne/blob/v0.4.0/docs/guide.md).
Local checkout: `..\ngne` at tag `v0.4.0`.

## 1. Rules

- `@ngne/core` **0.4.0**, exact pin. No engine changes, no internal imports, no patched engine.
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
| Overview chunk | `ed:chunk:<layerId>:<cx>:<cy>` | `createTexture(id, w, h)` once, then `updateTexture(id, pixels, region)` per dirty rectangle, with the compositor's raw RGBA8 pixels | Created when the chunk tier first needs it; released on eviction (a change leaves it showing nothing, or a new plan drops it or changes T), map close or layer delete |
| Checkerboard | `ed:checker` | `texture()` | As the map |
| Image layer: its image once, as decoded. A layer that repeats on either axis has it sampled with repeat addressing (`{ address: "repeat" }`, both axes); others with the default nearest and clamp | `ed:img:<layerId>` | `texture(id, source, signal, sampling)` | As the map; uploaded again when the image changes or the layer starts or stops repeating |

Editable texture rules (`createTexture` / `updateTexture`):

- `createTexture` needs an absent ID; to change size, release, create, repopulate.
- `updateTexture` takes an `ImageBitmap`, a canvas or raw pixels (`RgbaPixels`: `width`,
  `height` and `data`, straight-alpha sRGB RGBA8 rows with no padding) and a region
  `{sourceX, sourceY, width, height, destinationX, destinationY}` that fits both images.
  No clipping, scaling or blending; transparent source pixels erase. Raw pixels are stored
  byte for byte, with no canvas capture or readback; the editor passes the compositor's
  `PixelBuffer` as they are.
- Per ID, updates run FIFO with at most 32 pending including the active one; overflow
  rejects. The editor coalesces dirty rectangles per chunk and keeps at most one update in
  flight per chunk, so it never approaches the limit.
- Raw pixels are copied during the call: the buffer can be used again as soon as it returns,
  so whole chunks are composited into one buffer even while an earlier update is pending. A
  canvas or bitmap source instead stays unchanged until the promise settles.
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

- **Camera:** every tier emits its quads in map pixels, and NGNE's camera carries the view: its
  position is the map pixel at the canvas's top-left corner, its zoom the device pixels per map
  pixel (view zoom × device pixel ratio), both set with `cut` so a frame draws them without
  interpolation, and `pixelSnap = false`. A map point lands at `(point − camera) × zoom` device
  pixels; the overlay, hit-testing and sprite clips (device pixels) use the same mapping.
  Culling stays in the editor, as NGNE does none: the visible area is the canvas size divided
  by the zoom.
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
    chunk (later edits coalesce), and the live quads are dropped when it settles. The live
    quads are emitted whole, with the patch as their `Sprite.clip`: each edge of the patch
    rounded to the nearest device pixel, so the clip holds the pixels whose centres lie in the
    patch, which the patch's checkerboard and background cover too. A tile that reaches past the
    patch therefore does not draw again, translucent layers included, over what the chunk holds
    around it. The quads of a patch share its clip and batch with each other. A chunk that
    shows something after a change gets a texture, and one that shows nothing is released. A new
    chunk that would take chunk memory past 64 MB is not created: the tier is planned again
    (Resolution) and rebuilt, and the live tier draws meanwhile.
- **Redraw on demand:** frames are submitted only when the document, view or lifecycle
  changes; an idle editor submits nothing.
- **Frames in flight:** after each frame it submits, the viewport waits on
  `renderer.submittedWorkDone()` and counts the waits not yet settled. A redraw asked for while
  2 are pending (the §6 budget) is owed instead of scheduled, and asked for when a wait settles;
  it draws the document and view as they are then, so changes made meanwhile are not queued as
  frames. Either outcome settles a wait: a lost device resolves the pending waits, disposal and
  terminal failure reject them. A wait also covers the texture uploads submitted before it.
- **Layer opacity** maps to sprite alpha. Tint and blend modes are not drawn (Later / Out).
- **Image layers:** one texture each, holding the image once (≤ 8192 px per side, w × h × 4
  bytes of GPU memory), and one quad each. The quad has its top-left corner at the layer's
  shift (FORMAT §3.4); along a repeated axis it covers the area drawn instead (the view, or a
  pending patch with its clip), and its UVs run from where in a copy the area starts (`u`,
  `v` in 0–1) over the copies it spans (`uw`, `vh`), which repeat addressing tiles. Parallax and
  the layer offset move the UVs of a repeated axis, not the quad.

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

"Measured" values (Intel UHD / RTX 4060) are TE-064's measurement of the finished build on the
reference hardware; each row's benchmark is under `tests/perf/` (the ticket that built the
feature wrote it).

| Metric | Budget | Measured |
| --- | --- | --- |
| Pan at the live-tier threshold, 1920×1080 at DPR 1 and 1.25: animation-frame callback start → submit, p95 | ≤ 10 ms | DPR 1: 8.8 / 8.8 ms; DPR 1.25: 9.0 / 8.8 ms (median 8.1 / 8.2 ms at DPR 1, 8.4 / 8.3 ms at DPR 1.25) |
| Dropped frames (interval > 25 ms) over a 5 s scripted pan | ≤ 1% | DPR 1 and 1.25: 0% / 0% (0 / 0 frames of 543–557) |
| Paint: pointer event → frame containing it submitted, p95 | ≤ 33 ms | 9.3 / 9.8 ms (median 8.1 / 7.9 ms, max 15.5 / 11.2 ms) |
| Paint at overview: painted cells visible | next frame | the frame after the command (live quads); command → that frame submitted p95 15.0 / 15.2 ms (16×16 stamp: 15.7 / 15.9 ms) |
| Overview chunk patch settled after a paint, p95 | ≤ 100 ms | 32.0 / 30.5 ms (16×16 stamp: 33.0 / 32.0 ms) |
| Chunk-tier memory, GPU (NGNE retains the same again on the CPU) | ≤ 64 MB | 32 / 32 MB (T = 8, 128 chunks) |
| Overview rebuild after a layer visibility/opacity change | ≤ 500 ms, no task > 16 ms | 298 / 313 ms; longest build slice 3.7 / 3.7 ms; the live-tier frame drawn meanwhile 112 / 108 ms (§4) |
| Initial overview build after a map opens (background) | no task > 16 ms | 0.39 / 0.40 s total, longest task 20.1 / 18.0 ms, **over budget** (build slices ≤ 7.3 / 7.5 ms) |
| Tab switch to an open map: first frame submitted, p95 | ≤ 100 ms | fitted view 80.6 / 82.6 ms (median 77.3 / 78.2 ms); 100% view 22.7 / 24.4 ms (median 20.3 / 20.7 ms) |
| GPU frames in flight during a scripted pan, overview pan or paint, max | ≤ 2 | pan 2 / 2 (p95 2 / 2); overview pan 2 / 2 (p95 1 / 1); paint 2 / 2 (p95 2 / 2); last submit → GPU idle 2.4–7.1 ms |
| Idle editor: frames submitted per second | 0 | 0 / 0 (live tier at 100% and chunk tier fitted; pointer outside the viewport and resting on the canvas) |
| Cold load to interactive (production build, local) | ≤ 2 s | 224 / 2,503 ms, **over budget** on the RTX 4060 (median 217 / 809 ms) |

All rows: `@ngne/core` 0.4.0, i7-12650H, Balanced power plan with the Best performance power
mode, on AC, 144 Hz panel, 1920×1080 window at DPR 1 (canvas 1612×784) unless the row says
otherwise; the pan, dropped-frame and chunk-tier rows (paint at overview, patch, memory, rebuild,
initial build) on 2026-11-20 with Chrome 157.0.8103.80; the tab-switch and cold-load rows on
2026-11-27 with Chrome 158.0.8127.38 and `@ngne/editor-ui` 0.1.0; the others on 2026-11-19 with
Chrome 157.0.8103.79; each record holds these facts. Raw data: `<benchmark id>-intel-uhd.json`
and `<benchmark id>-rtx-4060.json` in [evidence/](evidence/), recorded by
`tests/perf/te-064-record-all.ts`.

- Pan and dropped frames: `te-013-pan-{submit,dropped}-{dpr1,dpr125}`. The reference map at the
  live-tier threshold (zoom 0.78, 66,640 sprites), 5 s after 1 s of warm-up. Each animation-frame
  callback moves the view and submits a frame at once, outside the viewport's frames-in-flight
  hold (§4), so the row times the frame alone.
- Paint: `te-017-paint`. A stroke of the stamp brush (1×1 stamp) on the layer under the parallax
  layer at 100%: one press and 200 drag moves to a new cell each, sent as real input; the first
  10 moves are warm-up.
- Chunk tier (paint at overview, patch, memory, rebuild, initial build): `te-015-*`. The patch
  and the frame after the command are timed from the command over 100 paints. The initial build
  is timed from the map's first frame at 100% to the tier ready; its longest task is the longest
  gap of a message loop, and the build's own slices are recorded beside it. The rebuild follows
  an opacity change at overview, where the editor draws the change in the live tier until the
  chunks are composited again (§4). Owner: the initial build's longest task (§7) is accepted
  for v1.0.0 (2026-11-12), at 28.6 / 23.2 ms on 0.3.1 for v1.0.1 (2026-11-15) and, at
  20.9 / 19.0 ms on 0.4.0, for v1.1.0 (2026-11-19).
- Tab switch: `te-031-tab-switch-{fit,100}`. Two open tabs each hold the reference map; a switch
  is timed from the call that shows the other map to the return of the first frame submitted
  after it, 40 switches 1 s apart after 4 warm-up switches. At the fitted view the first frame is
  a live-tier frame of all 524,289 cells (median draw 62 / 63 ms): the previous map's chunk tier
  is released on the switch and the new one is built in the background (§4). At 100% the median
  draw is 5.3 / 5.4 ms of the switch's 20.3 / 20.7 ms.
- Frames in flight: `te-068-frames-in-flight-{pan,overview,paint}`. Counted right after each of
  the viewport's submits, that frame included, as the `onSubmittedWorkDone()` promises of its
  queue still pending; the preview's queue is counted apart. Scenarios: the pan above (5 s) at
  1.01 times its zoom, which draws the same 66,640 sprites but puts the visible count (§4) at
  about 64,200, so the view stays in the live tier once the chunk tier is ready; the same pan at
  overview in the chunk tier; in both, each step moves the view and asks the viewport for a frame
  as input does, so the viewport decides which frames are submitted (§4, frames in flight); and
  the paint stroke above. The viewport draws a frame of the pan in a median 7.9 / 8.3 ms and
  submits 373 / 444 frames in its 5 s.
- Idle: `te-064-idle-{live,overview}`, the sprite editor's method (RULES 1). The reference map
  at 100% in its middle and fitted (View › Fit Map); after the chunk tier has no work left and 2 s
  more, two windows of 10 s with nothing done: the pointer outside the viewport, then resting on
  the canvas after one move onto it. Every `GPUQueue.submit` of the page (viewport and preview) is
  counted: 0 in each window, and 0 animation-frame callbacks of the app. A window counts only when
  the page ran at least 20 animation frames per second (it ran 144), and a view change afterwards
  must submit a frame.
- Cold load: `te-064-cold-load`, the sprite editor's definition of "interactive" (RULES 1). The
  production build (`vite build`) served by `vite preview` on the machine; each load in a new
  Chrome with a fresh profile (no cache, no service worker). From the navigation's start, the
  empty state's New Project button is clicked at every animation frame (at most every 50 ms) from
  the first one that shows it; "interactive" is the first animation frame that shows the New
  Project dialog. The maximum of 10 loads. The app commits at a median 142 / 134 ms and shows the
  empty state at 195 / 779 ms (medians): on the RTX 4060 the WebGPU check before the shell takes
  most of the load. The loads took 208–224 ms on Intel UHD and 736–2,503 ms on the RTX 4060: the
  first load 2,503 ms, of which 2,482 ms before the shell showed, one more 1,343 ms, the others
  736–841 ms. Owner: the RTX 4060's over-budget maximum is accepted as recorded for the move onto
  `@ngne/editor-ui` 0.1.0 (2026-11-27, #19); its cause is not identified.

### Game runtime budget

| Config (stacked HUD scene, `pixelSnap` on, tile animations on, panning) | Budget: p95 `game.stats.renderMs` | Measured |
| --- | --- | --- |
| 480×270 logical ×3 (typical pixel-art game; 4,664 sprites) | ≤ 8 ms on Intel UHD | 1.1 / 1.2 ms (median 0.9 / 0.9 ms, max 1.5 / 1.4 ms) |
| 1920×1080 logical ×1, all 8 layers full (67k sprites, worst case) | recorded, not gated | 10.6 / 10.4 ms (median 9.1 / 9.6 ms, max 19.4 / 14.9 ms) |

Both rows: TE-064, with the machine, power plan, panel and window of the editor budgets. The
fixture game (`tests/fixtures/game`, the app's `@ngne/core`) imports the exported
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

Gaps that the editor or the generated runtime works around, with their status in 0.4.0. The
NGNE owner reads this table. Costs are the reference-hardware measurements of §6 and SPEC §14
(TE-064 and TE-068; Intel UHD / RTX 4060, on 0.4.0) and the spikes of 2026-10-30; "not
measured" marks a gap whose workaround no benchmark isolates. A gap that 0.4.0 resolves keeps
its row while the editor keeps its workaround.

Status evidence: the declarations of the pinned engine (`tests/unit/engine-gaps-surface.test.ts`,
written "surface" below) and drawing with it on a WebGPU canvas
(`tests/e2e/engine-gaps.spec.ts`, written "GPU" below).

| Gap | Workaround | Where | Cost (measured) | Status with 0.4.0 |
| --- | --- | --- | --- | --- |
| CPU cost per quad; sort fast path only for 32,768–262,144 quads | Two-tier viewport (§4) | editor | ~0.12 µs of main-thread time per quad (S1), so the live tier stops at 65,536 visible cells: its pan takes 8.8 / 8.8 ms p95 per frame at ~66,600 quads, against a 10 ms budget. A zoomed-out reference map (~524,000 quads) needs the chunk tier: 32 / 32 MB of GPU memory (as much again on the CPU), a 298 / 313 ms rebuild after a layer change, a 0.39 / 0.40 s initial build | Still applicable: 0.4.0 changes no step of a tilemap frame's preparation (ngne#57 and ngne#58 are open). `te-011-emit` and `te-013-pan` |
| Batching joins only consecutive quads with the same texture | Emit layer by layer, grouped by tileset | editor, runtime | Not measured ungrouped. Grouped, the reference map draws in 17 draw calls (4,664 and 66,992 sprites; runtime p95 1.1 / 1.2 ms and 10.6 / 10.4 ms) | Still applicable; a sprite clip also splits a draw. GPU: "batching still joins only consecutive quads of the same texture" |
| No camera zoom | Runtime takes a render-scale option and scales quad positions and sizes | runtime | Not measured: the scaling is part of the runtime's quad emission | Resolved: `Camera.zoom`. The viewport uses it (§4); the runtime's render-scale option is kept. GPU: "camera zoom 2 draws as the editor's scaling of positions and sizes does" |
| Nearest/clamp sampler only (no linear, no repeat) | Chunk tier for overview; runtime image-layer repeat as a quad grid; runtime seam-free only at integer scales | editor, runtime | The chunk tier of the first row; runtime repeat quads not measured | Partly resolved: `TextureSampling` per texture. The viewport draws a repeated image layer as one quad with repeat addressing (§4). Repeat tiles a whole texture, not an atlas rectangle; linear filtering bleeds across an atlas rectangle's edge and has no mipmaps, so the chunk tier and the integer-scale limit stay. The runtime's quad grid is kept. GPU: "repeat addressing tiles a whole texture; the default stays clamp", "linear filtering blends texels, and bleeds across an atlas sub-rectangle's edge" |
| Source-over blending only; multiplicative tint | Opacity via alpha; tint Later; blend modes Out | editor, runtime | None in time; features left out (tint, blend modes) | Still applicable. Surface: "Sprite has no blend mode and no additive tint: colour and alpha only" |
| No texture readback | CPU compositor in `core/` for chunks, thumbnails and test references | editor | Overview chunk patch settled 32.0 / 30.5 ms p95 after a paint (33.0 / 32.0 ms for a 16 × 16 stamp); the composite is part of the 298 / 313 ms rebuild | Still applicable. Surface: "WebGPURenderer has no texture readback and does not expose its GPU device" |
| The initial overview build still has a main-thread task over 16 ms (§6). Chunk uploads pass raw pixels and no longer read a canvas back; the cause of the remaining task is not identified | None yet: the initial overview build misses its 16 ms task budget; later updates stay within it | editor | Longest task of the initial overview build 20.1 / 18.0 ms against 16 ms (§6; the build's own slices ≤ 7.3 / 7.5 ms). With canvas uploads on 0.3.0 the same machine measured 30.0–37.5 / 37.1–48.6 ms on 2026-11-15 (three runs each) | Still applicable: with 0.4.0 the task is still over 16 ms on the reference hardware. `te-015-chunk` |
| Centre pixel snapping misplaces odd sizes | Editor: `pixelSnap = false`. Runtime: placement table for the 8 orientations with integer centre corrections; atlases padded to even rectangles, exported images to even sides | editor, runtime | Not measured: one extra transparent column or row per odd tile in the atlas | Resolved: `pixelSnap` rounds a quad's corner. The workarounds are kept; the runtime also supports engines before 0.4.0 (SPEC §11.4). GPU: "pixel snapping places odd-sized and flipped quads on whole pixels, texel for pixel" |
| No line, ellipse or polygon primitives | Markers and collision shapes on the Canvas2D overlay (they ignore tile-layer order and opacity) | editor | Overlay redraw 0.2 / 0.2 ms with 2,000 markers; the pan with them takes 9.5 / 9.6 ms p95 (budget 10 ms) | Still applicable. Surface: "Frame has no line, ellipse or polygon primitive: sprites and rects only" |
| No animation repeat count or direction | Tile animations loop; `once` atlas animations imported as looping | editor | None in time; `once` animations loop | Still applicable. Surface: "exports no tilemap or atlas schema, no tileset discovery and no sprite animation" |
| Assets checked by object identity; no reference following; unlisted texture throws in render | Runtime caches one definition per ID, namespaces IDs, exposes `assetsFor(tilemap)`, skips unlisted tilesets | runtime | Not measured | Still applicable. Surface: "ImageAsset gains only sampling: no references to follow from one asset to another" |
| No tilemap or atlas schema; no tileset discovery | Editor-owned `ngne-tilemap` and `ngne-sprite-atlas` formats | editor, runtime | None in time; the formats and the runtime are the editor's to maintain | Still applicable. Surface: "exports no tilemap or atlas schema, no tileset discovery and no sprite animation" |
| One GPU device per renderer; no multi-viewport | Secondary views in Canvas2D | editor | Not measured | Still applicable. Surface: "WebGPURenderer has no texture readback and does not expose its GPU device" |
| BrowserGame: no in-scene uploads, fixed logical size | Preview restarts its scene on tileset change; fixed preview resolution | preview | Not measured | Still applicable. Surface: "BrowserGame has no in-scene upload and no resize: its logical size is fixed" |
| `WebGPURenderer.create` awaits `requestAdapter` and `requestDevice` without a time limit. Its abort signal ends the wait: creation rejects with an `AbortError` | The editor's WebGPU check runs first with a limit (5 s, one retry) and shows WebGPU required ([DESIGN.md](DESIGN.md) §9); a hang that starts after the check has passed leaves the viewport loading | editor | Not measured: no request hung in the measurements. The check is part of the cold load (260 / 940 ms, §6), most of it on the RTX 4060; a hung request shows the notice after up to 10 s (two 5 s limits) | Still applicable: no time limit. GPU: "renderer creation has no time limit of its own while the adapter request hangs", "aborting renderer creation ends a hung adapter request" |
