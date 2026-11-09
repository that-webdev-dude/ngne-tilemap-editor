// The quad emitter shared by the editor's live tier and the generated runtime (SPEC 11.3,
// ENGINE 4): one tile layer into a sprite sink, tiles placed as FORMAT 1.2 and 1.3 say. The
// generator inlines this file into `ngne-tilemap.ts` (TE-050), so it has no imports and no
// export the runtime cannot carry.

/** The sprite fields the emitter sets; NGNE's `Sprite` has them all (SPEC 11.4). */
export interface SpriteLike {
    x: number;
    y: number;
    /** Negative mirrors. */
    width: number;
    height: number;
    /** Radians, clockwise on screen. */
    rotation: number;
    texture: string;
    u: number;
    v: number;
    uw: number;
    vh: number;
    alpha: number;
    color: number;
    layer: number;
    depth: number;
}

export interface SpriteSink {
    sprite(s: SpriteLike): void;
}

/** A tile layer's cells by coordinates; `CellStore` has this shape. 0 is an empty cell. */
export interface CellSource {
    get(x: number, y: number): number;
}

/** A row-major array of `width x height` cell values as a `CellSource`; outside it is empty. */
export class FlatCells implements CellSource {
    constructor(
        readonly data: ArrayLike<number>,
        readonly width: number,
        readonly height: number,
    ) {}

    get(x: number, y: number): number {
        return x < 0 || y < 0 || x >= this.width || y >= this.height
            ? 0
            : this.data[y * this.width + x]!;
    }
}

/**
 * How cell values name a tileset and a tile:
 * - `"slot"`: the editor's in-memory values (SPEC 2.2): bits 20..27 the tileset's slot, bits
 *   0..19 the tile ID.
 * - `"gid"`: the values of a file (FORMAT 1.2): the GID below the flags; the tileset is the one
 *   with the largest `firstGid` not above it, the tile `GID - firstGid`.
 * The flag bits are the same in both.
 */
export type CellMode = "slot" | "gid";

export interface EmitTileset {
    /** Texture ID of the packed image. */
    texture: string;
    tileWidth: number;
    tileHeight: number;
    offsetX: number;
    offsetY: number;
    /** `"slot"` mode: the tileset's slot, 1..255. `"gid"` mode: its `firstGid`. */
    key: number;
    /** Tile IDs, ascending or not; tile `ids[i]` has the rectangle `uv[4i .. 4i + 3]`. */
    ids: ArrayLike<number>;
    /** `u, v, uw, vh` per entry of `ids` (the tile's even rectangle as fractions of the image). */
    uv: ArrayLike<number>;
    /** Length of the tile ID span (`nextTileId`); at least the largest ID + 1. */
    span: number;
}

/** What one `emitLayer` call needs besides the cells. */
export interface EmitLayerOptions {
    /** Cells the layer has per side; cells outside are not read. */
    width: number;
    height: number;
    /** The map's grid cell size in pixels. */
    gridWidth: number;
    gridHeight: number;
    /**
     * The rectangle to draw, in the layer's own map pixels (the view moved by the layer's shift,
     * FORMAT 3.4). A tile is skipped only when none of its pixels lies inside it.
     */
    viewX: number;
    viewY: number;
    viewWidth: number;
    viewHeight: number;
    /** Added to every map position before `scale`; the layer's shift, or shift minus view origin. */
    translateX: number;
    translateY: number;
    /** Multiplies every position and size (FORMAT 1.3). */
    scale: number;
    alpha: number;
    color: number;
    layer: number;
    /** One depth for the whole layer. */
    depth: number;
}

/** Floats per orientation in a tileset's placement table. */
const PLACEMENT_STRIDE = 5;
/** Ints per bucketed cell: x, y, and `entry << 3 | orientation`. */
const BUCKET_STRIDE = 3;
/** Slack for the cell-range arithmetic: a cell too many is scanned, never one too few. */
const EPSILON = 1e-9;

/** `fx` and `fy` of the 8 orientations indexed `H<<2 | V<<1 | D`; `theta` is pi/2 when `D` is set (FORMAT 1.2). */
const FX = [1, 1, 1, -1, -1, 1, -1, -1] as const;
const FY = [1, -1, -1, -1, 1, 1, -1, 1] as const;

/**
 * The placement table of a tileset (FORMAT 1.3): per orientation, the quad centre relative to
 * the cell's bottom-left corner `B`, and the quad's signed size and rotation. Odd tile sizes
 * draw their even rectangle moved so the content stays on the centre.
 */
