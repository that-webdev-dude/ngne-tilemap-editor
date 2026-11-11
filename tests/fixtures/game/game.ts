import { BrowserGame, imageAsset } from "@ngne/core";
import type { FrameScheduler, PreparedScene, SceneDefinition, Stats } from "@ngne/core";
// Types only: the generated `ngne-tilemap.ts` is this source with its tables (SPEC §11).
import type {
    DrawOptions,
    Tilemap,
    TilemapLayer,
    assetsFor,
    drawTilemap,
    loadTilemap,
} from "../../../src/core/runtime/runtime";

// TE-055: the fixture NGNE game of SPEC §10.3 (`@ngne/core` 0.3.0, or the newest release in the
// weekly `latest` job, SPEC §11.4). A game as a user of an export writes it: it loads a map
// with the exported `ngne-tilemap.ts`, lists its textures with `assetsFor`, and draws it with
// `drawTilemap` in `scene.render`, with the scene camera's `pixelSnap` on. It uses nothing but
// `@ngne/core` and what the generated module exports.
//
// The conformance page (tests/e2e/harness/te-055-game.ts) draws one frame at a time and reads the
// canvas back in `afterFrame`; the runtime budget page (tests/perf/harness/te-055-runtime.ts)
// runs it on `requestAnimationFrame` with tile animations, a pan and a stacked HUD scene.

/** What the game uses of a generated `ngne-tilemap.ts`. */
export interface TilemapRuntime {
    loadTilemap: typeof loadTilemap;
    assetsFor: typeof assetsFor;
    drawTilemap: typeof drawTilemap;
}

/** What the scene shows. The host changes it between two frames of the game. */
export interface Stage {
    /** Top-left corner of the view, in world units (map pixels × `scale`). */
    camera: { x: number; y: number };
    /** World units per map pixel. */
    scale: number;
    /** Which layers to draw; the visible ones when null. */
    layers: ((layer: TilemapLayer, index: number) => boolean) | null;
    /** Pan of the camera per second of game time, in world units. */
    pan: { x: number; y: number };
    /** The scene's clock, in milliseconds; it runs only while `animate` is on. */
    elapsedMs: number;
    animate: boolean;
    /** Ticks the scene's system has run. */
    ticks: number;
    /** `pixelSnap` of the scene's camera at the last render. */
    pixelSnap: boolean | null;
    /** What `drawTilemap` reported. */
    reports: string[];
}

export interface TilemapGameOptions {
    canvas: HTMLCanvasElement;
    /** Logical size of the game: its canvas's backing size, and the view in world units. */
    width: number;
    height: number;
    /** Clear colour, 0xRRGGBB. */
    clear: number;
    runtime: TilemapRuntime;
    /** The map to load, by export name. */
    map: string;
    /** Sprites of a HUD scene pushed above the map scene; none when 0 or left out. */
    hud?: number;
    /** Seconds per tick; NGNE's default (1/60) when left out. */
    dt?: number;
    /** Most ticks in one frame; NGNE's default (5) when left out. */
    maxTicks?: number;
    /** Runs the frames; `requestAnimationFrame` when left out. */
    scheduler?: FrameScheduler;
    diagnostic: (error: unknown) => void;
    afterFrame?: (stats: Readonly<Stats>) => void;
}

export interface TilemapGame {
    app: BrowserGame<Record<string, never>, never>;
    stage: Stage;
    /** The tilemap, once `start` has loaded it. */
    tilemap(): Tilemap;
    /**
     * Puts the camera's top-left corner on (`x`, `y`) at once, with no interpolation from where
     * it was. NGNE reads the scene camera before `scene.render`, so the host moves it between
     * frames, not in one.
     */
    moveCamera(x: number, y: number): void;
    /** Loads the map and its textures, mounts the scene (and the HUD) and starts the loop. */
    start(): Promise<void>;
}

