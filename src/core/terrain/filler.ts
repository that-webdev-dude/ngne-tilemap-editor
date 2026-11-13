import type { CellRect } from "../cells";
import { regionBounds, regionOf } from "../fill";
import type { Region } from "../fill";
import type { PixelPoint } from "../raster/line";
import { effectiveTypeForColor, transitionPenalty, wangIdOfCell } from "./analysis";
import type { TerrainAnalysis } from "./analysis";
import type { Random } from "./random";
import {
    AROUND,
    BOTTOM,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
    INDEX_MASK,
    LEFT,
    RIGHT,
    TOP,
    TOP_LEFT,
    TOP_RIGHT,
    WANG_INDEXES,
    isCorner,
    nextIndex,
    oppositeIndex,
    previousIndex,
    typeUsesIndex,
} from "./wangId";
import type { WangIndex } from "./wangId";

// The terrain filler (SPEC §5.2), shared by the terrain brush (§5.3) and terrain fill mode
// (§5.4). Painting leaves a constraint on each touched cell: a wished terrain per index, some
// of them hard, starting from the terrain ID the cell holds. `apply` then walks the painted
// region rectangle by rectangle and gives each cell the candidate with the lowest transition
// penalty that meets its hard indexes; each resolved cell hardens the indexes its neighbours
// share with it. Fill tools first seed the region's border from the cells around it; the
// brush instead re-resolves, within the region grown by the set's maximum distance, the
// neighbours its change no longer fits (corrections). Ties are broken by the seeded generator,
// and without corrections an incomplete set looks one step ahead so no neighbour is left
// without a tile.
//
// State lives in a table of slots keyed by cell, with typed arrays per slot, so one brush step
// costs in proportion to the cells it touches, never to the map.

/** The tile layer before the change: the value of cell `(x, y)`, 0 when it is empty. */
export type TerrainBack = (x: number, y: number) => number;

/** What a filler works on. */
export interface TerrainFillerOptions {
    analysis: TerrainAnalysis;
    /** The tile layer as it is before the change. */
    back: TerrainBack;
    /** Map width in cells. */
    width: number;
    /** Map height in cells. */
    height: number;
    /** Breaks ties between equal candidates. */
    random: Random;
    /** Re-resolve neighbours the change no longer fits (the brush); default false. */
    corrections?: boolean;
    /** The empty cell is a candidate; default true. */
    erasing?: boolean;
}

/** A resolved cell and its new value. */
export interface TerrainCell {
    readonly x: number;
    readonly y: number;
    readonly value: number;
}

/** What `apply` resolved. */
export interface TerrainFillResult {
    /** Resolved cells, in the order they were resolved. */
    readonly cells: readonly TerrainCell[];
    /** Cells that could not be resolved; they stay as they are. */
    readonly invalid: Region;
    /** The painted region grown by the maximum distance, clipped to the map; null when empty. */
    readonly bounds: CellRect | null;
}

/** Slot flags. */
const HAS_CONSTRAINT = 1;
const IN_REGION = 2;
const RESOLVED = 4;
const SETTLED = 8;
const INVALID = 16;
const DONE = RESOLVED | SETTLED;

/** Cell coordinates stay below this in absolute value, so a cell's key is a safe integer. */
const COORDINATE_LIMIT = 2 ** 25;
const KEY_SPAN = 2 * COORDINATE_LIMIT;

/** A constraint with no wish at all. Never written. */
const NO_WISH: Uint8Array = new Uint8Array(WANG_INDEXES).fill(INDEX_MASK);
/** The terrain ID of the empty cell. Never written. */
const NO_TERRAIN: Uint8Array = new Uint8Array(WANG_INDEXES);

/** Per direction, the indexes of the neighbour there that it shares with the cell. */
const SHARED: readonly (readonly WangIndex[])[] = AROUND.map((_, direction) => {
    const facing = oppositeIndex(direction);
    return isCorner(direction) ? [facing] : [facing, nextIndex(facing), previousIndex(facing)];
});

/** The indexes of each side of a rectangle that border seeding fills. */
const TOP_SIDE: readonly WangIndex[] = [TOP_LEFT, TOP, TOP_RIGHT];
const RIGHT_SIDE: readonly WangIndex[] = [TOP_RIGHT, RIGHT, BOTTOM_RIGHT];
const BOTTOM_SIDE: readonly WangIndex[] = [BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT];
const LEFT_SIDE: readonly WangIndex[] = [BOTTOM_LEFT, LEFT, TOP_LEFT];

