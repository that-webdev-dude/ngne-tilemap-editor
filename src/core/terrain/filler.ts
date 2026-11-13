import type { CellRect } from "../cells";
import { forEachRegionCell, regionOf } from "../fill";
import type { Region } from "../fill";
import type { PixelPoint } from "../raster/line";
import { effectiveTypeForColor, transitionPenalty, wangIdOfCell } from "./analysis";
import type { TerrainAnalysis } from "./analysis";
import { anyCandidate, candidateTable, forEachCandidate, keepWith } from "./candidates";
import type { CandidateTable } from "./candidates";
import type { Random } from "./random";
import {
    AROUND,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
    INDEX_MASK,
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

// The terrain filler (SPEC §5.2, used by the brush of §5.3 and the fill mode of §5.4).
//
// Painting records constraints on the cells it touches, the painted region: each cell holds a
// wish per index (`INDEX_MASK` for none) and a set of hard indexes. A cell touched by painting
// first wishes the terrains its tile has now; the painted index becomes hard. A cell given by a
// region (the fill tools) starts without wishes and, at `apply`, takes as hard the indexes it
// shares with the set's tiles just outside the region (border seeding).
//
// `apply` resolves the painted cells in row-major order. A candidate (each tile of the set, then
// the empty cell when erasing, which has no terrain at any index; found through the bit sets of
// `candidates.ts`, so a cell costs the candidates that fit it) must match every hard index; each
// wished index adds the transition distance from the wish to the candidate's terrain. A wish no
// transition reaches discards the candidate when corrections are on and otherwise costs more
// than any reachable one. With corrections off and a set that is not complete, a candidate is
// also dropped when it would leave a neighbour not resolved yet (any of the eight, painted or
// not) with no tile of the set matching its hard indexes; the empty cell is no way out there,
// and a neighbour that would then wish no terrain at all eight indexes is not checked (one step
// of look-ahead). The lowest penalty wins; equal candidates are told apart by the generator,
// which is only asked when there is a choice. A resolved cell makes the indexes it shares with every neighbour not resolved yet
// hard for that neighbour.
//
// With corrections (the brush), cells outside the painted region within the bounds (the painted
// region's bounding box grown by the set's maximum distance, clipped to the map) collect those
// hard indexes too. Each time a cell is resolved, a side neighbour of that kind whose tile
// disagrees with any of its hard indexes is queued; a diagonal neighbour is not queued for the
// corner it shares. The queue runs in batches, each the cells queued during the one before, the
// first those queued by the painted region. A queued cell already resolved is skipped; otherwise
// its hard indexes are the accumulated ones, its other indexes wish the terrains of its tile, and
// there is no look-ahead. A queued cell without a candidate stays unchanged and may be resolved
// by a later batch. Nothing outside the bounds is written, so a step costs the cells it touches,
// not the map. Cells still without a candidate at the end are reported as invalid.

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

/** The constraints on one cell. */
interface Constraint {
    readonly x: number;
    readonly y: number;
    /** The wished terrain per index; `INDEX_MASK` for no wish. */
    readonly desired: Uint8Array;
    /** Bit `i` set: index `i` must be `desired[i]`. */
    hard: number;
}

/** A pair of indexes two neighbours share: this cell's and the neighbour's. */
type SharedPair = readonly [mine: number, theirs: number];

/**
 * Per direction (the index of the neighbour, as `AROUND`), the indexes a cell shares with that
 * neighbour: a side neighbour shares the edge and the two corners at its ends, a diagonal
 * neighbour one corner.
 */
const SHARED: readonly (readonly SharedPair[])[] = AROUND.map((_, direction) => {
    const facing = oppositeIndex(direction);
    if (isCorner(direction)) return [[direction, facing]];
    return [
        [direction, facing],
        [previousIndex(direction), nextIndex(facing)],
        [nextIndex(direction), previousIndex(facing)],
    ];
});

/** Cost of a wish no transition reaches, when it does not discard the candidate. */
const UNREACHABLE = 1 << 20;

/** An unresolved neighbour the look-ahead checks, from the cell being resolved. */
interface LookAhead {
    /** The indexes the two share: the cell's, the neighbour's. */
    readonly pairs: readonly SharedPair[];
    /** The tiles that fit the neighbour's hard indexes it does not share with the cell. */
    readonly base: Uint32Array;
    /** The neighbour wishes no terrain at every index it does not share with the cell. */
    readonly zeroRest: boolean;
}

/** A resolution choice: a candidate and its penalty. */
interface Scored {
    readonly candidate: number;
    readonly penalty: number;
}

/**
 * The terrain filler of SPEC §5.2: paint indexes, corners, edges or whole tiles (or give it a
 * region), then `apply` to resolve the painted cells to tiles of the set.
 * Throws `RangeError` when the map size is not two non-negative integers.
 */
export class TerrainFiller {
    private readonly context: ResolutionContext;
    /** The painted region and its constraints, by `y × width + x`. */
    private painted = new Map<number, Constraint>();
    /** A region was given: seed its border at `apply`. */
    private seedBorder = false;

    constructor(options: TerrainFillerOptions) {
        const { width, height } = options;
        if (
            !Number.isSafeInteger(width) ||
            !Number.isSafeInteger(height) ||
            width < 0 ||
            height < 0
        ) {
            throw new RangeError(
                `A terrain filler needs a map size of two non-negative integers, got ${width} × ${height}.`,
            );
        }
        const { analysis } = options;
        this.context = {
            analysis,
            back: options.back,
            width,
            height,
            random: options.random,
            corrections: options.corrections ?? false,
            table: candidateTable(analysis, options.erasing ?? true),
            shared: SHARED.map((pairs) =>
                pairs.filter(([mine]) => typeUsesIndex(analysis.type, mine)),
            ),
        };
    }

    /** Paints `color` at `index` of cell `(x, y)`. */
    setWangIndex(x: number, y: number, index: WangIndex, color: number): void {
        this.checkCell(x, y);
        this.checkIndex(index);
        this.checkColor(color);
        this.paint(x, y, index, color);
    }

    /** Paints `color` at the grid vertex `(x, y)`, the top-left corner of cell `(x, y)`. */
    setCorner(x: number, y: number, color: number): void {
        this.checkCell(x, y);
        this.checkColor(color);
        this.paint(x, y, TOP_LEFT, color);
        this.paint(x - 1, y, TOP_RIGHT, color);
        this.paint(x - 1, y - 1, BOTTOM_RIGHT, color);
        this.paint(x, y - 1, BOTTOM_LEFT, color);
    }

    /** Paints `color` at `index` of cell `(x, y)` and at the facing index of its neighbour. */
    setEdge(x: number, y: number, index: WangIndex, color: number): void {
        this.checkCell(x, y);
        this.checkIndex(index);
        this.checkColor(color);
        const [dx, dy] = AROUND[index]!;
        this.paint(x, y, index, color);
        this.paint(x + dx, y + dy, oppositeIndex(index), color);
    }

    /**
     * Paints `color` at every index of cell `(x, y)` its effective type uses, and at the indexes
     * of that type each neighbour shares with the cell.
     */
    setFullTile(x: number, y: number, color: number): void {
        this.checkCell(x, y);
        this.checkColor(color);
        const type = effectiveTypeForColor(this.context.analysis, color);
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (typeUsesIndex(type, index)) this.paint(x, y, index, color);
        }
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const [dx, dy] = AROUND[direction]!;
            for (const [mine, theirs] of SHARED[direction]!) {
                if (typeUsesIndex(type, mine)) this.paint(x + dx, y + dy, theirs, color);
            }
        }
    }

    /**
     * Rotational symmetry: copies the hard indexes of every painted cell, turned by 180°, to the
     * cell `(width − x − 1, height − y − 1)`.
     */
    mirror(): void {
        const copies: [x: number, y: number, index: number, color: number][] = [];
        for (const cell of this.painted.values()) {
            for (let index = 0; index < WANG_INDEXES; index++) {
                if (cell.hard & (1 << index)) {
                    copies.push([cell.x, cell.y, index, cell.desired[index]!]);
                }
            }
        }
        for (const [x, y, index, color] of copies) {
            this.paint(
                this.context.width - x - 1,
                this.context.height - y - 1,
                oppositeIndex(index),
                color,
            );
        }
    }

    /** The painted region becomes exactly `region`; constraints already made are kept. */
    setRegion(region: Region): void {
        const next = new Map<number, Constraint>();
        forEachRegionCell(region, (x, y) => {
            if (!this.inside(x, y)) return;
            const key = this.key(x, y);
            next.set(key, this.painted.get(key) ?? this.unconstrained(x, y));
        });
        this.painted = next;
        this.seedBorder = true;
    }

    /** Resolves the painted region and empties the filler. */
    apply(): TerrainFillResult {
        const painted = this.painted;
        const seedBorder = this.seedBorder;
        this.painted = new Map();
        this.seedBorder = false;
        if (painted.size === 0) return { cells: [], invalid: [], bounds: null };
        return new Resolution(this.context, painted, seedBorder).run();
    }

    private key(x: number, y: number): number {
        return y * this.context.width + x;
    }

    private inside(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.context.width && y < this.context.height;
    }

    /** A constraint with no wish at any index. */
    private unconstrained(x: number, y: number): Constraint {
        return { x, y, desired: new Uint8Array(WANG_INDEXES).fill(INDEX_MASK), hard: 0 };
    }

    /** Hard `color` at `index` of cell `(x, y)`; a cell outside the map is not painted. */
    private paint(x: number, y: number, index: number, color: number): void {
        if (!this.inside(x, y)) return;
        const key = this.key(x, y);
        let cell = this.painted.get(key);
        if (!cell) {
            // A newly touched cell wishes what it has now, at the indexes the set uses.
            const desired = new Uint8Array(WANG_INDEXES);
            wangIdOfCell(this.context.analysis, this.context.back(x, y), desired);
            for (let i = 0; i < WANG_INDEXES; i++) {
                if (!typeUsesIndex(this.context.analysis.type, i)) desired[i] = INDEX_MASK;
            }
            cell = { x, y, desired, hard: 0 };
            this.painted.set(key, cell);
        }
        cell.desired[index] = color;
        cell.hard |= 1 << index;
    }

    private checkCell(x: number, y: number): void {
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
            throw new RangeError(`A terrain cell needs whole coordinates, got (${x}, ${y}).`);
        }
    }

    private checkIndex(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= WANG_INDEXES) {
            throw new RangeError(`A terrain index must be 0..7, got ${index}.`);
        }
    }

    private checkColor(color: number): void {
        if (!Number.isInteger(color) || color < 0 || color > this.context.analysis.colorCount) {
            throw new RangeError(
                `A terrain must be 0..${this.context.analysis.colorCount} in this set, got ${color}.`,
            );
        }
    }
}

