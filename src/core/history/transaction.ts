import type { CellRect, CellStore } from "../cells";
import { MEMORY_LIMIT_BYTES, MemoryLimitError, accountMemory, findLayer } from "../model";
import type { ProjectMap, ProjectSession } from "../model";
import { allocateWords, type Allocator } from "./allocate";
import { CELL_PATCH_WORDS, cellPatchCommand } from "./cellPatch";
import { compositeCommand, type Command } from "./command";
import { TransactionError } from "./errors";

/** Target of a transaction: one tile layer of one map. */
export interface TransactionOptions {
    mapId: string;
    layerId: number;
}

/** One open tool stroke on a tile layer (SPEC §3). `History.begin` returns it. */
export interface Transaction {
    readonly mapId: string;
    readonly layerId: number;
    /** The map of the stroke; `set` refuses a cell outside it. */
    readonly map: ProjectMap;
    /** Cells whose value now differs from their value at `begin`. */
    readonly changedCount: number;
    /** Bounding rectangle of the cells written so far; null when none was. */
    readonly dirty: CellRect | null;
    /** False after `commit` or `abort`. A closed transaction rejects every call. */
    readonly open: boolean;
    /** The value of a cell of the layer, 0 when empty. */
    get(x: number, y: number): number;
    /**
     * Writes `value` (0 empties) to a cell of the layer and records its value at `begin`
     * the first time the cell is written. Throws `RangeError` for a cell outside the map or
     * a value that is no cell value; the layer is then unchanged.
     */
    set(x: number, y: number, value: number): void;
    /**
     * Closes the stroke as one history entry labelled `label` and returns its command. The
     * entry keeps `(index, before, after)` of every cell whose value differs from `begin`,
     * 12 bytes each. When none differs — nothing was written, or every written cell has its
     * value at `begin` again — it acts as `abort` and returns null (SPEC §3: a stroke that
     * changes nothing makes no entry). When the entry cannot be allocated, or the project's
     * memory passed its limit, it restores the state at `begin` and throws `AllocationError`
     * or `MemoryLimitError`.
     *
     * `extra` is a change of the session that the owner of the transaction made besides the
     * cells and that is already applied. It becomes part of the same entry, done after the
     * cells and undone before them; when no cell changed it is the entry alone. When the
     * entry cannot be allocated or the memory limit refuses it, `extra` is not undone: that
     * is the owner's part; when the history refuses the recorded entry, both parts are.
     */
    commit(label: string, extra?: Command): Command | null;
    /** Closes the stroke with no history entry: every cell as at `begin`. */
    abort(): void;
}

/** What a transaction needs from the history that begins it. */
export interface TransactionHost {
    allocate: Allocator;
    /** Called once when the transaction closes, before `record`. */
    closed(): void;
    /**
     * Takes the command of a commit. Its change is already in the session; when `record`
     * throws, it has undone the command first.
     */
    record(command: Command): void;
}

function union(a: CellRect | null, b: CellRect): CellRect {
    if (!a) return b;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
}

class StrokeTransaction implements Transaction {
    readonly mapId: string;
    readonly layerId: number;
    readonly map: ProjectMap;
    readonly #session: ProjectSession;
    readonly #host: TransactionHost;
    readonly #cells: CellStore;
    /** Value at `begin` of every cell written so far, by index `y × width + x`. */
    readonly #before = new Map<number, number>();
    #dirty: CellRect | null = null;
    #open = true;

    constructor(
        session: ProjectSession,
        host: TransactionHost,
        map: ProjectMap,
        layerId: number,
        cells: CellStore,
    ) {
        this.mapId = map.id;
        this.layerId = layerId;
        this.map = map;
        this.#session = session;
        this.#host = host;
        this.#cells = cells;
    }

