# NGNE Tilemap Editor

A desktop browser editor for orthogonal tile maps, rendered with the NGNE WebGPU engine. Build
tilesets from grid PNGs, sprite-editor projects and atlases; paint tile layers with stamps, fills
and terrain brushes; mark per-tile collision, animation and properties; place markers for spawns
and zones; and export a folder that an NGNE game loads with the generated `ngne-tilemap.ts`,
without editor code. Tiled maps (`.tmj`, `.tsj`, `.tsx`) import with a report. Projects save
locally as `.ngtilemap` files; the production build installs as a PWA and works offline. It is
the second tool of the NGNE editor suite, after the NGNE Sprite Editor.

## Requirements

- Desktop Chrome or Edge, current stable, with WebGPU and hardware acceleration enabled.
- A secure origin: HTTPS or localhost. Other browsers are unverified.
- A window of at least 1280 × 720 CSS pixels.
- Node.js ≥ 24 and npm for development, builds and tests.

## Install, build and test

From the repository root, on a clean checkout:

<!-- readme-commands:start -->

```sh
npm ci --ignore-scripts
npm run build
npm test
```

<!-- readme-commands:end -->

The CI job `readme-commands` extracts these three lines and runs each verbatim on a clean
Ubuntu runner with Node 24. Install scripts are skipped, as in every CI job. `npm test` runs the Node unit
suite, including the documentation link check and a compile of the user guide's game example.

## Run

`npm run dev` starts the development server on port 5183; open the localhost URL it prints.
`npm run build` creates `dist/`, and `npm run preview` serves that production build on port
4183, with its service worker and web manifest. The ports differ from the sprite editor's
(5173, 4173) so the two apps' service workers stay apart when both run locally, and the
development server registers no service worker.

## Verification

`npm run check` runs typecheck, lint, formatting, unit tests and the production build. The E2E
suite (`npx playwright test`) uses installed Chrome (`channel: "chrome"`); see
[tests/e2e/README.md](tests/e2e/README.md). On Ubuntu, CI installs:

```sh
sudo apt-get update
sudo apt-get install -y libvulkan1 mesa-vulkan-drivers xvfb xauth
```

Run the complete suite as CI does, with `CI=1` and headed Chrome under xvfb (SwiftShader):

```sh
CI=1 E2E_HEADLESS=0 xvfb-run -a -s "-screen 0 4096x2304x24" npx playwright test
```

