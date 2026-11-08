import type { CellRect } from "../cells";
import { regionOf } from "../fill";
import type { Region } from "../fill";
import { effectiveTypeForColor, transitionPenalty, wangIdOfCell } from "./analysis";
import type { TerrainAnalysis } from "./analysis";
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

// The terrain filler (SPEC §5.2): Tiled's `WangFiller` (`src/tiled/wangfiller.cpp`, tag v1.12.2)
// for orthogonal fixed maps, every candidate weighing 1 (probabilities are Later) and ties
// broken by a seeded generator. Painting constraints are kept per touched cell (`desired`,
// `mask`); `apply` resolves the region row by row, pushes each placed tile's terrains into its
// neighbours' constraints, looks one step ahead when corrections are off and the set is not
// complete, and with corrections on re-resolves the edge neighbours outside the region that no
// longer match. Nothing is written: the result is a cell patch for a stroke transaction.

/** The value of a cell of the layer the filler matches against, 0 when empty. */
export type TerrainBack = (x: number, y: number) => number;

export interface TerrainFillerOptions {
    analysis: TerrainAnalysis;
    /** The tile layer as it is before the change. */
    back: TerrainBack;
    /** The map's size in cells: nothing outside it is read as a tile or changed. */
    width: number;
    height: number;
    /** Breaks ties between candidates of equal penalty. */
    random: Random;
    /** On for the terrain brush, off for fill tools (Tiled's `setCorrectionsEnabled`). */
    corrections?: boolean;
    /** Whether an empty cell is a candidate (Tiled's `setErasingEnabled`, on by default). */
    erasing?: boolean;
}

/** One cell the filler resolved. */
export interface TerrainCell {
    readonly x: number;
    readonly y: number;
    readonly value: number;
}

/** What `apply` returns. */
export interface TerrainFillResult {
    /** Every resolved cell with its new value, in the order resolved: the cell patch. */
    readonly cells: readonly TerrainCell[];
    /** Cells that could not be resolved; they are not in `cells`, so they stay unchanged. */
    readonly invalid: Region;
    /** The region grown by the maximum distance, clipped to the map; null for no region. */
    readonly bounds: CellRect | null;
}

/** Coordinates are offset by `KEY_BIAS` into `[0, KEY_SPAN)` to form one numeric key. */
const KEY_BIAS = 2 ** 25;
const KEY_SPAN = 2 ** 26;

function cellKey(x: number, y: number): number {
    if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        Math.abs(x) >= KEY_BIAS ||
        Math.abs(y) >= KEY_BIAS
    ) {
        throw new RangeError(`Terrain cell must be integers within ±2^25, got ${x}, ${y}.`);
    }
    return (y + KEY_BIAS) * KEY_SPAN + (x + KEY_BIAS);
}

const keyX = (key: number) => (key % KEY_SPAN) - KEY_BIAS;
const keyY = (key: number) => Math.floor(key / KEY_SPAN) - KEY_BIAS;

/** Indexes of each side of a cell (Tiled's `MaskTopSide` and so on). */
const TOP_SIDE: readonly number[] = [7, 0, 1];
const RIGHT_SIDE: readonly number[] = [1, 2, 3];
const BOTTOM_SIDE: readonly number[] = [3, 4, 5];
const LEFT_SIDE: readonly number[] = [5, 6, 7];

const NO_WISH = new Uint8Array(WANG_INDEXES).fill(INDEX_MASK);
const NO_MASK = new Uint8Array(WANG_INDEXES);
const EMPTY_WANG_ID = new Uint8Array(WANG_INDEXES);

/** Tiled's `Grid<CellInfo>`: per cell a desired WangId and a mask, by default "no wish". */
class ConstraintGrid {
    readonly #index = new Map<number, number>();
    desired = new Uint8Array(64 * WANG_INDEXES);
    mask = new Uint8Array(64 * WANG_INDEXES);

    /** The entry of `key`, or −1 when it has none (its info is the default). */
    get(key: number): number {
        return this.#index.get(key) ?? -1;
    }