    get changedCount(): number {
        let count = 0;
        for (const [index, before] of this.#before) {
            if (this.#valueAt(index) !== before) count++;
        }
        return count;
    }

    get dirty(): CellRect | null {
        return this.#dirty && { ...this.#dirty };
    }

    get open(): boolean {
        return this.#open;
    }

    get(x: number, y: number): number {
        return this.#cells.get(x, y);
    }

    set(x: number, y: number, value: number): void {
        this.#assertOpen("set");
        const { width, height } = this.map;
        const inside =
            Number.isInteger(x) &&
            Number.isInteger(y) &&
            x >= 0 &&
            y >= 0 &&
            x < width &&
            y < height;
        if (!inside) {
            throw new RangeError(`Cell (${x}, ${y}) lies outside the ${width}×${height} map.`);
        }
        const previous = this.#cells.set(x, y, value);
        const index = y * width + x;
        if (!this.#before.has(index)) this.#before.set(index, previous);
        this.#dirty = union(this.#dirty, { x, y, width: 1, height: 1 });
    }

    commit(label: string, extra?: Command): Command | null {
        this.#assertOpen("commit");
        let cells: Command | null = null;
        try {
            cells = this.#command(label);
            if (cells) {
                const total = accountMemory(this.#session.project).total;
                if (total > MEMORY_LIMIT_BYTES) throw new MemoryLimitError(total);
            }
        } catch (error) {
            cells = null;
            throw error;
        } finally {
            if (!cells) this.#restore();
            this.#close();
        }
        const command =
            cells && extra ? compositeCommand(label, [cells, extra]) : (cells ?? extra ?? null);
        if (command) this.#host.record(command);
        return command;
    }

    abort(): void {
        this.#assertOpen("abort");
        this.#restore();
        this.#close();
    }

    #assertOpen(call: string): void {
        if (!this.#open) {
            throw new TransactionError(`${call}: the transaction is already closed.`);
        }
    }

    #close(): void {
        this.#open = false;
        this.#host.closed();
    }

    #valueAt(index: number): number {
        const { width } = this.map;
        return this.#cells.get(index % width, Math.floor(index / width));
    }

    /** The command for the cells that differ from `begin`, already in the layer; null when none. */
    #command(label: string): Command | null {
        const { width } = this.map;
        const changed: number[] = [];
        let rect: CellRect | null = null;
        for (const [index, before] of this.#before) {
            if (this.#valueAt(index) === before) continue;
            changed.push(index);
            const cell = { x: index % width, y: Math.floor(index / width), width: 1, height: 1 };
            rect = union(rect, cell);
        }
        if (!rect) return null;
        const words = allocateWords(this.#host.allocate, changed.length * CELL_PATCH_WORDS);
        changed.forEach((index, n) => {
            const at = n * CELL_PATCH_WORDS;
            words[at] = index;
            words[at + 1] = this.#before.get(index)!;
            words[at + 2] = this.#valueAt(index);
        });
        return cellPatchCommand({
            label,
            mapId: this.mapId,
            layerId: this.layerId,
            width,
            words,
            cellRect: rect,
        });
    }

    /** Puts every written cell back to its value at `begin`. */
    #restore(): void {
        const { width } = this.map;
        for (const [index, before] of this.#before) {
            this.#cells.set(index % width, Math.floor(index / width), before);
        }
    }
}

/**
 * Begins a stroke on a tile layer of a map: snapshots nothing, records each cell's value
 * at `begin` as the stroke first writes it. Throws `TransactionError` for a target that is
 * not a tile layer of a map of the project; the session is then unchanged.
 */
export function beginTransaction(
    session: ProjectSession,
    options: TransactionOptions,
    host: TransactionHost,
): Transaction {
    const { mapId, layerId } = options;
    const map = session.project.maps.find((candidate) => candidate.id === mapId);
    if (!map) throw new TransactionError(`begin: the project has no map "${mapId}".`);
    const entry = findLayer(map, layerId);
    if (!entry) throw new TransactionError(`begin: map "${mapId}" has no layer ${layerId}.`);
    if (entry.layer.type !== "tile") {
        throw new TransactionError(`begin: layer ${layerId} is a ${entry.layer.type} layer.`);
    }
    return new StrokeTransaction(session, host, map, layerId, entry.layer.cells);
}