CI splits the suite into four shards of the `parallel` project and one job for `alone`, and
repeats the golden path ten times in a job of its own. Frame and time budgets are **reported, not
asserted, under CI**; image content and other correctness checks remain assertions. Budgets are
enforced on reference hardware ([ENGINE.md](docs/ENGINE.md#6-budgets-and-spikes)). Benchmarks are
separate from `npm run check`; see [tests/perf/README.md](tests/perf/README.md).

`npm run compat` compiles the generated runtime in a game against each NGNE version games use
(`ngne` 0.1.0, `@ngne/core` 0.2.2 and 0.3.0); `npm run compat -- latest` checks the newest
published `@ngne/core`, as the weekly Runtime latest workflow does
([SPEC §11.4](docs/SPEC.md#114-compatibility)).

## Accessibility

The viewport is a pointer surface and is not operable by screen reader. Everything else is
keyboard and screen-reader operable: every command is in a menu or the command palette (Ctrl+K),
F6 / Shift+F6 cycle regions, the Maps list, Layers tree and Tilesets grid are one tab stop each
with arrow keys, and controls show keyboard focus.

## Documentation

- [User guide](docs/GUIDE.md): projects, tilesets, painting, terrain, layers, markers,
  properties, export, using `ngne-tilemap.ts` in a game, Tiled import.
- [File formats](docs/FORMAT.md): `.ngtilemap` v1, `ngne-tilemap` v1 and the export folder,
  frozen from release 1.0.0; any format change needs a new version number and a migration.
- [Specification](docs/SPEC.md) and [interface design](docs/DESIGN.md): behaviour,
  architecture, menus and keys.
- [Engine integration](docs/ENGINE.md): budgets, measurements and the NGNE engine gaps.
- [Changelog](CHANGELOG.md): features and known limitations.
- [Docs index](docs/README.md).

## Release and deployment

The GitHub Pages workflow (`.github/workflows/deploy.yml`) builds with
`vite build --base=/ngne-tilemap-editor/` and deploys on a pushed `v*` tag or a manual run;
branch pushes do not deploy. The owner tags and deploys.

## Licence

Licensed under [MIT](LICENSE). Code derived from libtiled (BSD 2-clause), Alois Zingl's
Bresenham algorithms (MIT), Aseprite's document library (MIT), pixman (MIT) and Tiled's
qjsonparser is listed with its notices in [third-party notices](THIRD_PARTY_NOTICES.md). The
build writes `licences.txt` beside `index.html`: this project's licence, those notices, the
licence of every npm package the build bundles and the licence of rolldown, the bundler. The
app shows it in a dialog (View → Open Source Licences…), offline too. The build fails when a
bundled package is not a runtime dependency, has no licence text or has a licence other than
MIT, ISC, 0BSD, BSD-2-Clause, BSD-3-Clause or Apache-2.0. This project is not affiliated with
or endorsed by Tiled or Thorbjørn Lindeijer, nor by Aseprite or Igara Studio S.A.

The `ngne-tilemap.ts` that an export writes is under
[MIT-0](https://spdx.org/licenses/MIT-0.html) (`SPDX-License-Identifier: MIT-0` in its header):
a game that ships it needs no licence notice for it.

### Earlier versions of some files

Before their current versions, the files listed below followed the source of Tiled's editor
(<https://github.com/mapeditor/tiled>), which is GPL-2.0-or-later. Every earlier version of
them in this repository's history is available under GPL-2.0-or-later
([LICENSES/GPL-2.0-or-later.txt](LICENSES/GPL-2.0-or-later.txt)), not MIT;
`git log --follow -- <file>` lists them.

Each Tiled file below, with the copyright lines of its header, and the files here that followed
it:

- `src/tiled/wangfiller.cpp` (2017 Benjamin Trotter; 2020–2023 Thorbjørn Lindeijer; 2023
  a-morphous): `src/core/terrain/filler.ts`.
- `src/tiled/wangbrush.cpp` (2017 Benjamin Trotter; 2020 Thorbjørn Lindeijer):
  `src/core/terrain/brush.ts`, `src/core/terrain/pick.ts`.
- `src/tiled/geometry.cpp` (2010–2011 Stefan Beller; 2017 Benjamin Trotter; 2020 Zingl Alois;
  2017–2023 Thorbjørn Lindeijer): `src/core/raster/line.ts`, `src/core/raster/ellipse.ts`,
  `ellipseRegion` in `src/core/fill/region.ts`, the reference ellipse in
  `tests/unit/te-019-fill.test.ts` and `tests/e2e/te-017-tiled-golden.py` (since removed).
- `src/tiled/tilepainter.cpp` (2009–2011 Thorbjørn Lindeijer; 2009 Jeff Bland):
  `src/core/fill/flood.ts`.
- `src/tiled/shapefilltool.cpp` (2017 Benjamin Trotter): `shapeArea` in
  `src/app/tools/fill/shapeFill.tools.ts`.
- `src/tiled/stampbrush.cpp` (2009–2010 Thorbjørn Lindeijer; 2010 Stefan Beller):
  `tests/e2e/te-017-tiled-golden.py`.

Parts of those earlier versions derived from libtiled (BSD 2-clause) and Zingl's Bresenham
code (MIT) remain under their own licences, with
their notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The current `line.ts`, `filler.ts`, `brush.ts`, `pick.ts` (with `candidates.ts`) and
`shapeArea` were rewritten from this project's specification, its tests and Tiled's user
manual. They reproduce Tiled's behaviour; no code in them was translated from Tiled's source or
from the earlier versions, whose public interfaces they keep. The
current `ellipse.ts`, `ellipseRegion` and the reference ellipse in `te-019-fill.test.ts` follow
Zingl's Bresenham code (MIT), and the current `flood.ts` is an independent design.
