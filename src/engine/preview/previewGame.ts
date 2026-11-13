import { BrowserGame } from "@ngne/core";
import type { Assets, Camera, Frame, ImageAsset, SceneDefinition } from "@ngne/core";
import type { PixelBuffer } from "../../core/model";
import { drawTilemap } from "../../core/runtime/runtime";
import type { DrawOptions, Tilemap, TilemapLayer } from "../../core/runtime/runtime";
import { readCanvas } from "../testing/readCanvas";
import { bitmapFromPixels } from "../viewport/textures";
import { DemandScheduler, ticksDelay, untilNextAnimationFrame, TICK_MS } from "./demandScheduler";

// The game preview's engine side (ENGINE §5, SPEC §12): a `BrowserGame` on its own canvas that
// draws the current map with `drawTilemap` of the runtime source the export writes, `pixelSnap`
// on, tile animations playing. The app hands it the `Tilemap` and the pixels of its textures;
// this module owns the game's lifecycle.
//
//   base scene  (bottom, always mounted): the background colour, the animation clock
//   map scene   (pushed on top): `drawTilemap`, its textures as `SceneDefinition.assets`
//
// - The game's logical size is the preview resolution, fixed at creation (ENGINE §7): another
//   resolution makes another game. Its canvas is shown at the display size the app sets.
// - Textures reach the map scene as image assets whose loaders make bitmaps of in-memory
//   pixels, under the IDs `drawTilemap` names them by (`ngne-tilemap:<project>/<name>`).
//   NGNE has no in-scene uploads and keeps an asset by its ID (ENGINE §7), so new textures
//   restart the map scene: it is popped, its assets are evicted once the pop is applied, and a
//   scene with the new assets is prepared and pushed.
// - A new `Tilemap` with the same textures is drawn by the mounted scene from its next frame;
//   cells written into a tile layer's `data` show at the next frame after `wake`.
// - While the app makes the content again (`setPending`), no frame shows the content it
//   replaces: none is drawn at all ("hold"), or the background alone ("blank").
// - Lifecycle steps (create, start, stop, scene restart, dispose) run one at a time, in order.
// - Frames run on demand (`demandScheduler.ts`). The game stops while `setRunning(false)` (the
//   window hidden) and is disposed with the preview (the dock section collapsed).

/** Ticks one frame may run: frames come at animation frames, which may last 65 535 ms. */
const MAX_TICKS = Math.ceil(65_535 / TICK_MS) + 1;

/** After a failure that follows another, the next game is made after this long. */
const RETRY_MS = 1000;

/** A texture of the map scene: an asset ID and its pixels (straight alpha). */
export interface PreviewTexture {
    readonly id: string;
    readonly pixels: PixelBuffer;
}

/** What the map scene draws. */
export interface PreviewContent {
    readonly tilemap: Tilemap;
    /** Equal keys have equal textures; another key restarts the map scene. */
    readonly texturesKey: string;
    readonly textures: readonly PreviewTexture[];
    /**
     * The frame durations of the animated tiles the visible layers place, in milliseconds
     * (frames on demand); the list grows when cells written in place add one.
     */
    readonly animations: readonly (readonly number[])[];
}

export type LayerFilter = (layer: TilemapLayer, index: number) => boolean;

/**
 * How the preview waits for a content that is being made (SPEC §12): "hold" draws no frame, so
 * the picture stays; "blank" draws the background alone, the map scene and its textures kept.
 */
export type PreviewPending = "hold" | "blank";

export interface PreviewGameOptions {
    /** A diagnostic of the game or of `drawTilemap`, once per distinct message. */
    onDiagnostic?(message: string): void;
}

/** What tests read of the page's previews: counters that outlive each game. */
export interface PreviewPageStats {
    /** Frames rendered by every preview game of the page (`afterFrame` calls). */
    readonly frames: number;
    readonly gamesCreated: number;
    /** Games created and not disposed. */
    readonly liveGames: number;
    /** Map scenes prepared and pushed: one per (re)start of the scene. */
    readonly scenesStarted: number;
}

