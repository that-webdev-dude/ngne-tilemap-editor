import type { Frame } from "@ngne/core";
import { CHUNK_SIZE } from "../../core/cells";
import type { CellRect } from "../../core/cells";
import { MapCompositor, cellScale } from "../../core/compositor";
import { drawnOpacity, effectiveValues, walkLayers } from "../../core/model";
import type {
    ImageLayer,
    LayerHighlight,
    PixelBuffer,
    Project,
    ProjectMap,
    TileLayer,
} from "../../core/model";
import {
    chooseResolution,
    chunkBytes,
    chunkShows,
    grow,
    neededChunks,
    planSets,
    tileLayersOf,
    tileReach,
    visibleCells,
    visibleCount,
    CHUNK_MEMORY_LIMIT,
    LIVE_LIMIT,
} from "./chunkPlan";
import type { ChunkSetPlan, Reach } from "./chunkPlan";
import type { Camera2D, DeviceSize } from "./geometry";
import { intersect, layerShift, toDevice, visibleRect } from "./geometry";
import { LAYER, drawUnderTiles, emitLiveImageLayer, emitLiveLayer } from "./liveTier";
import type { LiveCounts, LiveInputs } from "./liveTier";

// The chunk tier (ENGINE §4): each chunk set of the map is a grid of 32 × 32-cell chunk textures
// composited on the CPU by `core/compositor` and uploaded with `createTexture` and
// `updateTexture` (ENGINE §3). The textures are built in the background, one chunk per task,
// after a map opens and after a change of its sets; a changed cell is drawn as live quads over
// its chunk until the chunk's patch settles. No NGNE value import: the renderer is reached
// through `ChunkTarget`.

/** The texture ID of a chunk (ENGINE §3); `key` is the set's bottom layer. */
export function chunkTextureId(key: number, cx: number, cy: number): string {
    return `ed:chunk:${key}:${cx}:${cy}`;
}

/** Where `updateTexture` copies from and to; `TextureRegion` of NGNE. */
export interface ChunkRegion {
    sourceX: number;
    sourceY: number;
    width: number;
    height: number;
    destinationX: number;
    destinationY: number;
}

/** What the renderer offers for editable textures; `WebGPURenderer` has this shape. */
export interface ChunkTarget {
    createTexture(id: string, width: number, height: number, signal?: AbortSignal): Promise<void>;
    updateTexture(
        id: string,
        source: HTMLCanvasElement,
        region: ChunkRegion,
        signal?: AbortSignal,
    ): Promise<void>;
    releaseTexture(id: string): void;
    /** The renderer holds a registration for `id` (it drops one after a failed copy). */
    has(id: string): boolean;
}

/**
 * Makes the source of an update: a canvas of its own, kept unchanged until the update settles.
 * It copies the pixels, whose buffer is used again.
 */
export type ChunkSourceFn = (pixels: PixelBuffer) => HTMLCanvasElement;

/** A canvas holding the pixels (straight RGBA8, as the compositor gives them). */
export const canvasFromPixels: ChunkSourceFn = (pixels) => {
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!context) throw new Error("A chunk needs a 2D canvas context.");
    // Pixel buffers never sit on shared memory.
    const data = pixels.data as Uint8ClampedArray<ArrayBuffer>;
    context.putImageData(new ImageData(data, pixels.width, pixels.height), 0, 0);
    return canvas;
};

/** Runs `job` in a task of its own, soon; returns what cancels it. */
export type SliceFn = (job: () => void) => () => void;

/**
 * A task through a message channel: unlike nested `setTimeout(0)`, it is not clamped to 4 ms,
 * and the browser still renders frames between tasks.
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

export interface ChunkHooks {
    /** A build finished, a patch settled or a chunk failed: draw again. */
    onChange(): void;
    /** A chunk could not be created or updated after retries; it stays drawn as live quads. */
    onError(error: unknown): void;
}