const bit = (mask: number, index: number): boolean => ((mask >> index) & 1) === 1;

/** The key of cell `(x, y)`; `RangeError` for a coordinate that is not a small integer. */
function cellKey(x: number, y: number): number {
    for (const value of [x, y]) {
        if (!Number.isInteger(value) || Math.abs(value) >= COORDINATE_LIMIT) {
            throw new RangeError(`Cell coordinates must be integers below 2^25, got ${x}, ${y}.`);
        }
    }
    return (y + COORDINATE_LIMIT) * KEY_SPAN + (x + COORDINATE_LIMIT);
}

/**
 * Writes the terrain ID `source[at..]` resolved at a cell into the constraint `wish[to..]` of
 * its neighbour in `direction`: every index they share takes the terrain at the same place and
 * becomes hard. Returns the neighbour's new hard mask.
 */
function propagate(
    source: Uint8Array,
    at: number,
    direction: number,
    wish: Uint8Array,
    to: number,
    hard: number,
): number {
    const facing = oppositeIndex(direction);
    wish[to + facing] = source[at + direction];
    let mask = hard | (1 << facing);
    if (!isCorner(direction)) {
        const after = nextIndex(facing);
        const before = previousIndex(facing);
        wish[to + after] = source[at + previousIndex(direction)];
        wish[to + before] = source[at + nextIndex(direction)];
        mask |= (1 << after) | (1 << before);
    }
    return mask;
}

/** A row of `region` starting at span `start`: one past its last span. */
function rowEnd(region: Region, start: number): number {
    let end = start;
    while (end < region.length && region[end].y === region[start].y) end++;
    return end;
}

/** Whether the rows starting at spans `a` and `b`, `length` spans each, have the same spans. */
function sameSpans(region: Region, a: number, b: number, length: number): boolean {
    for (let k = 0; k < length; k++) {
        const first = region[a + k];
        const second = region[b + k];
        if (first.start !== second.start || first.end !== second.end) return false;
    }
    return true;
}

/**
 * The region as rectangles in band order: runs of consecutive rows with the same spans, top to
 * bottom, each giving one rectangle per span from left to right.
 */
function bandRects(region: Region): CellRect[] {
    const rects: CellRect[] = [];
    let start = 0;
    while (start < region.length) {
        const end = rowEnd(region, start);
        const length = end - start;
        let height = 1;
        let next = end;
        while (
            next < region.length &&
            region[next].y === region[start].y + height &&
            rowEnd(region, next) - next === length &&
            sameSpans(region, start, next, length)
        ) {
            height++;
            next += length;
        }
        for (let k = start; k < end; k++) {
            const span = region[k];
            rects.push({ x: span.start, y: span.y, width: span.end - span.start, height });
        }
        start = next;
    }
    return rects;
}

/** Calls `visit` for every cell of `rects`, rectangle by rectangle, row by row. */
function forEachRectCell(rects: readonly CellRect[], visit: (x: number, y: number) => void): void {
    for (const rect of rects) {
        for (let y = rect.y; y < rect.y + rect.height; y++) {
            for (let x = rect.x; x < rect.x + rect.width; x++) visit(x, y);
        }
    }
}

/** Cells the filler has seen, each in a slot with its flags and constraint. */
class CellTable {
    readonly #slots = new Map<number, number>();
    #count = 0;
    #xs = new Int32Array(64);
    #ys = new Int32Array(64);
    #flags = new Uint8Array(64);
    #hard = new Uint8Array(64);
    #wish = new Uint8Array(64 * WANG_INDEXES);

    get count(): number {
        return this.#count;
    }
    get xs(): Int32Array {
        return this.#xs;
    }
    get ys(): Int32Array {
        return this.#ys;
    }
    get flags(): Uint8Array {
        return this.#flags;
    }
    get hard(): Uint8Array {
        return this.#hard;
    }
    /** Wishes, 8 per slot. Replaced when the table grows: read it again after `ensure`. */
    get wish(): Uint8Array {
        return this.#wish;
    }

    /** The slot of `(x, y)`, or −1. */
    find(x: number, y: number): number {
        return this.#slots.get(cellKey(x, y)) ?? -1;
    }