/** What a resolution reads of its filler. */
interface ResolutionContext {
    readonly analysis: TerrainAnalysis;
    readonly back: TerrainBack;
    readonly width: number;
    readonly height: number;
    readonly random: Random;
    readonly corrections: boolean;
    readonly table: CandidateTable;
    readonly shared: readonly (readonly SharedPair[])[];
}

/** One `apply`: resolves a painted region, then corrects around it. */
class Resolution {
    private readonly context: ResolutionContext;
    /** Painted cells, row-major. */
    private readonly region: Constraint[];
    /** Painted cells not resolved yet, by key. */
    private readonly unresolved: Map<number, Constraint>;
    /** Keys of every painted cell, resolved or not. */
    private readonly regionKeys: ReadonlySet<number>;
    private readonly seedBorder: boolean;
    private readonly lookAhead: boolean;
    private readonly bounds: CellRect;
    /** Resolved cells: the candidate each took, by key. */
    private readonly resolved = new Map<number, number>();
    private readonly cells: TerrainCell[] = [];
    /** Painted cells left without a candidate. */
    private readonly invalidRegion: PixelPoint[] = [];
    /** Correction cells that found no candidate and are still unresolved, by key. */
    private readonly invalidOutside = new Map<number, PixelPoint>();
    /**
     * Cells outside the painted region in the bounds: the indexes they share with resolved
     * cells, accumulated as hard indexes.
     */
    private readonly outside = new Map<number, Constraint>();
    /** The batch of corrections being filled: cells queued since the batch before began. */
    private queue: PixelPoint[] = [];
    /** Scratch WangId of a back cell. */
    private readonly scratch = new Uint8Array(WANG_INDEXES);
    /** Scratch candidate set of the look-ahead. */
    private readonly lookAheadSet: Uint32Array;
    /** Bit `i` set: the set's type uses index `i`. */
    private readonly typeMask: number = 0;

