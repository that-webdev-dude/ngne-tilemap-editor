import { forEachRegionCell, regionOf } from "../fill";
import type { Region } from "../fill";
import type { PixelPoint } from "../raster/line";
import { effectiveTypeForColor, wangIdOfCell } from "./analysis";
import type { TerrainAnalysis } from "./analysis";
import type { Random } from "./random";
import {
    AROUND,
    WANG_INDEXES,
    isCorner,
    nextIndex,
    oppositeIndex,
    previousIndex,
    typeUsesIndex,
} from "./wangId";
import type { WangIndex } from "./wangId";

// The terrain filler (SPEC §5.2): chooses the tiles of terrain painting and terrain fills.
//
// What it is given becomes a set of cells to resolve: the cells with a painted index, or the
// cells of a fill's region. They are resolved one at a time, in row order, and with the brush
// the cells around a resolved cell join the queue when the cell changed an index they share
// and they no longer agree with it there; those are resolved in the order they joined.
//
// Resolving a cell: the terrains it must have are, from weakest to strongest (a stronger one
// replaces a weaker one at the same index):
//   - in a fill, what the cells outside the region have at the indexes they share;
//   - what the neighbours still to be resolved were painted at the indexes they share;
//   - what the neighbours already resolved now have at the indexes they share;
//   - what the cell itself was painted.
// Among the tiles of the set that have all of them (and the empty cell, where one of them is
// "no terrain"), the cell takes the one whose remaining indexes are closest, in terrain
// distance, to the terrains the cell had there; a cell of a fill's region keeps nothing of what
// it had, so all its remaining indexes are free. With the brush a tile is left out when, at an
// index the cell was not painted, it has a terrain that cannot be reached from the one the
// index had. Equally close tiles are decided by the seeded generator, which is called only then.
// A cell no tile fits is invalid: it keeps its value and asks nothing of the cells after it.

/** The tile layer's cell value at `(x, y)` before the change. */
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
    /** Breaks ties between equally close tiles. */
    random: Random;
    /** The brush (true): cells around the touched ones change where needed. A fill: false (default). */
    corrections?: boolean;
    /** The empty cell may be chosen; default true. */
    erasing?: boolean;
}

/** A cell and its new value. */
export interface TerrainCell {
    readonly x: number;
    readonly y: number;
    readonly value: number;
}

/** What `apply` produced. */
export interface TerrainFillResult {
    /** Cells given a tile. */
    readonly cells: readonly TerrainCell[];
    /** Cells that cannot be given a matching tile; they stay as they are. */
    readonly invalid: Region;
}

/** No terrain wanted at an index (of a painted or wanted WangId). */
const NONE = -1;

/** The WangId of the empty cell: no terrain anywhere. */
const EMPTY_WANG_ID = new Uint8Array(WANG_INDEXES);

/**
 * For each neighbour direction, the indexes a cell shares with that neighbour, as pairs of the
 * cell's index and the neighbour's: a diagonal neighbour shares one corner, a side neighbour
 * the edge between them and the two corners at its ends.
 */
const SHARED: readonly (readonly (readonly [number, number])[])[] = AROUND.map((_, direction) => {
    const facing = oppositeIndex(direction);
    if (isCorner(direction)) return [[direction, facing] as const];
    return [
        [direction, facing] as const,
        [previousIndex(direction), nextIndex(facing)] as const,
        [nextIndex(direction), previousIndex(facing)] as const,
    ];
});

/** Where a cell of the work is. */
const QUEUED = 0;
const RESOLVED = 1;
const INVALID = 2;

/** A cell to resolve, and what became of it. */
interface WorkCell {
    state: typeof QUEUED | typeof RESOLVED | typeof INVALID;
    /** The resolved tile's WangId (masked by the set's type). */
    wangId: Uint8Array;
    /** The resolved cell value. */
    value: number;
}

/** A cell that joins the work, not resolved yet. */
function queuedCell(): WorkCell {
    return { state: QUEUED, wangId: EMPTY_WANG_ID, value: 0 };
}

/** Takes into `wanted` what the neighbour in `direction` has at the indexes it shares. */
function takeShared(wanted: Int16Array, direction: number, from: ArrayLike<number>): void {
    for (const [own, theirs] of SHARED[direction]!) {
        const color = from[theirs]!;
        if (color !== NONE) wanted[own] = color;
    }
}

/** Takes what the neighbours outside a fill's region have at the indexes they share. */
function takeOutside(
    wanted: Int16Array,
    neighbours: readonly number[],
    touched: ReadonlySet<number>,
    backWangId: (key: number) => Uint8Array,
): void {
    neighbours.forEach((other, direction) => {
        if (other >= 0 && !touched.has(other)) takeShared(wanted, direction, backWangId(other));
    });
}