function placementTable(tileset: EmitTileset): Float64Array {
    const { tileWidth: tw, tileHeight: th, offsetX, offsetY } = tileset;
    const w = tw + (tw & 1);
    const h = th + (th & 1);
    const pw = w - tw;
    const ph = h - th;
    const table = new Float64Array(8 * PLACEMENT_STRIDE);
    for (let o = 0; o < 8; o += 1) {
        const d = (o & 1) !== 0;
        const fx = FX[o]!;
        const fy = FY[o]!;
        const x = offsetX + (d ? th : tw) / 2;
        const y = offsetY - (d ? tw : th) / 2;
        const row = o * PLACEMENT_STRIDE;
        table[row] = d ? x - (fy * ph) / 2 : x + (fx * pw) / 2;
        table[row + 1] = d ? y + (fx * pw) / 2 : y + (fy * ph) / 2;
        table[row + 2] = fx * w;
        table[row + 3] = fy * h;
        table[row + 4] = d ? Math.PI / 2 : 0;
    }
    return table;
}

interface Prepared {
    tileset: EmitTileset;
    /** Entry of a tile ID in `ids`/`uv`, -1 for none; length `span`. */
    entryOf: Int32Array;
    placement: Float64Array;
    /** Widest the tile is drawn in either direction: `max(tw, th)`. */
    reach: number;
    /** Cells of this tileset in the current layer, `BUCKET_STRIDE` ints each. */
    bucket: Int32Array;
    count: number;
}

export class QuadEmitter {
    /** The one sprite every `sink.sprite` call receives. */
    readonly sprite: SpriteLike = {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        texture: "",
        u: 0,
        v: 0,
        uw: 0,
        vh: 0,
        alpha: 1,
        color: 0xffffffff,
        layer: 0,
        depth: 0,
    };

    private readonly mode: CellMode;
    private readonly sets: Prepared[];
    /** `"slot"` mode: index in `sets` by slot, -1 for none. */
    private readonly bySlot = new Int16Array(256).fill(-1);
    /** `"gid"` mode: `sets` indexes ordered by `firstGid`. */
    private readonly byGid: number[];
    private lastSet = 0;

    /**
     * Quads of one layer come out grouped by tileset in the order of `tilesets`. The tilesets are
     * read here once and not again: build a new emitter when a tileset changes.
     */
    constructor(mode: CellMode, tilesets: readonly EmitTileset[]) {
        this.mode = mode;
        this.sets = tilesets.map((tileset) => {
            const entryOf = new Int32Array(tileset.span).fill(-1);
            for (let i = 0; i < tileset.ids.length; i += 1) entryOf[tileset.ids[i]!] = i;
            return {
                tileset,
                entryOf,
                placement: placementTable(tileset),
                reach: Math.max(tileset.tileWidth, tileset.tileHeight),
                bucket: new Int32Array(0),
                count: 0,
            };
        });
        this.sets.forEach(({ tileset }, index) => {
            if (mode === "slot") this.bySlot[tileset.key & 255] = index;
        });
        this.byGid = this.sets
            .map((_, index) => index)
            .sort((a, b) => this.sets[a]!.tileset.key - this.sets[b]!.tileset.key);
    }