    constructor(context: ResolutionContext, painted: Map<number, Constraint>, seedBorder: boolean) {
        this.context = context;
        this.region = [...painted.values()].sort((a, b) => a.y - b.y || a.x - b.x);
        this.unresolved = new Map(painted);
        this.regionKeys = new Set(painted.keys());
        this.seedBorder = seedBorder;
        this.lookAhead = !context.corrections && !context.analysis.fillerComplete;
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (typeUsesIndex(context.analysis.type, index)) this.typeMask |= 1 << index;
        }
        this.lookAheadSet = new Uint32Array(context.table.words);
        this.bounds = this.boundsOf(this.region);
    }

    run(): TerrainFillResult {
        if (this.seedBorder) for (const cell of this.region) this.seed(cell);
        for (const cell of this.region) {
            this.unresolved.delete(this.key(cell.x, cell.y));
            const candidate = this.choose(cell, this.lookAhead);
            if (candidate < 0) this.invalidRegion.push(cell);
            else this.place(cell.x, cell.y, candidate);
        }
        // Batches: the cells queued by the region, then those each batch queued, until none.
        while (this.queue.length > 0) {
            const batch = this.queue;
            this.queue = [];
            for (const cell of batch) this.correct(cell);
        }
        const invalid = [...this.invalidRegion, ...this.invalidOutside.values()];
        return { cells: this.cells, invalid: regionOf(invalid), bounds: this.bounds };
    }

    private key(x: number, y: number): number {
        return y * this.context.width + x;
    }

    private inside(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.context.width && y < this.context.height;
    }

    private inBounds(x: number, y: number): boolean {
        const { bounds } = this;
        return (
            x >= bounds.x &&
            y >= bounds.y &&
            x < bounds.x + bounds.width &&
            y < bounds.y + bounds.height
        );
    }

    /** The region's bounding box grown by the maximum distance, clipped to the map. */
    private boundsOf(region: readonly Constraint[]): CellRect {
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const { x, y } of region) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + 1);
            bottom = Math.max(bottom, y + 1);
        }
        const grow = this.context.analysis.maximumDistance;
        left = Math.max(0, left - grow);
        top = Math.max(0, top - grow);
        right = Math.min(this.context.width, right + grow);
        bottom = Math.min(this.context.height, bottom + grow);
        return { x: left, y: top, width: right - left, height: bottom - top };
    }

    /** The WangId cell `(x, y)` has before the change, into the scratch array. */
    private backWangId(x: number, y: number): Uint8Array {
        wangIdOfCell(this.context.analysis, this.context.back(x, y), this.scratch);
        return this.scratch;
    }

    /**
     * Border seeding: the indexes `cell` shares with neighbours outside the region become hard,
     * with the neighbour's terrains. A neighbour that is not a tile of the set (empty, another
     * tileset) gives nothing to match. Indexes already hard are kept.
     */
    private seed(cell: Constraint): void {
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const [dx, dy] = AROUND[direction]!;
            const nx = cell.x + dx;
            const ny = cell.y + dy;
            if (!this.inside(nx, ny) || this.regionKeys.has(this.key(nx, ny))) continue;
            const around = this.backWangId(nx, ny);
            if (around.every((color) => color === 0)) continue;
            for (const [mine, theirs] of this.context.shared[direction]!) {
                if (cell.hard & (1 << mine)) continue;
                cell.desired[mine] = around[theirs]!;
                cell.hard |= 1 << mine;
            }
        }
    }

    /** The candidates with the terrain of every index of `hard` in `desired`, as a new set. */
    private fitting(desired: Uint8Array, hard: number): Uint32Array {
        const { table } = this.context;
        const set = table.all.slice();
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (hard & (1 << index)) keepWith(table, set, index, desired[index]!);
        }
        return set;
    }

    /**
     * The penalty of candidate `c` for the wishes of `cell`: the transition distance of each
     * wished index that is not hard. −1 when a wish is unreachable and corrections are on.
     */
    private penalty(c: number, cell: Constraint): number {
        const { analysis, table, corrections } = this.context;
        const at = c * WANG_INDEXES;
        let total = 0;
        for (let index = 0; index < WANG_INDEXES; index++) {
            const wish = cell.desired[index]!;
            if (wish === INDEX_MASK || cell.hard & (1 << index)) continue;
            const distance = transitionPenalty(analysis, wish, table.wangIds[at + index]!);
            if (distance >= 0) total += distance;
            else if (corrections) return -1;
            else total += UNREACHABLE;
        }
        return total;
    }

    /**
     * What the look-ahead checks around `cell`: each neighbour not resolved yet (painted or not)
     * that shares an index with it, with the tiles of the set that fit its hard indexes other than
     * the ones it shares with `cell` (those will come from the candidate). The empty cell is no
     * way out. `zeroRest` tells whether the neighbour wishes no terrain at every index it does
     * not share with `cell`: its hard index there, else its wish, else the terrain of its tile.
     */
    private lookAheadOf(cell: Constraint): LookAhead[] {
        const { table } = this.context;
        const out: LookAhead[] = [];
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const pairs = this.context.shared[direction]!;
            if (pairs.length === 0) continue;
            const [dx, dy] = AROUND[direction]!;
            const nx = cell.x + dx;
            const ny = cell.y + dy;
            if (!this.inside(nx, ny)) continue;
            const key = this.key(nx, ny);
            if (this.resolved.has(key)) continue;
            let neighbour = this.unresolved.get(key);
            if (!neighbour) {
                // A painted cell already found invalid keeps its tile: nothing to resolve.
                if (this.regionKeys.has(key)) continue;
                neighbour = this.outside.get(key) ?? {
                    x: nx,
                    y: ny,
                    desired: new Uint8Array(WANG_INDEXES).fill(INDEX_MASK),
                    hard: 0,
                };
            }
            let overwritten = 0;
            for (const [, theirs] of pairs) overwritten |= 1 << theirs;
            const hard = neighbour.hard & ~overwritten & this.typeMask;
            const base = this.fitting(neighbour.desired, hard);
            if (table.empty >= 0) {
                const word = table.empty >>> 5;
                base[word] = base[word]! & ~(1 << (table.empty & 31));
            }
            const current = this.backWangId(nx, ny);
            let zeroRest = true;
            for (let index = 0; index < WANG_INDEXES && zeroRest; index++) {
                if (overwritten & (1 << index)) continue;
                const wish = neighbour.desired[index]!;
                const known = neighbour.hard & (1 << index) || wish !== INDEX_MASK;
                zeroRest = (known ? wish : current[index]!) === 0;
            }
            out.push({ pairs, base, zeroRest });
        }
        return out;
    }

    /**
     * Whether each look-ahead neighbour still has a tile of the set once `c` is placed: one that
     * fits its own hard indexes and has `c`'s terrains at the indexes they share. A neighbour that
     * would then wish no terrain at all eight indexes is not checked.
     */
    private leavesNeighboursSolvable(c: number, neighbours: readonly LookAhead[]): boolean {
        const { table } = this.context;
        const at = c * WANG_INDEXES;
        const set = this.lookAheadSet;
        for (const { pairs, base, zeroRest } of neighbours) {
            if (zeroRest && pairs.every(([mine]) => table.wangIds[at + mine] === 0)) continue;
            set.set(base);
            for (const [mine, theirs] of pairs) {
                keepWith(table, set, theirs, table.wangIds[at + mine]!);
            }
            if (!anyCandidate(set)) return false;
        }
        return true;
    }

    /**
     * The candidate for `cell`, −1 when there is none: the lowest penalty among those that fit
     * (and, with `lookAhead`, leave the neighbours not resolved yet a tile); a tie is broken by the
     * generator.
     */
    private choose(cell: Constraint, lookAhead: boolean): number {
        const fit = this.fitting(cell.desired, cell.hard);
        const scored: Scored[] = [];
        forEachCandidate(fit, (c) => {
            const penalty = this.penalty(c, cell);
            if (penalty >= 0) scored.push({ candidate: c, penalty });
        });
        if (scored.length === 0) return -1;
        // Stable: equal penalties keep the candidates' order.
        scored.sort((a, b) => a.penalty - b.penalty);
        const neighbours = lookAhead ? this.lookAheadOf(cell) : [];
        const ties: number[] = [];
        let start = 0;
        // The cheapest group with a candidate the look-ahead keeps.
        while (start < scored.length && ties.length === 0) {
            const penalty = scored[start]!.penalty;
            let end = start;
            while (end < scored.length && scored[end]!.penalty === penalty) end++;
            for (let i = start; i < end; i++) {
                const { candidate } = scored[i]!;
                if (this.leavesNeighboursSolvable(candidate, neighbours)) ties.push(candidate);
            }
            start = end;
        }
        if (ties.length === 0) return -1;
        if (ties.length === 1) return ties[0]!;
        return ties[this.context.random() % ties.length]!;
    }

    /**
     * Writes candidate `c` at `(x, y)`. The indexes it shares with each neighbour not resolved
     * yet become hard for that neighbour: a painted cell to be resolved, or a cell in the bounds
     * outside the region. With corrections, a side neighbour of the latter
     * kind whose tile disagrees with any of its hard indexes is queued for the next batch;
     * a diagonal neighbour takes the shared corner but is not queued for it.
     */
    private place(x: number, y: number, c: number): void {
        const { table, corrections, shared } = this.context;
        const key = this.key(x, y);
        this.resolved.set(key, c);
        this.invalidOutside.delete(key);
        this.cells.push({ x, y, value: table.values[c]! });
        const at = c * WANG_INDEXES;
        for (let direction = 0; direction < WANG_INDEXES; direction++) {
            const pairs = shared[direction]!;
            if (pairs.length === 0) continue;
            const [dx, dy] = AROUND[direction]!;
            const nx = x + dx;
            const ny = y + dy;
            if (!this.inside(nx, ny)) continue;
            const neighbourKey = this.key(nx, ny);
            if (this.resolved.has(neighbourKey)) continue;
            let neighbour = this.unresolved.get(neighbourKey);
            if (!neighbour) {
                if (this.regionKeys.has(neighbourKey) || !this.inBounds(nx, ny)) continue;
                neighbour = this.outsideConstraint(nx, ny, neighbourKey);
            }
            for (const [mine, theirs] of pairs) {
                neighbour.desired[theirs] = table.wangIds[at + mine]!;
                neighbour.hard |= 1 << theirs;
            }
            if (!corrections || isCorner(direction) || this.unresolved.has(neighbourKey)) continue;
            if (this.disagrees(neighbour)) this.queue.push({ x: nx, y: ny });
        }
    }

    /** The accumulated hard indexes of cell `(x, y)` outside the region, made on first use. */
    private outsideConstraint(x: number, y: number, key: number): Constraint {
        let cell = this.outside.get(key);
        if (!cell) {
            cell = { x, y, desired: new Uint8Array(WANG_INDEXES).fill(INDEX_MASK), hard: 0 };
            this.outside.set(key, cell);
        }
        return cell;
    }

    /** Whether the tile of `cell` now differs from any of its hard indexes. */
    private disagrees(cell: Constraint): boolean {
        const current = this.backWangId(cell.x, cell.y);
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (cell.hard & (1 << index) && current[index] !== cell.desired[index]) return true;
        }
        return false;
    }

    /**
     * Corrects cell `(x, y)` outside the region, unless it is resolved already: the indexes it
     * shares with resolved cells are hard, the others wish the terrains of its tile. Without a
     * candidate it is invalid for now and stays unchanged; a later batch may still resolve it.
     */
    private correct({ x, y }: PixelPoint): void {
        const key = this.key(x, y);
        if (this.resolved.has(key)) return;
        const { analysis } = this.context;
        const accumulated = this.outsideConstraint(x, y, key);
        const desired = new Uint8Array(WANG_INDEXES);
        wangIdOfCell(analysis, this.context.back(x, y), desired);
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (accumulated.hard & (1 << index)) desired[index] = accumulated.desired[index]!;
            else if (!typeUsesIndex(analysis.type, index)) desired[index] = INDEX_MASK;
        }
        const cell: Constraint = { x, y, desired, hard: accumulated.hard };
        const candidate = this.choose(cell, false);
        if (candidate < 0) this.invalidOutside.set(key, { x, y });
        else this.place(x, y, candidate);
    }
}