    /** The slot of `(x, y)`, made (no flags, no constraint) when it has none. */
    ensure(x: number, y: number): number {
        const key = cellKey(x, y);
        const found = this.#slots.get(key);
        if (found !== undefined) return found;
        if (this.#count === this.#xs.length) this.#grow();
        const slot = this.#count++;
        this.#xs[slot] = x;
        this.#ys[slot] = y;
        this.#flags[slot] = 0;
        this.#hard[slot] = 0;
        this.#slots.set(key, slot);
        return slot;
    }

    /** Gives `slot` an empty constraint (no wish, nothing hard) when it has none. */
    constrain(slot: number): void {
        if (this.#flags[slot] & HAS_CONSTRAINT) return;
        this.#wish.fill(INDEX_MASK, slot * WANG_INDEXES, (slot + 1) * WANG_INDEXES);
        this.#hard[slot] = 0;
        this.#flags[slot] |= HAS_CONSTRAINT;
    }

    clear(): void {
        this.#slots.clear();
        this.#count = 0;
    }

    #grow(): void {
        const size = this.#xs.length * 2;
        const grown = <T extends Int32Array | Uint8Array>(from: T, to: T): T => {
            to.set(from);
            return to;
        };
        this.#xs = grown(this.#xs, new Int32Array(size));
        this.#ys = grown(this.#ys, new Int32Array(size));
        this.#flags = grown(this.#flags, new Uint8Array(size));
        this.#hard = grown(this.#hard, new Uint8Array(size));
        this.#wish = grown(this.#wish, new Uint8Array(size * WANG_INDEXES));
    }
}

/** The options of a filler with their defaults applied. */
interface FillSettings {
    readonly analysis: TerrainAnalysis;
    readonly back: TerrainBack;
    readonly width: number;
    readonly height: number;
    readonly random: Random;
    readonly corrections: boolean;
    readonly erasing: boolean;
}

/** One `apply`: seeding, resolving and corrections over the filler's table. */
class Resolution {
    readonly #table: CellTable;
    readonly #settings: FillSettings;
    readonly #bounds: CellRect;
    /** Candidate tiles; candidate number `#tiles` is the empty cell. */
    readonly #tiles: number;
    /** The indexes the set's type uses, one bit each. */
    readonly #usedMask: number;
    readonly #lookAhead: boolean;
    readonly #cells: TerrainCell[] = [];
    readonly #failed: number[] = [];
    readonly #pool: number[] = [];
    readonly #terrain = new Uint8Array(WANG_INDEXES);
    readonly #copy = new Uint8Array(WANG_INDEXES);
    #queue: number[] = [];

    constructor(table: CellTable, settings: FillSettings, bounds: CellRect) {
        this.#table = table;
        this.#settings = settings;
        this.#bounds = bounds;
        const { analysis } = settings;
        this.#tiles = analysis.candidateValues.length;
        let used = 0;
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (typeUsesIndex(analysis.type, index)) used |= 1 << index;
        }
        this.#usedMask = used;
        this.#lookAhead = !settings.corrections && !analysis.fillerComplete;
    }

    /** Fills the unhardened indexes of each rectangle's border from the cells around it. */
    seedBorders(rects: readonly CellRect[]): void {
        for (const rect of rects) {
            const top = rect.y;
            const bottom = rect.y + rect.height - 1;
            const left = rect.x;
            const right = rect.x + rect.width - 1;
            for (let x = left; x <= right; x++) {
                this.#seedCell(x, top, TOP_SIDE);
                this.#seedCell(x, bottom, BOTTOM_SIDE);
            }
            for (let y = top; y <= bottom; y++) {
                this.#seedCell(left, y, LEFT_SIDE);
                this.#seedCell(right, y, RIGHT_SIDE);
            }
        }
    }

