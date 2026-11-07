import { Camera, Frame, WebGPURenderer } from "@ngne/core";
import type { RendererStatus } from "@ngne/core";
import type { CellRect } from "../../core/cells";
import type { Touched } from "../../core/history";
import type { Tileset } from "../../core/model";
import { checkerBlock, checkerSpec } from "./checker";
import type { ViewportChecker } from "./checker";
import { nextTier } from "./chunkPlan";
import type { Tier } from "./chunkPlan";
import { ChunkTier } from "./chunkTier";
import type { ChunkStats, ChunkTarget } from "./chunkTier";
import type { DeviceSize } from "./geometry";
import { EmitterCache, buildLiveFrame, drawMapBase, sceneCamera } from "./liveTier";
import type { LiveCounts, LiveInputs, ViewportScene } from "./liveTier";
import { CHECKER_TEXTURE_ID, TilesetTextures, bitmapFromPixels } from "./textures";
import type { BitmapFn, PackFn, TextureTarget } from "./textures";

// The main viewport's renderer (ENGINE §2): one direct `WebGPURenderer` on one canvas, created
// with an abort signal, resized without being created again, observed through its lifecycle and
// torn down in order. Frames are submitted only when something asked for one (ENGINE §4,
// redraw on demand).

export type ViewportStatus = RendererStatus;

export interface ViewportOptions {
    canvas: HTMLCanvasElement;
    /** The canvas size in device pixels. */
    size: DeviceSize;
    /** What to draw; read at each draw. Null draws the workspace colour alone. */
    scene(): ViewportScene | null;
    /** The colour around the map and behind everything, 0xRRGGBB. */
    workspace(): number;
    /** Packs a tileset for upload (`packTileset`, here or in the worker). */
    pack: PackFn;
    /** Aborts a creation under way (tab or project switch, teardown). */
    signal?: AbortSignal;
    /** NGNE diagnostics and failed uploads. */
    onError(error: unknown): void;
    /** The renderer's status when it changes, and once after creation. */
    onStatus(status: ViewportStatus): void;
    /** Test seam: the upload source of an image. */
    bitmap?: BitmapFn;
}

/** What a viewport reports about its frames (the test hook and the pan benchmark read it). */
export interface ViewportStats {
    /** Frames submitted to the renderer. */
    frames: number;
    /** Sprites of the last frame, as the renderer counted them. */
    sprites: number;
    drawCalls: number;
    /** Milliseconds from the start of the last draw to the return of `render`. */
    lastDrawMs: number;
    /** Of those, the milliseconds that building the frame took (the rest is `render`). */
    lastBuildMs: number;
    /** The tier of the last frame (ENGINE §4). */
    tier: Tier;
    /** Changes of tier between submitted frames. */
    tierChanges: number;
    /** The visible count the last frame chose its tier by. */
    visibleCount: number;
    /** Chunk and live quads of the last frame. */
    chunkQuads: number;
    tileQuads: number;
}

let creations = 0;

/** Renderers created by this page so far; a resize never adds one. */
export function rendererCreations(): number {
    return creations;
}