/** Takes what the neighbours already resolved now have at the indexes they share. */
function takeResolved(
    wanted: Int16Array,
    neighbours: readonly number[],
    work: ReadonlyMap<number, WorkCell>,
): void {
    neighbours.forEach((other, direction) => {
        const resolved = other < 0 ? undefined : work.get(other);
        if (resolved?.state === RESOLVED) takeShared(wanted, direction, resolved.wangId);
    });
}

/** Takes what the cell itself was painted. */
function takePainted(wanted: Int16Array, own: Int16Array): void {
    for (let index = 0; index < WANG_INDEXES; index++) {
        if (own[index] !== NONE) wanted[index] = own[index]!;
    }
}

/**
 * Paint terrains at indexes, corners, edges or whole tiles (or give it a region), then `apply`.
 * Throws `RangeError` when the map size is not two non-negative integers.
 */
export class TerrainFiller {
    readonly #analysis: TerrainAnalysis;
    readonly #back: TerrainBack;
    readonly #width: number;
    readonly #height: number;
    readonly #random: Random;
    readonly #corrections: boolean;
    readonly #erasing: boolean;
    /** The indexes the set's type uses. */
    readonly #indexes: readonly number[];
    /** Painted terrains by cell key (`y × width + x`), `NONE` where an index was not painted. */
    #painted = new Map<number, Int16Array>();
    /** The cells of a fill's region by key; null when none was given. */
    #region: Set<number> | null = null;