    /** Resolves the rectangles in order, then the corrections they queue, batch by batch. */
    run(rects: readonly CellRect[]): TerrainFillResult {
        forEachRectCell(rects, (x, y) => this.#resolve(this.#table.ensure(x, y)));
        while (this.#queue.length > 0) {
            const batch = this.#queue;
            this.#queue = [];
            for (const slot of batch) this.#resolve(slot);
        }
        const table = this.#table;
        const invalid: PixelPoint[] = [];
        for (const slot of this.#failed) {
            if (table.flags[slot] & RESOLVED) continue;
            invalid.push({ x: table.xs[slot], y: table.ys[slot] });
        }
        return { cells: this.#cells, invalid: regionOf(invalid), bounds: this.#bounds };
    }

    #seedCell(x: number, y: number, side: readonly WangIndex[]): void {
        const table = this.#table;
        const slot = table.ensure(x, y);
        table.constrain(slot);
        const hard = table.hard[slot];
        const at = slot * WANG_INDEXES;
        for (const index of side) {
            if (bit(hard, index)) continue;
            const terrain = this.#surrounding(x, y, index);
            if (terrain !== INDEX_MASK) table.wish[at + index] = terrain;
        }
    }

    /** What the cells around `(x, y)` want at its `index`; `INDEX_MASK` for nothing. */
    #surrounding(x: number, y: number, index: WangIndex): number {
        let terrain = this.#neighbourTerrain(x, y, index, oppositeIndex(index));
        if (!isCorner(index)) return terrain;
        // The same vertex seen from the side neighbours, when the diagonal one says nothing.
        const sides: readonly [number, number][] = [
            [previousIndex(index), (index + 2) % WANG_INDEXES],
            [nextIndex(index), (index + 6) % WANG_INDEXES],
        ];
        for (const [direction, at] of sides) {
            if (terrain !== INDEX_MASK && terrain !== 0) break;
            const other = this.#neighbourTerrain(x, y, direction, at);
            if (other !== INDEX_MASK) terrain = other;
        }
        return terrain;
    }

