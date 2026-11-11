import { MapCompositor, mapPixels, minimapRequest, minimapSize } from "../../core/compositor";
import type { Size } from "../../core/compositor";
import type { PixelBuffer, Project, ProjectMap } from "../../core/model";

// The minimap's image (DESIGN §8.8): the whole map from `core/compositor` at the dock width,
// composited on the main thread in slices of rows, each its own task, so no task of a redraw
// comes near 16 ms (ENGINE §6, the reference map included). An edit asks for a redraw once it
// is in the history (a change that settled); redraws start at most once per `interval`. The
// image goes to the canvas whole, when its last slice is done.

/** Runs `job` in a task of its own, soon; returns what cancels it. */
export type SliceFn = (job: () => void) => () => void;

/** Runs `job` after `ms` milliseconds; returns what cancels it. */
export type DelayFn = (job: () => void, ms: number) => () => void;

/**
 * A task through a message channel: unlike nested `setTimeout(0)`, it is not clamped to 4 ms,
 * and the browser still renders frames between tasks (as the chunk tier's slices).
 */
export const messageSlice: SliceFn = (job) => {
    const channel = new MessageChannel();
    let cancelled = false;
    channel.port1.onmessage = () => {
        channel.port1.close();
        if (!cancelled) job();
    };
    channel.port2.postMessage(null);
    return () => {
        cancelled = true;
        channel.port1.close();
    };
};

const timerDelay: DelayFn = (job, ms) => {
    const id = setTimeout(job, ms);
    return () => clearTimeout(id);
};

/** DESIGN §8.8: at most one redraw per 500 ms. */
export const MINIMAP_INTERVAL_MS = 500;

/** What one slice aims at; the rows of the next slice follow from the last one's time. */
export const SLICE_TARGET_MS = 6;

/** Rows of the first slice of a redraw, before any is timed. */
const FIRST_ROWS = 4;
const MAX_ROWS = 256;
/** Starts kept in `stats.starts`. */
const KEPT_STARTS = 64;

export interface MinimapContent {
    project: Project;
    map: ProjectMap;
}

export interface MinimapRendererOptions {
    /** The project and the map to draw, read when a redraw starts; null for none. */
    content(): MinimapContent | null;
    /** A redraw finished: the minimap image of `content`, 0 × 0 when there is nothing to draw. */
    onImage(image: PixelBuffer, content: MinimapContent | null): void;
    now?: () => number;
    slice?: SliceFn;
    delay?: DelayFn;
    /** Default `MINIMAP_INTERVAL_MS`. */
    interval?: number;
}

/** What the renderer reports (the test hook reads it). */
export interface MinimapStats {
    /** Redraws finished. */
    redraws: number;
    /** When the most recent redraws started (`now`), oldest first. */
    starts: number[];
    /** When the last redraw finished; −Infinity before the first. */
    lastEnd: number;
    /** Slices run, and the longest one in milliseconds. */
    slices: number;
    maxSliceMs: number;
    /** The longest slice of the last redraw finished, in milliseconds. */
    lastMaxSliceMs: number;
    /** A redraw is under way. */
    busy: boolean;
    /** A change waits for a redraw. */
    pending: boolean;
}

interface Redraw {
    compositor: MapCompositor | null;
    content: MinimapContent;
    image: PixelBuffer;
    y: number;
}

const EMPTY: PixelBuffer = { width: 0, height: 0, data: new Uint8ClampedArray(0) };

export class MinimapRenderer {
    readonly #content: () => MinimapContent | null;
    readonly #onImage: (image: PixelBuffer, content: MinimapContent | null) => void;
    readonly #now: () => number;
    readonly #slice: SliceFn;
    readonly #delay: DelayFn;
    readonly #interval: number;