    /**
     * Emits the tiles of `cells` that can show in the view, as `sink.sprite(this.sprite)` calls:
     * grouped by tileset, row-major inside a tileset, all with `options.depth`. Allocates
     * nothing per quad. A cell naming no tileset or tile is skipped.
     */
    emitLayer(sink: SpriteSink, cells: CellSource, options: EmitLayerOptions): void {
        const { width, height, gridWidth, gridHeight, viewX, viewY, viewWidth, viewHeight } =
            options;
        const sets = this.sets;
        if (sets.length === 0 || width <= 0 || height <= 0) return;
        if (!(viewWidth > 0) || !(viewHeight > 0)) return;

        // The cell range any tileset can show in: a tile reaches `reach` pixels from its cell
        // corner in either direction, moved by its offset.
        let x0 = width;
        let x1 = -1;
        let y0 = height;
        let y1 = -1;
        for (const set of sets) {
            const { offsetX, offsetY } = set.tileset;
            x0 = Math.min(x0, Math.floor((viewX - offsetX - set.reach) / gridWidth - EPSILON) + 1);
            x1 = Math.max(x1, Math.ceil((viewX + viewWidth - offsetX) / gridWidth + EPSILON) - 1);
            y0 = Math.min(y0, Math.floor((viewY - offsetY) / gridHeight - EPSILON));
            y1 = Math.max(
                y1,
                Math.ceil((viewY + viewHeight - offsetY + set.reach) / gridHeight + EPSILON) - 2,
            );
        }
        x0 = Math.max(x0, 0);
        y0 = Math.max(y0, 0);
        x1 = Math.min(x1, width - 1);
        y1 = Math.min(y1, height - 1);
        if (x0 > x1 || y0 > y1) return;

        for (const set of sets) set.count = 0;
        for (let y = y0; y <= y1; y += 1) {
            for (let x = x0; x <= x1; x += 1) {
                const value = cells.get(x, y);
                if (value === 0) continue;
                const index = this.resolve(value);
                if (index < 0) continue;
                const set = sets[index]!;
                const tile =
                    this.mode === "slot" ? value & 0xfffff : (value & 0x0fffffff) - set.tileset.key;
                const entry = set.entryOf[tile] ?? -1;
                if (entry < 0) continue;
                // The range above is a superset; this is the exact test, on the tile's pixels.
                const swapped = (value >>> 29) & 1;
                const { tileWidth, tileHeight, offsetX, offsetY } = set.tileset;
                const left = x * gridWidth + offsetX;
                const bottom = (y + 1) * gridHeight + offsetY;
                if (
                    left + (swapped ? tileHeight : tileWidth) <= viewX ||
                    left >= viewX + viewWidth ||
                    bottom <= viewY ||
                    bottom - (swapped ? tileWidth : tileHeight) >= viewY + viewHeight
                ) {
                    continue;
                }
                this.push(set, x, y, (entry << 3) | (value >>> 29));
            }
        }

        const sprite = this.sprite;
        const { translateX, translateY, scale } = options;
        sprite.alpha = options.alpha;
        sprite.color = options.color;
        sprite.layer = options.layer;
        sprite.depth = options.depth;
        for (const set of sets) {
            const { bucket, placement } = set;
            const { uv, texture } = set.tileset;
            sprite.texture = texture;
            for (let i = 0, end = set.count * BUCKET_STRIDE; i < end; i += BUCKET_STRIDE) {
                const packed = bucket[i + 2]!;
                const entry = packed >> 3;
                const row = (packed & 7) * PLACEMENT_STRIDE;
                sprite.x = (bucket[i]! * gridWidth + placement[row]! + translateX) * scale;
                sprite.y =
                    ((bucket[i + 1]! + 1) * gridHeight + placement[row + 1]! + translateY) * scale;
                sprite.width = placement[row + 2]! * scale;
                sprite.height = placement[row + 3]! * scale;
                sprite.rotation = placement[row + 4]!;
                sprite.u = uv[entry * 4]!;
                sprite.v = uv[entry * 4 + 1]!;
                sprite.uw = uv[entry * 4 + 2]!;
                sprite.vh = uv[entry * 4 + 3]!;
                sink.sprite(sprite);
            }
        }
    }

    /** The index in `sets` of the tileset a non-empty value names, or -1. */
    private resolve(value: number): number {
        if (this.mode === "slot") return this.bySlot[(value >>> 20) & 255]!;
        const gid = value & 0x0fffffff;
        const sets = this.sets;
        const last = sets[this.lastSet]!;
        if (gid >= last.tileset.key && gid - last.tileset.key < last.entryOf.length) {
            return this.lastSet;
        }
        // The tileset with the largest `firstGid` not above `gid`.
        const order = this.byGid;
        let low = 0;
        let high = order.length - 1;
        let found = -1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (sets[order[mid]!]!.tileset.key <= gid) {
                found = order[mid]!;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        if (found < 0 || gid - sets[found]!.tileset.key >= sets[found]!.entryOf.length) return -1;
        this.lastSet = found;
        return found;
    }

    private push(set: Prepared, x: number, y: number, packed: number): void {
        const at = set.count * BUCKET_STRIDE;
        if (at + BUCKET_STRIDE > set.bucket.length) {
            const grown = new Int32Array(Math.max(at + BUCKET_STRIDE, set.bucket.length * 2, 96));
            grown.set(set.bucket);
            set.bucket = grown;
        }
        set.bucket[at] = x;
        set.bucket[at + 1] = y;
        set.bucket[at + 2] = packed;
        set.count += 1;
    }
}