export class Viewport {
    readonly canvas: HTMLCanvasElement;
    readonly #renderer: WebGPURenderer;
    readonly #options: ViewportOptions;
    readonly #frame = new Frame();
    readonly #camera = new Camera();
    readonly #emitters = new EmitterCache();
    readonly #textures: TilesetTextures;
    readonly #bitmap: BitmapFn;
    readonly #unsubscribe: () => void;
    readonly #abort = new AbortController();
    readonly #stats: ViewportStats = {
        frames: 0,
        sprites: 0,
        drawCalls: 0,
        lastDrawMs: 0,
        lastBuildMs: 0,
        tier: "live",
        tierChanges: 0,
        visibleCount: 0,
        chunkQuads: 0,
        tileQuads: 0,
    };
    readonly #chunks: ChunkTier;
    /** Test seam: `updateTexture` calls of chunks still to reject, and how. */
    #chunkFaults = { count: 0, drop: false };
    #size: DeviceSize;
    #raf = 0;
    #waitingForReady = false;
    #checkerReady: string | null = null;
    #checkerPending: string | null = null;
    #checkerAbort: AbortController | null = null;
    #disposed = false;

    private constructor(renderer: WebGPURenderer, options: ViewportOptions) {
        this.canvas = options.canvas;
        this.#renderer = renderer;
        this.#options = options;
        this.#size = options.size;
        this.#bitmap = options.bitmap ?? bitmapFromPixels;
        // Quads are placed in device pixels from fractional positions; snapping would round
        // their centres (ENGINE §4).
        this.#camera.pixelSnap = false;
        const target: TextureTarget = {
            texture: (id, source, signal) => renderer.texture(id, source, signal),
            // Releasing throws once the renderer failed; the textures are gone with it.
            releaseTexture: (id) => {
                try {
                    renderer.releaseTexture(id);
                } catch {
                    // Nothing left to release.
                }
            },
        };
        this.#textures = new TilesetTextures(target, options.pack, this.#bitmap, {
            onChange: () => this.requestRedraw(),
            onError: (error) => options.onError(error),
        });
        const chunkTarget: ChunkTarget = {
            createTexture: (id, width, height, signal) =>
                renderer.createTexture(id, width, height, signal),
            updateTexture: (id, source, region, signal) => {
                const faults = this.#chunkFaults;
                if (faults.count > 0) {
                    faults.count -= 1;
                    // As NGNE after a failed copy (drops the registration) or a loss after
                    // submission (keeps the image it had).
                    if (faults.drop) target.releaseTexture(id);
                    return Promise.reject(new Error(`Test: update of ${id} rejected.`));
                }
                return renderer.updateTexture(id, source, region, signal);
            },
            releaseTexture: target.releaseTexture,
            has: (id) => this.textureIds().includes(id),
        };
        this.#chunks = new ChunkTier({
            target: chunkTarget,
            hooks: {
                onChange: () => this.requestRedraw(),
                onError: (error) => options.onError(error),
            },
        });
        // Observers get future transitions only; the callback stays small (ENGINE §2).
        this.#unsubscribe = renderer.onLifecycle((event) => {
            options.onStatus(event.status);
            if (event.status === "ready") {
                this.#resizeToWanted();
                this.requestRedraw();
            }
        });
        options.onStatus(renderer.status);
    }

    /**
     * Creates the renderer on `options.canvas`. Rejects with the signal's reason when it is
     * aborted first; a renderer that was created by then is disposed.
     */
    static async create(options: ViewportOptions): Promise<Viewport> {
        const { canvas, size, signal } = options;
        // The caller owns the backing size; the renderer's logical size starts as the same.
        canvas.width = size.width;
        canvas.height = size.height;
        creations += 1;
        const renderer = await WebGPURenderer.create(
            canvas,
            size.width,
            size.height,
            options.onError,
            signal,
        );
        if (signal?.aborted) {
            renderer.dispose();
            throw signal.reason;
        }
        return new Viewport(renderer, options);
    }

    get status(): ViewportStatus {
        return this.#renderer.status;
    }

    get stats(): Readonly<ViewportStats> {
        return this.#stats;
    }

    /** IDs of the manual textures on the renderer (at most 1,000: the inspection's limit). */
    textureIds(): string[] {
        try {
            return this.#renderer.inspect(1000).entries.map((entry) => entry.id);
        } catch {
            // A failed or disposed renderer holds nothing.
            return [];
        }
    }

    /** What the chunk tier reports, for tests and benchmarks. */
    get chunkStats(): ChunkStats {
        return this.#chunks.stats;
    }

    /** The cells the chunk tier draws as live quads over their chunks, for tests. */
    chunkLiveCells(): { set: number; cells: CellRect }[] {
        return this.#chunks.liveCells();
    }

    /**
     * A command changed the document: chunks under changed cells are patched, and their cells
     * drawn as live quads until the patch settles (ENGINE §4, painting at overview).
     */
    noteTouched(touched: Touched): void {
        this.#chunks.noteTouched(touched);
        this.requestRedraw();
    }

    /**
     * Test seam: the next `count` chunk updates reject, as after a loss once submitted (the
     * texture keeps its image) or, with `drop`, a failed copy that drops the registration.
     */
    rejectChunkUpdates(count: number, drop = false): void {
        this.#chunkFaults = { count, drop };
    }

    /** Makes exactly these tilesets the ones with a texture; the others are released. */
    useTilesets(tilesets: readonly Tileset[]): void {
        this.#textures.use(tilesets);
    }

    /** The pixels or tiles of these tilesets changed: upload them again. */
    invalidateTilesets(ids: readonly string[]): void {
        this.#textures.invalidate(ids);
    }

    /**
     * Sets the canvas size in device pixels. The renderer keeps its device, pipelines and
     * textures; during recovery the resize waits for `ready()` (ENGINE §2). A size under one
     * device pixel on either side is ignored.
     */
    resize(size: DeviceSize): void {
        // A hidden host (the window-too-small notice covers the shell) measures 0 × 0; the
        // renderer keeps its last size until the host is back.
        if (!(size.width >= 1 && size.height >= 1)) return;
        this.#size = size;
        this.#resizeToWanted();
    }

    /** Asks for a frame at the next animation frame; any number of calls make one. */
    requestRedraw(): void {
        if (this.#disposed || this.#raf !== 0) return;
        this.#raf = requestAnimationFrame(() => {
            this.#raf = 0;
            this.renderNow();
        });
    }

    /**
     * Builds and submits a frame now. Returns false when nothing was submitted: the renderer
     * is not ready. A WebGPU canvas holds its image only until the frame is presented, so a
     * test reads the canvas in the task that called this.
     */
    renderNow(): boolean {
        const renderer = this.#renderer;
        if (this.#disposed || renderer.status !== "ready") return false;
        const started = performance.now();
        const scene = this.#options.scene();
        const stats = this.#stats;
        if (scene) {
            this.#ensureChecker(scene.checker);
            const size = { width: renderer.width, height: renderer.height };
            const inputs: LiveInputs = {
                scene,
                size,
                camera: this.#camera,
                emitter: this.#emitters.emitter(this.#textures.drawable(scene.project.tilesets)),
                checkerReady: this.#checkerReady,
            };
            // The tier from the chunk counts of the view, with hysteresis (ENGINE §4).
            const chunks = this.#chunks;
            chunks.sync(scene.project, scene.map, size, scene.highlight ?? null);
            const camera = sceneCamera(scene);
            const count = chunks.visibleCount(camera, size);
            const tier = nextTier(stats.tier, count, chunks.ready);
            if (tier !== stats.tier) stats.tierChanges += 1;
            stats.tier = tier;
            stats.visibleCount = count;
            let counts: LiveCounts;
            if (tier === "chunk") {
                counts = { tileQuads: 0, checkerQuads: 0 };
                drawMapBase(this.#frame, inputs, counts);
                const workspace = this.#options.workspace();
                stats.chunkQuads = chunks.draw(this.#frame, inputs, camera, counts, workspace);
            } else {
                counts = buildLiveFrame(this.#frame, inputs);
                stats.chunkQuads = 0;
            }
            stats.tileQuads = counts.tileQuads;
        } else {
            this.#chunks.clear();
            this.#frame.reset();
            this.#frame.scene(this.#camera, 1);
        }
        const built = performance.now();
        renderer.render(this.#frame, this.#options.workspace());
        this.#stats.frames += 1;
        this.#stats.lastBuildMs = built - started;
        this.#stats.sprites = renderer.sprites;
        this.#stats.drawCalls = renderer.drawCalls;
        this.#stats.lastDrawMs = performance.now() - started;
        return true;
    }

    /** Ends the viewport: unsubscribes, then disposes the renderer, which owns the canvas. */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
        this.#raf = 0;
        this.#abort.abort();
        this.#checkerAbort?.abort();
        this.#textures.dispose();
        this.#chunks.dispose();
        this.#unsubscribe();
        try {
            this.#renderer.dispose();
        } catch (error) {
            this.#options.onError(error);
        }
    }

    #resizeToWanted(): void {
        const renderer = this.#renderer;
        const { width, height } = this.#size;
        if (this.#disposed || (renderer.width === width && renderer.height === height)) return;
        if (renderer.status === "ready") {
            try {
                renderer.resize(width, height);
            } catch (error) {
                this.#options.onError(error);
                return;
            }
            this.requestRedraw();
        } else if (renderer.status === "recovering" && !this.#waitingForReady) {
            // `resize` throws during recovery: wait for `ready()` and retry with the latest size.
            this.#waitingForReady = true;
            renderer.ready(this.#abort.signal).then(
                () => {
                    this.#waitingForReady = false;
                    this.#resizeToWanted();
                },
                () => {
                    this.#waitingForReady = false;
                },
            );
        }
    }

    /** Uploads the checker image of `checker` when `ed:checker` does not hold it. */
    #ensureChecker(checker: ViewportChecker): void {
        const spec = checkerSpec(checker);
        if (spec === this.#checkerReady || spec === this.#checkerPending) return;
        this.#checkerAbort?.abort();
        const abort = new AbortController();
        this.#checkerAbort = abort;
        this.#checkerPending = spec;
        void (async () => {
            const bitmap = await this.#bitmap(checkerBlock(checker));
            try {
                await this.#renderer.texture(CHECKER_TEXTURE_ID, bitmap, abort.signal);
            } finally {
                bitmap.close();
            }
            if (abort.signal.aborted) return;
            this.#checkerReady = spec;
            this.#checkerPending = null;
            this.requestRedraw();
        })().catch((error: unknown) => {
            if (abort.signal.aborted || this.#disposed) return;
            this.#checkerPending = null;
            this.#options.onError(error);
        });
    }
}