/** What the chunk tier reports (the test hook and the benchmarks read it). */
export interface ChunkStats {
    /** Texels per cell; 0 while the map has no chunk tier. */
    texelsPerCell: number;
    sets: number;
    chunks: number;
    /** The build of the current sets has finished: the tier can draw. */
    ready: boolean;
    /** Chunks with a patch to composite, queued, being created or in flight. */
    pending: number;
    /** Chunks drawn with live quads over them. */
    live: number;
    /** GPU bytes of the chunk textures that exist. */
    bytes: number;
    /** Tasks run: a texture created, or texels composited and submitted. */
    slices: number;
    /** The longest of them since the current or last build began, in milliseconds. */
    maxSliceMs: number;
    /** Milliseconds from the start of the last build or rebuild to its end; 0 while none ended. */
    lastBuildMs: number;
    /** Builds and rebuilds finished. */
    builds: number;
    /** `updateTexture` calls that rejected. */
    rejected: number;
}

/**
 * Texture creations and updates under way at once. NGNE finishes each in tasks of its own (it
 * allocates and uploads a created texture's image, reads an update's source back from a 2D
 * canvas); many at once finish together in one long task, so the build waits for them instead.
 */
const MAX_IN_FLIGHT = 2;

/** Consecutive failures of one chunk before it is reported and left to its live quads. */
const MAX_FAILURES = 3;

/** What the chunk tier draws, in order: a chunk set, or an image layer between sets. */
type DrawItem = { kind: "set"; set: ChunkSet } | { kind: "image"; layer: ImageLayer };

interface ChunkSet {
    plan: ChunkSetPlan;
    layers: TileLayer[];
    /** The set's chunks, in row order. */
    chunks: Chunk[];
}

/** A rectangle of a chunk's texels, chunk-local. */
interface TexelRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Chunk {
    id: string;
    set: ChunkSet;
    cx: number;
    cy: number;
    /** `createTexture` resolved and the registration was not dropped since. */
    registered: boolean;
    creating: AbortController | null;
    /** The texture holds a composite of every texel: it can be drawn. */
    populated: boolean;
    /** Texels to composite and upload. */
    dirty: TexelRect | null;
    /** Cells (layer space) the texture does not show yet: drawn as live quads over it. */
    live: CellRect | null;
    queued: boolean;
    inFlight: boolean;
    failures: number;
    /** Left to its live quads after `MAX_FAILURES`. */
    failed: boolean;
}

function union<R extends { x: number; y: number; width: number; height: number }>(
    a: R | null,
    b: R,
): R {
    if (a === null) return { ...b };
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
        ...a,
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
    };
}

export interface ChunkTierOptions {
    target: ChunkTarget;
    hooks: ChunkHooks;
    /** Default `canvasFromPixels`. */
    source?: ChunkSourceFn;
    /** Default `messageSlice`. */
    slice?: SliceFn;
    /** Default `performance.now`. */
    now?: () => number;
}

export class ChunkTier {
    readonly #target: ChunkTarget;
    readonly #hooks: ChunkHooks;
    readonly #source: ChunkSourceFn;
    readonly #slice: SliceFn;
    readonly #now: () => number;