    /**
     * The terrain at `index` of the neighbour of `(x, y)` in `direction`; `INDEX_MASK` when that
     * neighbour is empty (outside the map included) or in the painted region.
     */
    #neighbourTerrain(x: number, y: number, direction: number, index: number): number {
        const [dx, dy] = AROUND[direction];
        const nx = x + dx;
        const ny = y + dy;
        const { analysis, back, width, height } = this.#settings;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return INDEX_MASK;
        const value = back(nx, ny);
        if (value === 0) return INDEX_MASK;
        const slot = this.#table.find(nx, ny);
        if (slot >= 0 && this.#table.flags[slot] & IN_REGION) return INDEX_MASK;
        wangIdOfCell(analysis, value, this.#terrain);
        return this.#terrain[index];
    }

    #resolve(slot: number): void {
        const table = this.#table;
        if (table.flags[slot] & DONE) return;
        const choice = this.#choose(slot);
        if (choice < 0) {
            table.flags[slot] |= INVALID;
            this.#failed.push(slot);
            return;
        }
        table.flags[slot] |= RESOLVED;
        const { analysis } = this.#settings;
        const x = table.xs[slot];
        const y = table.ys[slot];
        const tile = choice < this.#tiles;
        this.#cells.push({ x, y, value: tile ? analysis.candidateValues[choice] : 0 });
        const source = tile ? analysis.candidateWangIds : NO_TERRAIN;
        const at = tile ? choice * WANG_INDEXES : 0;
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const [dx, dy] = AROUND[direction];
            this.#spread(x + dx, y + dy, direction, source, at);
        }
    }

    /** Hardens what neighbour `(x, y)` in `direction` shares with a resolved cell. */
    #spread(x: number, y: number, direction: number, source: Uint8Array, at: number): void {
        const table = this.#table;
        let slot = table.find(x, y);
        if (slot >= 0 && table.flags[slot] & DONE) return;
        if (slot < 0) slot = table.ensure(x, y);
        table.constrain(slot);
        table.hard[slot] = propagate(
            source,
            at,
            direction,
            table.wish,
            slot * WANG_INDEXES,
            table.hard[slot],
        );
        if (this.#settings.corrections && !isCorner(direction)) this.#correct(slot, x, y);
    }

    /**
     * Queues a cell outside the painted region but inside the bounds whose tile no longer meets
     * its hard indexes; its other indexes then wish for what the tile has.
     */
    #correct(slot: number, x: number, y: number): void {
        const table = this.#table;
        const bounds = this.#bounds;
        if (x < bounds.x || y < bounds.y) return;
        if (x >= bounds.x + bounds.width || y >= bounds.y + bounds.height) return;
        if (table.flags[slot] & IN_REGION) return;
        const { analysis, back } = this.#settings;
        const terrain = this.#terrain;
        wangIdOfCell(analysis, back(x, y), terrain);
        const wish = table.wish;
        const at = slot * WANG_INDEXES;
        const hard = table.hard[slot];
        let fits = true;
        for (let index = 0; index < WANG_INDEXES && fits; index++) {
            fits = !bit(hard, index) || wish[at + index] === terrain[index];
        }
        if (fits) return;
        this.#queue.push(slot);
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (!bit(hard, index)) wish[at + index] = terrain[index];
        }
    }

    /** The candidate chosen for `slot` (`#tiles` = the empty cell); −1 for none. */
    #choose(slot: number): number {
        const table = this.#table;
        const constrained = (table.flags[slot] & HAS_CONSTRAINT) !== 0;
        const wish = constrained ? table.wish : NO_WISH;
        const at = constrained ? slot * WANG_INDEXES : 0;
        const hard = constrained ? table.hard[slot] : 0;
        const pool = this.#pool;
        pool.length = 0;
        let lowest = Infinity;
        const count = this.#settings.erasing ? this.#tiles + 1 : this.#tiles;
        for (let candidate = 0; candidate < count; candidate++) {
            const penalty = this.#penalty(wish, at, hard, candidate);
            if (penalty < 0 || penalty > lowest) continue;
            if (penalty < lowest) {
                lowest = penalty;
                pool.length = 0;
            }
            pool.push(candidate);
        }
        return this.#pick(slot);
    }

    /** The transition penalty of `candidate` against a constraint; −1 when it is excluded. */
    #penalty(wish: Uint8Array, at: number, hard: number, candidate: number): number {
        const { analysis, corrections } = this.#settings;
        const tile = candidate < this.#tiles;
        const ids = tile ? analysis.candidateWangIds : NO_TERRAIN;
        const from = tile ? candidate * WANG_INDEXES : 0;
        let sum = 0;
        for (let index = 0; index < WANG_INDEXES; index++) {
            const wanted = wish[at + index];
            const terrain = ids[from + index];
            if (wanted === terrain) continue;
            if (bit(hard, index)) return -1;
            if (wanted === INDEX_MASK) continue;
            let cost = transitionPenalty(analysis, wanted, terrain);
            if (cost < 0) {
                if (corrections) return -1;
                cost = analysis.maximumDistance + 1;
            }
            sum += cost;
        }
        return sum;
    }

    /** Draws from the pool until a candidate passes the look-ahead; −1 when none does. */
    #pick(slot: number): number {
        const pool = this.#pool;
        const { random } = this.#settings;
        while (pool.length > 0) {
            const k = pool.length === 1 ? 0 : random() % pool.length;
            const candidate = pool[k];
            pool[k] = pool.at(-1)!;
            pool.length--;
            if (!this.#lookAhead || !this.#strands(slot, candidate)) return candidate;
        }
        return -1;
    }

    /** Whether resolving `slot` to `candidate` would leave some neighbour without any tile. */
    #strands(slot: number, candidate: number): boolean {
        const table = this.#table;
        const { analysis } = this.#settings;
        const tile = candidate < this.#tiles;
        const source = tile ? analysis.candidateWangIds : NO_TERRAIN;
        const at = tile ? candidate * WANG_INDEXES : 0;
        const x = table.xs[slot];
        const y = table.ys[slot];
        const copy = this.#copy;
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const [dx, dy] = AROUND[direction];
            const own = this.#copyConstraint(x + dx, y + dy);
            if (own < 0) continue;
            const hard = propagate(source, at, direction, copy, 0, own);
            if (copy.every((terrain) => terrain === 0)) continue;
            if (!this.#anyTileFits(copy, hard & this.#usedMask)) return true;
        }
        return false;
    }

    /**
     * Copies the constraint of `(x, y)` (no wish when it has none) into `#copy` and returns its
     * hard mask; −1, copying nothing, when the cell is resolved or settled.
     */
    #copyConstraint(x: number, y: number): number {
        const table = this.#table;
        const slot = table.find(x, y);
        const flags = slot >= 0 ? table.flags[slot] : 0;
        if (flags & DONE) return -1;
        if (!(flags & HAS_CONSTRAINT)) {
            this.#copy.set(NO_WISH);
            return 0;
        }
        const from = slot * WANG_INDEXES;
        for (let index = 0; index < WANG_INDEXES; index++) {
            this.#copy[index] = table.wish[from + index];
        }
        return table.hard[slot];
    }

    /** Whether some candidate tile has `wish` at every index of `mask`. */
    #anyTileFits(wish: Uint8Array, mask: number): boolean {
        const ids = this.#settings.analysis.candidateWangIds;
        for (let candidate = 0; candidate < this.#tiles; candidate++) {
            const from = candidate * WANG_INDEXES;
            let fits = true;
            for (let index = 0; index < WANG_INDEXES && fits; index++) {
                fits = !bit(mask, index) || ids[from + index] === wish[index];
            }
            if (fits) return true;
        }
        return false;
    }
}