    /** The entry of `key`, created with the default info when absent. */
    add(key: number): number {
        const found = this.#index.get(key);
        if (found !== undefined) return found;
        const entry = this.#index.size;
        if ((entry + 1) * WANG_INDEXES > this.desired.length) {
            const desired = new Uint8Array(this.desired.length * 2);
            desired.set(this.desired);
            const mask = new Uint8Array(this.mask.length * 2);
            mask.set(this.mask);
            this.desired = desired;
            this.mask = mask;
        }
        this.desired.fill(INDEX_MASK, entry * 8, entry * 8 + 8);
        this.mask.fill(0, entry * 8, entry * 8 + 8);
        this.#index.set(key, entry);
        return entry;
    }

    /** Whether the entry still has the default info (Tiled's `info == CellInfo()`). */
    isDefault(entry: number): boolean {
        for (let i = entry * 8; i < entry * 8 + 8; i++) {
            if (this.desired[i] !== INDEX_MASK || this.mask[i] !== 0) return false;
        }
        return true;
    }
}

/**
 * Tiled's `updateAdjacent`: the cell at `adjacentIndex` of a placed tile with `wangId` takes
 * the placed tile's terrains at the indexes they share, as hard constraints.
 */
function updateAdjacent(
    desired: Uint8Array,
    mask: Uint8Array,
    at: number,
    wangId: Uint8Array,
    wangAt: number,
    adjacentIndex: number,
): void {
    const index = oppositeIndex(adjacentIndex);
    desired[at + index] = wangId[wangAt + adjacentIndex]!;
    mask[at + index] = INDEX_MASK;
    if (!isCorner(index)) {
        const cornerA = nextIndex(index);
        const cornerB = previousIndex(index);
        desired[at + cornerA] = wangId[wangAt + previousIndex(adjacentIndex)]!;
        mask[at + cornerA] = INDEX_MASK;
        desired[at + cornerB] = wangId[wangAt + nextIndex(adjacentIndex)]!;
        mask[at + cornerB] = INDEX_MASK;
    }
}

/** A rectangle of a banded region, inclusive like Qt's `QRect` `left..right`, `top..bottom`. */
interface BandRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/**
 * The rectangles of `region` in `QRegion`'s order: rows with the same spans that follow one
 * another form one band, bands top to bottom, rectangles of a band left to right. Tiled
 * resolves a rectangle's cells row by row before the next rectangle.
 */
function bandRects(region: Region): BandRect[] {
    const rows: { y: number; spans: Region }[] = [];
    for (let i = 0; i < region.length;) {
        const y = region[i]!.y;
        let end = i;
        while (end < region.length && region[end]!.y === y) end++;
        rows.push({ y, spans: region.slice(i, end) });
        i = end;
    }
    const sameSpans = (a: Region, b: Region) =>
        a.length === b.length &&
        a.every((span, i) => span.start === b[i]!.start && span.end === b[i]!.end);
    const rects: BandRect[] = [];
    for (let r = 0; r < rows.length;) {
        let last = r;
        while (
            last + 1 < rows.length &&
            rows[last + 1]!.y === rows[last]!.y + 1 &&
            sameSpans(rows[last + 1]!.spans, rows[r]!.spans)
        ) {
            last++;
        }
        for (const span of rows[r]!.spans) {
            rects.push({
                left: span.start,
                right: span.end - 1,
                top: rows[r]!.y,
                bottom: rows[last]!.y,
            });
        }
        r = last + 1;
    }
    return rects;
}

/**
 * Tiled's `wangIdFromSurrounding`: a WangId from the WangIds of the 8 cells around one
 * (`INDEX_MASK` at every index of an empty or in-region neighbour). Edges come from the edge
 * neighbours; a corner from the diagonal neighbour, else from the side neighbours next to it.
 */