    constructor(options: TerrainFillerOptions) {
        const { width, height } = options;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
            throw new RangeError(
                `The map size must be two non-negative integers, got ${width} × ${height}.`,
            );
        }
        this.#analysis = options.analysis;
        this.#back = options.back;
        this.#width = width;
        this.#height = height;
        this.#random = options.random;
        this.#corrections = options.corrections ?? false;
        this.#erasing = options.erasing ?? true;
        this.#indexes = [0, 1, 2, 3, 4, 5, 6, 7].filter((index) =>
            typeUsesIndex(options.analysis.type, index),
        );
    }

    /** Paints `color` at `index` of cell `(x, y)` only. */
    setWangIndex(x: number, y: number, index: WangIndex, color: number): void {
        this.#checkPoint(x, y);
        this.#checkIndex(index);
        this.#checkColor(color);
        this.#paint(x, y, index, color);
    }

    /** Paints `color` at the grid vertex `(x, y)`, the top-left corner of cell `(x, y)`. */
    setCorner(x: number, y: number, color: number): void {
        this.#checkPoint(x, y);
        this.#checkColor(color);
        // The four cells around the vertex, each with its corner on it.
        this.#paint(x, y, 7, color);
        this.#paint(x - 1, y, 1, color);
        this.#paint(x - 1, y - 1, 3, color);
        this.#paint(x, y - 1, 5, color);
    }

    /** Paints `color` at edge `index` of cell `(x, y)`, and so at the neighbour's facing edge. */
    setEdge(x: number, y: number, index: WangIndex, color: number): void {
        this.#checkPoint(x, y);
        this.#checkIndex(index);
        if (isCorner(index)) throw new RangeError(`Index ${index} is a corner, not an edge.`);
        this.#checkColor(color);
        const [dx, dy] = AROUND[index]!;
        this.#paint(x, y, index, color);
        this.#paint(x + dx, y + dy, oppositeIndex(index), color);
    }

    /** Full tile mode at cell `(x, y)` (SPEC §5.3). */
    setFullTile(x: number, y: number, color: number): void {
        this.#checkPoint(x, y);
        this.#checkColor(color);
        // In a mixed set a terrain used only at corners (or only at edges) paints those only.
        const type = effectiveTypeForColor(this.#analysis, color);
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (typeUsesIndex(type, index)) this.#paint(x, y, index, color);
        }
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const [dx, dy] = AROUND[direction]!;
            for (const [own, theirs] of SHARED[direction]!) {
                if (typeUsesIndex(type, own)) this.#paint(x + dx, y + dy, theirs, color);
            }
        }
    }

    /** Also paints everything painted so far turned 180° about the map's centre (SPEC §5.3). */
    mirror(): void {
        const width = this.#width;
        const height = this.#height;
        const painted = [...this.#painted].map(([key, values]) => [key, values.slice()] as const);
        for (const [key, values] of painted) {
            const x = key % width;
            const y = (key - x) / width;
            for (let index = 0; index < WANG_INDEXES; index++) {
                const color = values[index]!;
                if (color === NONE) continue;
                this.#paint(width - 1 - x, height - 1 - y, oppositeIndex(index), color);
            }
        }
    }

    /** A fill: the cells to fill become `region` (SPEC §5.4). */
    replacePaintedRegion(region: Region): void {
        this.#painted.clear();
        const cells = new Set<number>();
        forEachRegionCell(region, (x, y) => {
            if (this.#inside(x, y)) cells.add(y * this.#width + x);
        });
        this.#region = cells;
    }

    /** Resolves what was painted or given, and empties the filler. */
    apply(): TerrainFillResult {
        const touched = new Set<number>(this.#painted.keys());
        if (this.#region) for (const key of this.#region) touched.add(key);
        const queue = [...touched].sort((a, b) => a - b);
        const work = new Map<number, WorkCell>();
        for (const key of queue) work.set(key, queuedCell());
        const backWangId = this.#backWangIdReader();

        // Cells the brush adds to the queue while it runs are visited after the ones before them.
        for (const key of queue) {
            const cell = work.get(key)!;
            this.#resolve(key, cell, work, touched, backWangId);
            if (cell.state === RESOLVED && this.#corrections) {
                this.#queueDisagreeing(key, cell, work, queue, backWangId);
            }
        }

        const result = this.#collect(work);
        this.#painted = new Map();
        this.#region = null;
        return result;
    }

    /** Reads a cell's WangId from the tile layer before the change, once per cell. */
    #backWangIdReader(): (key: number) => Uint8Array {
        const width = this.#width;
        const before = new Map<number, Uint8Array>();
        return (key: number): Uint8Array => {
            const known = before.get(key);
            if (known) return known;
            const x = key % width;
            const wangId = new Uint8Array(WANG_INDEXES);
            wangIdOfCell(this.#analysis, this.#back(x, (key - x) / width), wangId);
            before.set(key, wangId);
            return wangId;
        };
    }

    /**
     * Queues the cells around the resolved cell `key` that are not in the work yet and no longer
     * agree with it at an index it changed.
     */
    #queueDisagreeing(
        key: number,
        cell: WorkCell,
        work: Map<number, WorkCell>,
        queue: number[],
        backWangId: (key: number) => Uint8Array,
    ): void {
        const width = this.#width;
        const had = backWangId(key);
        const x = key % width;
        const y = (key - x) / width;
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const [dx, dy] = AROUND[direction]!;
            if (!this.#inside(x + dx, y + dy)) continue;
            const other = key + dy * width + dx;
            if (work.has(other)) continue;
            const theirs = backWangId(other);
            const differs = SHARED[direction]!.some(
                ([own, shared]) =>
                    cell.wangId[own] !== had[own] && cell.wangId[own] !== theirs[shared],
            );
            if (differs) {
                work.set(other, queuedCell());
                queue.push(other);
            }
        }
    }

    /** The work's cells in row order: the resolved ones with their values, and the invalid ones. */
    #collect(work: ReadonlyMap<number, WorkCell>): TerrainFillResult {
        const width = this.#width;
        const cells: TerrainCell[] = [];
        const invalid: PixelPoint[] = [];
        for (const key of [...work.keys()].sort((a, b) => a - b)) {
            const cell = work.get(key)!;
            const x = key % width;
            const y = (key - x) / width;
            if (cell.state === RESOLVED) cells.push({ x, y, value: cell.value });
            else invalid.push({ x, y });
        }
        return { cells, invalid: regionOf(invalid) };
    }

    /** Resolves cell `key` into `cell`: a tile, or invalid. */
    #resolve(
        key: number,
        cell: WorkCell,
        work: ReadonlyMap<number, WorkCell>,
        touched: ReadonlySet<number>,
        backWangId: (key: number) => Uint8Array,
    ): void {
        const own = this.#painted.get(key) ?? null;
        const wanted = this.#wanted(key, own, work, touched, backWangId);
        const closest = this.#closest(wanted, own, backWangId(key), !this.#region?.has(key));
        if (closest.length === 0) {
            cell.state = INVALID;
            return;
        }
        const chosen =
            closest.length === 1 ? closest[0]! : closest[this.#random() % closest.length]!;
        cell.state = RESOLVED;
        if (chosen < 0) {
            cell.wangId = EMPTY_WANG_ID;
            cell.value = 0;
        } else {
            const ids = this.#analysis.candidateWangIds;
            cell.wangId = ids.subarray(chosen * WANG_INDEXES, (chosen + 1) * WANG_INDEXES);
            cell.value = this.#analysis.candidateValues[chosen]!;
        }
    }

    /** The keys of the eight cells around cell `key` by direction; −1 where outside the map. */
    #neighbourKeys(key: number): number[] {
        const width = this.#width;
        const x = key % width;
        const y = (key - x) / width;
        const neighbours: number[] = [];
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const [dx, dy] = AROUND[direction]!;
            neighbours.push(this.#inside(x + dx, y + dy) ? key + dy * width + dx : -1);
        }
        return neighbours;
    }

    /** The terrains cell `key` must have, by index, `NONE` where any will do (weakest first). */
    #wanted(
        key: number,
        own: Int16Array | null,
        work: ReadonlyMap<number, WorkCell>,
        touched: ReadonlySet<number>,
        backWangId: (key: number) => Uint8Array,
    ): Int16Array {
        const neighbours = this.#neighbourKeys(key);
        const wanted = new Int16Array(WANG_INDEXES).fill(NONE);
        // A fill leaves the cells outside its region as they are: the region matches them.
        if (!this.#corrections) takeOutside(wanted, neighbours, touched, backWangId);
        this.#takeQueued(wanted, neighbours, work);
        takeResolved(wanted, neighbours, work);
        if (own) takePainted(wanted, own);
        return wanted;
    }

    /** Takes what the neighbours still to be resolved were painted at the indexes they share. */
    #takeQueued(
        wanted: Int16Array,
        neighbours: readonly number[],
        work: ReadonlyMap<number, WorkCell>,
    ): void {
        neighbours.forEach((other, direction) => {
            if (other < 0 || work.get(other)?.state === RESOLVED) return;
            const painted = this.#painted.get(other);
            if (painted) takeShared(wanted, direction, painted);
        });
    }

    /** The candidates (−1 for the empty cell) equally closest to what the cell had. */
    #closest(wanted: Int16Array, own: Int16Array | null, had: Uint8Array, keep: boolean): number[] {
        const ids = this.#analysis.candidateWangIds;
        const count = this.#analysis.candidateValues.length;
        let best = Infinity;
        const closest: number[] = [];
        const consider = (candidate: number, wangId: ArrayLike<number>, at: number) => {
            const cost = this.#cost(wangId, at, wanted, own, had, keep);
            if (cost < 0 || cost > best) return;
            if (cost < best) {
                best = cost;
                closest.length = 0;
            }
            closest.push(candidate);
        };
        for (let t = 0; t < count; t++) consider(t, ids, t * WANG_INDEXES);
        // The empty cell, where "no terrain" is wanted at an index.
        if (this.#erasing && this.#indexes.some((index) => wanted[index] === 0)) {
            consider(-1, EMPTY_WANG_ID, 0);
        }
        return closest;
    }

    /**
     * How far the candidate WangId at `wangId[at..at + 8]` is from what the cell had, at the
     * indexes nothing is wanted at; −1 when it does not have a wanted terrain or, with the brush,
     * has a terrain that cannot be reached from the one its index had (painted indexes aside).
     */
    #cost(
        wangId: ArrayLike<number>,
        at: number,
        wanted: Int16Array,
        own: Int16Array | null,
        had: Uint8Array,
        keep: boolean,
    ): number {
        let cost = 0;
        for (const index of this.#indexes) {
            const color = wangId[at + index]!;
            const want = wanted[index]!;
            if (want !== NONE && color !== want) return -1;
            if (own && own[index] !== NONE) continue;
            const distance = this.#indexDistance(had[index]!, color);
            if (distance < 0) return -1;
            if (want === NONE && keep) cost += distance;
        }
        return cost;
    }

    /**
     * The terrain distance from the terrain an index had to a candidate's terrain there. When it
     * cannot be reached: −1 with the brush, otherwise one more than the set's largest distance.
     */
    #indexDistance(from: number, to: number): number {
        if (from === to) return 0;
        const analysis = this.#analysis;
        const n = analysis.colorCount + 1;
        const distance = analysis.distances[from === 0 ? to * n : from * n + to]!;
        if (distance >= 0) return distance;
        return this.#corrections ? -1 : analysis.maximumDistance + 1;
    }

    #paint(x: number, y: number, index: number, color: number): void {
        if (!this.#inside(x, y)) return;
        const key = y * this.#width + x;
        let painted = this.#painted.get(key);
        if (!painted) {
            painted = new Int16Array(WANG_INDEXES).fill(NONE);
            this.#painted.set(key, painted);
        }
        painted[index] = color;
    }

    #inside(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.#width && y < this.#height;
    }

    #checkPoint(x: number, y: number): void {
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new RangeError(`A cell or vertex needs whole coordinates, got ${x}, ${y}.`);
        }
    }

    #checkIndex(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= WANG_INDEXES) {
            throw new RangeError(`An index must be 0..7, got ${index}.`);
        }
    }

    #checkColor(color: number): void {
        if (!Number.isInteger(color) || color < 0 || color > this.#analysis.colorCount) {
            throw new RangeError(
                `The set has terrains 1..${this.#analysis.colorCount} (0 erases), got ${color}.`,
            );
        }
    }
}