/** A non-negative integer. */
const isSize = (value: number): boolean => Number.isInteger(value) && value >= 0;

/**
 * The terrain filler of SPEC §5.2: paint indexes, corners, edges or whole tiles (or give it a
 * region), then `apply` to resolve the painted cells to tiles of the set.
 */
export class TerrainFiller {
    readonly #settings: FillSettings;
    readonly #table = new CellTable();
    /** A terrain ID read from the map. */
    readonly #terrain = new Uint8Array(WANG_INDEXES);
    readonly #rotated = new Uint8Array(WANG_INDEXES);

    constructor(options: TerrainFillerOptions) {
        const { width, height } = options;
        if (!isSize(width) || !isSize(height)) {
            throw new RangeError(
                `Map size must be non-negative integers, got ${width} × ${height}.`,
            );
        }
        this.#settings = {
            analysis: options.analysis,
            back: options.back,
            width,
            height,
            random: options.random,
            corrections: options.corrections ?? false,
            erasing: options.erasing ?? true,
        };
    }

    /** Paints `color` at `index` of cell `(x, y)`. */
    setWangIndex(x: number, y: number, index: WangIndex, color: number): void {
        this.#checkIndex(index);
        this.#checkColor(color);
        cellKey(x, y);
        this.#paint(x, y, index, color);
    }

    /** Paints `color` at the grid vertex `(x, y)`, the top-left corner of cell `(x, y)`. */
    setCorner(x: number, y: number, color: number): void {
        this.#checkColor(color);
        cellKey(x - 1, y - 1);
        cellKey(x, y);
        this.#paint(x, y - 1, BOTTOM_LEFT, color);
        this.#paint(x, y, TOP_LEFT, color);
        this.#paint(x - 1, y, TOP_RIGHT, color);
        this.#paint(x - 1, y - 1, BOTTOM_RIGHT, color);
    }

    /** Paints `color` at `index` of cell `(x, y)` and at the facing index of its neighbour. */
    setEdge(x: number, y: number, index: WangIndex, color: number): void {
        this.#checkIndex(index);
        this.#checkColor(color);
        const [dx, dy] = AROUND[index];
        cellKey(x, y);
        cellKey(x + dx, y + dy);
        this.#paint(x, y, index, color);
        this.#paint(x + dx, y + dy, oppositeIndex(index), color);
    }

    /**
     * Paints `color` at every index of cell `(x, y)` its effective type uses, and at the indexes
     * of that type each neighbour shares with the cell.
     */
    setFullTile(x: number, y: number, color: number): void {
        this.#checkColor(color);
        cellKey(x - 1, y - 1);
        cellKey(x + 1, y + 1);
        const type = effectiveTypeForColor(this.#settings.analysis, color);
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (typeUsesIndex(type, index)) this.#paint(x, y, index, color);
        }
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const [dx, dy] = AROUND[direction];
            for (const index of SHARED[direction]) {
                if (typeUsesIndex(type, index)) this.#paint(x + dx, y + dy, index, color);
            }
        }
    }

    /**
     * Rotational symmetry: copies the hard indexes of every painted cell, turned by 180°, to the
     * cell `(width − x − 1, height − y − 1)`.
     */
    mirror(): void {
        const { width, height } = this.#settings;
        const table = this.#table;
        const rotated = this.#rotated;
        forEachRectCell(bandRects(this.#paintedRegion()), (x, y) => {
            const source = table.find(x, y);
            let hard = 0;
            if (table.flags[source] & HAS_CONSTRAINT) {
                const at = source * WANG_INDEXES;
                for (let index = 0; index < WANG_INDEXES; index++) {
                    rotated[oppositeIndex(index)] = table.wish[at + index];
                }
                const own = table.hard[source];
                hard = ((own << 4) | (own >> 4)) & 0xff;
            }
            const target = this.#touch(width - x - 1, height - y - 1);
            const at = target * WANG_INDEXES;
            for (let index = 0; index < WANG_INDEXES; index++) {
                if (bit(hard, index)) table.wish[at + index] = rotated[index];
            }
            table.hard[target] |= hard;
        });
    }

    /** The painted region becomes exactly `region`; constraints already made are kept. */
    setRegion(region: Region): void {
        for (const span of region) {
            cellKey(span.start, span.y);
            cellKey(Math.max(span.start, span.end - 1), span.y);
        }
        const table = this.#table;
        for (let slot = 0; slot < table.count; slot++) table.flags[slot] &= ~IN_REGION;
        for (const span of region) {
            for (let x = span.start; x < span.end; x++) {
                table.flags[table.ensure(x, span.y)] |= IN_REGION;
            }
        }
    }

    /** Resolves the painted region and empties the filler. */
    apply(): TerrainFillResult {
        try {
            return this.#resolve();
        } finally {
            this.#table.clear();
        }
    }

    #resolve(): TerrainFillResult {
        const region = this.#settleOutside();
        if (region.length === 0) return { cells: [], invalid: [], bounds: null };
        const settings = this.#settings;
        const rects = bandRects(region);
        const box = regionBounds(region)!;
        const distance = settings.analysis.maximumDistance;
        const left = Math.max(0, box.x - distance);
        const top = Math.max(0, box.y - distance);
        const right = Math.min(settings.width, box.x + box.width + distance);
        const bottom = Math.min(settings.height, box.y + box.height + distance);
        const bounds = { x: left, y: top, width: right - left, height: bottom - top };
        const resolution = new Resolution(this.#table, settings, bounds);
        if (!settings.corrections) resolution.seedBorders(rects);
        return resolution.run(rects);
    }

    /** Takes painted cells outside the map out of the region, as settled; the rest. */
    #settleOutside(): Region {
        const { width, height } = this.#settings;
        const table = this.#table;
        const inside: PixelPoint[] = [];
        for (let slot = 0; slot < table.count; slot++) {
            if (!(table.flags[slot] & IN_REGION)) continue;
            const x = table.xs[slot];
            const y = table.ys[slot];
            if (x >= 0 && y >= 0 && x < width && y < height) {
                inside.push({ x, y });
            } else {
                table.flags[slot] = (table.flags[slot] & ~IN_REGION) | SETTLED;
            }
        }
        return regionOf(inside);
    }

    /** The cells of the painted region. */
    #paintedRegion(): Region {
        const table = this.#table;
        const cells: PixelPoint[] = [];
        for (let slot = 0; slot < table.count; slot++) {
            if (table.flags[slot] & IN_REGION) cells.push({ x: table.xs[slot], y: table.ys[slot] });
        }
        return regionOf(cells);
    }

    /**
     * Touches `(x, y)`: the first time, its constraint wishes for the terrain ID it holds
     * (empty outside the map), nothing hard. It is in the painted region from then on.
     */
    #touch(x: number, y: number): number {
        const table = this.#table;
        const slot = table.ensure(x, y);
        if (!(table.flags[slot] & HAS_CONSTRAINT)) {
            const { analysis, back, width, height } = this.#settings;
            const inside = x >= 0 && y >= 0 && x < width && y < height;
            wangIdOfCell(analysis, inside ? back(x, y) : 0, this.#terrain);
            table.wish.set(this.#terrain, slot * WANG_INDEXES);
            table.hard[slot] = 0;
            table.flags[slot] |= HAS_CONSTRAINT;
        }
        table.flags[slot] |= IN_REGION;
        return slot;
    }

    #paint(x: number, y: number, index: number, color: number): void {
        const slot = this.#touch(x, y);
        this.#table.wish[slot * WANG_INDEXES + index] = color;
        this.#table.hard[slot] |= 1 << index;
    }

    #checkIndex(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= WANG_INDEXES) {
            throw new RangeError(`A terrain index must be 0..7, got ${index}.`);
        }
    }

    #checkColor(color: number): void {
        const count = this.#settings.analysis.colorCount;
        if (!Number.isInteger(color) || color < 0 || color > count) {
            throw new RangeError(`A terrain must be an integer in 0..${count}, got ${color}.`);
        }
    }
}