/** The HUD: `count` small sprites in rows along the top of the view, above the map. */
function hudScene(count: number, width: number): SceneDefinition<Record<string, never>, never> {
    return {
        id: "ngne-tilemap-hud",
        blocksUpdateBelow: false,
        setup(scene) {
            scene.render((frame) => {
                const perRow = Math.max(1, Math.floor((width - 8) / 10));
                for (let i = 0; i < count; i += 1) {
                    frame.sprite({
                        x: scene.camera.x + 4 + (i % perRow) * 10 + 4,
                        y: scene.camera.y + 4 + Math.floor(i / perRow) * 10 + 4,
                        width: 8,
                        height: 8,
                        color: 0xffd040,
                        alpha: 0.9,
                        layer: 1,
                    });
                }
            });
        },
    };
}

export function createTilemapGame(options: TilemapGameOptions): TilemapGame {
    const { runtime, width, height } = options;
    const stage: Stage = {
        camera: { x: 0, y: 0 },
        scale: 1,
        layers: null,
        pan: { x: 0, y: 0 },
        elapsedMs: 0,
        animate: false,
        ticks: 0,
        pixelSnap: null,
        reports: [],
    };
    let loaded: Tilemap | null = null;
    let sceneCamera: { cut(x?: number, y?: number): void } | null = null;

    const scene = (tilemap: Tilemap): SceneDefinition<Record<string, never>, never> => ({
        id: "ngne-tilemap-map",
        // NGNE loads every texture before the scene is mounted; `drawTilemap` names them by
        // the asset IDs `assetsFor` gave them.
        assets: runtime.assetsFor(tilemap, imageAsset),
        setup(scene) {
            scene.camera.pixelSnap = true;
            scene.camera.cut(stage.camera.x, stage.camera.y);
            scene.system(({ dt }) => {
                stage.ticks += 1;
                if (stage.animate) stage.elapsedMs += dt * 1000;
                stage.camera.x += stage.pan.x * dt;
                stage.camera.y += stage.pan.y * dt;
                scene.camera.x = stage.camera.x;
                scene.camera.y = stage.camera.y;
            });
            const draw: { -readonly [K in keyof DrawOptions]: DrawOptions[K] } = {
                elapsedMs: 0,
                viewWidth: width,
                viewHeight: height,
                assets: scene.assets,
                report: (message) => stage.reports.push(message),
            };
            sceneCamera = scene.camera;
            scene.render((frame) => {
                stage.pixelSnap = scene.camera.pixelSnap;
                draw.elapsedMs = stage.elapsedMs;
                draw.scale = stage.scale;
                if (stage.layers) draw.layers = stage.layers;
                else delete draw.layers;
                runtime.drawTilemap(frame, tilemap, scene.camera, draw);
            });
        },
    });

    const app = new BrowserGame<Record<string, never>, never>({
        canvas: options.canvas,
        width,
        height,
        clear: options.clear,
        seed: "ngne-tilemap-game",
        state: {},
        transition: (state) => state,
        diagnostic: options.diagnostic,
        ...(options.dt === undefined ? {} : { dt: options.dt }),
        ...(options.maxTicks === undefined ? {} : { maxTicks: options.maxTicks }),
        ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
        ...(options.afterFrame === undefined ? {} : { afterFrame: options.afterFrame }),
    });

    return {
        app,
        stage,
        moveCamera(x, y) {
            stage.camera.x = x;
            stage.camera.y = y;
            sceneCamera?.cut(x, y);
        },
        tilemap() {
            if (!loaded) throw new Error("The game has not loaded its map.");
            return loaded;
        },
        async start() {
            loaded = await runtime.loadTilemap(options.map);
            const prepared: PreparedScene = await app.game.prepare(scene(loaded), { key: "map" });
            await app.start(prepared);
            if (options.hud) {
                app.game.push(await app.game.prepare(hudScene(options.hud, width), { key: "hud" }));
            }
        },
    };
}