    #side = 0;
    #rows = FIRST_ROWS;
    #redraw: Redraw | null = null;
    #cancelSlice: (() => void) | null = null;
    #cancelDelay: (() => void) | null = null;
    #pending = false;
    #lastStart = -Infinity;
    /** The longest slice of the redraw under way. */
    #redrawMaxMs = 0;
    #disposed = false;
    readonly #stats: MinimapStats = {
        redraws: 0,
        starts: [],
        lastEnd: -Infinity,
        slices: 0,
        maxSliceMs: 0,
        lastMaxSliceMs: 0,
        busy: false,
        pending: false,
    };

    constructor(options: MinimapRendererOptions) {
        this.#content = options.content;
        this.#onImage = options.onImage;
        this.#now = options.now ?? (() => performance.now());
        this.#slice = options.slice ?? messageSlice;
        this.#delay = options.delay ?? timerDelay;
        this.#interval = options.interval ?? MINIMAP_INTERVAL_MS;
    }

    get stats(): Readonly<MinimapStats> {
        return {
            ...this.#stats,
            starts: [...this.#stats.starts],
            busy: this.#redraw !== null,
            pending: this.#pending,
        };
    }

    /** The width of the box the minimap fits, in image pixels; a new width redraws at once. */
    setWidth(side: number): void {
        const next = Math.max(0, Math.floor(side));
        if (next === this.#side) return;
        this.#side = next;
        this.restart();
    }

    /**
     * Something the minimap shows changed and settled: a redraw follows, at most one per
     * `interval` from the start of the last. A redraw under way finishes first.
     */
    changed(): void {
        if (this.#disposed) return;
        this.#pending = true;
        this.#pump();
    }

    /** Another map or project is shown, or the size changed: drops a redraw under way and starts one now. */
    restart(): void {
        if (this.#disposed) return;
        this.#cancel();
        this.#pending = true;
        this.#start();
    }

    dispose(): void {
        this.#disposed = true;
        this.#cancel();
        this.#pending = false;
    }

    #cancel(): void {
        this.#cancelSlice?.();
        this.#cancelSlice = null;
        this.#cancelDelay?.();
        this.#cancelDelay = null;
        this.#redraw = null;
    }

    #pump(): void {
        if (this.#disposed || !this.#pending) return;
        if (this.#redraw !== null || this.#cancelDelay !== null) return;
        const wait = this.#lastStart + this.#interval - this.#now();
        if (wait > 0) {
            this.#cancelDelay = this.#delay(() => {
                this.#cancelDelay = null;
                this.#pump();
            }, wait);
            return;
        }
        this.#start();
    }

    #start(): void {
        this.#pending = false;
        this.#redrawMaxMs = 0;
        this.#lastStart = this.#now();
        this.#stats.starts.push(this.#lastStart);
        if (this.#stats.starts.length > KEPT_STARTS) this.#stats.starts.shift();
        const content = this.#content();
        const size: Size = content
            ? minimapSize(mapPixels(content.map), this.#side)
            : { width: 0, height: 0 };
        if (!content || size.width === 0 || size.height === 0) {
            this.#finish(EMPTY, content);
            return;
        }
        this.#redraw = {
            compositor: null,
            content,
            image: {
                width: size.width,
                height: size.height,
                data: new Uint8ClampedArray(size.width * size.height * 4),
            },
            y: 0,
        };
        this.#next();
    }

    #next(): void {
        this.#cancelSlice = this.#slice(() => {
            this.#cancelSlice = null;
            this.#runSlice();
        });
    }

    /**
     * One task of a redraw: the compositor first (it reads the tilesets), then bands of rows
     * sized from the last band's time.
     */
    #runSlice(): void {
        const redraw = this.#redraw;
        if (!redraw) return;
        const started = this.#now();
        const { content, image } = redraw;
        if (redraw.compositor === null) {
            redraw.compositor = new MapCompositor(content.project, content.map);
        } else {
            const rows = Math.min(this.#rows, image.height - redraw.y);
            const at = redraw.y * image.width * 4;
            const band: PixelBuffer = {
                width: image.width,
                height: rows,
                data: image.data.subarray(at, at + rows * image.width * 4),
            };
            redraw.compositor.composite(minimapRequest(content.map, image, redraw.y, rows), band);
            redraw.y += rows;
            const ms = this.#now() - started;
            const scaled = Math.floor((rows * SLICE_TARGET_MS) / Math.max(ms, 0.05));
            this.#rows = Math.min(MAX_ROWS, Math.max(1, Math.min(scaled, rows * 2)));
        }
        const ms = this.#now() - started;
        this.#stats.slices += 1;
        this.#stats.maxSliceMs = Math.max(this.#stats.maxSliceMs, ms);
        this.#redrawMaxMs = Math.max(this.#redrawMaxMs, ms);
        if (redraw.y < image.height) {
            this.#next();
            return;
        }
        this.#redraw = null;
        this.#finish(image, content);
    }

    #finish(image: PixelBuffer, content: MinimapContent | null): void {
        this.#stats.redraws += 1;
        this.#stats.lastEnd = this.#now();
        this.#stats.lastMaxSliceMs = this.#redrawMaxMs;
        this.#onImage(image, content);
        this.#pump();
    }
}
