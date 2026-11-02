import type { CellRect, CellStore } from "../cells";
import { MEMORY_LIMIT_BYTES, MemoryLimitError, accountMemory, findLayer } from "../model";
import type { ProjectMap, ProjectSession } from "../model";
import { allocateWords, type Allocator } from "./allocate";
import { CELL_PATCH_WORDS, cellPatchCommand } from "./cellPatch";
import { compositeCommand, type Command } from "./command";
import { TransactionError } from "./errors";

/** Target of a transaction: the tile layer of one map it is begun on. */
export interface TransactionOptions {
    mapId: string;
    layerId: number;
}

/**
 * One open tool stroke (SPEC §3). `History.begin` returns it. It writes the tile layer it was
 * begun on and, when a tool names them, other tile layers of the same map (the eraser's
 * all-layers mode, SPEC §4.3): each cell is recorded with its layer.
 */
export interface Transaction {
    readonly mapId: string;
    /** The tile layer the stroke was begun on: `get` and `set` use it unless told another. */
    readonly layerId: number;
    /** The map of the stroke; `set` refuses a cell outside it. */
    readonly map: ProjectMap;
    /** Cells whose value now differs from their value at `begin`, over every layer written. */
    readonly changedCount: number;
    /** Bounding rectangle of the cells written so far, over every layer; null when none was. */
    readonly dirty: CellRect | null;
    /** The layers written so far, in the order they were first written. */
    readonly layerIds: readonly number[];
    /** False after `commit` or `abort`. A closed transaction rejects every call. */
    readonly open: boolean;
    /**
     * The value of a cell of tile layer `layerId` of the map (the stroke's own by default),
     * 0 when empty. Throws `TransactionError` for a layer that is not a tile layer of the map.
     */
    get(x: number, y: number, layerId?: number): number;
    /**
     * Writes `value` (0 empties) to a cell of tile layer `layerId` of the map (the stroke's
     * own by default) and records its value at `begin` the first time the cell is written.
     * Throws `RangeError` for a cell outside the map or a value that is no cell value, and
     * `TransactionError` for a layer that is not a tile layer of the map; the layer is then
     * unchanged.
     */
    set(x: number, y: number, value: number, layerId?: number): void;
    /**
     * Closes the stroke as one history entry labelled `label` and returns its command. The
     * entry keeps `(index, before, after)` of every cell whose value differs from `begin`,
     * 12 bytes each, as one cell patch per layer. When none differs — nothing was written, or
     * every written cell has its value at `begin` again — it acts as `abort` and returns null
     * (SPEC §3: a stroke that changes nothing makes no entry). When the entry cannot be
     * allocated, or the project's memory passed its limit, it restores the state at `begin`
     * and throws `AllocationError` or `MemoryLimitError`.
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

/** The cells of one layer a stroke wrote. */
interface LayerRecord {
    readonly cells: CellStore;
    /** Value at `begin` of every cell written so far, by index `y × width + x`. */
    readonly before: Map<number, number>;
}

/** The changed cells of one layer, as a commit collects them. */
interface LayerPatch {
    readonly layerId: number;
    readonly record: LayerRecord;
    readonly changed: number[];
    readonly rect: CellRect;
}

class StrokeTransaction implements Transaction {
    readonly mapId: string;
    readonly layerId: number;
    readonly map: ProjectMap;
    readonly #session: ProjectSession;
    readonly #host: TransactionHost;
    readonly #cells: CellStore;
    /** What the stroke wrote, by layer, in the order the layers were first written. */
    readonly #layers = new Map<number, LayerRecord>();
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
        for (const record of this.#layers.values()) {
            for (const [index, before] of record.before) {
                if (this.#valueAt(record.cells, index) !== before) count++;
            }
        }
        return count;
    }

    get dirty(): CellRect | null {
        return this.#dirty && { ...this.#dirty };
    }

    get layerIds(): readonly number[] {
        return [...this.#layers.keys()];
    }

    get open(): boolean {
        return this.#open;
    }

    get(x: number, y: number, layerId: number = this.layerId): number {
        return this.#cellsOf(layerId, "get").get(x, y);
    }

    set(x: number, y: number, value: number, layerId: number = this.layerId): void {
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
        const cells = this.#cellsOf(layerId, "set");
        const previous = cells.set(x, y, value);
        let record = this.#layers.get(layerId);
        if (!record) {
            record = { cells, before: new Map() };
            this.#layers.set(layerId, record);
        }
        const index = y * width + x;
        if (!record.before.has(index)) record.before.set(index, previous);
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

    /** The cells of tile layer `layerId` of the stroke's map; throws naming `call`. */
    #cellsOf(layerId: number, call: string): CellStore {
        if (layerId === this.layerId) return this.#cells;
        const recorded = this.#layers.get(layerId);
        if (recorded) return recorded.cells;
        const entry = findLayer(this.map, layerId);
        if (entry?.layer.type !== "tile") {
            throw new TransactionError(
                `${call}: map "${this.mapId}" has no tile layer ${layerId}.`,
            );
        }
        return entry.layer.cells;
    }

    #valueAt(cells: CellStore, index: number): number {
        const { width } = this.map;
        return cells.get(index % width, Math.floor(index / width));
    }

    /**
     * The command for the cells that differ from `begin`, already in their layers: a cell
     * patch per layer, several as one step; null when none differs.
     */
    #command(label: string): Command | null {
        const { width } = this.map;
        const patches: LayerPatch[] = [];
        let total = 0;
        for (const [layerId, record] of this.#layers) {
            const changed: number[] = [];
            let rect: CellRect | null = null;
            for (const [index, before] of record.before) {
                if (this.#valueAt(record.cells, index) === before) continue;
                changed.push(index);
                const cell = {
                    x: index % width,
                    y: Math.floor(index / width),
                    width: 1,
                    height: 1,
                };
                rect = union(rect, cell);
            }
            if (!rect) continue;
            patches.push({ layerId, record, changed, rect });
            total += changed.length;
        }
        if (patches.length === 0) return null;
        // One allocation for the whole entry: it is made in full or not at all.
        const words = allocateWords(this.#host.allocate, total * CELL_PATCH_WORDS);
        let at = 0;
        const commands = patches.map(({ layerId, record, changed, rect }) => {
            const start = at;
            for (const index of changed) {
                words[at] = index;
                words[at + 1] = record.before.get(index)!;
                words[at + 2] = this.#valueAt(record.cells, index);
                at += CELL_PATCH_WORDS;
            }
            return cellPatchCommand({
                label,
                mapId: this.mapId,
                layerId,
                width,
                words: patches.length === 1 ? words : words.subarray(start, at),
                cellRect: rect,
            });
        });
        return commands.length === 1 ? commands[0]! : compositeCommand(label, commands);
    }

    /** Puts every written cell back to its value at `begin`. */
    #restore(): void {
        const { width } = this.map;
        for (const record of this.#layers.values()) {
            for (const [index, before] of record.before) {
                record.cells.set(index % width, Math.floor(index / width), before);
            }
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