function wangIdFromSurrounding(around: readonly Uint8Array[]): Uint8Array {
    const id = new Uint8Array(WANG_INDEXES).fill(INDEX_MASK);
    for (const i of [0, 2, 4, 6]) id[i] = around[i]![oppositeIndex(i)]!;
    for (const i of [TOP_RIGHT, BOTTOM_RIGHT, BOTTOM_LEFT, TOP_LEFT]) {
        let color = around[i]![oppositeIndex(i)]!;
        if (color === INDEX_MASK || color === 0) {
            const left = around[previousIndex(i)]![(i + 2) % 8]!;
            if (left !== INDEX_MASK) color = left;
        }
        if (color === INDEX_MASK || color === 0) {
            const right = around[nextIndex(i)]![(i + 6) % 8]!;
            if (right !== INDEX_MASK) color = right;
        }
        id[i] = color;
    }
    return id;
}

/**
 * One terrain change: painting constraints are added with `setCorner`, `setEdge`, `setFullTile`
 * or `setWangIndex` (the brush) or `setRegion` (fill tools), then `apply` resolves them. After
 * `apply` the filler is empty again, like Tiled's.
 */
export class TerrainFiller {
    readonly #analysis: TerrainAnalysis;
    readonly #back: TerrainBack;
    readonly #width: number;
    readonly #height: number;
    readonly #random: Random;
    readonly #corrections: boolean;
    readonly #erasing: boolean;
    /** Indexes the set's type uses (Tiled's `typeMask()`). */
    readonly #typeMask: boolean[];
    #grid = new ConstraintGrid();
    #region = new Set<number>();