/** What tests read of a preview and how they script it (TE-056). */
export interface PreviewProbe {
    /** The game's lifecycle; null while there is none. */
    readonly lifecycle: string | null;
    /** The backing size of the canvas; null while there is no game. */
    readonly canvasSize: { width: number; height: number } | null;
    /** The canvas's CSS size. */
    readonly displaySize: { width: number; height: number };
    /**
     * True while nothing is under way: no new content is being made (`setPending`), and the
     * game runs the content's textures, or is stopped.
     */
    readonly settled: boolean;
    /** The textures key of the mounted map scene; null while none is mounted. */
    readonly mountedKey: string | null;
    /** The animation clock, in milliseconds. */
    readonly elapsedMs: number;
    readonly playing: boolean;
    /** The camera of the last frame (top-left, map pixels); null before one. */
    readonly drawnCamera: { x: number; y: number } | null;
    /** Sets the animation clock. */
    seek(elapsedMs: number): void;
    /** Asks for a frame at the next animation frame. */
    wake(): void;
    /** Called after every frame of the game, in its task; `read` reads the canvas back. */
    onFrame: ((read: () => ImageData) => void) | null;
}

type Game = BrowserGame<Record<string, never>, never>;

/** The map scene on the game's stack (or about to be). */
interface MountedMap {
    readonly key: string;
    readonly ids: readonly string[];
    /** The tilemap it was prepared with: drawn while the content has other textures. */
    readonly tilemap: Tilemap;
    camera: Camera | null;
}

interface Instance {
    readonly game: Game;
    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;
    readonly scheduler: DemandScheduler;
    /** `start()` resolved and no `stop()` since. */
    running: boolean;
    /** The base scene is mounted: later starts resume. */
    started: boolean;
    failed: boolean;
    map: MountedMap | null;
    /** Asset IDs of a popped map scene, evicted once the pop is applied. */
    popped: readonly string[] | null;
    stopLifecycle: (() => void) | null;
}

const page = { frames: 0, gamesCreated: 0, liveGames: 0, scenesStarted: 0 };

/** The page's counters (TE-056). */
export const previewPageStats: PreviewPageStats = {
    get frames() {
        return page.frames;
    },
    get gamesCreated() {
        return page.gamesCreated;
    },
    get liveGames() {
        return page.liveGames;
    },
    get scenesStarted() {
        return page.scenesStarted;
    },
};

/** NGNE reports dropped ticks through the diagnostic callback; they are not errors. */
function isOverloadNotice(value: unknown): boolean {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as { type?: unknown }).type === "overload"
    );
}

/** The IDs of `ids` still in `assets`: loading, or loaded and leased. */
function heldAssets(assets: Assets, ids: readonly string[]): string[] {
    // The inspection lists at most 1,000 entries; the preview holds one per tileset.
    const present = new Set(assets.inspect(1000).entries.map((entry) => entry.id));
    return ids.filter((id) => present.has(id));
}

function messageOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === "string" ? error : JSON.stringify(error);
}

/** An image asset whose loader makes a bitmap of in-memory pixels (ENGINE §5). */
function pixelAsset(texture: PreviewTexture): ImageAsset {
    return {
        id: texture.id,
        kind: "image",
        estimateBytes: () => texture.pixels.width * texture.pixels.height * 4,
        load: () => bitmapFromPixels(texture.pixels),
        dispose: (bitmap) => bitmap.close(),
    };
}

export class PreviewGame {
    readonly probe: PreviewProbe;
    readonly #host: HTMLElement;
    readonly #options: PreviewGameOptions;
    readonly #reported = new Set<string>();
    #instance: Instance | null = null;
    // Wanted state.
    #resolution: { width: number; height: number } | null = null;
    #display = { width: 0, height: 0 };
    #running = false;
    #disposed = false;
    #content: PreviewContent | null = null;
    #pending: PreviewPending | null = null;
    #camera = { x: 0, y: 0 };
    #background = 0;
    #layers: LayerFilter | null = null;
    #playing = true;
    #elapsedMs = 0;
    #drawnCamera: { x: number; y: number } | null = null;
    // Lifecycle work.
    #working = false;
    #again = false;
    #failures = 0;
    #retryAt = 0;
    #retryTimer: ReturnType<typeof setTimeout> | undefined;
    /** Resolves the step that waits for the game's next frame. */
    #frameWaiters: (() => void)[] = [];
    #disposal: Promise<void> | null = null;
    #resolveDisposal: (() => void) | null = null;
    readonly #draw: { -readonly [K in keyof DrawOptions]: DrawOptions[K] };