    #project: Project | null = null;
    #map: ProjectMap | null = null;
    #compositor: MapCompositor | null = null;
    #reach: Reach = { left: 0, right: 0, up: 0, down: 0 };
    /** The sets' signature when planned; "" asks for a new plan. */
    #signature = "";
    /** Highlight Current Layer as of the last sync; chunks are composited with it. */
    #highlight: LayerHighlight | null = null;
    /** The next plan composites every set again (a structural change). */
    #rebuildAll = false;
    #texels = 0;
    #sets: ChunkSet[] = [];
    readonly #chunks = new Map<string, Chunk>();
    readonly #queue: Chunk[] = [];
    #cancelSlice: (() => void) | null = null;
    /** A build is under way: it ends when `#remaining()` is 0. */
    #building = false;
    #buildStarted = 0;
    #disposed = false;
    /** The buffer whole chunks are composited into. */
    #scratch: PixelBuffer | null = null;
    readonly #stats = {
        slices: 0,
        maxSliceMs: 0,
        lastBuildMs: 0,
        builds: 0,
        rejected: 0,
    };

    constructor(options: ChunkTierOptions) {
        this.#target = options.target;
        this.#hooks = options.hooks;
        this.#source = options.source ?? canvasFromPixels;
        this.#slice = options.slice ?? messageSlice;
        this.#now = options.now ?? (() => performance.now());
    }

    /** The build of the current sets has finished, so the tier can draw the map. */
    get ready(): boolean {
        return this.#sets.length > 0 && !this.#building;
    }

    get stats(): ChunkStats {
        let pending = 0;
        let live = 0;
        let registered = 0;
        for (const chunk of this.#chunks.values()) {
            if (
                !chunk.failed &&
                (chunk.dirty !== null || chunk.queued || chunk.inFlight || chunk.creating)
            ) {
                pending += 1;
            }
            if (chunk.live !== null) live += 1;
            if (chunk.registered) registered += 1;
        }
        return {
            texelsPerCell: this.#texels,
            sets: this.#sets.length,
            chunks: this.#chunks.size,
            ready: this.ready,
            pending,
            live,
            bytes: chunkBytes(registered, this.#texels),
            ...this.#stats,
        };
    }

    /** The cells drawn as live quads over their chunks, by set index bottom to top (tests). */
    liveCells(): { set: number; cells: CellRect }[] {
        const live: { set: number; cells: CellRect }[] = [];
        this.#sets.forEach((set, index) => {
            for (const chunk of set.chunks) {
                if (chunk.live !== null) live.push({ set: index, cells: { ...chunk.live } });
            }
        });
        return live;
    }

    /**
     * Follows the scene: another map or project is planned anew (the old chunks are released,
     * ENGINE §3 eviction and map close); so is a change of the map's sets (a layer's
     * visibility, opacity, parallax or offset, a layer added or deleted). A set whose layers and
     * opacities stay keeps its chunks, wherever it is drawn. `size` is the canvas in device
     * pixels, which sets the resolution of a new plan.
     */
    sync(
        project: Project,
        map: ProjectMap,
        size: DeviceSize,
        highlight: LayerHighlight | null = null,
    ): void {
        if (this.#disposed) return;
        this.#highlight = highlight;
        if (project !== this.#project || map !== this.#map) {
            this.#releaseAll();
            this.#project = project;
            this.#map = map;
            this.#compositor = null;
            this.#signature = "";
        }
        const plans = planSets(map, highlight);
        const signature = plans.map((plan) => `${plan.key}:${plan.content}`).join("|");
        if (signature === this.#signature) {
            // Only where the sets are drawn may have changed.
            plans.forEach((plan, index) => {
                const set = this.#sets[index];
                if (set) set.plan = plan;
            });
            return;
        }
        // A map below the live tier's limit never needs the chunk tier: no plan until it grows.
        if (visibleCells(map, plans) <= LIVE_LIMIT) {
            if (this.#sets.length > 0) this.#releaseAll();
            return;
        }
        this.#plan(project, map, plans, signature, size);
    }

    /** No map is shown (the last one closed): every chunk is released (ENGINE §3, map close). */
    clear(): void {
        if (this.#disposed || this.#map === null) return;
        this.#releaseAll();
        this.#project = null;
        this.#map = null;
        this.#compositor = null;
    }

    /**
     * A command changed the document (`Command.touched`, SPEC §3): the chunks under changed
     * cells are patched, a changed tileset rebuilds every chunk, a structural change plans anew.
     */
    noteTouched(touched: {
        mapId: string | null;
        layerIds: readonly number[];
        cellRects: readonly CellRect[];
        tilesetIds: readonly string[];
        structure: boolean;
    }): void {
        const map = this.#map;
        if (this.#disposed || map === null) return;
        if (touched.mapId !== null && touched.mapId !== map.id) return;
        if (touched.structure) {
            // Tilesets, images or layers were added, removed or resized: plan and composite
            // everything again at the next sync.
            this.#compositor = null;
            this.#signature = "";
            this.#rebuildAll = true;
            return;
        }
        if (touched.tilesetIds.length > 0) {
            // Every chunk is composited again; the next sync plans again too, as tiles may now
            // reach into other chunks.
            this.#compositor = null;
            this.#reach = this.#project ? tileReach(this.#project, map) : this.#reach;
            this.#signature = "";
            this.#rebuild(this.#sets);
        }
        if (touched.cellRects.length === 0 || this.#sets.length === 0) return;
        const layers = new Set(touched.layerIds);
        for (const set of this.#sets) {
            if (layers.size > 0 && !set.plan.layerIds.some((id) => layers.has(id))) continue;
            for (const rect of touched.cellRects) this.#patch(set, rect);
        }
    }

    /**
     * For each set bottom to top, its chunk quads, then over the cells its chunks do not show
     * yet everything up to the set drawn again: the checkerboard and background (`workspace`,
     * 0xRRGGBB, outside the map), the layers of the sets below as live quads, then its own. So a
     * pending cell shows the document, whatever its stale chunk holds. A visible image layer
     * between two sets draws its texture between them (`planSets` ends a set at one), and again
     * under a patch of a set above it. Live quads are counted in `counts`; returns the chunk
     * quads.
     */
    draw(
        frame: Frame,
        inputs: LiveInputs,
        camera: Camera2D,
        counts: LiveCounts,
        workspace: number,
    ): number {
        const map = this.#map;
        if (map === null) return 0;
        let chunkQuads = 0;
        const { size } = inputs;
        const visible = visibleRect(camera, size);
        const { scale } = camera;
        const chunkWidth = CHUNK_SIZE * map.tileWidth;
        const chunkHeight = CHUNK_SIZE * map.tileHeight;
        const drawn: DrawItem[] = [];
        let depth = 0;
        for (const item of this.#drawOrder(map, inputs.scene.highlight ?? null)) {
            if (item.kind === "image") {
                depth += 1;
                emitLiveImageLayer(frame, inputs, camera, item.layer, visible, { depth, counts });
                drawn.push(item);
                continue;
            }
            const { set } = item;
            drawn.push(item);
            depth += 1;
            const shift = layerShift(map, camera, set.plan.placement);
            const live: CellRect[] = [];
            for (const chunk of set.chunks) {
                if (chunk.live !== null) live.push(chunk.live);
                if (!chunk.populated || !chunk.registered) continue;
                const area = {
                    x: chunk.cx * chunkWidth + shift.x,
                    y: chunk.cy * chunkHeight + shift.y,
                    width: chunkWidth,
                    height: chunkHeight,
                };
                if (!intersect(area, visible)) continue;
                const at = toDevice(camera, size, area.x, area.y);
                const w = chunkWidth * scale;
                const h = chunkHeight * scale;
                frame.sprite({
                    x: at.x + w / 2,
                    y: at.y + h / 2,
                    width: w,
                    height: h,
                    texture: chunk.id,
                    u: 0,
                    v: 0,
                    uw: 1,
                    vh: 1,
                    layer: LAYER.tiles,
                    depth,
                });
                chunkQuads += 1;
            }
            depth += 1;
            for (const cells of live) {
                const area = {
                    x: cells.x * map.tileWidth + shift.x,
                    y: cells.y * map.tileHeight + shift.y,
                    width: cells.width * map.tileWidth,
                    height: cells.height * map.tileHeight,
                };
                const shown = intersect(area, visible);
                if (!shown) continue;
                const place = { layer: LAYER.tiles, depth };
                drawUnderTiles(frame, inputs, camera, shown, counts, { ...place, workspace });
                for (const below of drawn) {
                    if (below.kind === "image") {
                        emitLiveImageLayer(frame, inputs, camera, below.layer, shown, {
                            depth,
                            counts,
                            clip: true,
                        });
                        continue;
                    }
                    for (const layer of below.set.layers) {
                        emitLiveLayer(frame, inputs, camera, layer, shown, {
                            depth,
                            counts,
                            clip: true,
                        });
                    }
                }
            }
        }
        return chunkQuads;
    }

    /**
     * The sets and the visible image layers of `map`, bottom to top, as `planSets` walks the
     * layers: a set where its first layer is, an image layer where it is.
     */
    #drawOrder(map: ProjectMap, highlight: LayerHighlight | null): DrawItem[] {
        const setOf = new Map<number, ChunkSet>();
        for (const set of this.#sets) for (const id of set.plan.layerIds) setOf.set(id, set);
        const items: DrawItem[] = [];
        let last: ChunkSet | null = null;
        for (const { layer, ancestors } of walkLayers(map.layers)) {
            if (layer.type === "image") {
                const values = effectiveValues(layer, ancestors);
                if (!values.visible || drawnOpacity(layer, ancestors, values, highlight) === 0) {
                    continue;
                }
                items.push({ kind: "image", layer });
                last = null;
                continue;
            }
            const set = setOf.get(layer.id);
            if (set === undefined || set === last) continue;
            items.push({ kind: "set", set });
            last = set;
        }
        return items;
    }

    /** The visible count of the tier choice (ENGINE §4) for the planned sets; 0 without a plan. */
    visibleCount(camera: Camera2D, size: DeviceSize): number {
        const map = this.#map;
        if (map === null || this.#sets.length === 0) return 0;
        return visibleCount(
            map,
            this.#sets.map((set) => set.plan),
            camera,
            size,
        );
    }

    dispose(): void {
        this.#disposed = true;
        this.#cancelSlice?.();
        this.#cancelSlice = null;
        for (const chunk of this.#chunks.values()) chunk.creating?.abort();
        // The renderer is disposed next and its textures with it.
        this.#chunks.clear();
        this.#queue.length = 0;
    }

    #plan(
        project: Project,
        map: ProjectMap,
        plans: ChunkSetPlan[],
        signature: string,
        size: DeviceSize,
    ): void {
        const reach = tileReach(project, map);
        const needed = plans.map((plan) => neededChunks(map, plan, reach));
        const count = needed.reduce((sum, chunks) => sum + chunks.length, 0);
        const texels = chooseResolution(map, visibleCells(map, plans), count, size);
        if (texels === null || texels !== this.#texels) this.#releaseAll();
        // Without a resolution (not even one texel per cell fits the memory budget) the live
        // tier draws; the signature keeps this from being planned again at every frame.
        this.#signature = signature;
        if (texels === null) return;
        this.#texels = texels;
        this.#reach = reach;
        this.#compositor = null;

        const previous = new Map(this.#sets.map((set) => [set.plan.key, set.plan.content]));
        const all = this.#rebuildAll;
        this.#rebuildAll = false;
        const kept = new Set<string>();
        const changed: ChunkSet[] = [];
        this.#sets = plans.map((plan, index) => {
            const set: ChunkSet = { plan, layers: tileLayersOf(map, plan.layerIds), chunks: [] };
            const same = !all && previous.get(plan.key) === plan.content;
            for (const { cx, cy } of needed[index]!) {
                const chunk = this.#chunk(set, cx, cy);
                kept.add(chunk.id);
                set.chunks.push(chunk);
            }
            if (!same) changed.push(set);
            return set;
        });
        for (const [id, chunk] of this.#chunks) {
            if (!kept.has(id)) this.#release(chunk);
        }
        // Chunks new to the plan are not populated; those of a set whose content changed are
        // composited again. The rest are drawn as they are.
        this.#rebuild(changed);
    }

    /** The chunk with these coordinates in `set`, created when new; adopted by `set`. */
    #chunk(set: ChunkSet, cx: number, cy: number): Chunk {
        const id = chunkTextureId(set.plan.key, cx, cy);
        const found = this.#chunks.get(id);
        if (found) {
            found.set = set;
            return found;
        }
        const chunk: Chunk = {
            id,
            set,
            cx,
            cy,
            registered: false,
            creating: null,
            populated: false,
            dirty: null,
            live: null,
            queued: false,
            inFlight: false,
            failures: 0,
            failed: false,
        };
        this.#chunks.set(id, chunk);
        return chunk;
    }

    /** Composites every chunk of `sets`, and every chunk not populated, again; the tier waits. */
    #rebuild(sets: readonly ChunkSet[]): void {
        for (const set of sets) {
            for (const chunk of set.chunks) chunk.populated = false;
        }
        this.#beginBuild();
    }

    #beginBuild(): void {
        const full = this.#fullRect();
        let unbuilt = 0;
        for (const set of this.#sets) {
            for (const chunk of set.chunks) {
                if (chunk.populated) continue;
                unbuilt += 1;
                chunk.dirty = full;
                chunk.live = null;
                chunk.failures = 0;
                chunk.failed = false;
            }
        }
        if (unbuilt === 0) {
            // A change that left nothing to composite (a set removed) ends a build under way.
            if (this.#building) this.#endBuild();
            return;
        }
        if (!this.#building) {
            this.#buildStarted = this.#now();
            this.#stats.maxSliceMs = 0;
        }
        this.#building = true;
        for (const set of this.#sets) for (const chunk of set.chunks) this.#kick(chunk);
    }

    #fullRect(): TexelRect {
        const side = CHUNK_SIZE * this.#texels;
        return { x: 0, y: 0, width: side, height: side };
    }

    /**
     * Marks what a change of the cells `rect` of `set`'s layers alters. A chunk that shows
     * something now gets a texture within the memory budget; past it, the next sync plans the
     * tier again (ENGINE §4, resolution). A chunk that shows nothing any more is released.
     */
    #patch(set: ChunkSet, rect: CellRect): void {
        const map = this.#map!;
        const area = grow(rect, this.#reach);
        const cx0 = Math.floor(area.x / CHUNK_SIZE);
        const cy0 = Math.floor(area.y / CHUNK_SIZE);
        const cx1 = Math.floor((area.x + area.width - 1) / CHUNK_SIZE);
        const cy1 = Math.floor((area.y + area.height - 1) / CHUNK_SIZE);
        const texels = this.#texels;
        for (let cy = cy0; cy <= cy1; cy += 1) {
            for (let cx = cx0; cx <= cx1; cx += 1) {
                const cells = intersect(area, {
                    x: cx * CHUNK_SIZE,
                    y: cy * CHUNK_SIZE,
                    width: CHUNK_SIZE,
                    height: CHUNK_SIZE,
                });
                if (!cells) continue;
                let chunk = this.#chunks.get(chunkTextureId(set.plan.key, cx, cy));
                const shows = chunkShows(map, set.layers, this.#reach, cx, cy);
                if (!chunk) {
                    // A chunk that showed nothing: it gets a texture now, if it shows something.
                    if (!shows) continue;
                    if (chunkBytes(this.#chunks.size + 1, texels) > CHUNK_MEMORY_LIMIT) {
                        // Past the budget: T is chosen anew, and the live tier draws while the
                        // tier builds again.
                        this.#signature = "";
                        continue;
                    }
                    chunk = this.#chunk(set, cx, cy);
                    set.chunks.push(chunk);
                    chunk.dirty = this.#fullRect();
                } else if (!shows) {
                    this.#evict(chunk);
                    continue;
                }
                chunk.failed = false;
                chunk.failures = 0;
                // A chunk not populated yet (its first composite may be in flight) is
                // composited whole: only a whole composite populates it.
                if (!chunk.populated) chunk.dirty = this.#fullRect();
                chunk.dirty = union(chunk.dirty, {
                    x: (cells.x - cx * CHUNK_SIZE) * texels,
                    y: (cells.y - cy * CHUNK_SIZE) * texels,
                    width: cells.width * texels,
                    height: cells.height * texels,
                });
                chunk.live = union(chunk.live, cells);
                this.#kick(chunk);
            }
        }
    }

    /**
     * Moves a chunk on: queues the creation of its texture or its dirty texels. Both run in
     * slices: creating a texture allocates its image, and a map's worth at once is a long task.
     */
    #kick(chunk: Chunk): void {
        if (this.#disposed || chunk.failed || chunk.queued || chunk.inFlight) return;
        if (chunk.creating !== null || this.#chunks.get(chunk.id) !== chunk) return;
        if (chunk.registered && chunk.dirty === null) return;
        chunk.queued = true;
        this.#queue.push(chunk);
        this.#pump();
    }

    #create(chunk: Chunk): void {
        const abort = new AbortController();
        chunk.creating = abort;
        const side = CHUNK_SIZE * this.#texels;
        this.#target.createTexture(chunk.id, side, side, abort.signal).then(
            () => {
                if (abort.signal.aborted) return;
                chunk.creating = null;
                chunk.registered = true;
                chunk.dirty = this.#fullRect();
                // Populated next, before more textures are created: the GPU's work stays even,
                // and NGNE's readback of the update's source does not wait behind a backlog.
                if (!chunk.queued && !chunk.failed) {
                    chunk.queued = true;
                    this.#queue.unshift(chunk);
                }
                this.#pump();
            },
            (error: unknown) => {
                if (abort.signal.aborted || this.#disposed) return;
                chunk.creating = null;
                this.#failed(chunk, error);
                this.#pump();
            },
        );
    }

    /**
     * The index in the queue of the next chunk a slice can take, while fewer than
     * `MAX_IN_FLIGHT` creations and updates are under way; −1 for none.
     */
    #next(): number {
        let inFlight = 0;
        for (const chunk of this.#chunks.values()) {
            if (chunk.inFlight || chunk.creating !== null) inFlight += 1;
        }
        return inFlight < MAX_IN_FLIGHT && this.#queue.length > 0 ? 0 : -1;
    }

    #pump(): void {
        if (this.#cancelSlice !== null || this.#disposed || this.#next() < 0) return;
        this.#cancelSlice = this.#slice(() => {
            this.#cancelSlice = null;
            this.#runSlice();
            this.#pump();
        });
    }

    /**
     * One task for the next queued chunk: creates its texture, or composites its dirty texels and
     * submits them.
     */
    #runSlice(): void {
        const at = this.#next();
        if (at < 0) return;
        const chunk = this.#queue.splice(at, 1)[0]!;
        chunk.queued = false;
        if (this.#chunks.get(chunk.id) !== chunk || chunk.creating !== null) return;
        const started = this.#now();
        if (!chunk.registered) {
            this.#create(chunk);
            this.#timeSlice(started);
            return;
        }
        if (chunk.dirty === null) return;
        const map = this.#map!;
        this.#compositor ??= new MapCompositor(this.#project!, map);
        const rect = chunk.dirty;
        chunk.dirty = null;
        const side = CHUNK_SIZE * this.#texels;
        const full = rect.width === side && rect.height === side;
        // A whole chunk is composited into one buffer used again and again: less garbage, so
        // fewer collector pauses in the slices.
        if (full && this.#scratch?.width !== side) {
            this.#scratch = {
                width: side,
                height: side,
                data: new Uint8ClampedArray(side * side * 4),
            };
        }
        const request = {
            x: chunk.cx * side + rect.x,
            y: chunk.cy * side + rect.y,
            width: rect.width,
            height: rect.height,
            scaleX: cellScale(this.#texels, map.tileWidth),
            scaleY: cellScale(this.#texels, map.tileHeight),
            layerIds: new Set(chunk.set.plan.layerIds),
            layerSpace: true,
            background: false,
            highlight: this.#highlight,
        };
        const pixels = this.#compositor.composite(request, full ? this.#scratch! : undefined);
        const source = this.#source(pixels);
        chunk.inFlight = true;
        const update = this.#target.updateTexture(chunk.id, source, {
            sourceX: 0,
            sourceY: 0,
            width: rect.width,
            height: rect.height,
            destinationX: rect.x,
            destinationY: rect.y,
        });
        this.#timeSlice(started);
        update.then(
            () => this.#settled(chunk, full),
            (error: unknown) => this.#rejected(chunk, rect, error),
        );
    }

    #timeSlice(started: number): void {
        this.#stats.slices += 1;
        this.#stats.maxSliceMs = Math.max(this.#stats.maxSliceMs, this.#now() - started);
    }

    #settled(chunk: Chunk, full: boolean): void {
        chunk.inFlight = false;
        this.#pump();
        if (this.#chunks.get(chunk.id) !== chunk) return;
        chunk.failures = 0;
        // A full composite populates the chunk unless a newer change already waits: a rebuild
        // that began while it was in flight wants a composite of its own.
        if (full && !chunk.populated && chunk.dirty === null) {
            chunk.populated = true;
            this.#endBuildIfDone();
        }
        // The texture shows every change made so far: the live quads go. A frame is asked for
        // only when the image changes: while a build is under way the live tier draws, and a
        // frame per settled chunk would only slow the build.
        if (chunk.dirty === null && chunk.live !== null) {
            chunk.live = null;
            if (!this.#building) this.#hooks.onChange();
        }
        this.#kick(chunk);
    }

    #rejected(chunk: Chunk, rect: TexelRect, error: unknown): void {
        chunk.inFlight = false;
        this.#pump();
        this.#stats.rejected += 1;
        if (this.#chunks.get(chunk.id) !== chunk || this.#disposed) return;
        if (!this.#target.has(chunk.id)) {
            // The registration was dropped: create it again and repopulate it from the document;
            // until then its cells are drawn as live quads (ENGINE §3).
            chunk.registered = false;
            if (chunk.populated) {
                chunk.live = this.#cellsOf(chunk);
                chunk.populated = false;
            }
            // The renderer may hold it still and not say so (its inspection lists 1,000 entries
            // at most): released first, so that creating it again cannot meet the ID.
            this.#target.releaseTexture(chunk.id);
            chunk.dirty = this.#fullRect();
        } else {
            // The write was lost: composite the region again from the document and retry; the
            // texture still holds what it held before.
            chunk.dirty = union(chunk.dirty, rect);
        }
        this.#failed(chunk, error);
    }

    #failed(chunk: Chunk, error: unknown): void {
        chunk.failures += 1;
        if (chunk.failures >= MAX_FAILURES) {
            chunk.failed = true;
            if (chunk.live === null) chunk.live = this.#cellsOf(chunk);
            this.#hooks.onError(error);
            // The build does not wait for it: its cells are drawn as live quads.
            this.#endBuildIfDone();
            this.#hooks.onChange();
            return;
        }
        this.#kick(chunk);
    }

    /** All cells of a chunk, layer space. */
    #cellsOf(chunk: Chunk): CellRect {
        return {
            x: chunk.cx * CHUNK_SIZE,
            y: chunk.cy * CHUNK_SIZE,
            width: CHUNK_SIZE,
            height: CHUNK_SIZE,
        };
    }

    /** Ends the build under way once every chunk is populated or left to its live quads. */
    #endBuildIfDone(): void {
        if (!this.#building) return;
        for (const set of this.#sets) {
            for (const chunk of set.chunks) if (!chunk.populated && !chunk.failed) return;
        }
        this.#endBuild();
    }

    #endBuild(): void {
        this.#building = false;
        this.#stats.builds += 1;
        this.#stats.lastBuildMs = this.#now() - this.#buildStarted;
        this.#hooks.onChange();
    }

    /** Releases a chunk of the plan that shows nothing (ENGINE §3, eviction). */
    #evict(chunk: Chunk): void {
        const { chunks } = chunk.set;
        const at = chunks.indexOf(chunk);
        if (at >= 0) chunks.splice(at, 1);
        this.#release(chunk);
        // The build may have waited for it only.
        this.#endBuildIfDone();
    }

    #release(chunk: Chunk): void {
        chunk.creating?.abort();
        this.#chunks.delete(chunk.id);
        // Absent IDs are no-ops; a creation under way is cancelled by this too.
        this.#target.releaseTexture(chunk.id);
    }

    #releaseAll(): void {
        for (const chunk of [...this.#chunks.values()]) this.#release(chunk);
        this.#queue.length = 0;
        this.#sets = [];
        this.#texels = 0;
        this.#signature = "";
        this.#building = false;
    }
}