    constructor(options: TerrainFillerOptions) {
        const { width, height } = options;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
            throw new RangeError(`Map size must be non-negative integers, got ${width}x${height}.`);
        }
        this.#analysis = options.analysis;
        this.#back = options.back;
        this.#width = width;
        this.#height = height;
        this.#random = options.random;
        this.#corrections = options.corrections ?? false;
        this.#erasing = options.erasing ?? true;
        this.#typeMask = Array.from({ length: WANG_INDEXES }, (_, index) =>
            typeUsesIndex(options.analysis.type, index),
        );
    }

    #inMap(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.#width && y < this.#height;
    }

    /** The cell of the back layer, empty outside the map. */
    #backAt(x: number, y: number): number {
        return this.#inMap(x, y) ? this.#back(x, y) : 0;
    }

    #assertColor(color: number): void {
        if (!Number.isInteger(color) || color < 0 || color > this.#analysis.colorCount) {
            throw new RangeError(
                `Terrain must be an integer 0..${this.#analysis.colorCount}, got ${color}.`,
            );
        }
    }

    /**
     * Tiled's `changePosition`: the first time a cell is touched, its desired WangId becomes the
     * WangId of its current tile and it joins the region. Returns its grid entry.
     */
    changePosition(x: number, y: number): number {
        const key = cellKey(x, y);
        const entry = this.#grid.add(key);
        if (this.#grid.isDefault(entry)) {
            wangIdOfCell(
                this.#analysis,
                this.#backAt(x, y),
                this.#grid.desired.subarray(entry * 8, entry * 8 + 8),
            );
            this.#region.add(key);
        }
        return entry;
    }

    /** Paints `color` at `index` of cell `(x, y)` as a hard constraint. */
    setWangIndex(x: number, y: number, index: WangIndex, color: number): void {
        if (!Number.isInteger(index) || index < 0 || index > 7) {
            throw new RangeError(`WangId index must be 0..7, got ${index}.`);
        }
        this.#assertColor(color);
        const entry = this.changePosition(x, y);
        this.#grid.desired[entry * 8 + index] = color;
        this.#grid.mask[entry * 8 + index] = INDEX_MASK;
    }

    /** Paints `color` at the grid vertex `(x, y)`: the top-left corner of cell `(x, y)`. */
    setCorner(x: number, y: number, color: number): void {
        this.setWangIndex(x, y - 1, BOTTOM_LEFT, color);
        this.setWangIndex(x, y, TOP_LEFT, color);
        this.setWangIndex(x - 1, y, TOP_RIGHT, color);
        this.setWangIndex(x - 1, y - 1, BOTTOM_RIGHT, color);
    }

    /** Paints `color` at `index` of cell `(x, y)` and the opposite index of the cell beyond it. */
    setEdge(x: number, y: number, index: WangIndex, color: number): void {
        this.setWangIndex(x, y, index, color);
        const [dx, dy] = AROUND[index]!;
        this.setWangIndex(x + dx, y + dy, oppositeIndex(index), color);
    }

    /**
     * Full tile mode (Tiled's `WangBrush::updateBrushAt` in tile mode): every index of cell
     * `(x, y)` that the terrain's effective type uses (corners, edges or both, Tiled's
     * `effectiveTypeForColor`), and the indexes its neighbours share with it.
     */
    setFullTile(x: number, y: number, color: number): void {
        this.#assertColor(color);
        const type = effectiveTypeForColor(this.#analysis, color);
        const center = this.changePosition(x, y);
        for (let index = 0; index < WANG_INDEXES; index++) {
            if (!typeUsesIndex(type, index)) continue;
            this.#grid.desired[center * 8 + index] = color;
            this.#grid.mask[center * 8 + index] = INDEX_MASK;
        }
        for (let i = 0; i < WANG_INDEXES; i++) {
            const corner = isCorner(i);
            if (type === "edge" && corner) continue;
            const [dx, dy] = AROUND[i]!;
            const entry = this.changePosition(x + dx, y + dy);
            const { desired, mask } = this.#grid;
            if (corner || type !== "corner") {
                desired[entry * 8 + oppositeIndex(i)] = color;
                mask[entry * 8 + oppositeIndex(i)] = INDEX_MASK;
            }
            if (!corner && type !== "edge") {
                for (const index of [(i + 3) % 8, (i + 5) % 8]) {
                    desired[entry * 8 + index] = color;
                    mask[entry * 8 + index] = INDEX_MASK;
                }
            }
        }
    }

    /** Fill tools: the region to fill, replacing the region (Tiled's `setRegion`). */
    setRegion(region: Region): void {
        this.#region = new Set();
        for (const span of region) {
            for (let x = span.start; x < span.end; x++) this.#region.add(cellKey(x, span.y));
        }
    }

    /** Tiled's `wangIdFromSurroundings`: from the back layer's cells outside the region. */
    #wangIdFromSurroundings(x: number, y: number): Uint8Array {
        const around = AROUND.map(([dx, dy]) => {
            const px = x + dx;
            const py = y + dy;
            const value = this.#backAt(px, py);
            if (value === 0 || this.#region.has(cellKey(px, py))) return NO_WISH;
            const wangId = new Uint8Array(WANG_INDEXES);
            wangIdOfCell(this.#analysis, value, wangId);
            return wangId;
        });
        return wangIdFromSurrounding(around);
    }

    /** Tiled's `wangIdIsUsed`: whether a candidate matches `desired` where `mask` and the type say. */
    #wangIdIsUsed(desired: Uint8Array, mask: Uint8Array): boolean {
        const wangIds = this.#analysis.candidateWangIds;
        const typeMask = this.#typeMask;
        outer: for (let at = 0; at < wangIds.length; at += WANG_INDEXES) {
            for (let i = 0; i < WANG_INDEXES; i++) {
                if (mask[i] && typeMask[i] && wangIds[at + i] !== desired[i]) continue outer;
            }
            return true;
        }
        return false;
    }

    /** Resolves the region and returns the cell patch; the filler is empty afterwards. */
    apply(): TerrainFillResult {
        const analysis = this.#analysis;
        const grid = this.#grid;
        const region = this.#region;
        const resolved = new Map<number, number>();
        /** Region cells outside the map: never changed, and to Tiled already placed. */
        const outside = new Set<number>();
        const cells: TerrainCell[] = [];
        const invalid = new Set<number>();

        for (const key of region) {
            if (!this.#inMap(keyX(key), keyY(key))) outside.add(key);
        }
        for (const key of outside) region.delete(key);

        const reset = () => {
            this.#grid = new ConstraintGrid();
            this.#region = new Set();
        };
        if (region.size === 0) {
            reset();
            return { cells, invalid: [], bounds: null };
        }

        const rects = bandRects(
            regionOf([...region].map((key) => ({ x: keyX(key), y: keyY(key) }))),
        );

        if (!this.#corrections) {
            // Border seeding: the region's border prefers to connect with the cells outside.
            const seed = (x: number, y: number, side: readonly number[]) => {
                const surroundings = this.#wangIdFromSurroundings(x, y);
                const entry = grid.add(cellKey(x, y));
                for (const index of side) {
                    if (grid.mask[entry * 8 + index] || surroundings[index] === INDEX_MASK)
                        continue;
                    grid.desired[entry * 8 + index] = surroundings[index]!;
                }
            };
            for (const rect of rects) {
                for (let x = rect.left; x <= rect.right; x++) {
                    seed(x, rect.top, TOP_SIDE);
                    seed(x, rect.bottom, BOTTOM_SIDE);
                }
                for (let y = rect.top; y <= rect.bottom; y++) {
                    seed(rect.left, y, LEFT_SIDE);
                    seed(rect.right, y, RIGHT_SIDE);
                }
            }
        }

        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const rect of rects) {
            left = Math.min(left, rect.left);
            top = Math.min(top, rect.top);
            right = Math.max(right, rect.right);
            bottom = Math.max(bottom, rect.bottom);
        }
        const margin = analysis.maximumDistance;
        const boundsLeft = Math.max(0, left - margin);
        const boundsTop = Math.max(0, top - margin);
        const boundsRight = Math.min(this.#width - 1, right + margin);
        const boundsBottom = Math.min(this.#height - 1, bottom + margin);
        const inBounds = (x: number, y: number) =>
            x >= boundsLeft && x <= boundsRight && y >= boundsTop && y <= boundsBottom;

        const checked = (key: number) => resolved.has(key) || outside.has(key);
        const candidates = analysis.candidateWangIds;
        const maximumPenalty = analysis.maximumDistance + 1;
        const lookAhead = !this.#corrections && !analysis.fillerComplete;
        const matches: number[] = [];
        const nextDesired = new Uint8Array(WANG_INDEXES);
        const nextMask = new Uint8Array(WANG_INDEXES);
        const current = new Uint8Array(WANG_INDEXES);

        /** Tiled's `findBestMatch`: a candidate index, −1 for the empty cell, null for none. */
        const findBestMatch = (x: number, y: number): number | null => {
            const entry = grid.get(cellKey(x, y));
            const desired = entry < 0 ? NO_WISH : grid.desired.subarray(entry * 8, entry * 8 + 8);
            const mask = entry < 0 ? NO_MASK : grid.mask.subarray(entry * 8, entry * 8 + 8);
            matches.length = 0;
            let lowest = Infinity;
            const consider = (wangIds: Uint8Array, at: number, id: number) => {
                for (let i = 0; i < WANG_INDEXES; i++) {
                    if (mask[i] && wangIds[at + i] !== desired[i]) return;
                }
                let total = 0;
                for (let i = 0; i < WANG_INDEXES; i++) {
                    const wanted = desired[i]!;
                    if (wanted === INDEX_MASK) continue;
                    const color = wangIds[at + i]!;
                    if (wanted === color) continue;
                    let penalty = transitionPenalty(analysis, wanted, color);
                    if (penalty < 0) {
                        // No path to the wanted terrain: with corrections, not a candidate.
                        if (this.#corrections) return;
                        penalty = maximumPenalty;
                    }
                    total += penalty;
                }
                if (total <= lowest) {
                    if (total < lowest) {
                        matches.length = 0;
                        lowest = total;
                    }
                    matches.push(id);
                }
            };
            for (let t = 0; t * WANG_INDEXES < candidates.length; t++)
                consider(candidates, t * 8, t);
            if (this.#erasing) consider(EMPTY_WANG_ID, 0, -1);

            while (matches.length > 0) {
                const pick = matches.length === 1 ? 0 : this.#random() % matches.length;
                const id = matches[pick]!;
                matches[pick] = matches[matches.length - 1]!;
                matches.pop();
                if (lookAhead) {
                    // Reject a pick that would leave a neighbour with no possible tile.
                    const wangIds = id < 0 ? EMPTY_WANG_ID : candidates;
                    const at = id < 0 ? 0 : id * 8;
                    let discard = false;
                    for (let i = 0; i < WANG_INDEXES && !discard; i++) {
                        const [dx, dy] = AROUND[i]!;
                        const key = cellKey(x + dx, y + dy);
                        if (checked(key)) continue;
                        const near = grid.get(key);
                        if (near < 0) {
                            nextDesired.set(NO_WISH);
                            nextMask.set(NO_MASK);
                        } else {
                            nextDesired.set(grid.desired.subarray(near * 8, near * 8 + 8));
                            nextMask.set(grid.mask.subarray(near * 8, near * 8 + 8));
                        }
                        updateAdjacent(nextDesired, nextMask, 0, wangIds, at, i);
                        discard =
                            nextDesired.some((color) => color !== 0) &&
                            !this.#wangIdIsUsed(nextDesired, nextMask);
                    }
                    if (discard) continue;
                }
                return id;
            }
            return null;
        };

        const corrections: number[] = [];
        const resolve = (x: number, y: number) => {
            const key = cellKey(x, y);
            if (checked(key)) return;
            const id = findBestMatch(x, y);
            if (id === null) {
                invalid.add(key);
                return;
            }
            const value = id < 0 ? 0 : analysis.candidateValues[id]!;
            resolved.set(key, value);
            cells.push({ x, y, value });
            const wangIds = id < 0 ? EMPTY_WANG_ID : candidates;
            const at = id < 0 ? 0 : id * 8;
            for (let i = 0; i < WANG_INDEXES; i++) {
                const [dx, dy] = AROUND[i]!;
                const px = x + dx;
                const py = y + dy;
                const near = cellKey(px, py);
                if (checked(near)) continue;
                const entry = grid.add(near);
                const { desired, mask } = grid;
                updateAdjacent(desired, mask, entry * 8, wangIds, at, i);
                // An edge neighbour outside the region may no longer match: correct it.
                if (isCorner(i) || !this.#corrections || !inBounds(px, py) || region.has(near)) {
                    continue;
                }
                wangIdOfCell(analysis, this.#backAt(px, py), current);
                let mismatch = false;
                for (let k = 0; k < WANG_INDEXES; k++) {
                    if (mask[entry * 8 + k] && current[k] !== desired[entry * 8 + k])
                        mismatch = true;
                }
                if (!mismatch) continue;
                corrections.push(px, py);
                for (let k = 0; k < WANG_INDEXES; k++) {
                    if (!mask[entry * 8 + k]) desired[entry * 8 + k] = current[k]!;
                }
            }
        };

        for (const rect of rects) {
            for (let y = rect.top; y <= rect.bottom; y++) {
                for (let x = rect.left; x <= rect.right; x++) resolve(x, y);
            }
        }
        while (corrections.length > 0) {
            const batch = corrections.splice(0, corrections.length);
            for (let i = 0; i < batch.length; i += 2) resolve(batch[i]!, batch[i + 1]!);
        }

        reset();
        // A correction cell found invalid and resolved by a later batch is resolved, not
        // invalid: only cells left unchanged are reported.
        const unresolved = [...invalid]
            .filter((key) => !resolved.has(key))
            .map((key) => ({ x: keyX(key), y: keyY(key) }));
        return {
            cells,
            invalid: regionOf(unresolved),
            bounds: {
                x: boundsLeft,
                y: boundsTop,
                width: boundsRight - boundsLeft + 1,
                height: boundsBottom - boundsTop + 1,
            },
        };
    }
}