    constructor(host: HTMLElement, options: PreviewGameOptions = {}) {
        this.#host = host;
        this.#options = options;
        this.#draw = {
            elapsedMs: 0,
            viewWidth: 0,
            viewHeight: 0,
            assets: new Map(),
            report: (message) => this.#report(message),
        };
        this.probe = this.#createProbe();
    }

    /** The game's logical size; null for none (no game). */
    setResolution(size: { width: number; height: number } | null): void {
        const now = this.#resolution;
        if (size?.width === now?.width && size?.height === now?.height) return;
        this.#resolution = size ? { width: size.width, height: size.height } : null;
        this.#kick();
    }

    /** The canvas size on the page, in CSS pixels. */
    setDisplaySize(size: { width: number; height: number }): void {
        if (size.width === this.#display.width && size.height === this.#display.height) return;
        this.#display = { width: size.width, height: size.height };
        if (this.#instance) this.#style(this.#instance.canvas);
    }

    /** Whether the game runs: false stops it (the window hidden). */
    setRunning(running: boolean): void {
        if (running === this.#running) return;
        this.#running = running;
        this.#releaseFrameWaiters();
        this.#kick();
    }

    /** What the map scene draws; null draws the background alone. */
    setContent(content: PreviewContent | null): void {
        if (content === this.#content) return;
        const restart = content?.texturesKey !== this.#content?.texturesKey;
        this.#content = content;
        if (restart) this.#kick();
        this.#wake();
    }

    /**
     * The content is being made again and the one set is older than the project: until null is
     * set, no frame draws it. Set the new content before ending it.
     */
    setPending(pending: PreviewPending | null): void {
        if (pending === this.#pending) return;
        this.#pending = pending;
        this.#instance?.scheduler.hold(pending === "hold");
        this.#wake();
    }

    /** Cells of the content's tilemap were written: they show at the next frame. */
    contentChanged(): void {
        this.#wake();
    }

    /** The top-left corner of the view, in map pixels. */
    setCamera(x: number, y: number): void {
        if (x === this.#camera.x && y === this.#camera.y) return;
        this.#camera = { x, y };
        this.#instance?.map?.camera?.cut(x, y);
        this.#wake();
    }

    /** The colour behind the map, 0xRRGGBB. */
    setBackground(colour: number): void {
        if (colour === this.#background) return;
        this.#background = colour;
        this.#wake();
    }

    /** Which layers to draw; the visible ones when null. */
    setLayers(filter: LayerFilter | null): void {
        if (filter === this.#layers) return;
        this.#layers = filter;
        this.#wake();
    }

    /** Whether the animation clock runs (play/pause). */
    setPlaying(playing: boolean): void {
        if (playing === this.#playing) return;
        // Time since the last frame is not played: the clock starts or stops now.
        this.#instance?.scheduler.skip();
        this.#playing = playing;
        this.#instance?.scheduler.replan();
    }

    /** Ends the preview: its game is stopped and disposed in order. */
    dispose(): Promise<void> {
        if (!this.#disposal) {
            this.#disposed = true;
            clearTimeout(this.#retryTimer);
            this.#disposal = new Promise((resolve) => {
                this.#resolveDisposal = resolve;
            });
            this.#releaseFrameWaiters();
            this.#kick();
        }
        return this.#disposal;
    }

    #report(message: string): void {
        if (this.#reported.has(message)) return;
        this.#reported.add(message);
        this.#options.onDiagnostic?.(message);
    }

    #reportError(error: unknown): void {
        console.error("NGNE preview:", error);
        this.#report(messageOf(error));
    }

    /** Something drawn changed: a frame at the next animation frame. */
    #wake(): void {
        const instance = this.#instance;
        if (!instance) return;
        // Paused, nothing plays: the time until this frame is not ticked through.
        if (!this.#playing) instance.scheduler.skip();
        instance.scheduler.wake();
    }

    /** Real milliseconds until the playing animations show another frame. */
    #due(): number {
        const content = this.#content;
        if (!this.#playing || !content || !this.#instance?.map) return Infinity;
        return ticksDelay(untilNextAnimationFrame(content.animations, this.#elapsedMs));
    }

    // --- Lifecycle -------------------------------------------------------------------------

    /** Brings the game in line with the wanted state, one step at a time. */
    #kick(): void {
        if (this.#working) {
            this.#again = true;
            return;
        }
        this.#working = true;
        void (async () => {
            do {
                this.#again = false;
                for (let step = this.#nextStep(); step; step = this.#nextStep()) {
                    try {
                        await step();
                    } catch (error) {
                        if (!this.#disposed) this.#reportError(error);
                        await this.#failed();
                    }
                }
            } while (this.#again);
        })().finally(() => {
            this.#working = false;
            if (this.#again) this.#kick();
            else if (this.#disposed && !this.#instance) this.#resolveDisposal?.();
        });
    }

    /** The next step the wanted state needs, or null when there is none. */
    #nextStep(): (() => Promise<void>) | null {
        const instance = this.#instance;
        const size = this.#resolution;
        if (this.#disposed) return instance ? () => this.#end(instance) : null;
        if (instance) {
            if (instance.failed) return () => this.#rebuild(instance);
            if (!size || size.width !== instance.width || size.height !== instance.height) {
                return () => this.#end(instance);
            }
            if (!this.#running) return instance.running ? () => this.#stop(instance) : null;
            if (!instance.running) return () => this.#start(instance);
            return this.#sceneStep(instance);
        }
        if (!size || !this.#running) return null;
        if (performance.now() < this.#retryAt) return null;
        return () => this.#create(size);
    }

    /** The step that brings the map scene in line with the content, or null. */
    #sceneStep(instance: Instance): (() => Promise<void>) | null {
        const { game } = instance;
        const content = this.#content;
        const map = instance.map;
        if (map && map.key !== content?.texturesKey) {
            return async () => {
                instance.map = null;
                instance.popped = map.ids;
                game.game.pop();
                this.#wake();
            };
        }
        if (instance.popped) {
            const popped = instance.popped;
            if (game.game.scenes.length > 1) return () => this.#nextFrame(instance);
            return async () => {
                // Another scene may take the popped scene's IDs once they are evicted. NGNE's
                // scene and renderer leases on a texture can outlast the pop by a few frames
                // (restarts close together), and a held ID is not evicted: it is tried again
                // at the next frame, as a scene taking it sooner would fail to prepare.
                const { assets } = game.game;
                for (const id of popped) assets.evict(id);
                const held = heldAssets(assets, popped);
                instance.popped = held.length > 0 ? held : null;
                if (held.length > 0) await this.#nextFrame(instance);
            };
        }
        if (!map && content) return () => this.#pushMap(instance, content);
        if (map && game.game.scenes.length < 2) return () => this.#nextFrame(instance);
        return null;
    }

    /** Waits for the game's next frame (or for a stop or disposal). */
    #nextFrame(instance: Instance): Promise<void> {
        return new Promise((resolve) => {
            this.#frameWaiters.push(resolve);
            instance.scheduler.wake();
        });
    }

    #releaseFrameWaiters(): void {
        const waiters = this.#frameWaiters;
        this.#frameWaiters = [];
        for (const resolve of waiters) resolve();
    }

    async #failed(): Promise<void> {
        const instance = this.#instance;
        if (instance) await this.#rebuild(instance).catch(() => undefined);
        else this.#delayNext();
    }

    async #rebuild(instance: Instance): Promise<void> {
        try {
            await this.#end(instance);
        } finally {
            this.#delayNext();
        }
    }

    /** A game that keeps failing is made again after a pause, not in a loop. */
    #delayNext(): void {
        if (this.#failures++ === 0 || this.#disposed) return;
        this.#retryAt = performance.now() + RETRY_MS;
        clearTimeout(this.#retryTimer);
        this.#retryTimer = setTimeout(() => this.#kick(), RETRY_MS);
    }

    async #create(size: { width: number; height: number }): Promise<void> {
        const canvas = document.createElement("canvas");
        canvas.className = "preview-panel__canvas";
        this.#style(canvas);
        let instance: Instance | null = null;
        const scheduler = new DemandScheduler(() => this.#due());
        scheduler.hold(this.#pending === "hold");
        const game: Game = new BrowserGame<Record<string, never>, never>({
            canvas,
            width: size.width,
            height: size.height,
            clear: 0x000000,
            seed: "ngne-tilemap-editor-preview",
            state: {},
            transition: (state) => state,
            scheduler,
            maxTicks: MAX_TICKS,
            diagnostic: (error) => {
                if (isOverloadNotice(error)) return;
                this.#reportError(error);
                // Not inside NGNE's own call: the lifecycle is read once it has returned.
                queueMicrotask(() => {
                    if (instance) this.#check(instance);
                });
            },
            afterFrame: () => {
                page.frames += 1;
                if (!instance || instance !== this.#instance) return;
                this.#releaseFrameWaiters();
                const { onFrame } = this.probe;
                if (!onFrame) return;
                try {
                    onFrame(() => readCanvas(canvas));
                } catch (error) {
                    console.error("NGNE preview: probe.onFrame threw.", error);
                }
            },
        });
        instance = {
            game,
            canvas,
            width: size.width,
            height: size.height,
            scheduler,
            running: false,
            started: false,
            failed: false,
            map: null,
            popped: null,
            stopLifecycle: null,
        };
        page.liveGames += 1;
        page.gamesCreated += 1;
        this.#instance = instance;
        this.#host.append(canvas);
    }

    async #start(instance: Instance): Promise<void> {
        if (!instance.started) {
            const base = await instance.game.game.prepare(this.#baseScene(instance), {
                key: "base",
            });
            await instance.game.start(base);
            instance.started = true;
            const renderer = instance.game.renderer;
            if (!renderer) throw new Error("The preview's renderer is missing after start().");
            // Observers get future transitions only; the callback stays small (ENGINE §2).
            instance.stopLifecycle = renderer.onLifecycle((event) => {
                if (event.status === "ready") this.#wake();
                else if (event.status === "failed") this.#check(instance);
            });
        } else {
            await instance.game.start();
            // A stop drops the scene commands no tick applied yet (NGNE's `cancelPending`,
            // which also releases a prepared scene not pushed yet): a pop is asked for again,
            // and a dropped push is forgotten, its assets evicted, so the scene is made again.
            const mounted = instance.game.game.scenes.length;
            if (instance.popped && mounted > 1) instance.game.game.pop();
            if (instance.map && mounted < 2) {
                instance.popped = instance.map.ids;
                instance.map = null;
            }
        }
        instance.running = true;
        // The clock stood still while the game was stopped: that time is not played.
        instance.scheduler.skip();
        this.#failures = 0;
    }

    async #stop(instance: Instance): Promise<void> {
        instance.running = false;
        await instance.game.stop();
    }

    /** Disposes a game; its canvas leaves the page. */
    async #end(instance: Instance): Promise<void> {
        if (this.#instance === instance) this.#instance = null;
        instance.running = false;
        instance.stopLifecycle?.();
        instance.scheduler.dispose();
        this.#releaseFrameWaiters();
        try {
            await instance.game.dispose();
        } finally {
            instance.canvas.remove();
            page.liveGames -= 1;
        }
    }

    /** A game whose lifecycle or renderer failed is made again. */
    #check(instance: Instance): void {
        if (instance !== this.#instance || instance.failed) return;
        const failed =
            instance.game.game.lifecycle === "Failed" ||
            instance.game.renderer?.status === "failed";
        if (!failed) return;
        instance.failed = true;
        this.#releaseFrameWaiters();
        this.#kick();
    }

    /** Prepares the map scene of `content` (its textures uploaded) and pushes it. */
    async #pushMap(instance: Instance, content: PreviewContent): Promise<void> {
        const mounted: MountedMap = {
            key: content.texturesKey,
            ids: content.textures.map((texture) => texture.id),
            tilemap: content.tilemap,
            camera: null,
        };
        const scene = this.#mapScene(instance, content, mounted);
        const prepared = await instance.game.game.prepare(scene, { key: "map" });
        if (instance !== this.#instance || !instance.running) {
            prepared.release();
            return;
        }
        instance.game.game.push(prepared);
        instance.map = mounted;
        page.scenesStarted += 1;
        this.#wake();
    }

    #style(canvas: HTMLCanvasElement): void {
        canvas.style.width = `${this.#display.width}px`;
        canvas.style.height = `${this.#display.height}px`;
    }

    // --- Scenes ----------------------------------------------------------------------------

    /** The bottom scene: the background colour over the whole view, and the animation clock. */
    #baseScene(instance: Instance): SceneDefinition<Record<string, never>, never> {
        const { width, height } = instance;
        return {
            id: "ngne-tilemap-editor-preview-base",
            setup: (scene) => {
                scene.system(({ dt }) => {
                    if (this.#playing) this.#elapsedMs += dt * 1000;
                });
                scene.render((frame) => {
                    frame.rect(width / 2, height / 2, width, height, this.#background, 1, 0, true);
                });
            },
        };
    }

    /** The map scene: `drawTilemap` with the scene's assets, `pixelSnap` on (ENGINE §5). */
    #mapScene(
        instance: Instance,
        content: PreviewContent,
        mounted: MountedMap,
    ): SceneDefinition<Record<string, never>, never> {
        const { width, height } = instance;
        return {
            id: "ngne-tilemap-editor-preview-map",
            assets: content.textures.map(pixelAsset),
            setup: (scene) => {
                scene.camera.pixelSnap = true;
                scene.camera.cut(this.#camera.x, this.#camera.y);
                mounted.camera = scene.camera;
                this.#draw.viewWidth = width;
                this.#draw.viewHeight = height;
                scene.render((frame) => this.#drawMap(frame, scene.camera, scene.assets, mounted));
            },
        };
    }

    /** The map scene's render. It never throws: a throw would fail the game. */
    #drawMap(
        frame: Frame,
        camera: Camera,
        assets: ReadonlyMap<string, unknown>,
        mounted: MountedMap,
    ): void {
        try {
            // The content is older than the project: nothing of it is drawn.
            if (this.#pending === "blank") return;
            const content = this.#content;
            // The newest tilemap of the scene's textures; the scene's own while others wait.
            const tilemap =
                content?.texturesKey === mounted.key ? content.tilemap : mounted.tilemap;
            const draw = this.#draw;
            draw.elapsedMs = this.#elapsedMs;
            draw.assets = assets;
            if (this.#layers) draw.layers = this.#layers;
            else delete draw.layers;
            drawTilemap(frame, tilemap, camera, draw);
            this.#drawnCamera = { x: camera.x, y: camera.y };
        } catch (error) {
            this.#reportError(error);
        }
    }

    // --- Test hooks ------------------------------------------------------------------------

    #createProbe(): PreviewProbe {
        const read = <Value>(get: () => Value) => ({ get, enumerable: true });
        return Object.defineProperties(
            {
                onFrame: null,
                seek: (elapsedMs: number) => {
                    this.#elapsedMs = elapsedMs;
                    this.#instance?.scheduler.skip();
                    this.#wake();
                },
                wake: () => this.#wake(),
            } as unknown as PreviewProbe,
            {
                lifecycle: read(() => this.#instance?.game.game.lifecycle ?? null),
                canvasSize: read(() =>
                    this.#instance
                        ? {
                              width: this.#instance.canvas.width,
                              height: this.#instance.canvas.height,
                          }
                        : null,
                ),
                displaySize: read(() => ({ ...this.#display })),
                settled: read(() => {
                    const instance = this.#instance;
                    // A new content is being made: the one set is about to be replaced.
                    if (this.#working || this.#pending !== null) return false;
                    if (!instance) return !this.#resolution || !this.#running;
                    if (instance.running !== this.#running) return false;
                    if (!instance.running) return true;
                    const key = this.#content?.texturesKey ?? null;
                    if ((instance.map?.key ?? null) !== key || instance.popped) return false;
                    return instance.game.game.scenes.length === (key === null ? 1 : 2);
                }),
                mountedKey: read(() => this.#instance?.map?.key ?? null),
                elapsedMs: read(() => this.#elapsedMs),
                playing: read(() => this.#playing),
                drawnCamera: read(() => this.#drawnCamera),
            },
        );
    }
}
