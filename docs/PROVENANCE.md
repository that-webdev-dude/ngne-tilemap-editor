# Provenance

Files copied from ngne-sprite-editor (`se/` = `..\ngne-sprite-editor`, SUITE §1), one row per
file, sorted by path. Kinds as DESIGN §3: **verbatim** files are byte-identical to the `se/`
file at the recorded commit and carry its SHA-256; **adapt** files were copied and then
changed only as the row states. `scripts/drift.ts` reports later changes in `se/` to verbatim
rows.

| Path | `se/` path | Kind | Commit | SHA-256 | Change |
| ---- | ---------- | ---- | ------ | ------- | ------ |
| `.gitattributes` | `.gitattributes` | verbatim | `ea5c91d` | `23302dd90b8bb74b44d365fafef8df20f809b61cb347023951ecf60a88a29651` | |
| `.github/workflows/ci.yml` | `.github/workflows/ci.yml` | adapt | `ea5c91d` | | `check` and E2E jobs only (4 shards + `alone`); E2E needs `check`; `--pass-with-no-tests`. Golden path, README commands and links are later tickets' |
| `.gitignore` | `.gitignore` | adapt | `ea5c91d` | | Workflow-file references removed |
| `.npmrc` | `.npmrc` | verbatim | `ea5c91d` | `be85cc462e740587626bbcbb1c3ed1c40b26e62ec072e8cbd2768f23915c28e6` | |
| `.prettierignore` | `.prettierignore` | adapt | `ea5c91d` | | Workflow-file references removed |
| `.prettierrc.json` | `.prettierrc.json` | verbatim | `ea5c91d` | `d04a16899ab54acc7f6594035de866d26c4abf39686192b3994abdd132351e27` | |
| `LICENSE` | `LICENSE` | verbatim | `ea5c91d` | `4d21bde6e4b9d15aafd5e507b3222205aa1ed73c3546650c524a3bf75685305a` | |
| `eslint.config.js` | `eslint.config.js` | adapt | `ea5c91d` | | `src/core/sprite` imports only itself, `fflate` and `fast-png`; only `src/core` imports `src/core/sprite` (DESIGN §3.1) |
| `index.html` | `index.html` | adapt | `ea5c91d` | | Title and description (SUITE §1); no favicon link until the icons exist (TE-066) |
| `package.json` | `package.json` | adapt | `ea5c91d` | | Name, version `0.0.0`, description; dependencies of SUITE §5 (`@ngne/core` 0.3.0, no `gifenc`); `drift` script |
| `playwright.config.ts` | `playwright.config.ts` | verbatim | `ea5c91d` | `c54d185e32b18fb3e05cee6fd7c72f924ec93eaaf51d5f36ceaf32d84b03b7a6` | |
| `src/app/commandPalette/commandPalette.commands.ts` | `src/app/commandPalette/commandPalette.commands.ts` | adapt | `ea5c91d` | | Comment cites DESIGN §10.3 instead of the sprite editor's SPEC §7.8 |
| `src/app/commandPalette/fuzzy.ts` | `src/app/commandPalette/fuzzy.ts` | verbatim | `ea5c91d` | `da142574be46c0eba4988a74649e3e1778b9dd0cf98c4df3a29e231c822e50b1` | |
| `src/app/commandPalette/paletteModel.ts` | `src/app/commandPalette/paletteModel.ts` | verbatim | `ea5c91d` | `176c165b0cbd1f323ee156432ce67ee68a0298b13bc318d96ea796285fa9578a` | |
| `src/app/commandPalette/recentCommands.ts` | `src/app/commandPalette/recentCommands.ts` | adapt | `ea5c91d` | | Storage key `ngne-tilemap-editor.recent-commands` (SUITE §7) |
| `src/app/commands/appCommands.ts` | `src/app/commands/appCommands.ts` | adapt | `ea5c91d` | | Refreshes on the session store and the key-context store; no editor store |
| `src/app/commands/chord.ts` | `src/app/commands/chord.ts` | verbatim | `ea5c91d` | `a4af3b93d1fc355074f329aac1ca3fdcc65a54ce5cbbdf0074a75fc5212d1d66` | |
| `src/app/commands/invoke.ts` | `src/app/commands/invoke.ts` | adapt | `ea5c91d` | | No playback state to stop |
| `src/app/commands/menuModel.ts` | `src/app/commands/menuModel.ts` | verbatim | `ea5c91d` | `32c9403fdf2f5467c1c78af7e0750cdcd579ebb4fbf3bf0084c7022aff10e6a7` | |
| `src/app/commands/planned.commands.ts` | `src/app/commands/planned.commands.ts` | adapt | `ea5c91d` | | The menus and items of DESIGN §5; the Open Recent submenu holds a placeholder item until TE-047 |
| `src/app/commands/registry.ts` | `src/app/commands/registry.ts` | verbatim | `ea5c91d` | `acd66e0e604dd887ce3e79fbf6e92b61403981418bce8cc18da8e4fa5da70281` | |
| `src/app/commands/types.ts` | `src/app/commands/types.ts` | adapt | `ea5c91d` | | `KEY_CONTEXTS` of DESIGN §10.1 (`markers`, `panel`); `MENU_BAR` of DESIGN §5 |
| `src/app/dialogs/dialogRequests.ts` | `src/app/dialogs/dialogRequests.ts` | verbatim | `ea5c91d` | `514a85c12e26dc3c93a169ac55c68f75b64b15ae2268b9c76127d7eeec67c781` | |
| `src/app/keymap/contextState.ts` | `src/app/keymap/contextState.ts` | adapt | `ea5c91d` | | Contexts `gesture` and `markers` (DESIGN §10.1) |
| `src/app/keymap/environment.ts` | `src/app/keymap/environment.ts` | adapt | `ea5c91d` | | `inPanel` from `PANEL_SELECTOR` (the bottom panel region or `data-keymap-panel`) instead of `inTimeline`; `markers` instead of `floating` |
| `src/app/keymap/install.ts` | `src/app/keymap/install.ts` | adapt | `ea5c91d` | | No change: it reads the contexts through contextState.ts and environment.ts |
| `src/app/keymap/keyClasses.ts` | `src/app/keymap/keyClasses.ts` | verbatim | `ea5c91d` | `f8a26308a617fffec31cd268ffe309d19c8adc1400f35d9ecf1ef2f0db60020b` | |
| `src/app/keymap/regions.commands.ts` | `src/app/keymap/regions.commands.ts` | verbatim | `ea5c91d` | `4abaeb31767f3ac6e0b9b9027df5edd9b13a44aba035a6e2cece364711b27e93` | |
| `src/app/keymap/regions.ts` | `src/app/keymap/regions.ts` | verbatim | `ea5c91d` | `6d180e5dc433fd882b16133ef66d834ac11e25c23fe4c5f628a9d46221df19fb` | |
| `src/app/keymap/resolve.ts` | `src/app/keymap/resolve.ts` | adapt | `ea5c91d` | | `KeyEnvironment.inPanel` and `markers` instead of `inTimeline` and `floating`; `applicableContexts` lists the contexts of DESIGN §10.1 |
| `src/app/notices/notices.ts` | `src/app/notices/notices.ts` | verbatim | `ea5c91d` | `360f48063c7912a9d9b649438c806c362af2c361d679155bb703aaf9f9a65cfb` | |
| `src/app/overlay/draw.ts` | `src/app/overlay/draw.ts` | adapt | `ea5c91d` |  | `fillRects` only (the cell grid needs no clip); `DeviceRect` from `gridLines.ts` |
| `src/app/overlay/grid.commands.ts` | `src/app/overlay/grid.commands.ts` | adapt | `ea5c91d` |  | `view.grid` toggles the `grid` view preference (SPEC §3) and takes Ctrl+G (DESIGN §10.3); no pixel grid, no document settings |
| `src/app/overlay/grid.overlay.ts` | `src/app/overlay/grid.overlay.ts` | adapt | `ea5c91d` |  | One layer, `cell-grid` at order 300, from the cell size of the active map; the grid preference's colour and opacity; no pixel grid |
| `src/app/overlay/gridLines.ts` | `src/app/overlay/gridLines.ts` | adapt | `ea5c91d` |  | Axes from the map's corner and the scale (map pixels, cells); cell lines only, from 4 device pixels per cell; no pixel grid or outline helpers |
| `src/app/overlay/mountOverlay.ts` | `src/app/overlay/mountOverlay.ts` | adapt | `ea5c91d` |  | Session store of the project; the canvas is sized by the viewport host (no NGNE canvas observation or stretching); probe adds the canvas |
| `src/app/overlay/overlayController.ts` | `src/app/overlay/overlayController.ts` | adapt | `ea5c91d` |  | Active map, its geometry and view as the redraw key; cursor carries map position and cell; no stretched mapping; theme is the grid ink, `--accent` and `--danger` |
| `src/app/overlay/overlayLayers.ts` | `src/app/overlay/overlayLayers.ts` | adapt | `ea5c91d` | | Workflow-file references removed |
| `src/app/overlay/types.ts` | `src/app/overlay/types.ts` | adapt | `ea5c91d` |  | Frame carries the map, a cell mapping and the cursor's cell; theme is the grid ink, `--accent` and `--danger` |
| `src/app/platform/storage.ts` | `src/app/platform/storage.ts` | verbatim | `ea5c91d` | `79c92ee9e714fa52d8816918e78c0c2abf6c055b2f4297df7fa39f8fa30a80f3` | |
| `src/app/preferences/preferences.commands.ts` | `src/app/preferences/preferences.commands.ts` | adapt | `ea5c91d` | | Comment cites DESIGN §10.3 |
| `src/app/preferences/preferences.ts` | `src/app/preferences/preferences.ts` | adapt | `ea5c91d` | | Storage key `ngne-tilemap-editor.preferences`; sections `checkerboard`, `grid` (colour `"theme"` or 0xRRGGBB, opacity in percent), `highlight` (opacity in percent, default 25) and `autosave` instead of the sprite editor's grid, onion and import defaults; `ColourChoice` and the `percent` range |
| `src/app/selection/antsGeometry.ts` | `src/app/selection/antsGeometry.ts` | adapt | `ea5c91d` | | Axes in cells (device pixels per cell, the map's cells as the length); `DeviceRect` and `DeviceSize` from this editor's modules |
| `src/app/selection/boundaryCache.ts` | `src/app/selection/boundaryCache.ts` | adapt | `ea5c91d` | | Cell masks (the model's `Region`) instead of `BitMask`; shared with the pending selection of a gesture |
| `src/app/selection/ringPainter.ts` | `src/app/selection/ringPainter.ts` | adapt | `ea5c91d` | | Ring around a cell mask: `RingView` in cells, `cellAxes` per axis (cells need not be square); bounds a `CellRect` |
| `src/app/selection/selectionAnts.overlay.ts` | `src/app/selection/selectionAnts.overlay.ts` | adapt | `ea5c91d` | | The active map's tile selection, or a selection tool's pending one (`pendingSelection.ts`), from this editor's session store; order 500 |
| `src/app/selection/tools/selectionMode.ts` | `src/app/selection/tools/selectionMode.ts` | adapt | `ea5c91d` | | Tiled's modifiers (Shift add, Ctrl subtract, Ctrl+Shift intersect); commands on the stroke's map; right click clears |
| `src/app/selection/transform/handles.ts` | `src/app/selection/transform/handles.ts` | adapt | `ea5c91d` | | Handles of marker and collision-shape boxes (DESIGN §3.3): an axis-aligned `ShapeBox` instead of a turned `FreeTransform`, so no turn ring (`ROTATE_REACH`, `ANGLE_SNAP`, `rotateBoxTo` dropped, `hitBox` has no `rotate`); `scaleBox` takes the point as the caller snapped it, without the whole-pixel rounding, the 1 px minimum or the side limit, and a side dragged past the opposite one turns the box over (a box of size 0 grows from any handle) |
| `src/app/shell/bottomPanel.commands.ts` | `src/app/timeline/timeline.commands.ts` | adapt | `ea5c91d` | | `view.bottomPanel` toggles the bottom panel (Hide / Show Bottom Panel, Tab in `canvas`); refreshes the registry on its store |
| `src/app/shell/bottomPanel.ts` | `src/app/timeline/timelineState.ts` | adapt | `ea5c91d` | | Only `visible`, for the bottom panel |
| `src/app/shortcuts/shortcutSheet.ts` | `src/app/shortcuts/shortcutSheet.ts` | verbatim | `ea5c91d` | `607f13dc68fc72037b0a6cc77812bb0cb5656947d48d81933f76767f04f28e49` | |
| `src/app/shortcuts/shortcuts.commands.ts` | `src/app/shortcuts/shortcuts.commands.ts` | adapt | `ea5c91d` | | Comment cites DESIGN §10.3 |
| `src/app/state/history.commands.ts` | `src/app/state/history.commands.ts` | adapt | `ea5c91d` | | Reads the history of the app's one project; no floating selection; a step for another map shows that map's tab first (SPEC §3) |
| `src/app/state/session.ts` | `src/app/state/sessions.ts` | adapt | `ea5c91d` | | One `ProjectSession` with its `History` per window (SPEC §3, §10.1) instead of a list of documents: `replace`, `touch`, `revision`; no views, saved state or reference sources |
| `src/app/state/status.ts` | `src/app/state/status.ts` | adapt | `ea5c91d` |  | Cursor is the cell under the pointer (DESIGN §8.7); the fields that read it register from `*.status.ts` modules |
| `src/app/surfaces/surfaces.ts` | `src/app/surfaces/surfaces.ts` | verbatim | `ea5c91d` | `cd95fe5ba802969ff977d366e540320bd4a5104d4011f76a669478b5b14a599b` | |
| `src/app/tabs/tabs.commands.ts` | `src/app/tabs/tabs.commands.ts` | adapt | `ea5c91d` | | Previous Map and Next Map in the Map menu, through the open map tabs; Close Map (Alt+W) |
| `src/app/tabs/tabs.ts` | `src/app/tabs/tabs.ts` | adapt | `ea5c91d` | | Tabs hold the open maps of the one project (`mapTabsStore`): no file workflows, palette swatch or reference images; closing a tab hides the map; the active map is always open; a deleted map's tab comes back in place on undo |
| `src/app/testing/testHooks.ts` | `src/app/testing/testHooks.ts` | adapt | `ea5c91d` | | Exposes the session, key-context, bottom-panel, preference, view-preference and recent-command stores and the registry; `assertInvariants` on the project; `viewport`, the probe of the viewport host (frames, textures, renderer count) |
| `src/app/tools/activeTool.ts` | `src/app/tools/activeTool.ts` | adapt | `ea5c91d` |  | Its own store keeps the selected tool per layer kind (`tile`, `marker`, `none`; DESIGN §6) and the option values; `select` and `hold` take only tools of the active layer's set; `kind` and `offered` added; no editor store |
| `src/app/tools/appPipeline.ts` | `src/app/tools/appPipeline.ts` | adapt | `ea5c91d` |  | On the session and status stores; stroke cells to the viewport (`strokeCells.ts`); no stroke while the pan key is held; failures reported as a toast naming the tool (`reportStrokeError`, SPEC §3); no composites, echo, playback or symmetry grab |
| `src/app/tools/attachToolPointer.ts` | `src/app/tools/attachToolPointer.ts` | adapt | `ea5c91d` |  | Cursor state `overMap` instead of `overDocument`; a right press joining a left drag (a chorded move) arms the context-menu cancel; no grab cursor; probe without the grab |
| `src/app/tools/gesture.commands.ts` | `src/app/tools/gesture.commands.ts` | adapt | `ea5c91d` |  | Comment cites DESIGN §10.1 and this editor's gestures |
| `src/app/tools/hand/hand.tools.ts` | `src/app/tools/hand/hand.tools.ts` | adapt | `ea5c91d` |  | No `hold`: Space pans through `view.panHold` (TE-014); comment cites SPEC §4.3 |
| `src/app/tools/options.ts` | `src/app/tools/options.ts` | adapt | `ea5c91d` |  | `ToolOptions` defined here instead of in the editor store |
| `src/app/tools/pipeline.ts` | `src/app/tools/pipeline.ts` | adapt | `ea5c91d` |  | Cells instead of pixels (SPEC §4.1): samples carry the cell and the cells crossed since the one before (`pointsOnLine`); paint target is the active tile layer (`paintTarget.ts`) and its transaction, clipped to the map and to the paintable tile layers; a right press during a left drag aborts; the stroke ends when the project, history, active map or layer changes; `cellsChanged`, `navigating`; `onError` gets the stroke's tool; no live composite, colours, grab, `latestSample` or `claims` |
| `src/app/tools/planned.tools.ts` | `src/app/tools/planned.tools.ts` | adapt | `ea5c91d` |  | The slots of DESIGN §6 with the keys of DESIGN §10.3 and the layer kinds of their set |
| `src/app/tools/registry.ts` | `src/app/tools/registry.ts` | verbatim | `ea5c91d` | `bd5fd9bd647aed09d426fe461403d03ad10f1065855274831ecebbc232ce76a1` |  |
| `src/app/tools/toolRegistry.ts` | `src/app/tools/toolRegistry.ts` | adapt | `ea5c91d` | | Workflow-file references removed |
| `src/app/tools/tools.commands.ts` | `src/app/tools/tools.commands.ts` | adapt | `ea5c91d` |  | Select and hold commands are enabled only while the active layer's set holds the tool; the registry refreshes on the tool state |
| `src/app/tools/types.ts` | `src/app/tools/types.ts` | adapt | `ea5c91d` |  | Same exports plus `ToolLayerKind`: pointers carry map position, cell and crossed cells; `PaintStroke` writes cells of a tile layer, or of another paintable tile layer of the map (`paintableLayers`); `ToolContext` has the session, map and layer instead of the document and colour; `layers` on tools and planned slots; `readouts` on tools; no `claims` or `latestSample` |
| `src/app/tools/zoom/zoom.tools.ts` | `src/app/tools/zoom/zoom.tools.ts` | adapt | `ea5c91d` |  | Comment cites SPEC §4.3 |
| `src/app/view/coordinates.ts` | `src/app/view/coordinates.ts` | adapt | `ea5c91d` |  | Client, device, map and cell spaces from the view's centre and zoom (zoom in CSS pixels per map pixel, TE-013); map positions within 1e-9 of a whole pixel are that pixel |
| `src/app/view/navigate.ts` | `src/app/view/navigate.ts` | adapt | `ea5c91d` |  | Views are centre and zoom; navigation works on the map's origin on the canvas and converts back; pan limit and pixel-exact origin as the sprite editor's |
| `src/app/view/pointerNavigation.ts` | `src/app/view/pointerNavigation.ts` | adapt | `ea5c91d` |  | Wheel, Shift+wheel, middle drag and Space-held primary drag; the status cursor is the cell under the pointer |
| `src/app/view/view.commands.ts` | `src/app/view/view.commands.ts` | adapt | `ea5c91d` |  | Adds `view.panHold` (Space, hold); the commands refresh with the viewport's size |
| `src/app/view/viewNavigation.ts` | `src/app/view/viewNavigation.ts` | adapt | `ea5c91d` |  | Active map of the project session, its view in `MapSession`; `touch` after a change; no document store |
| `src/app/view/viewPolicy.ts` | `src/app/view/viewPolicy.ts` | adapt | `ea5c91d` |  | Only the pan limit, applied on a resize and a change of the active map; maps are not fitted on opening |
| `src/app/view/viewportSize.ts` | `src/app/view/viewportSize.ts` | adapt | `ea5c91d` |  | One store the viewport host reports to; no region probe or link |
| `src/app/view/wheel.ts` | `src/app/view/wheel.ts` | verbatim | `ea5c91d` | `706809d643ccf8ae3d6964a8d577ff219d8e09cb6f0e201a680e6fec21817dd3` |  |
| `src/app/view/zoom.ts` | `src/app/view/zoom.ts` | adapt | `ea5c91d` |  | Steps 1/32 and 1/16 added below (SPEC §4.1); `fitZoom` in map pixels without rounding |
| `src/core/color/contrast.ts` | `src/core/color/contrast.ts` | verbatim | `ea5c91d` | `7fb03d414fd8612982d1fdd95b8b0cfafc5dc8cfd119b823fae663eb549fe06c` | |
| `src/core/color/hex.ts` | `src/core/color/hex.ts` | verbatim | `ea5c91d` | `da3a6afbd39c047ec6fc6bee250ca0945e117e91fb00700dea7b75920aa36209` | |
| `src/core/color/hsv.ts` | `src/core/color/hsv.ts` | verbatim | `ea5c91d` | `8303ccbd2731e84fc98f5a05cbcb0ed8fac5f91777d39d7cc474a4ffb34851ca` | |
| `src/core/color/index.ts` | `src/core/color/index.ts` | verbatim | `ea5c91d` | `f906353fba3321780076f87fd9296e26077417887d9ce5e03710ab5a79554426` | |
| `src/core/color/oklab.ts` | `src/core/color/oklab.ts` | verbatim | `ea5c91d` | `9544f9611bb120656eabaf5ae01ab6e26398748785755df45901ae1442a8f627` | |
| `src/core/color/rgba.ts` | `src/core/color/rgba.ts` | verbatim | `ea5c91d` | `26974e90f746c75e9f9a55d061ea9786cd64c796858613d3edb9b6b493576b3f` | |
| `src/core/history/allocate.ts` | `src/core/history/allocate.ts` | adapt | `ea5c91d` | | `Allocator` returns an `ArrayBuffer`; `allocateWords` for the 32-bit words of a cell patch instead of `allocateBuffer` and `copyRect` for pixels |
| `src/core/history/cellPatch.ts` | `src/core/history/pixelPatch.ts` | adapt | `ea5c91d` | | `cellPatchCommand` over `(index, before, after)` words of one tile layer instead of pixel rectangles of an image; `tileLayerCells` finds the layer; no `pixelPatchCommand` |
| `src/core/history/command.ts` | `src/core/history/command.ts` | adapt | `ea5c91d` | | `Command` over `ProjectSession` with optional `projectBytes` (SPEC §2.2); `Touched` of SPEC §3 (map, layers, cell rectangles, tilesets, structure) defined here with `touchedNothing`; `mergeTouched` keeps one map or none |
| `src/core/history/errors.ts` | `src/core/history/errors.ts` | adapt | `ea5c91d` | | Message says history memory, not pixel memory |
| `src/core/history/history.ts` | `src/core/history/history.ts` | adapt | `ea5c91d` | | One history per project: `markSaved` and `dirty` (SPEC §3), `undoMapId`/`redoMapId`, memory limit and one warning per crossing (SPEC §2.2), a `verify` option that runs `assertInvariants` in development and tests and reverses a failing step; no cel limits or ID generator |
| `src/core/history/index.ts` | `src/core/history/index.ts` | adapt | `ea5c91d` | | Exports of this editor's history: cell patch, `Touched`, memory warning listener, verifier; no chained command or pixel patch |
| `src/core/history/transaction.ts` | `src/core/history/transaction.ts` | adapt | `ea5c91d` | | Target is a tile layer of a map; `begin` snapshots nothing, `set` records `(index, before, after)` on a cell's first write, `commit` stores 12 bytes a cell through `cellPatchCommand`, one patch per tile layer written (other layers of the map by id); no clip mask, no cel creation |
| `src/core/raster/line.ts` | `src/core/raster/line.ts` | adapt | `ea5c91d` |  | `pointsOnLine` (Tiled's `src/tiled/geometry.cpp` at v1.12.2, with its `manhattan` option) replaces `linePixels` and `forEachLinePixel` (Zingl's all-octant form, which breaks ties differently) |
| `src/core/selection/boundary.ts` | `src/core/selection/boundary.ts` | adapt | `ea5c91d` | | Cell grid lines of a cell mask over its rectangle instead of a document-sized bit mask |
| `src/core/selection/commands.ts` | `src/core/selection/commands.ts` | adapt | `ea5c91d` | | Commands on `MapSession.tileSelection` of one map of the project (`touched.mapId`); Select None instead of Deselect |
| `src/core/selection/mask.ts` | `src/core/selection/mask.ts` | adapt | `ea5c91d` | | Cell masks: the model's `Region` (a rectangle of cells, one byte a cell) instead of a document-sized bit mask; conversions to and from `core/fill` row spans |
| `src/core/selection/operations.ts` | `src/core/selection/operations.ts` | adapt | `ea5c91d` | | Cell masks over any rectangles of the map; invert and select all over the map's cells |
| `src/core/sprite/animation/expandTag.ts` | `src/core/animation/expandTag.ts` | verbatim | `ea5c91d` | `b72b0e96d9ed95b79d090f436e7b070752fb28438f162fcbccda5ca84cdadf0b` | |
| `src/core/sprite/animation/index.ts` | `src/core/animation/index.ts` | verbatim | `ea5c91d` | `4f38e8b4add97270be649f06776753a8fa0d2d01fee8f27bfdee2f9bbde93897` | |
| `src/core/sprite/animation/playbackClock.ts` | `src/core/animation/playbackClock.ts` | verbatim | `ea5c91d` | `b2d057b570c42f31d91f6cffb436f2287904224ad07eaaedaee7e8959cf30d9b` | |
| `src/core/sprite/cels/celPlan.ts` | `src/core/cels/celPlan.ts` | verbatim | `ea5c91d` | `2270ed7706e8e526ad398919f231af7871fa4417507c5cc4d64f0d5847304a3b` | |
| `src/core/sprite/cels/commands.ts` | `src/core/cels/commands.ts` | verbatim | `ea5c91d` | `2941c46111b22073380bcff2c1cff0b1d0df6faddec62d4e4132ff7a6fee29b8` | |
| `src/core/sprite/cels/errors.ts` | `src/core/cels/errors.ts` | verbatim | `ea5c91d` | `e6078acb719093e9fcd1d584f61d8b7fec5fca1644acfb1d6bf620b63f2fb995` | |
| `src/core/sprite/cels/index.ts` | `src/core/cels/index.ts` | verbatim | `ea5c91d` | `6c3cfcefb0fd14c4c3f3c4a77d081e044158844a2273d983fc55fffc60fac9d4` | |
| `src/core/sprite/cels/orderedMap.ts` | `src/core/cels/orderedMap.ts` | verbatim | `ea5c91d` | `5ef2a6aa640827dab9656019e50d824cf8c16de525e076573b86cb8414e159f2` | |
| `src/core/sprite/composite/blend.ts` | `src/core/composite/blend.ts` | verbatim | `ea5c91d` | `215f5c92bce80814d690f44614b67337c50f53dc09a74d733a2def73f4a8868e` | |
| `src/core/sprite/composite/compositeFrame.ts` | `src/core/composite/compositeFrame.ts` | verbatim | `ea5c91d` | `f0b9c66cf3fbaaadc1c82ae767dc764165e88a45d08e965ff443e7414829740e` | |
| `src/core/sprite/export/atlasFormat.ts` | `src/core/export/atlasFormat.ts` | verbatim | `ea5c91d` | `3804715597a48fa57d5eb5b3948ad0a321ca8f99edc33eb3644e4461a086106a` | |
| `src/core/sprite/export/errors.ts` | `src/core/export/errors.ts` | verbatim | `ea5c91d` | `2fec68b1cb0e8fc0506ce835a93d05e48549dd5dd85556b84c41d87d0adc864b` | |
| `src/core/sprite/export/names.ts` | `src/core/export/names.ts` | verbatim | `ea5c91d` | `72444f549ec41c31853bf1de84540e03be8343be8afa21940a4a65e17ace6db4` | |
| `src/core/sprite/export/pack.ts` | `src/core/export/pack.ts` | verbatim | `ea5c91d` | `507e618ebddc3bb9363ff5599779c478ae6d9ecdd660986ef82629f03b30fcdc` | |
| `src/core/sprite/export/packErrors.ts` | `src/core/export/packErrors.ts` | verbatim | `ea5c91d` | `73a3f90b75e22dab99784872b7422381f870162391e5639001a46658e19ce471` | |
| `src/core/sprite/export/sprite-runtime.ts` | `src/core/export/sprite-runtime.ts` | verbatim | `ea5c91d` | `fbfd33992aa6896ac8ab6444893175e32e2e42a24ab905ad36c2b8f0c7ad1fa3` | |
| `src/core/sprite/export/validateAtlas.ts` | `src/core/export/validateAtlas.ts` | verbatim | `ea5c91d` | `563a9afac931a269e6cd979f0cd5758259411a7a62b26666a351a1d151ec944f` | |
| `src/core/sprite/frames/commands.ts` | `src/core/frames/commands.ts` | verbatim | `ea5c91d` | `60ccb5066a61eaac2c2ced1bb04db68c77093b645ac0fbc25cd5d5f021bd6f99` | |
| `src/core/sprite/frames/errors.ts` | `src/core/frames/errors.ts` | verbatim | `ea5c91d` | `e48e004b7d9b18ad6d248d9f73d5031743cac9131e2ac999e308438b767ea9b6` | |
| `src/core/sprite/frames/index.ts` | `src/core/frames/index.ts` | verbatim | `ea5c91d` | `54421fcc59da187033e3a900a0162812c2d13f12388a392ea0a48c50c4ea0278` | |
| `src/core/sprite/history/allocate.ts` | `src/core/history/allocate.ts` | verbatim | `ea5c91d` | `7184ba4197f39d9b1cad8b26875b505d04a68a913b4b69676178e60366add57e` | |
| `src/core/sprite/history/chained.ts` | `src/core/history/chained.ts` | verbatim | `ea5c91d` | `dbf232c472a81b500ac50a53667daec1425f6e499023be0b507c6c33670b9418` | |
| `src/core/sprite/history/command.ts` | `src/core/history/command.ts` | verbatim | `ea5c91d` | `be3def30f56f5b67c8afc3bed0bcbbafac15bd6ef191534eec4c4f2c5d590288` | |
| `src/core/sprite/history/errors.ts` | `src/core/history/errors.ts` | verbatim | `ea5c91d` | `8d4592872de46e1c413dc540d797a24ef1281f4164340970c308996a41e85130` | |
| `src/core/sprite/history/history.ts` | `src/core/history/history.ts` | verbatim | `ea5c91d` | `80edff1e6ff56b92bf40e6712d884c75f6c73e28ba42bbe791f1cf731083bacb` | |
| `src/core/sprite/history/index.ts` | `src/core/history/index.ts` | verbatim | `ea5c91d` | `cff5290416419ee7277ea96d9f0fdc81326f251290b9d0fa176e090002a7ca4a` | |
| `src/core/sprite/history/pixelPatch.ts` | `src/core/history/pixelPatch.ts` | verbatim | `ea5c91d` | `f827538a45c03bb8382986604d847f882ce8c48289fbbda78f18a07afbb0e580` | |
| `src/core/sprite/history/transaction.ts` | `src/core/history/transaction.ts` | verbatim | `ea5c91d` | `eee05e1c45bdf7d297e87fb29f443908292109c8d3e326ebb3725e97bba15ff2` | |
| `src/core/sprite/model/createDocument.ts` | `src/core/model/createDocument.ts` | verbatim | `ea5c91d` | `8c3355ca03c6d791093440ffd2d83e3f94542f8d355cd939dacd029742222293` | |
| `src/core/sprite/model/defaultPalette.ts` | `src/core/model/defaultPalette.ts` | verbatim | `ea5c91d` | `c0b9e2d8c49af709d876455c9fd242925021c0d3aa61e5b68e1aa0a033cf693c` | |
| `src/core/sprite/model/defaults.ts` | `src/core/model/defaults.ts` | verbatim | `ea5c91d` | `4533c66242fab7e4312344752a421b8e3b27f967ed96693c2bc30e0cbb89975e` | |
| `src/core/sprite/model/ids.ts` | `src/core/model/ids.ts` | verbatim | `ea5c91d` | `d2048173b54881c59783b9d5c68ee2f3beeffe64db318a4d11feb893895e5f0b` | |
| `src/core/sprite/model/index.ts` | `src/core/model/index.ts` | verbatim | `ea5c91d` | `8f7cfb56bec8728df06e1cb2085d40fe16c017c91a6c7ef31312aaad6982017b` | |
| `src/core/sprite/model/invariants.ts` | `src/core/model/invariants.ts` | verbatim | `ea5c91d` | `685aa5db2462177f37bf38570186a6b1fb3d9da320a98532ad596dd00b0f3ca4` | |
| `src/core/sprite/model/limits.ts` | `src/core/model/limits.ts` | verbatim | `ea5c91d` | `c9b830952556d052cac41fb9f17d6221f2c2c89e83dc213ab065c9725039b4c5` | |
| `src/core/sprite/model/queries.ts` | `src/core/model/queries.ts` | verbatim | `ea5c91d` | `7d448563bfed8d318e4240385f5d64b991e410f0a600b21f37efb72e90efb872` | |
| `src/core/sprite/model/types.ts` | `src/core/model/types.ts` | verbatim | `ea5c91d` | `e33b8b6714ff342562c23b6b963add4207c91093455a40caa9130c46b31f96a8` | |
| `src/core/sprite/pixels/buffer.ts` | `src/core/pixels/buffer.ts` | verbatim | `ea5c91d` | `5ead4f2e13ad8249972242340bbbe8bfd3b71a4bcb5e075ca46cc0276807486d` | |
| `src/core/sprite/pixels/index.ts` | `src/core/pixels/index.ts` | verbatim | `ea5c91d` | `338af67efca2a31a448d4d14188df8ffcbdf4f57580d3ffb55b806d497b2c91f` | |
| `src/core/sprite/pixels/transform.ts` | `src/core/pixels/transform.ts` | verbatim | `ea5c91d` | `7ea0c96485aeccecf1f2a98d55adb84bc2d401d9d7d98e2519b214e700ebe9fd` | |
| `src/core/sprite/png/decode.ts` | `src/core/png/decode.ts` | verbatim | `ea5c91d` | `923b8353b8386415b72751d968f0c3c85030e14a6ff69bdfdf34f1f1af52d612` | |
| `src/core/sprite/png/encode.ts` | `src/core/png/encode.ts` | verbatim | `ea5c91d` | `d50020dd5c13da77885b651e66ce4af26e1f88c7e6fc60998cc1ac344dc1fb62` | |
| `src/core/sprite/png/errors.ts` | `src/core/png/errors.ts` | verbatim | `ea5c91d` | `ca62993364a90980ff960025b2c1e44f70acee4d178d6a329aecc6bcadddcdde` | |
| `src/core/sprite/png/index.ts` | `src/core/png/index.ts` | verbatim | `ea5c91d` | `4b4b9eaae82b94e5ebb1cf20b3d503737d9dd560793f9fec68ecd7d3e4a63a4d` | |
| `src/core/sprite/project/deserialize.ts` | `src/core/project/deserialize.ts` | verbatim | `ea5c91d` | `1470409d9327a147e83fd0fa18dbc105a1f970cb5dc9fef7cf0925ad82ca57cf` | |
| `src/core/sprite/project/docFromJson.ts` | `src/core/project/docFromJson.ts` | verbatim | `ea5c91d` | `1995c6b98feb8184a41518007e5e02c9f5c4a7d0805d94a94858453b471e6831` | |
| `src/core/sprite/project/errors.ts` | `src/core/project/errors.ts` | verbatim | `ea5c91d` | `0c38e297d087bf13acb2355cc1d5eca200e712fdd037e71d23c3de8a816558ba` | |
| `src/core/sprite/project/format.ts` | `src/core/project/format.ts` | verbatim | `ea5c91d` | `537f452144cdd86bc9af2f870ec08bbd6b13a7d9ad9ad9f4d5140ca60eecf9b2` | |
| `src/core/sprite/project/json.ts` | `src/core/project/json.ts` | verbatim | `ea5c91d` | `ffb6dfa988fa5062d550a72fa888287e0d090eed73691326228ad845e1b7ed95` | |
| `src/core/sprite/project/manifest.ts` | `src/core/project/manifest.ts` | verbatim | `ea5c91d` | `a086f3c5ea8852cc822fd3c449193977b7cdbdab2e4f9ebd2cc0744dc9e58771` | |
| `src/core/sprite/project/migrations.ts` | `src/core/project/migrations.ts` | verbatim | `ea5c91d` | `7d37d8e4b1a2ef789d878fd3cfe247eae42b4b7513a6543b9dbb2b05a402698c` | |
| `src/core/sprite/project/png.ts` | `src/core/project/png.ts` | verbatim | `ea5c91d` | `7458385e6136b6acd0ea7c0870b56ae825c3d1902f15840af2f5f973b9f3db21` | |
| `src/core/sprite/project/schema.ts` | `src/core/project/schema.ts` | verbatim | `ea5c91d` | `c4b697256a4d319d08e2bc4b644a65d0f4e9585633c6c8bf8c6ed445f23bf3bd` | |
| `src/core/sprite/project/zip.ts` | `src/core/project/zip.ts` | verbatim | `ea5c91d` | `c77aee663b3964e6e2012257dfb9f3fbacf3c685b30ea2c1e58c9fd090b1a7ad` | |
| `src/core/sprite/tags/commands.ts` | `src/core/tags/commands.ts` | verbatim | `ea5c91d` | `39432e0ea2f52efe72d10d9b37e0dc4709d1c1ce34aeff8d6991631c3a538b6f` | |
| `src/core/sprite/tags/errors.ts` | `src/core/tags/errors.ts` | verbatim | `ea5c91d` | `c170d18fa238b0a336594996415b8769df3506216b6b89bc553f1384c372bc62` | |
| `src/core/sprite/tags/follow.ts` | `src/core/tags/follow.ts` | verbatim | `ea5c91d` | `47cf22e4671f43122f3616efbc40720fd4318d7a8f13d41538be09e9dc32504a` | |
| `src/core/sprite/tags/index.ts` | `src/core/tags/index.ts` | verbatim | `ea5c91d` | `53cd62d1e8e1e5e8c601723b38f0bb7f67f20e70ee718c2e51c31d15fe779210` | |
| `src/core/sprite/tags/tagList.ts` | `src/core/tags/tagList.ts` | verbatim | `ea5c91d` | `2645ecaec4b30ada632365a047357c797a1ede9145dee5ebc18d7c1e91ddcdf6` | |
| `src/engine/testing/readCanvas.ts` | `src/engine/testing/readCanvas.ts` | verbatim | `ea5c91d` | `27de8812f006a47624b87f2095afcf25c353461832890a3afea774af1951f7f0` | |
| `src/engine/viewport/checker.ts` | `src/engine/viewport/checker.ts` | adapt | `ea5c91d` | | The image is one block of 16 × 16 squares (`ed:checker`, ENGINE §3) drawn as a grid of quads, not the whole document; `ViewportChecker` is defined here; adds `checkerBlock`, `checkerColourAt`, `checkerMean`; `checkerSpec` takes the checker alone |
| `src/import-meta.d.ts` | `src/import-meta.d.ts` | adapt | `ea5c91d` | | No `SERVICE_WORKER` flag until the PWA build defines it (TE-066) |
| `src/main.tsx` | `src/main.tsx` | adapt | `ea5c91d` | | Renders `App` in a root that sets `<html data-app-ready>` once committed; no service worker |
| `src/raw.d.ts` | `src/raw.d.ts` | verbatim | `ea5c91d` | `b35d4d2d9cf5cfd50c415c801c3f0e0ad000f4bb30009520db02368b12eec131` | |
| `src/ui/App.tsx` | `src/ui/App.tsx` | adapt | `ea5c91d` | | The WebGPU and window-size gates and the gallery route; test hooks and the keymap (TE-007); the surfaces (TE-008); the notices shown as toasts, as `FileWorkflows` shows them (TE-028); file workflows and the pixel-memory warning are left out |
| `src/ui/UiRoot.tsx` | `src/ui/UiRoot.tsx` | verbatim | `ea5c91d` | `9da0fc7bf55f880cd1e7769e0bf59ebbc80ef64f00315311bfb29b0d5f1b4e74` | |
| `src/ui/colour/ColourPicker.tsx` | `src/ui/colour/ColourPicker.tsx` | adapt | `ea5c91d` | | Edits one colour given by its caller (`value`, `onChange`) instead of the editor store's foreground and background, with either button as the sprite editor's `single` panel; the colour and its HSV live in a store of the panel's own, which follows `value`; `unset` reports the first edit even when it gives `value` (a colour of "None"); no `store` or `single` props (DESIGN §3.3) |
| `src/ui/colour/cancelContextMenu.ts` | `src/ui/colour/cancelContextMenu.ts` | verbatim | `ea5c91d` | `9c1041c45ee133476335ca53e92e1882d5ea79b3d6139c5a665466cc920242af` | |
| `src/ui/colour/colourPicker.css` | `src/ui/colour/colourPicker.css` | verbatim | `ea5c91d` | `99a9d989a8409246bfd017f3e104db21c144428e49d0740f6bf1fa5272af2cd6` | |
| `src/ui/colour/pickerEdits.ts` | `src/ui/colour/pickerEdits.ts` | adapt | `ea5c91d` | | Edits a `ColourStore` (the panel's colour 0xRRGGBBAA with its HSV, `PickerColour`) instead of a colour slot of the editor store: same functions without the `slot` parameter; `ColourStore` and `PickerColour` instead of `EditorStore` |
| `src/ui/colour/pickerMath.ts` | `src/ui/colour/pickerMath.ts` | adapt | `ea5c91d` | | No change: it imports only the `Hsv` type, which `core/color` exports as in the sprite editor |
| `src/ui/commandPalette/CommandPalette.tsx` | `src/ui/commandPalette/CommandPalette.tsx` | verbatim | `ea5c91d` | `0b28da9e42ce9e91c73f1b8a6d0873801cc319c4f921fde16a0d359871373723` | |
| `src/ui/commandPalette/CommandPaletteTrigger.tsx` | `src/ui/commandPalette/CommandPaletteTrigger.tsx` | verbatim | `ea5c91d` | `414b2165c6eac389f9797a4371f24e64171daf524c636262c1ca5b7f1c01b4f6` | |
| `src/ui/commandPalette/commandPalette.css` | `src/ui/commandPalette/commandPalette.css` | verbatim | `ea5c91d` | `c4cc79edc7940ebaa46b4424c69756ea1033cf1f01101c2559f73c785983da98` | |
| `src/ui/commands/Chord.tsx` | `src/ui/commands/Chord.tsx` | verbatim | `ea5c91d` | `4e74f7638162b047e17049c7b21c20900542365c11707aa892ca1695652b93c7` | |
| `src/ui/commands/chord.css` | `src/ui/commands/chord.css` | verbatim | `ea5c91d` | `c94a08c100868e5877de06530839692722ba17c41cf6eb21580213fbce21020d` | |
| `src/ui/commands/contextMenu.ts` | `src/ui/commands/contextMenu.ts` | adapt | `ea5c91d` | | No change: the adapted `appCommands` and `invoke` keep their exports |
| `src/ui/commands/runCommand.ts` | `src/ui/commands/runCommand.ts` | adapt | `ea5c91d` | | No change: the adapted `appCommands` and `invoke` keep their exports |
| `src/ui/commands/useCommands.ts` | `src/ui/commands/useCommands.ts` | adapt | `ea5c91d` | | No change: the adapted `appCommands` keeps its exports |
| `src/ui/commands/useEditorKeymap.ts` | `src/ui/commands/useEditorKeymap.ts` | adapt | `ea5c91d` | | No change: the adapted `appCommands` and `install` keep their exports |
| `src/ui/dialogs/DialogHost.tsx` | `src/ui/dialogs/DialogHost.tsx` | verbatim | `ea5c91d` | `d80f3e296fc4dce2ccb5dd09023ec782594b82a47e0e3bf1261e7055bb2c23df` | |
| `src/ui/dialogs/registry.ts` | `src/ui/dialogs/registry.ts` | adapt | `ea5c91d` | | Workflow-file references removed |
| `src/ui/dock/DockSection.tsx` | `src/ui/dock/DockSection.tsx` | verbatim | `ea5c91d` | `3e46144a531c70c4b70420d3d1276115ee7eab9665728c15d43ad7f2dadd6e25` | |
| `src/ui/dock/registry.ts` | `src/ui/dock/registry.ts` | adapt | `ea5c91d` | | Workflow-file references removed |
| `src/ui/focus/inertOutside.ts` | `src/ui/focus/inertOutside.ts` | verbatim | `ea5c91d` | `b6a211b7c790c44abf0cc688082b60da14552729402fcfea43c108fa60377b32` | |
| `src/ui/focus/menuOpener.ts` | `src/ui/focus/menuOpener.ts` | verbatim | `ea5c91d` | `b61a40a2721132e675858320c17f49c84f72947e52fd85fe3b7afda8c584f572` | |
| `src/ui/focus/modality.ts` | `src/ui/focus/modality.ts` | verbatim | `ea5c91d` | `6ac8166dda8f7ccca4277d23bc58b945e9393590c33eec26044835948ee50917` | |
| `src/ui/gallery/Gallery.tsx` | `src/ui/gallery/Gallery.tsx` | verbatim | `ea5c91d` | `085dec68931e95f663140458010ad08f9bb84a9ecfc29054462e7b1b06a43f2f` | |
| `src/ui/gallery/gallery.css` | `src/ui/gallery/gallery.css` | verbatim | `ea5c91d` | `b6aded6922dd700c06b8da53d87435cdc16537094512bf52d98458e2f23ff521` | |
| `src/ui/import/PixelCanvas.tsx` | `src/ui/import/PixelCanvas.tsx` | adapt | `ea5c91d` | | `PixelBuffer` from `core/codec`, which re-exports the `core/sprite` type (only `core/` imports `core/sprite`, DESIGN §3.1) |
| `src/ui/import/SourcePane.tsx` | `src/ui/import/SourcePane.tsx` | adapt | `ea5c91d` | | Grid overlay of the tileset import: the tiles of the form's tile size, margin and spacing as `core/tileset` cuts them (Tiled's grid, SPEC §6.1); no crop rectangle or pointer drawing; `PixelRect` local |
| `src/ui/import/import.css` | `src/ui/import/import.css` | adapt | `ea5c91d` | | The source pane's rules without the crop; the Import Tileset layout (source left, form right), atlas lists, text fields, warnings; no result pane or drop chooser |
| `src/ui/menubar/MenubarItems.tsx` | `src/ui/menubar/MenubarItems.tsx` | verbatim | `ea5c91d` | `2cd89ca6bc084dd4f26cfb91572643d87bf22167383aa1d4f8505df5bd1c9363` | |
| `src/ui/menubar/menubar.css` | `src/ui/menubar/menubar.css` | verbatim | `ea5c91d` | `402568c9b9500b5442d2ca215b0deeb78efba6671f8e46f135fd6974e6e970e6` | |
| `src/ui/platform/useWindowSize.ts` | `src/ui/platform/useWindowSize.ts` | verbatim | `ea5c91d` | `0d968743a68821e6aeac5cc7a2e3cef3943505b7be6b682134d7254833630f63` | |
| `src/ui/platform/webgpu.ts` | `src/ui/platform/webgpu.ts` | verbatim | `ea5c91d` | `63b6d488de30d8d14099ca7ce40a2d74772d806a125d1dc54052a85b2fa8bef1` | |
| `src/ui/preferences/PreferencesDialog.tsx` | `src/ui/preferences/PreferencesDialog.tsx` | adapt | `ea5c91d` | | Sections Theme, Checkerboard, Grid (Theme / Custom colour, opacity, swatch), Highlight current layer (opacity) and Autosave (DESIGN §3.3); no onion-skin or import sections |
| `src/ui/preferences/hexColour.ts` | `src/ui/preferences/hexColour.ts` | verbatim | `ea5c91d` | `7114bc877518563f9db0091f1fa1cb7511e1bbcf5b855b1a58f8c3258fb2b1a4` | |
| `src/ui/preferences/preferences.css` | `src/ui/preferences/preferences.css` | adapt | `ea5c91d` | | Adds `.preferences__swatch` and `.preferences__swatch-colour` for the grid colour preview; header comment cites DESIGN §9 |
| `src/ui/primitives/Button.tsx` | `src/ui/primitives/Button.tsx` | verbatim | `ea5c91d` | `94c7181e08d9b0a8f073280f147998cd74bdd29e86d8979be4558db0e337d105` | |
| `src/ui/primitives/ContextMenu.tsx` | `src/ui/primitives/ContextMenu.tsx` | verbatim | `ea5c91d` | `ba7a3d39cc4d379ad6157f5bd4074381e618cf2dd332d899be91bd01c7cee054` | |
| `src/ui/primitives/Dialog.tsx` | `src/ui/primitives/Dialog.tsx` | verbatim | `ea5c91d` | `9fd508dca089ce0cf8a1af005c5eb616293df0a0d503a300929f2d29070348a1` | |
| `src/ui/primitives/Icon.tsx` | `src/ui/primitives/Icon.tsx` | verbatim | `ea5c91d` | `f7c27316615e66a05c00270e3d6615b3b180aaab42f9a3b4ae3633998aa2357f` | |
| `src/ui/primitives/IconButton.tsx` | `src/ui/primitives/IconButton.tsx` | verbatim | `ea5c91d` | `b38c89ed66acddfd2aa9e131eb56239aca7ae542d12d9a46781bd72669db5e33` | |
| `src/ui/primitives/NumberField.tsx` | `src/ui/primitives/NumberField.tsx` | verbatim | `ea5c91d` | `6ee366248b2019e4ee39e217a5f24fb296a158835174bc0bf4598e00264e36e4` | |
| `src/ui/primitives/Popover.tsx` | `src/ui/primitives/Popover.tsx` | verbatim | `ea5c91d` | `e8769d39a6be68ddd10f7dd7d008012a89584cb1d30c6f9a98125548a53441b0` | |
| `src/ui/primitives/SegmentedControl.tsx` | `src/ui/primitives/SegmentedControl.tsx` | verbatim | `ea5c91d` | `e61cb8a91ec9ff70acdfec6585826e23e0cb4670e4481b0d1040a4fcc5edb325` | |
| `src/ui/primitives/Select.tsx` | `src/ui/primitives/Select.tsx` | verbatim | `ea5c91d` | `41c5e516455e64b941ca037b67410fa2773c57a927729b7a95dc0899b2c72bcf` | |
| `src/ui/primitives/Slider.tsx` | `src/ui/primitives/Slider.tsx` | verbatim | `ea5c91d` | `d3ce469e4f7bfd1a8028bd5fb5db1a992fe6efc5d756c94103d685ff09685a23` | |
| `src/ui/primitives/Splitter.tsx` | `src/ui/primitives/Splitter.tsx` | verbatim | `ea5c91d` | `fe56d4ea3ca80fd704372685939755b309f339397ac2aea6cd7da25d60631f3a` | |
| `src/ui/primitives/Toggle.tsx` | `src/ui/primitives/Toggle.tsx` | verbatim | `ea5c91d` | `71964da3c9b1c5cf714a3cb288f17a8ad32c2151fd60d09f34602efb16d9127a` | |
| `src/ui/primitives/ToolButton.tsx` | `src/ui/primitives/ToolButton.tsx` | verbatim | `ea5c91d` | `3f4695638f60c83d30da8a740f665a2c11226820f540270f63040999e1734803` | |
| `src/ui/primitives/Tooltip.tsx` | `src/ui/primitives/Tooltip.tsx` | verbatim | `ea5c91d` | `1efd8acbba3d945d79dc6df77197913670a8c743bfaeb5f5d3ddda66df92e2bf` | |
| `src/ui/primitives/button.css` | `src/ui/primitives/button.css` | verbatim | `ea5c91d` | `c0fc31e1d0d78205a93a5e29e18cdee606c2d526069c273d6592d028cd965005` | |
| `src/ui/primitives/cx.ts` | `src/ui/primitives/cx.ts` | verbatim | `ea5c91d` | `3ce0dd21751abb604d32f1f8fd9a336a49774f30dbc77e25af23095a5f51855a` | |
| `src/ui/primitives/dialog.css` | `src/ui/primitives/dialog.css` | verbatim | `ea5c91d` | `0c3243ab13549f14c74bfbc44b292a1d16348b96835814b9d00a6d9e81c55fba` | |
| `src/ui/primitives/field.css` | `src/ui/primitives/field.css` | verbatim | `ea5c91d` | `f45e33085ddb81249f75265e2d8e8c835f268a208af81abb858bb3ec2218b5d9` | |
| `src/ui/primitives/index.ts` | `src/ui/primitives/index.ts` | verbatim | `ea5c91d` | `831b294148cd5d492e3840958dec91ece88171ef5baf6e429d07da2d9cfd9207` | |
| `src/ui/primitives/menu.css` | `src/ui/primitives/menu.css` | verbatim | `ea5c91d` | `d3c2ae35ccc5c875fb10c375854e9157f2f4d86cc49fddacb47bc81b806657ec` | |
| `src/ui/primitives/numberMath.ts` | `src/ui/primitives/numberMath.ts` | verbatim | `ea5c91d` | `a0c2be7e59af3b5a20c26f3884f0834118d88bb607afe88f1f1fcc1eee3e0384` | |
| `src/ui/primitives/popover.css` | `src/ui/primitives/popover.css` | verbatim | `ea5c91d` | `cd3b0aa92827424d083cef85018e3dc43dd8a444527fee93badef930226a81e3` | |
| `src/ui/primitives/segmented.css` | `src/ui/primitives/segmented.css` | verbatim | `ea5c91d` | `ac1ea1139e3168fd4bb425a174596d2837e058567ba531d14e835fcb47debf9f` | |
| `src/ui/primitives/slider.css` | `src/ui/primitives/slider.css` | verbatim | `ea5c91d` | `ead0846ed348fa18abb706978d9a4cace5fddc84950f147e5f4f6bd5a4af5de5` | |
| `src/ui/primitives/splitter.css` | `src/ui/primitives/splitter.css` | verbatim | `ea5c91d` | `30d83973bf1d68795fb5d9bdaae723fcebe7a7a9d161aacc8f33e8d430ef7536` | |
| `src/ui/primitives/splitterMath.ts` | `src/ui/primitives/splitterMath.ts` | verbatim | `ea5c91d` | `1d96ac72cd69f2ead655db2d6e09a51427a5489a51e1034f36176ed814fec385` | |
| `src/ui/primitives/tooltip.css` | `src/ui/primitives/tooltip.css` | verbatim | `ea5c91d` | `52bef1c6e98304457ef16e054f81ecb1dbc72d0f5952ea258482785406071dec` | |
| `src/ui/shell/AppShell.tsx` | `src/ui/shell/AppShell.tsx` | adapt | `ea5c91d` | | Region `bottom-panel` ("Bottom panel", splitter "Resize bottom panel") in the timeline's slot and sizes, hidden by the bottom-panel store (Tab, TE-007); the rail's footer is the stamp preview (`STAMP_PREVIEW_SIZE`) |
| `src/ui/shell/RailFrame.tsx` | `src/ui/shell/RailFrame.tsx` | adapt | `ea5c91d` | | Column count from the groups of the tool set of the active layer's kind (`railToolSet`) and a `footer` prop (the stamp preview, TE-017) instead of the sprite tool registry and `RAIL.footer` |
| `src/ui/shell/RegionBoundary.tsx` | `src/ui/shell/RegionBoundary.tsx` | verbatim | `ea5c91d` | `c94eaf58d754b2ae325946afc92a024b46a71fab8ad155a8935dcc4fa3301eed` | |
| `src/ui/shell/layout.ts` | `src/ui/shell/layout.ts` | verbatim | `ea5c91d` | `3ac6fc4d0345c669786c6a2af179b251fa4ff1a686500597b62da5a5ad1c61ac` | |
| `src/ui/shell/layoutStore.ts` | `src/ui/shell/layoutStore.ts` | adapt | `ea5c91d` | | Storage key `ngne-tilemap-editor.layout` (SUITE §7) |
| `src/ui/shell/notices/WebGpuRequired.tsx` | `src/ui/shell/notices/WebGpuRequired.tsx` | adapt | `ea5c91d` | | Product name (SUITE §1) |
| `src/ui/shell/notices/WindowTooSmall.tsx` | `src/ui/shell/notices/WindowTooSmall.tsx` | verbatim | `ea5c91d` | `3a83708aa6a40a370af0f79d9afda9a2966acf7fa6e3df952d1364a552fb9311` | |
| `src/ui/shell/notices/notice.css` | `src/ui/shell/notices/notice.css` | verbatim | `ea5c91d` | `76af4099e674df54d8626c6f16e47b44a30f32d5b35823c41a20cae9a9600008` | |
| `src/ui/shell/regionBoundary.css` | `src/ui/shell/regionBoundary.css` | verbatim | `ea5c91d` | `d3a067d3f16a58dc4a46d342fe9daf5fdbdc2eb0664da85ba1965a112527a5a8` | |
| `src/ui/shell/regions/BottomPanel.tsx` | `src/ui/shell/regions/Timeline.tsx` | adapt | `ea5c91d` | | In the timeline's place: tabs Tilesets and Terrains (DESIGN §2), panels empty until TE-025 and TE-043 |
| `src/ui/shell/regions/ContextBar.tsx` | `src/ui/shell/regions/ContextBar.tsx` | adapt | `ea5c91d` | | Doc comments cite DESIGN §7; the tool's readouts after its options |
| `src/ui/shell/regions/Dock.tsx` | `src/ui/shell/regions/Dock.tsx` | verbatim | `ea5c91d` | `7a0847e2169df096d4dc2314ba82d4f77b0b9db27a0a5d5df1e04d0dc813fabe` | |
| `src/ui/shell/regions/MenuBar.tsx` | `src/ui/shell/regions/MenuBar.tsx` | adapt | `ea5c91d` | | `MapTabs` (TE-031) in place of `DocumentTabs` |
| `src/ui/shell/regions/StatusBar.tsx` | `src/ui/shell/regions/StatusBar.tsx` | adapt | `ea5c91d` | | Renders the fields of the `*.status.ts` registry (cell, tile, zoom with Fit, map size) and the tool hint or feedback on the right |
| `src/ui/shell/regions/ToolRail.tsx` | `src/ui/shell/regions/ToolRail.tsx` | adapt | `ea5c91d` | | The tool set of the active layer's kind (`railToolSet`, DESIGN §6); the stamp preview footer instead of the colour chips |
| `src/ui/shell/regions/Viewport.tsx` | `src/ui/shell/regions/Viewport.tsx` | adapt | `ea5c91d` | | Hosts the viewport canvas of the active map (TE-013); the empty state joins it later |
| `src/ui/shell/shell.css` | `src/ui/shell/shell.css` | adapt | `ea5c91d` | | Tool rail beside the bottom panel, which spans the viewport and dock columns (DESIGN §2); `shell-panel` classes and `--shell-panel-height` for the timeline's; bottom panel tab strip |
| `src/ui/shortcuts/ShortcutSheet.tsx` | `src/ui/shortcuts/ShortcutSheet.tsx` | verbatim | `ea5c91d` | `a76a9882845fd8434ef08519ea1db19748dd25b14d1c7f144f9fba7cd69db929` | |
| `src/ui/shortcuts/shortcuts.css` | `src/ui/shortcuts/shortcuts.css` | verbatim | `ea5c91d` | `4af0e022d12297df189fdb6ebb3283063b1538f538c497e75c3d69c641600a6d` | |
| `src/ui/status/status.css` | `src/ui/status/status.css` | adapt | `ea5c91d` |  | Widths reserved by the field (inline), not by CSS rules for the cursor field |
| `src/ui/styles/base.css` | `src/ui/styles/base.css` | verbatim | `ea5c91d` | `cb79b6d9a9383a0d114a3453f2fe19471ae3f657472d0f6d7186553ef92c8d87` | |
| `src/ui/styles/tokens.css` | `src/ui/styles/tokens.css` | verbatim | `ea5c91d` | `a8d0de7b7cefa647152a2a27811adfa1f8db544b9443201647ea132fc05b3917` | |
| `src/ui/surfaces/AppSurfaces.tsx` | `src/ui/surfaces/AppSurfaces.tsx` | verbatim | `ea5c91d` | `7e3cb942466f81c3e0e1cb6fc899b98b589347294b3f00c26cb5ee28b63ba079` | |
| `src/ui/tabs/MapTabs.tsx` | `src/ui/tabs/DocumentTabs.tsx` | adapt | `ea5c91d` | | Tabs of the open maps (`app/tabs/tabs.ts`); the project's name and unsaved marker before the first tab instead of a marker per tab; close without asking; overflow menu "All maps" |
| `src/ui/tabs/tabs.css` | `src/ui/tabs/tabs.css` | adapt | `ea5c91d` | | Class names `map-tabs`, `map-tab`; the project's name before the tabs in `--text-muted` |
| `src/ui/theme/theme.ts` | `src/ui/theme/theme.ts` | adapt | `ea5c91d` | | Storage key `ngne-tilemap-editor.theme` (SUITE §7) |
| `src/ui/toast/ToastViewport.tsx` | `src/ui/toast/ToastViewport.tsx` | verbatim | `ea5c91d` | `5afbf9241ea9e98bcde716d37b96cb649c7cd09b8846ce9c77b4e5b8ff3b151f` | |
| `src/ui/toast/toast.css` | `src/ui/toast/toast.css` | verbatim | `ea5c91d` | `3b72cd806b701adc7f137bda1d694bac53047e151db222432cfde10a1fbc824e` | |
| `src/ui/toast/toast.ts` | `src/ui/toast/toast.ts` | verbatim | `ea5c91d` | `35cdddcdfb41732710dea2c026a5c22c443c2b16fcf6a3fdb5701b594cce70e7` | |
| `src/ui/tools/VariantToolButton.tsx` | `src/ui/tools/VariantToolButton.tsx` | adapt | `ea5c91d` |  | No change: the adapted `app/tools/types.ts` keeps `RailSlot` and `Tool` |
| `src/ui/tools/contextBar.css` | `src/ui/tools/contextBar.css` | adapt | `ea5c91d` |  | Readout text (`.context-readout`) |
| `src/ui/tools/contextBarRegistry.ts` | `src/ui/tools/contextBarRegistry.ts` | adapt | `ea5c91d` | | Workflow-file references removed |
| `src/ui/tools/toolRail.css` | `src/ui/tools/toolRail.css` | adapt | `ea5c91d` |  | The stamp preview button (`.tool-rail__stamp`) |
| `src/ui/tools/useToolState.ts` | `src/ui/tools/useToolState.ts` | adapt | `ea5c91d` |  | No change: the adapted `app/tools/activeTool.ts` keeps `toolState` and `ToolState`, bound to this editor's active-tool store (per layer kind) |
| `tests/e2e/harness/te-001-smoke.html` | `tests/e2e/harness/smoke.html` | adapt | `ea5c91d` | | Title and script name |
| `tests/e2e/harness/te-001-smoke.ts` | `tests/e2e/harness/smoke.ts` | adapt | `ea5c91d` | | Ticket ID in the comment; both far edges of the rect read; status read before the renderer is disposed |
| `tests/e2e/harness/te-003-boundary.html` | `tests/e2e/harness/se-006-boundary.html` | adapt | `ea5c91d` | | Ticket name |
| `tests/e2e/harness/te-003-boundary.tsx` | `tests/e2e/harness/se-006-boundary.tsx` | adapt | `ea5c91d` | | Ticket name; `window.te003Repaired` declared |
| `tests/e2e/harness/te-007-chords.html` | `tests/e2e/harness/se-007-keymap.html` | adapt | `ea5c91d` | | Ticket name |
| `tests/e2e/harness/te-007-chords.tsx` | `tests/e2e/harness/se-007-keymap.tsx` | adapt | `ea5c91d` | | Probes of DESIGN §10.3 with the layer-kind and marker-selection conditions; a bottom-panel cell instead of a timeline cell; `?probe` mode for the owner check lists the chords received |
| `tests/e2e/harness/te-007-design-keys.ts` | `tests/e2e/se-007-spec-keys.ts` | adapt | `ea5c91d` | | Parses the Key / Context / Action / Source table of DESIGN §10.3: this editor's contexts, the layer-kind and marker-selection conditions, digit ranges, `[ ]`; pure, for the browser |
| `tests/e2e/support/wait.ts` | `tests/e2e/se-006-support.ts`, `se-012-support.ts`, `se-022-support.ts` | adapt | `ea5c91d` | | `openShell` → `openApp` on `data-app-ready`; `afterFrames` as is; `framesSubmitted` and `stableSize` added |
| `tests/e2e/te-001-smoke.spec.ts` | `tests/e2e/se-001-smoke.spec.ts` | adapt | `ea5c91d` | | App start on `data-app-ready`, title and the shell's seven regions in `#root`; engine version 0.3.0; TE-001 harness and both far edges |
| `tests/e2e/te-003-boundary.spec.ts` | `tests/e2e/se-006-boundary.spec.ts` | adapt | `ea5c91d` | | This shell's regions; the bottom panel, the Maps section and the dock splitter checked in place of the timeline, palette, tool rail and empty state |
| `tests/e2e/te-003-notices.spec.ts` | `tests/e2e/se-006-notices.spec.ts` | adapt | `ea5c91d` | | Product name checked; the Maps section for the kept state; no fixed-time waits |
| `tests/e2e/te-003-support.ts` | `tests/e2e/se-006-support.ts` | adapt | `ea5c91d` | | This shell's regions; waits through `openApp`; axe helper for serious and critical violations; only the helpers TE-003 uses |
| `tests/e2e/te-007-chords.spec.ts` | `tests/e2e/se-007-keymap.spec.ts` | adapt | `ea5c91d` | | DESIGN §10.3 table; the bottom panel for the `panel` context; gesture and marker cases; `[`, `]` keys |
| `tests/e2e/te-007-design-keys.ts` | `tests/e2e/se-007-spec-keys.ts` | adapt | `ea5c91d` | | Reads docs/DESIGN.md for the parser in `harness/te-007-design-keys.ts` |
| `tests/e2e/te-007-focus.spec.ts` | `tests/e2e/se-007-focus.spec.ts` | adapt | `ea5c91d` | | Bottom panel among the regions with controls; the Tab toggle of the bottom panel added |
| `tests/e2e/te-007-menus.spec.ts` | `tests/e2e/se-007-menus.spec.ts` | adapt | `ea5c91d` | | DESIGN §5 menus and items checked in full; Hide Bottom Panel from the menu; no planned-item takeover or late-close cases |
| `tests/e2e/te-007-support.ts` | `tests/e2e/se-007-support.ts` | adapt | `ea5c91d` | | One project per window: `rename` runs on the app's history, no `openSession`; `addViewportFocus`, `settleTimers` |
| `tests/e2e/te-007-undo.spec.ts` | `tests/e2e/se-007-undo.spec.ts` | adapt | `ea5c91d` | | On the app's project; a transaction on a tile layer of a map |
| `tests/e2e/te-008-palette.spec.ts` | `tests/e2e/se-064-command-palette.spec.ts` | adapt | `ea5c91d` | | This editor's commands (`file.newProject` first, Undo on the app's project); probes `te008.*`; no document or New Sprite cases |
| `tests/e2e/te-008-preferences.spec.ts` | `tests/e2e/se-064-preferences.spec.ts` | adapt | `ea5c91d` | | This editor's sections (Theme, Checkerboard, Grid, Highlight current layer, Autosave) and the grid swatch; the view preferences of SPEC §3 added |
| `tests/e2e/te-008-sheet.spec.ts` | `tests/e2e/se-064-shortcut-sheet.spec.ts` | adapt | `ea5c91d` | | DESIGN §5 menus; probes `te008.*`; Preferences stands in for the New Sprite dialog |
| `tests/e2e/te-008-support.ts` | `tests/e2e/se-064-support.ts`, `se-008-support.ts` | adapt | `ea5c91d` | | This editor's keys (SUITE §7); `field`, `setNumber`, `dialogButton` from se-008-support; no `spyOnCommands`, themes or audit |
| `tests/perf/README.md` | `tests/perf/README.md` | adapt | `ea5c91d` | | Running rules only; records under `docs/evidence/`; budgets live in ENGINE §6 and SPEC §14 |
| `tests/perf/record.ts` | `tests/perf/record.ts` | adapt | `ea5c91d` | | Records under `docs/evidence/`; references to this repo's docs and ids |
| `tests/unit/te-001-dependencies.test.ts` | `tests/unit/se-001-dependencies.test.ts` | adapt | `ea5c91d` | | Compares with the SUITE §5 tables and the lockfile |
| `tests/unit/te-001-layers.test.ts` | `tests/unit/se-001-lint-boundaries.test.ts` | adapt | `ea5c91d` | | RULES 4 cases; the same code passes in `src/engine` |
| `tests/unit/te-002-fixtures/golden-v1.ngsprite.d/` | `tests/unit/se-040-fixtures/golden-v1.ngsprite` | verbatim | `ea5c91d` | `9e1e15076393d05f99322dfdd866133d191fe6e0cca3cdefd0b710b55ee05044` | Stored unpacked; `tests/support/ngsprite.ts` packs it into these bytes |
| `tests/unit/te-003-tokens.test.ts` | `tests/unit/se-006-tokens.test.ts` | adapt | `ea5c91d` | | Colour table of `se-design` §3.1 written out (DESIGN §1 inherits it unrepeated); SUITE §2 dark values |
| `tests/unit/te-006-history.test.ts` | `tests/unit/se-004-history.test.ts` | adapt | `ea5c91d` | | Project session and cell patches instead of a document and pixel patches; map of each entry, verifier, composite and `mergeTouched` cases added |
| `tests/unit/te-006-support.ts` | `tests/unit/se-004-support.ts` | adapt | `ea5c91d` | | Session with one map, one tile layer and one tileset; `paintRect` writes cells; allocators return `ArrayBuffer` |
| `tests/unit/te-006-transaction.test.ts` | `tests/unit/se-004-transaction.test.ts` | adapt | `ea5c91d` | | Cell writes on a tile layer instead of pixels on a cel image: 12 bytes a changed cell, no clip mask or cel creation; invariant-breaking commit and `cellPatchCommand` cases added |
| `tests/unit/te-007-resolve.test.ts` | `tests/unit/se-007-keymap.test.ts` | adapt | `ea5c91d` | | Contexts `markers` and `panel` of DESIGN §10.1; every † chord of DESIGN §10.3 in the text context; `PANEL_SELECTOR` |
| `tests/unit/te-008-commands.test.ts` | `tests/unit/se-064-commands.test.ts`, `se-064-palette.test.ts`, `se-064-shortcut-sheet.test.ts` | adapt | `ea5c91d` | | DESIGN §10.3 chords checked on the registry (no key-table parser); `inPanel` and `markers`; the palette and sheet models over the app's registry only |
| `tests/unit/te-008-preferences.test.ts` | `tests/unit/se-064-preferences.test.ts` | adapt | `ea5c91d` | | This editor's fields, ranges and defaults; corrupt and older records; the view preferences of SPEC §3 |
| `tsconfig.json` | `tsconfig.json` | verbatim | `ea5c91d` | `4dd0bfb34ca25b40ad4fc39e95876e50fad6ebdced165919618156742e15081e` | |
| `tsconfig.node.json` | `tsconfig.node.json` | adapt | `ea5c91d` | | `src/gifenc.d.ts` dropped |
| `vite.config.ts` | `vite.config.ts` | adapt | `ea5c91d` | | Ports 5183/4183 (strict); PWA plugin, manifest, file handler and theme colour are TE-066's; base path from the deploy build |
| `vitest.config.ts` | `vitest.config.ts` | verbatim | `ea5c91d` | `4a41581bc1a038dec83a21477c0a1288d693602ee3001af4327f3d08bad5fea4` | |
| `vitest.perf.config.ts` | `vitest.perf.config.ts` | verbatim | `ea5c91d` | `09675eb8bb88964f2e553c15966b99ced61c8910e3363731e977aa05d1955c9c` | |
