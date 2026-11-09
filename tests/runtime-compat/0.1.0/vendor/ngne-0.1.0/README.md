![NGNE — TypeScript sprite engine](docs/assets/ngne.svg)

A TypeScript engine for 2D sprite games. Fixed-step simulation, scene-owned ECS worlds and instanced WebGPU rendering. **Zero runtime dependencies.**

[Play Starfall '89](https://that-webdev-dude.github.io/ngne/) · [Engine guide](docs/guide.md) · [First scene](https://that-webdev-dude.github.io/ngne/examples/hello/) · [MIT license](LICENSE)

![Starfall '89 gameplay](docs/assets/starfall.png)

**Early release · 0.1.0.** The engine exports independently from the showcase. Its API may change as more games exercise it. Hello, Starfall and the platformer require WebGPU with hardware acceleration on a secure origin (localhost or HTTPS). The initial desktop support envelope is Chrome 152 on Windows 11 with Intel UHD (`gen-12lp`) or NVIDIA RTX 4060 Laptop graphics and keyboard/mouse input. Other browsers, operating systems, GPUs and physical touch/gamepad operation remain unverified.

## Run locally

Use Node.js 24 or newer.

```sh
git clone https://github.com/that-webdev-dude/ngne.git
cd ngne
npm ci
npm run dev
```

Open the URL printed by Vite. Select **Start Flight** for a three-minute survival run. Open `/examples/hello/` for the minimal engine example or `/examples/platformer/` for the [two-level platformer](examples/platformer/README.md).

| Control                            | Action                              |
| ---------------------------------- | ----------------------------------- |
| WASD / arrows / gamepad left stick | Move                                |
| Hold mouse / gamepad right stick   | Aim manually; otherwise auto-target |
| Space / gamepad A                  | Nova blast, 15-second recharge      |
| P / Escape / gamepad Start         | Pause                               |
| M                                  | Toggle sound                        |

Small screens offer touch controls. **Chaos Lab** adds 6,000 persistent particles and invulnerability for stress testing. Scores persist across scenes within the running game and reset on reload.

## Build a game

Create components, spawn entities during scene setup, register update systems and prepare draw commands. NGNE owns the fixed-step loop and scene cleanup.

```ts
import { component, f64, type SceneDefinition } from "ngne";

const Position = component("position", { x: f64(40), y: f64(100) });

const scene: SceneDefinition = {
    id: "hello",
    setup(scene) {
        scene.world.spawn(Position.of());
        const points = scene.world.query(Position);
        scene.system(({ dt }) => {
            points.eachChunk((chunk) => {
                const position = chunk.views.position;
                for (let row = 0; row < chunk.count; row++) position.x[row] += 40 * dt;
            });
        });
        scene.render((frame) => {
            points.eachChunk((chunk) => {
                const position = chunk.views.position;
                for (let row = 0; row < chunk.count; row++)
                    frame.rect(position.x[row], position.y[row], 16, 16, 0x83e8e1);
            });
        });
    },
};
```

Positions are sprite centers in logical pixels; `dt` is seconds. See the [runnable first scene](examples/hello/main.ts) for browser startup and smooth interpolation, then the [engine guide](docs/guide.md) for lifecycle, committed state, resources, interpolation, assets, audio and diagnostics. The [implementation contract](docs/contracts/NGNE.md) defines exact semantics.

NGNE is not published to npm. Build this checkout to obtain ESM modules and declarations in `dist/engine/`; the entry point is `dist/engine/index.js`. The demo and hello example consume that same package entry point, and the build checks forbidden API usage against the emitted declarations.

`npm run build:package` builds only the library with clean emission. For a fresh
tarball, isolated installation, declaration check and root/nested fixture builds, use
`npm run prepare:package`. See [tooling commands and evidence](tooling/README.md)
for output selection and verified manifest reuse.

`npm run verify:installed` prepares and verifies the engine-only fixture against
the installed package at root and nested URL bases. It needs Chrome/WebGPU and no
consumer checkout or snapshot. See [installed verification](tooling/README.md#installed-engine-verification)
for prerequisites and evidence limits.

## Verify

```sh
npm run format:check
npm test
npm run typecheck
npm run build
npm run preview
```

`npm run format` applies Prettier; `.editorconfig` and `.gitattributes` keep 4-space indentation and LF line endings on every platform.

During development, `/validation.html` exercises real WebGPU pixels, batching, controlled device loss, image readiness and browser lifecycle. `npm run build:browser && npm run test:browser` builds and serves a separate browser-test artifact, drives those assertions plus both games' launch/pause/resume paths in Chromium, and writes machine-readable results under `.test-output/browser/`. CI selects SwiftShader, so executed assertions are software WebGPU evidence, not hardware evidence; the deployed `dist/` remains separate.

For hardware verification, set `NGNE_BROWSER_HEADLESS=0` and `NGNE_EXPECT_GPU_VENDOR=intel` or `nvidia`; a different or fallback adapter fails the run. On Windows, `NGNE_FORCE_HIGH_PERFORMANCE_GPU=1` requests Chrome's discrete GPU. Results record the browser version, launch flags and devices used for GPU submissions and canvas configuration. Use `NGNE_BROWSER_ARTIFACT_DIR` to retain separate runs. Physical controls, audible output and normal background-tab behavior still require manual checks; the automated harness emulates focus and disables background throttling.

Consumer acceptance is explicitly selected with
`npm run verify:compatibility -- --consumer <checkout> --revision <full-commit>`.
It requires a conforming consumer-owned command and validates its pinned source,
selected package and returned evidence. See [compatibility usage](tooling/README.md#consumer-evidence-and-legacy-fixtures).
Ordinary verification and CI require no consumer. `test:installed` is an alias
for engine-only `verify:installed`; `bench:content -- --explore` is an alias
for the [engine resource workload](tooling/suites/benchmarks/content/README.md).
Historical consumer results remain under [evidence](docs/evidence/README.md).

The browser and content runners share internal DevTools request ownership. A request
has a finite deadline and is never replayed; timeout does not cancel browser work.
Disconnect or explicit close rejects pending and subsequent requests immediately.
Only navigation-context protocol errors are retried during readiness polling.

Results are finalized after socket, owned process-tree and temporary-profile cleanup.
Shutdown escalates from termination to forced termination and verifies exit; Windows
uses captured process identities and Linux uses the runner's detached process group.
Cleanup continues after individual failures. Results retain the original validation,
diagnostic and cleanup errors, including the affected resource and surviving PID
when available. Any cleanup failure fails the run, even if assertions passed.
`results.json` includes per-resource cleanup evidence. Controlled CI checks use
`NGNE_BROWSER_INJECT_FAILURE`, `NGNE_BROWSER_INJECT_SCREENSHOT_FAILURE` and
`NGNE_BROWSER_INJECT_CLEANUP_FAILURE`; the last injects a failure after actual
resource release, without deliberately leaking a process.

Benchmark implementations live under `tooling/suites/benchmarks/`; see [benchmark commands and evidence](benchmarks/README.md). `npm run bench` measures CPU workloads, not GPU time or universal frame-rate guarantees. `npx tsx benchmarks/browser/browser-baseline.ts` drives sustained game runs in visible Chromium. For the fixed WebGPU renderer workload, first run `npm run build:browser`, then run the same baseline command with `NGNE_URL=http://127.0.0.1:4173/benchmarks/browser/index.html?workload=renderer-webgpu`, `NGNE_SERVE_DIR=.`, and `NGNE_SERVE_OUT_DIR=dist-browser`. The renderer fixture records CPU preparation and submission only; it does not wait for GPU completion. Browser benchmark pages must remain visible because hidden pages throttle `requestAnimationFrame`.

GitHub Actions runs the format check, tests, typechecking, production build and software-WebGPU browser integration on pull requests and pushes to `main`. It reports passed and unsupported assertions separately and uploads JSON, browser logs and failure screenshots. Successful main builds deploy the showcase to GitHub Pages only after all verification passes.

## Documentation

| Document                                          | Purpose                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| [Engine guide](docs/guide.md)                     | Authoring examples and lifecycle rules                           |
| [Architecture](docs/architecture.md)              | Authoritative ownership, runtime model and required capabilities |
| [Implementation contract](docs/contracts/NGNE.md) | Precise API and runtime semantics                                |
| [Showcase design](demo/DESIGN.md)                 | Starfall '89 art direction                                       |
| [Platformer](examples/platformer/README.md)       | Controls and demonstrated capabilities                           |

## Contribute

Change `src/` for the engine, `demo/` for Starfall and `tests/` for regression coverage. Run the checks above; use browser validation for rendering or browser lifecycle changes. Update the owning document (contract for semantics, guide for usage) when behavior changes. Keep fixes small and report reproduction steps in issues.

## License

[MIT](LICENSE), including the engine and original showcase assets.
